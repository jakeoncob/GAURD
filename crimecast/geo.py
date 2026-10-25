"""Geography: the city universe, annual populations, land area, and place -> county crosswalk.

Sources (all key-free):
    * Census Population Estimates, incorporated places & counties (sub-est2019_all.csv, sub-est2024.csv)
    * Census Gazetteer files (land area, internal point coordinates)
    * Census Geocoder (coordinates -> county)
"""
from __future__ import annotations

import io
import re
import zipfile

import pandas as pd

from .config import MIN_CITY_POP, RAW_DIR, STATE_FIPS_TO_ABBR, UNIVERSE_BASE_YEAR
from .utils import download, get_json, log

POPEST_URLS = {
    "2010-2019": "https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/cities/totals/sub-est2019_all.csv",
    "2020-2024": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv",
}
GAZ_PLACE_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip"
GAZ_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip"
GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"


# --------------------------------------------------------------------------- population estimates
def _popest_frames() -> list[pd.DataFrame]:
    frames = []
    for url in POPEST_URLS.values():
        path = download(url, RAW_DIR / url.rsplit("/", 1)[-1])
        frames.append(pd.read_csv(path, encoding="latin-1", dtype=str))
    return frames


def _melt_pop(df: pd.DataFrame, id_cols: list[str]) -> pd.DataFrame:
    pop_cols = [c for c in df.columns if c.startswith("POPESTIMATE")]
    long = df.melt(id_vars=id_cols, value_vars=pop_cols, var_name="year", value_name="population")
    long["year"] = long["year"].str[-4:].astype(int)
    long["population"] = pd.to_numeric(long["population"], errors="coerce")
    return long


def load_place_population() -> pd.DataFrame:
    """Annual population of every incorporated place, 2010-2024. Columns: geoid, name, state_fips, year, population."""
    parts = []
    for df in _popest_frames():
        places = df[df["SUMLEV"] == "162"].copy()
        places["geoid"] = places["STATE"].str.zfill(2) + places["PLACE"].str.zfill(5)
        long = _melt_pop(places, ["geoid", "NAME", "STNAME", "STATE"])
        parts.append(long.rename(columns={"NAME": "name", "STNAME": "state_name", "STATE": "state_fips"}))
    out = pd.concat(parts, ignore_index=True)
    # The 2020-2024 file supersedes the 2010-2019 file where they overlap (2020).
    out = out.drop_duplicates(subset=["geoid", "year"], keep="last")
    return out.sort_values(["geoid", "year"]).reset_index(drop=True)


def load_county_population() -> pd.DataFrame:
    """Annual county population 2010-2024. Columns: county_geoid, year, population."""
    parts = []
    for df in _popest_frames():
        counties = df[df["SUMLEV"] == "050"].copy()
        counties["county_geoid"] = counties["STATE"].str.zfill(2) + counties["COUNTY"].str.zfill(3)
        parts.append(_melt_pop(counties, ["county_geoid"]))
    out = pd.concat(parts, ignore_index=True).drop_duplicates(subset=["county_geoid", "year"], keep="last")
    return out.reset_index(drop=True)


# --------------------------------------------------------------------------- gazetteer
def _read_gazetteer(url: str) -> pd.DataFrame:
    path = download(url, RAW_DIR / url.rsplit("/", 1)[-1])
    with zipfile.ZipFile(path) as zf:
        name = [n for n in zf.namelist() if n.lower().endswith(".txt")][0]
        raw = zf.read(name).decode("latin-1")
    df = pd.read_csv(io.StringIO(raw), sep="\t", dtype=str)
    df.columns = [c.strip() for c in df.columns]
    return df


def load_gazetteer_places() -> pd.DataFrame:
    df = _read_gazetteer(GAZ_PLACE_URL)
    out = pd.DataFrame(
        {
            "geoid": df["GEOID"].str.zfill(7),
            "gaz_name": df["NAME"].str.strip(),
            "lsad": df["LSAD"].str.strip(),
            "aland_sqmi": pd.to_numeric(df["ALAND_SQMI"], errors="coerce"),
            "lat": pd.to_numeric(df["INTPTLAT"], errors="coerce"),
            "lon": pd.to_numeric(df["INTPTLONG"], errors="coerce"),
        }
    )
    return out


