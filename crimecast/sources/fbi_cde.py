"""FBI Crime Data Explorer (CDE) API: agencies, offense counts, police employment.

Endpoints (base https://api.usa.gov/crime/fbi/cde, key = api.data.gov key as ``API_KEY``):
    agency/byStateAbbr/{ST}                       -> agencies grouped by county
    summarized/agency/{ORI}/{offense}?from=MM-YYYY&to=MM-YYYY
        offenses.actuals["<Agency> Offenses"]      -> monthly counts
        populations.population["<Agency>"]         -> monthly (annual) population
    pe/agency/{ORI}?from=YYYY&to=YYYY             -> actuals: Male/Female Officers/Civilians by year

Offense slugs: violent-crime, property-crime, homicide, rape, robbery, aggravated-assault,
burglary, larceny, motor-vehicle-theft, arson.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

import numpy as np
import pandas as pd

from ..config import (CONFIG_DIR, CRIME_END_YEAR, CRIME_START_YEAR, FBI_API_KEY, FBI_OFFENSES,
                      FBI_REQUESTS_PER_HOUR, MIN_MONTHS_FOR_ANNUAL)
from ..utils import RateLimiter, get_json, log

BASE = "https://api.usa.gov/crime/fbi/cde"
_LIMITER = RateLimiter(FBI_REQUESTS_PER_HOUR)


def _get(path: str, params: dict | None = None):
    params = dict(params or {})
    params["API_KEY"] = FBI_API_KEY
    return get_json(f"{BASE}/{path}", params=params, limiter=_LIMITER)


# --------------------------------------------------------------------------- agencies
def list_agencies(state_abbr: str) -> pd.DataFrame:
    data = _get(f"agency/byStateAbbr/{state_abbr}")
    rows = []
    for county, agencies in (data or {}).items():
        for a in agencies:
            rows.append({
                "ori": a.get("ori"),
                "agency_name": a.get("agency_name"),
                "agency_type": a.get("agency_type_name"),
                "county_group": county,
                "counties": a.get("counties"),
                "lat": a.get("latitude"),
                "lon": a.get("longitude"),
                "nibrs_start_date": a.get("nibrs_start_date"),
                "state_abbr": a.get("state_abbr"),
            })
    return pd.DataFrame(rows)


_AGENCY_NOISE = re.compile(
    r"\b(police department|police dept\.?|police|department of public safety|dept\.? of public safety|"
    r"public safety|bureau of police|metropolitan|metro|city of|town of|village of|borough of|"
    r"sheriff's office|sheriffs office|sheriff|department|dept\.?|county|consolidated|government|the)\b",
    re.IGNORECASE,
)


def normalize_agency_name(name: str) -> str:
    s = _AGENCY_NOISE.sub(" ", name or "")
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def _norm_place(base_name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", base_name.lower())).strip()


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in (lat1, lon1, lat2, lon2)):
        return float("nan")
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def load_overrides() -> pd.DataFrame:
    path = CONFIG_DIR / "ori_overrides.csv"
    if not path.exists():
        return pd.DataFrame(columns=["geoid", "state_abbr", "agency_name_contains", "note"])
    return pd.read_csv(path, dtype=str).fillna("")


# Agencies that police a facility or system rather than a city's residents.
_SPECIAL_PURPOSE = re.compile(
    r"\b(?:airport|park rangers?|park district|transit|housing authority|schools?|school district|university|"
    r"community college|college police|hospital|railroad|fire department|fire investigation|fire marshal|"
    r"board of education|port authority|capitol police|district attorney|forest (?:service|preserve)|wildlife|"
    r"tribal|highway patrol)\b",
    re.IGNORECASE,
)


def _general_purpose(agencies: pd.DataFrame) -> pd.DataFrame:
    return agencies[~agencies["agency_name"].str.contains(_SPECIAL_PURPOSE, na=False)]


def match_city(city, agencies: pd.DataFrame, overrides: pd.DataFrame) -> dict:
    """Pick the law-enforcement agency for one city (a row of the universe).

    Order: manual override (config/ori_overrides.csv) -> exact normalised-name match -> whole-word
    partial match within 40 km. Special-purpose agencies (airports, park police, schools, ...) are
    never chosen; ties are broken by an exact agency name, then by distance to the city centre.
    """
    result = {"geoid": city.geoid, "ori": None, "agency_name": None, "match_method": None, "match_km": np.nan}
    agencies = _general_purpose(agencies)
    ov = overrides[overrides["geoid"] == city.geoid]
    if len(ov):
        needle = ov.iloc[0]["agency_name_contains"].strip().lower()
        hit = agencies[agencies["agency_name"].str.lower().str.contains(needle, regex=False, na=False)]
        if len(hit):
            hit = hit.assign(
                exact=hit["agency_name"].str.strip().str.lower() == needle,
                law_enforcement=hit["agency_type"].isin(["City", "County"]),
                km=[_haversine_km(city.lat, city.lon, r.lat, r.lon) for r in hit.itertuples()],
            )
            best = hit.sort_values(["exact", "law_enforcement", "km"], ascending=[False, False, True],
                                   na_position="last").iloc[0]
            result.update(ori=best.ori, agency_name=best.agency_name, match_method="override", match_km=best.km)
            return result
    place = _norm_place(city.base_name)
    variants = [place]
    if place.endswith(" city") and len(place) > 5:  # 'boise city' -> 'Boise Police Department'
        variants.append(place[:-5].strip())
    cand = agencies[agencies["agency_type"].isin(["City", "County", "Other"])].copy()
    cand["norm"] = cand["agency_name"].map(normalize_agency_name)
    cand["km"] = [_haversine_km(city.lat, city.lon, r.lat, r.lon) for r in cand.itertuples()]
    for variant in variants:
        exact = cand[(cand["norm"] == variant) & (cand["agency_type"] == "City")]
        if len(exact) == 0:
            exact = cand[cand["norm"] == variant]
        if len(exact):
            best = exact.sort_values("km", na_position="last").iloc[0]
            result.update(ori=best.ori, agency_name=best.agency_name, match_method="exact", match_km=best.km)
            return result
    pat = re.compile(rf"\b{re.escape(place)}\b")
    partial = cand[cand["norm"].map(lambda s: bool(pat.search(s)))].copy()
    partial = partial[(partial["km"].isna()) | (partial["km"] <= 40)]
    if len(partial):
        partial["starts"] = partial["norm"].str.startswith(place)  # 'kansas city' beats 'north kansas city'
        best = partial.sort_values(["starts", "km"], ascending=[False, True], na_position="last").iloc[0]
        result.update(ori=best.ori, agency_name=best.agency_name, match_method="partial", match_km=best.km)
    return result


def match_cities_to_agencies(universe: pd.DataFrame) -> pd.DataFrame:
    overrides = load_overrides()
    out = []
    for state, group in universe.groupby("state_abbr"):
        try:
            agencies = list_agencies(state)
        except Exception as exc:
            log.error("could not list agencies for %s: %s", state, exc)
            agencies = pd.DataFrame(columns=["ori", "agency_name", "agency_type", "lat", "lon"])
        for city in group.itertuples(index=False):
            out.append(match_city(city, agencies, overrides))
    matches = pd.DataFrame(out)
    n = matches["ori"].notna().sum()
    log.info("agency matching: %d/%d cities matched (%s)", n, len(matches),
             matches["match_method"].value_counts(dropna=False).to_dict())
    return matches


# --------------------------------------------------------------------------- offenses
def annualize(monthly: dict[str, float | None], min_months: int = MIN_MONTHS_FOR_ANNUAL) -> dict[int, float]:
    """Sum monthly values per year; years with fewer than ``min_months`` reports are scaled or dropped."""
    by_year: dict[int, list[float]] = defaultdict(list)
    for key, val in (monthly or {}).items():
        try:
            month, year = key.split("-")
            year = int(year)
        except ValueError:
            continue
        if val is not None:
            by_year[year].append(float(val))
    out = {}
    for year, vals in by_year.items():
        if len(vals) >= min_months:
            out[year] = sum(vals) * 12.0 / len(vals)
    return out


def _annual_population(pop_monthly: dict[str, float | None]) -> dict[int, float]:
    out: dict[int, float] = {}
    for key, val in (pop_monthly or {}).items():
        if val is None:
            continue
        year = int(key.split("-")[1])
        out.setdefault(year, float(val))
    return out


def fetch_offense(ori: str, offense: str, start: int = CRIME_START_YEAR, end: int = CRIME_END_YEAR
                  ) -> tuple[dict[int, float], dict[int, float]]:
    """(annual counts, annual population) for one agency and offense slug."""
    windows = [(start, end)]
    counts: dict[int, float] = {}
    pops: dict[int, float] = {}
    tried_split = False
    while windows:
        a, b = windows.pop(0)
        data = _get(f"summarized/agency/{ori}/{offense}", {"from": f"01-{a}", "to": f"12-{b}"})
        actuals = ((data or {}).get("offenses") or {}).get("actuals") or {}
        key = next((k for k in actuals if k.endswith(" Offenses")), None)
        if key is None:
            if not tried_split and b - a > 9:  # maybe the window was too long; split into 10-year chunks
                tried_split = True
                windows = [(y, min(y + 9, end)) for y in range(start, end + 1, 10)]
                continue
            continue
        counts.update(annualize(actuals.get(key) or {}))
        agency_label = key[: -len(" Offenses")]
        pop_dict = ((data.get("populations") or {}).get("population") or {}).get(agency_label) or {}
        pops.update(_annual_population(pop_dict))
    return counts, pops


def fetch_police_employment(ori: str, start: int = CRIME_START_YEAR, end: int = CRIME_END_YEAR) -> pd.DataFrame:
    data = _get(f"pe/agency/{ori}", {"from": start, "to": end})
    act = (data or {}).get("actuals") or {}
    years = sorted({int(y) for series in act.values() for y in series})
    rows = []
    for y in years:
        mo = (act.get("Male Officers") or {}).get(str(y))
        fo = (act.get("Female Officers") or {}).get(str(y))
        mc = (act.get("Male Civilians") or {}).get(str(y))
        fc = (act.get("Female Civilians") or {}).get(str(y))
        officers = (mo or 0) + (fo or 0) if (mo is not None or fo is not None) else np.nan
        civilians = (mc or 0) + (fc or 0) if (mc is not None or fc is not None) else np.nan
        rows.append({"year": y, "officers": officers, "civilians": civilians})
    return pd.DataFrame(rows, columns=["year", "officers", "civilians"])


def build_crime_panel(matches: pd.DataFrame, offenses: dict[str, str] = FBI_OFFENSES,
                      start: int = CRIME_START_YEAR, end: int = CRIME_END_YEAR) -> pd.DataFrame:
    """Long table (geoid, year, ori, fbi_population, <name>_count ..., officers, civilians)."""
    frames = []
    matched = matches.dropna(subset=["ori"])
    for i, m in enumerate(matched.itertuples(index=False), 1):
        rec: dict[int, dict] = defaultdict(dict)
        for name, slug in offenses.items():
            try:
                counts, pops = fetch_offense(m.ori, slug, start, end)
            except Exception as exc:
                log.warning("offense fetch failed for %s %s: %s", m.ori, slug, exc)
                continue
            for y, v in counts.items():
                rec[y][f"{name}_count"] = v
            for y, v in pops.items():
                rec[y].setdefault("fbi_population", v)
        try:
            pe = fetch_police_employment(m.ori, start, end)
            for r in pe.itertuples(index=False):
                rec[r.year]["officers"] = r.officers
                rec[r.year]["civilians"] = r.civilians
        except Exception as exc:
            log.warning("police employment fetch failed for %s: %s", m.ori, exc)
        for y, vals in rec.items():
            frames.append({"geoid": m.geoid, "ori": m.ori, "year": y, **vals})
        if i % 25 == 0:
            log.info("FBI: %d/%d agencies fetched", i, len(matched))
    cols = ["geoid", "ori", "year", "fbi_population", *(f"{n}_count" for n in offenses), "officers", "civilians"]
    df = pd.DataFrame(frames)
    for c in cols:
        if c not in df.columns:
            df[c] = np.nan
    return df[cols].sort_values(["geoid", "year"]).reset_index(drop=True)
