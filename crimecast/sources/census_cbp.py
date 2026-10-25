"""County Business Patterns: establishment counts by county -> commercial density proxies.

CBP is not published for places, so the city's county (from the place->county crosswalk)
is used. Needs ``CENSUS_API_KEY``. NAICS variable name changes with the NAICS vintage.
"""
from __future__ import annotations

import pandas as pd

from ..config import CBP_YEARS, CENSUS_API_KEY
from ..utils import get_json, log

API = "https://api.census.gov/data/{year}/cbp"
SECTORS = {"00": "all", "44-45": "retail", "72": "food_accommodation"}


def _naics_var(year: int) -> str:
    if year <= 2016:
        return "NAICS2012"
    return "NAICS2017"


def load_cbp_county(years: list[int] = CBP_YEARS) -> pd.DataFrame:
    """Columns: county_geoid, year, cbp_estab_all, cbp_emp_all, cbp_estab_retail, cbp_estab_food_accommodation."""
    if not CENSUS_API_KEY:
        raise RuntimeError("CENSUS_API_KEY required for County Business Patterns")
    frames = []
    for year in years:
        var = _naics_var(year)
        year_frame = None
        for code, label in SECTORS.items():
            try:
                rows = get_json(API.format(year=year), params={"get": "ESTAB,EMP", "for": "county:*", var: code, "key": CENSUS_API_KEY})
            except Exception as exc:
                log.warning("CBP %s sector %s unavailable: %s", year, code, exc)
                continue
            if not rows:
                continue
            df = pd.DataFrame(rows[1:], columns=rows[0])
            df["county_geoid"] = df["state"].str.zfill(2) + df["county"].str.zfill(3)
            part = pd.DataFrame({
                "county_geoid": df["county_geoid"],
                f"cbp_estab_{label}": pd.to_numeric(df["ESTAB"], errors="coerce"),
            })
            if label == "all":
                part["cbp_emp_all"] = pd.to_numeric(df["EMP"], errors="coerce")
            year_frame = part if year_frame is None else year_frame.merge(part, on="county_geoid", how="outer")
        if year_frame is not None:
            year_frame["year"] = year
            frames.append(year_frame)
    if not frames:
        return pd.DataFrame(columns=["county_geoid", "year"])
    return pd.concat(frames, ignore_index=True)
