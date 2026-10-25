"""American Community Survey 5-year estimates at the place (city) level.

Variables are resolved *by label* through the key-free ``groups/{table}.json`` metadata
endpoint for every vintage, because some tables (e.g. B25034 "year structure built")
renumber their variables between years and label wording drifts (B11003 "no wife present"
-> "no spouse present"). Data queries need ``CENSUS_API_KEY``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
import pandas as pd

from ..config import ACS_YEARS, CENSUS_API_KEY, STATE_FIPS_TO_ABBR
from ..utils import get_json, log

API = "https://api.census.gov/data/{year}/acs/acs5"

Term = tuple[str, str, float]  # (group, label regex, weight)


@dataclass(frozen=True)
class AcsFeature:
    name: str
    numerator: tuple[Term, ...]
    denominator: tuple[Term, ...] | None = None
    scale: float = 1.0
    # alternative table ids tried in order when the primary group is absent for a vintage
    fallbacks: dict[str, tuple[str, ...]] = field(default_factory=dict, hash=False)


def T(group: str, regex: str, weight: float = 1.0) -> Term:
    return (group, regex, weight)


TOTAL = r"^Total$"
YOUNG_MALE = (
    T("B01001", r"^Total!!Male!!(18 and 19 years|20 years|21 years|22 to 24 years)$"),
    T("B01001", r"^Total!!Male!!25 to 29 years$", 0.4),  # 25 and 26 year olds ~ 2/5 of the 25-29 bucket
)
AGE_65_PLUS = r"^Total!!(Male|Female)!!(65 and 66 years|67 to 69 years|70 to 74 years|75 to 79 years|80 to 84 years|85 years and over)$"
UNDER_18 = r"^Total!!(Male|Female)!!(Under 5 years|5 to 9 years|10 to 14 years|15 to 17 years)$"
SINGLE_PARENT = r"^Total!!Other family!!(Male|Female) householder, no (wife|husband|spouse) present!!With own children( of the householder)? under 18 years$"
MARRIED_WITH_KIDS = r"^Total!!Married-couple family!!With own children( of the householder)? under 18 years$"
DISCONNECTED_16_19 = (
    r"^Total!!(Male|Female)!!Not enrolled in school!!"
    r"(High school graduate( \(includes equivalency\))?|Not high school graduate)!!(Unemployed|Not in labor force)$"
)
SNAP = r"^Total!!Household received Food Stamps/SNAP in the past 12 months$"

ACS_FEATURES: list[AcsFeature] = [
    AcsFeature("acs_population", (T("B01003", TOTAL),)),
    AcsFeature("young_male_18_26_count", YOUNG_MALE),
    AcsFeature("young_male_18_26_share", YOUNG_MALE, (T("B01001", TOTAL),)),
    AcsFeature("share_white_nh", (T("B03002", r"^Total!!Not Hispanic or Latino!!White alone$"),), (T("B03002", TOTAL),)),
    AcsFeature("share_black_nh", (T("B03002", r"^Total!!Not Hispanic or Latino!!Black or African American alone$"),), (T("B03002", TOTAL),)),
    AcsFeature("share_hispanic", (T("B03002", r"^Total!!Hispanic or Latino$"),), (T("B03002", TOTAL),)),
    AcsFeature("share_asian_nh", (T("B03002", r"^Total!!Not Hispanic or Latino!!Asian alone$"),), (T("B03002", TOTAL),)),
    AcsFeature(
        "share_other_nh",
        (T("B03002", r"^Total!!Not Hispanic or Latino!!(American Indian and Alaska Native alone|Native Hawaiian and Other Pacific Islander alone|Some other race alone|Two or more races)$"),),
        (T("B03002", TOTAL),),
    ),
    AcsFeature("poverty_rate", (T("B17001", r"^Total!!Income in the past 12 months below poverty level$"),), (T("B17001", TOTAL),)),
    AcsFeature(
        "unemployment_rate",
        (T("B23025", r"^Total!!In labor force!!Civilian labor force!!Unemployed$"),),
        (T("B23025", r"^Total!!In labor force!!Civilian labor force$"),),
    ),
    AcsFeature("single_parent_share", (T("B11003", SINGLE_PARENT),), (T("B11003", SINGLE_PARENT), T("B11003", MARRIED_WITH_KIDS))),
    AcsFeature("renter_share", (T("B25003", r"^Total!!Renter occupied$"),), (T("B25003", TOTAL),)),
    AcsFeature("moved_last_year_share", (T("B07003", TOTAL), T("B07003", r"^Total!!Same house 1 year ago$", -1.0)), (T("B07003", TOTAL),)),
    AcsFeature("vacancy_rate", (T("B25002", r"^Total!!Vacant$"),), (T("B25002", TOTAL),)),
    AcsFeature("other_vacant_share", (T("B25004", r"^Total!!Other vacant$"),), (T("B25002", TOTAL),)),
    AcsFeature("disconnected_youth_16_19_share", (T("B14005", DISCONNECTED_16_19),), (T("B14005", TOTAL),)),
    AcsFeature("housing_pre1950_share", (T("B25034", r"^Total!!Built (1940 to 1949|1939 or earlier)$"),), (T("B25034", TOTAL),)),
    AcsFeature(
        "housing_pre1980_share",
        (T("B25034", r"^Total!!Built (1970 to 1979|1960 to 1969|1950 to 1959|1940 to 1949|1939 or earlier)$"),),
        (T("B25034", TOTAL),),
    ),
    AcsFeature("snap_share", (T("B22010", SNAP),), (T("B22010", TOTAL),), fallbacks={"B22010": ("B22001",)}),
    AcsFeature("median_age", (T("B01002", r"^Median age( --)?!!Total$"),)),
    AcsFeature("share_65plus", (T("B01001", AGE_65_PLUS),), (T("B01001", TOTAL),)),
    AcsFeature("share_under18", (T("B01001", UNDER_18),), (T("B01001", TOTAL),)),
    AcsFeature("median_hh_income", (T("B19013", r"^Median household income"),)),
]


# --------------------------------------------------------------------------- metadata
def normalize_label(label: str) -> str:
    parts = [p.strip().rstrip(":").strip() for p in label.split("!!")]
    if parts and parts[0] == "Estimate":
        parts = parts[1:]
    return "!!".join(parts)


@lru_cache(maxsize=None)
def group_variables(year: int, group: str) -> dict[str, str] | None:
    """{variable code: normalized label} for estimate variables of a table, or None if the table is absent."""
    data = get_json(f"{API.format(year=year)}/groups/{group}.json", allow_404=True)
    if not data:
        return None
    out = {}
    for code, meta in data.get("variables", {}).items():
        if code.endswith("E") and code != "NAME" and code.startswith(group):
            out[code] = normalize_label(meta.get("label", ""))
    return out


def resolve_term(year: int, group: str, regex: str, fallbacks: dict[str, tuple[str, ...]]) -> list[str]:
    for g in (group, *fallbacks.get(group, ())):
        variables = group_variables(year, g)
        if variables is None:
            continue
        pattern = re.compile(regex)
        codes = [code for code, label in variables.items() if pattern.search(label)]
        if codes:
            return codes
        raise KeyError(
            f"ACS {year} table {g}: no variable label matches {regex!r}. "
            f"Available labels: {sorted(set(variables.values()))[:40]}"
        )
    log.warning("ACS %s: table %s (and fallbacks) not available; feature will be NaN", year, group)
    return []


def plan_year(year: int) -> tuple[dict[tuple[str, str], list[str]], set[str]]:
    """Resolve every term of every feature for a vintage. Returns ({(group, regex): codes}, all codes)."""
    resolved: dict[tuple[str, str], list[str]] = {}
    for feat in ACS_FEATURES:
        for group, regex, _w in (*feat.numerator, *(feat.denominator or ())):
            key = (group, regex)
            if key not in resolved:
                resolved[key] = resolve_term(year, group, regex, feat.fallbacks)
    codes = {c for cs in resolved.values() for c in cs}
    return resolved, codes


# --------------------------------------------------------------------------- data
def _require_key() -> str:
    if not CENSUS_API_KEY:
        raise RuntimeError(
            "CENSUS_API_KEY is not set. Request one (free) at https://api.census.gov/data/key_signup.html "
            "and add CENSUS_API_KEY=... to the .env file in the project root."
        )
    return CENSUS_API_KEY


def _rows_to_frame(rows: list[list[str]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["geoid"] = df["state"].str.zfill(2) + df["place"].str.zfill(5)
    return df.drop(columns=["state", "place"]).set_index("geoid")


def fetch_acs_places(year: int, codes: list[str], states: list[str] | None = None) -> pd.DataFrame:
    """All places (nationally, or for the given state FIPS codes) for one vintage; one column per variable."""
    key = _require_key()
    url = API.format(year=year)
    chunks = [codes[i:i + 48] for i in range(0, len(codes), 48)]
    frames = []
    for chunk in chunks:
        get = ",".join(["NAME", *chunk])
        if states is None:
            rows = get_json(url, params={"get": get, "for": "place:*", "key": key})
            frames.append(_rows_to_frame(rows))
        else:
            parts = []
            for st in states:
                rows = get_json(url, params={"get": get, "for": "place:*", "in": f"state:{st}", "key": key})
                parts.append(_rows_to_frame(rows))
            frames.append(pd.concat(parts))
    out = frames[0]
    for extra in frames[1:]:
        out = out.join(extra.drop(columns=["NAME"], errors="ignore"), how="outer")
    for c in out.columns:
        if c != "NAME":
            vals = pd.to_numeric(out[c], errors="coerce")
            out[c] = vals.where(vals >= 0)  # negative sentinels (-666666666 etc.) -> NaN
    return out


def _combine(df: pd.DataFrame, terms: tuple[Term, ...], resolved: dict[tuple[str, str], list[str]]) -> pd.Series:
    total = pd.Series(0.0, index=df.index)
    for group, regex, weight in terms:
        codes = resolved.get((group, regex), [])
        if not codes:
            return pd.Series(np.nan, index=df.index)
        total = total + weight * df[codes].sum(axis=1, min_count=len(codes))
    return total


def build_acs_features(years: list[int] = ACS_YEARS, geoids: set[str] | None = None,
                       national_query: bool = True) -> pd.DataFrame:
    """Long table (geoid, year, <features>) for the requested vintages.

    ``national_query=True`` asks the API for every place in one call per variable chunk;
    if that is refused the loader falls back to one call per state.
    """
    states = None if national_query else sorted(STATE_FIPS_TO_ABBR)
    out = []
    for year in years:
        resolved, codes = plan_year(year)
        codes = sorted(codes)
        log.info("ACS %s: fetching %d variables", year, len(codes))
        try:
            df = fetch_acs_places(year, codes, states)
        except Exception as exc:
            if states is None:
                log.warning("national place query failed for %s (%s); retrying state by state", year, exc)
                df = fetch_acs_places(year, codes, sorted(STATE_FIPS_TO_ABBR))
            else:
                raise
        if geoids is not None:
            df = df[df.index.isin(geoids)]
        feats = pd.DataFrame(index=df.index)
        for feat in ACS_FEATURES:
            num = _combine(df, feat.numerator, resolved)
            if feat.denominator is None:
                feats[feat.name] = num * feat.scale
            else:
                den = _combine(df, feat.denominator, resolved)
                feats[feat.name] = (num / den.where(den > 0)) * feat.scale
        feats["year"] = year
        feats["acs_name"] = df["NAME"]
        out.append(feats.reset_index())
    return pd.concat(out, ignore_index=True)
