"""HTTP helpers: retrying session, on-disk response cache, rate limiting, downloads."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import CACHE_DIR

log = logging.getLogger("crimecast")

# Query parameters that must never influence the cache key or be logged.
SECRET_PARAMS = {"key", "api_key", "API_KEY"}


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")


_SESSION: requests.Session | None = None


def session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        s = requests.Session()
        retry = Retry(
            total=5,
            backoff_factor=1.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "HEAD"]),
            raise_on_status=False,
        )
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.mount("http://", HTTPAdapter(max_retries=retry))
        s.headers.update({"User-Agent": "Mozilla/5.0 (compatible; crimecast/0.1; research use)"})
        _SESSION = s
    return _SESSION


class RateLimiter:
    """Simple fixed-interval limiter (N requests per hour)."""

    def __init__(self, per_hour: int):
        self.min_interval = 3600.0 / per_hour if per_hour and per_hour > 0 else 0.0
        self._last = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return
        delta = time.monotonic() - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()


def cache_path(url: str, params: dict[str, Any] | None, suffix: str = ".json") -> Path:
    public = {k: str(v) for k, v in (params or {}).items() if k not in SECRET_PARAMS}
    digest = hashlib.sha1((url + "?" + json.dumps(public, sort_keys=True)).encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}{suffix}"


class MissingKeyError(RuntimeError):
    pass


def get_json(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    use_cache: bool = True,
    timeout: int = 180,
    allow_404: bool = False,
    limiter: RateLimiter | None = None,
) -> Any:
    """GET a JSON document with on-disk caching. Returns ``None`` for 404 if ``allow_404``.

    The cache key ignores API keys, so cached data can be shared between machines.
    """
    path = cache_path(url, params, ".json")
    if use_cache and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    if limiter is not None:
        limiter.wait()
    resp = session().get(url, params=params, timeout=timeout)
    if "missing_key" in resp.url or resp.headers.get("X-DataWebAPI-KeyError"):
        raise MissingKeyError(
            "The Census Data API rejected the request because no valid key was supplied. "
            "Get a free key at https://api.census.gov/data/key_signup.html and put it in .env as CENSUS_API_KEY=..."
        )
    if resp.status_code == 404 and allow_404:
        return None
    if resp.status_code == 204:  # Census API: valid query, no rows
        return []
    if resp.status_code >= 400:
        raise requests.HTTPError(f"{resp.status_code} for {url}: {resp.text[:300]}")
    try:
        data = resp.json()
    except ValueError as exc:  # pragma: no cover - server returned text
        raise RuntimeError(f"Non-JSON response from {url}: {resp.text[:300]}") from exc
    if use_cache:
        path.write_text(json.dumps(data), encoding="utf-8")
    return data


def download(url: str, dest: Path, *, force: bool = False, timeout: int = 900) -> Path:
    """Stream a file to ``dest`` unless it already exists."""
    dest = Path(dest)
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading %s", url)
    with session().get(url, stream=True, timeout=timeout) as resp:
        if resp.status_code >= 400:
            raise requests.HTTPError(f"{resp.status_code} for {url}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                if chunk:
                    fh.write(chunk)
        tmp.replace(dest)
    return dest


def github_file_text(owner_repo: str, path: str, ref: str = "master") -> str:
    """Fetch a text file from GitHub, falling back to the API when raw.githubusercontent.com is blocked."""
    raw = f"https://raw.githubusercontent.com/{owner_repo}/{ref}/{path}"
    cache = cache_path(raw, None, ".txt")
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    text: str | None = None
    try:
        resp = session().get(raw, timeout=60)
        if resp.status_code == 200:
            text = resp.text
    except requests.RequestException:
        text = None
    if text is None:
        api = f"https://api.github.com/repos/{owner_repo}/contents/{path}"
        payload = get_json(api, params={"ref": ref}, use_cache=False)
        if payload.get("encoding") == "base64":
            text = base64.b64decode(payload["content"]).decode("utf-8")
        else:  # files > 1 MB: API gives a download_url only
            text = session().get(payload["download_url"], timeout=120).text
    cache.write_text(text, encoding="utf-8")
    return text