def load_gazetteer_counties() -> pd.DataFrame:
    df = _read_gazetteer(GAZ_COUNTY_URL)
    return pd.DataFrame(
        {
            "county_geoid": df["GEOID"].str.zfill(5),
            "county_name": df["NAME"].str.strip(),
            "county_aland_sqmi": pd.to_numeric(df["ALAND_SQMI"], errors="coerce"),
        }
    )


# --------------------------------------------------------------------------- names
# Only the *trailing* legal/statistical suffix is removed, so 'Oklahoma City city' -> 'oklahoma city'.
_SUFFIX_RE = re.compile(
    r"\s+(city and borough|municipality|metropolitan government|metro government|consolidated government|"
    r"urban county|unified government|city|town|village|borough|cdp|comunidad|zona urbana)$",
    re.IGNORECASE,
)


def place_base_name(name: str) -> str:
    """'Nashville-Davidson metropolitan government (balance)' -> 'nashville-davidson'; 'Oklahoma City city' -> 'oklahoma city'."""
    base = re.sub(r"\s*\(balance\)\s*$", "", name.strip())
    base = _SUFFIX_RE.sub("", base.strip())
    base = re.sub(r"\s+", " ", base).strip().lower()
    return base


# --------------------------------------------------------------------------- universe
def city_universe(min_pop: int = MIN_CITY_POP, base_year: int = UNIVERSE_BASE_YEAR) -> pd.DataFrame:
    """Incorporated places with population >= ``min_pop`` in ``base_year`` joined to Gazetteer geometry."""
    pop = load_place_population()
    base = pop[(pop["year"] == base_year) & (pop["population"] >= min_pop)].copy()
    base = base.rename(columns={"population": "base_population"})
    base["state_abbr"] = base["state_fips"].map(STATE_FIPS_TO_ABBR)
    base["base_name"] = base["name"].map(place_base_name)
    gaz = load_gazetteer_places()
    out = base.merge(gaz, on="geoid", how="left")
    missing = out["lat"].isna().sum()
    if missing:
        log.warning("%d cities missing Gazetteer coordinates (will be skipped in county lookup)", missing)
    cols = ["geoid", "name", "base_name", "state_fips", "state_abbr", "state_name", "base_population",
            "aland_sqmi", "lat", "lon", "lsad"]
    return out[cols].sort_values("base_population", ascending=False).reset_index(drop=True)


# --------------------------------------------------------------------------- place -> county
def lookup_county(lat: float, lon: float) -> tuple[str | None, str | None]:
    """County GEOID + name for a coordinate via the Census Geocoder (cached)."""
    params = {
        "x": f"{lon:.6f}",
        "y": f"{lat:.6f}",
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "layers": "Counties",
        "format": "json",
    }
    data = get_json(GEOCODER_URL, params=params)
    counties = (data.get("result", {}).get("geographies", {}) or {}).get("Counties") or []
    if not counties:
        return None, None
    return counties[0].get("GEOID"), counties[0].get("NAME")


def build_place_county_crosswalk(universe: pd.DataFrame) -> pd.DataFrame:
    """One county per city: the county containing the place's internal point."""
    rows = []
    for rec in universe.itertuples(index=False):
        if pd.isna(rec.lat) or pd.isna(rec.lon):
            rows.append((rec.geoid, None, None))
            continue
        try:
            cg, cn = lookup_county(rec.lat, rec.lon)
        except Exception as exc:  # network hiccup: keep going, fill later
            log.warning("geocoder failed for %s: %s", rec.name, exc)
            cg, cn = None, None
        rows.append((rec.geoid, cg, cn))
    xw = pd.DataFrame(rows, columns=["geoid", "county_geoid", "county_name"])
    log.info("place->county crosswalk: %d/%d resolved", xw["county_geoid"].notna().sum(), len(xw))
    return xw
