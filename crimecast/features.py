"""Assemble the city x year panel: features at year t, their derivatives, and crime targets at t+h.

Row = (geoid, year). "year" is the last year of the ACS 5-year window and the calendar year
of the crime counts. Targets are log changes in the crime rate between t and t+h.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import (ACS_YEARS, CRIME_END_YEAR, CRIME_START_YEAR, DERIVATIVE_LAGS, HORIZONS, PROCESSED_DIR,
                     TARGETS)
from .geo import (build_place_county_crosswalk, city_universe, load_county_population, load_gazetteer_counties,
                  load_place_population)
from .sources.census_acs import ACS_FEATURES, build_acs_features
from .sources.census_cbp import load_cbp_county
from .sources.elections import (load_county_presidential, load_mayoral_elections, mayor_as_of,
                                presidential_as_of)
from .sources.fbi_cde import build_crime_panel, match_cities_to_agencies
from .sources.gov_finance import load_gov_finance
from .sources.religion import load_religion_county
from .utils import log

PANEL_PATH = PROCESSED_DIR / "panel.parquet"
META_PATH = PROCESSED_DIR / "panel_meta.json"
ID_COLUMNS = ["geoid", "name", "state_abbr", "year", "county_geoid", "ori"]

# Features whose year-over-year change ("derivative") is added to the panel.
DERIVATIVE_BASE = [
    "young_male_18_26_share", "young_male_18_26_count",
    "share_white_nh", "share_black_nh", "share_hispanic", "share_asian_nh", "share_other_nh",
    "poverty_rate", "unemployment_rate", "single_parent_share", "renter_share", "moved_last_year_share",
    "vacancy_rate", "other_vacant_share", "disconnected_youth_16_19_share",
    "housing_pre1950_share", "housing_pre1980_share", "snap_share", "median_age", "share_65plus", "share_under18",
    "median_hh_income", "log_population", "pop_density",
    "gov_social_spend_pc", "gov_police_spend_pc", "officers_per_1000",
    "cbp_estab_per_1000", "cbp_retail_food_estab_per_1000", "cbp_estab_per_sqmi",
]
EPS_RATE = 1.0  # offenses per 100k added before taking logs (avoids log(0) in tiny counts)


def full_grid(geoids: pd.Series, years: list[int]) -> pd.DataFrame:
    return pd.MultiIndex.from_product([sorted(set(geoids)), years], names=["geoid", "year"]).to_frame(index=False)


def interpolate_within_city(panel: pd.DataFrame, cols: list[str], limit_direction: str = "both") -> pd.DataFrame:
    """Linear interpolation across years inside each city for sparse sources (gov finance, CBP)."""
    panel = panel.sort_values(["geoid", "year"])
    for c in cols:
        if c in panel.columns:
            panel[c] = panel.groupby("geoid")[c].transform(
                lambda s: s.interpolate(limit_direction=limit_direction, limit_area=None)
            )
    return panel


def add_crime_rates(panel: pd.DataFrame, targets: list[str]) -> pd.DataFrame:
    pop = panel["fbi_population"].where(panel["fbi_population"] > 0).fillna(panel["population"])
    for t in targets:
        rate = panel[f"{t}_count"] / pop * 1e5
        panel[f"{t}_rate"] = rate
        panel[f"log_{t}_rate"] = np.log(rate + EPS_RATE)
        g = panel.groupby("geoid")[f"log_{t}_rate"]
        panel[f"dlog_{t}_1y"] = g.diff(1)
        panel[f"dlog_{t}_3y_slope"] = g.diff(3) / 3.0
        panel[f"dlog_{t}_5y_slope"] = g.diff(5) / 5.0
    return panel


def add_targets(panel: pd.DataFrame, targets: list[str], horizons: list[int]) -> pd.DataFrame:
    for t in targets:
        g = panel.groupby("geoid")[f"log_{t}_rate"]
        for h in horizons:
            panel[f"y_{t}_h{h}"] = g.shift(-h) - panel[f"log_{t}_rate"]
            panel[f"future_{t}_rate_h{h}"] = panel.groupby("geoid")[f"{t}_rate"].shift(-h)
    return panel


def add_derivatives(panel: pd.DataFrame, cols: list[str], lags: list[int]) -> pd.DataFrame:
    panel = panel.sort_values(["geoid", "year"])
    new_cols = {}
    for lag in lags:
        for c in cols:
            if c in panel.columns:
                new_cols[f"d{lag}_{c}"] = panel.groupby("geoid")[c].diff(lag)
    return pd.concat([panel, pd.DataFrame(new_cols, index=panel.index)], axis=1)


def build_panel(min_pop: int | None = None, years: list[int] = ACS_YEARS, horizons: list[int] = HORIZONS,
                targets: list[str] = TARGETS, skip: set[str] | None = None, save: bool = True) -> pd.DataFrame:
    """Download everything (cached) and return the assembled panel. ``skip`` names sources to leave out
    (e.g. {"cbp", "gov_finance", "mayors", "religion", "elections"}) when a key or file is unavailable."""
    skip = skip or set()
    universe = city_universe(min_pop) if min_pop else city_universe()
    log.info("universe: %d cities", len(universe))
    geoids = set(universe["geoid"])

    # --- grid over all years needed for lags and leads
    all_years = list(range(min(min(years), CRIME_START_YEAR), max(max(years) + max(horizons), CRIME_END_YEAR) + 1))
    panel = full_grid(universe["geoid"], all_years)
    panel = panel.merge(universe[["geoid", "name", "state_abbr", "aland_sqmi", "lat", "lon"]], on="geoid", how="left")

    # --- population (annual estimates) and density
    pop = load_place_population()[["geoid", "year", "population"]]
    panel = panel.merge(pop, on=["geoid", "year"], how="left")
    panel["population"] = panel.groupby("geoid")["population"].transform(lambda s: s.interpolate(limit_direction="both"))
    panel["log_population"] = np.log(panel["population"])
    panel["pop_density"] = panel["population"] / panel["aland_sqmi"].where(panel["aland_sqmi"] > 0)

    # --- county crosswalk
    xw = build_place_county_crosswalk(universe)
    panel = panel.merge(xw[["geoid", "county_geoid"]], on="geoid", how="left")

    # --- ACS
    acs = build_acs_features(years, geoids)
    panel = panel.merge(acs.drop(columns=["acs_name"]), on=["geoid", "year"], how="left")

    # --- FBI crime + police employment
    matches = match_cities_to_agencies(universe)
    if save:
        matches.to_csv(PROCESSED_DIR / "agency_matches.csv", index=False)  # audit which agency each city got
    crime = build_crime_panel(matches, start=CRIME_START_YEAR, end=CRIME_END_YEAR)
    panel = panel.merge(crime, on=["geoid", "year"], how="left")
    panel["ori"] = panel.groupby("geoid")["ori"].transform(lambda s: s.ffill().bfill())
    panel = add_crime_rates(panel, targets)
    pop_for_rates = panel["fbi_population"].where(panel["fbi_population"] > 0).fillna(panel["population"])
    panel["officers_per_1000"] = panel["officers"] / pop_for_rates * 1000.0

    # --- county-level context: elections, religion, commercial density
    if "elections" not in skip:
        try:
            pres = presidential_as_of(load_county_presidential(), panel)
            panel = panel.merge(pres, on=["county_geoid", "year"], how="left")
        except Exception as exc:
            log.warning("presidential returns skipped: %s", exc)
    if "mayors" not in skip:
        try:
            panel = panel.merge(mayor_as_of(load_mayoral_elections(), panel), on=["geoid", "year"], how="left")
        except Exception as exc:
            log.warning("mayoral data skipped: %s", exc)
    if "religion" not in skip:
        try:
            panel = panel.merge(load_religion_county(), on="county_geoid", how="left")
        except Exception as exc:
            log.warning("religion data skipped: %s", exc)
    if "cbp" not in skip:
        try:
            cbp = load_cbp_county()
            cpop = load_county_population()
            carea = load_gazetteer_counties()
            cbp = cbp.merge(cpop, on=["county_geoid", "year"], how="left").merge(carea, on="county_geoid", how="left")
            cbp["cbp_estab_per_1000"] = cbp["cbp_estab_all"] / cbp["population"] * 1000.0
            cbp["cbp_retail_food_estab_per_1000"] = (
                cbp.get("cbp_estab_retail", np.nan) + cbp.get("cbp_estab_food_accommodation", np.nan)
            ) / cbp["population"] * 1000.0
            cbp["cbp_estab_per_sqmi"] = cbp["cbp_estab_all"] / cbp["county_aland_sqmi"]
            keep = ["county_geoid", "year", "cbp_estab_per_1000", "cbp_retail_food_estab_per_1000", "cbp_estab_per_sqmi"]
            panel = panel.merge(cbp[keep], on=["county_geoid", "year"], how="left")
            panel = interpolate_within_city(panel, keep[2:])
        except Exception as exc:
            log.warning("County Business Patterns skipped: %s", exc)

    # --- city government spending (sparse years -> interpolate)
    if "gov_finance" not in skip:
        try:
            gov = load_gov_finance(geoids=geoids)
            panel = panel.merge(gov.drop(columns=["gov_unit_population"], errors="ignore"), on=["geoid", "year"], how="left")
            # interpolate between survey years and carry the latest forward; years before the first survey stay NaN
            panel = interpolate_within_city(panel, ["gov_social_spend_pc", "gov_police_spend_pc", "gov_education_spend_pc"],
                                            limit_direction="forward")
        except Exception as exc:
            log.warning("government finance skipped: %s", exc)

    # --- derivatives and targets
    panel = add_derivatives(panel, DERIVATIVE_BASE, DERIVATIVE_LAGS)
    panel = add_targets(panel, targets, horizons)
    panel = panel[panel["year"].isin(years)].copy()
    panel = panel.sort_values(["geoid", "year"]).reset_index(drop=True)

    if save:
        panel.to_parquet(PANEL_PATH, index=False)
        meta = {
            "n_cities": int(panel["geoid"].nunique()),
            "years": years,
            "horizons": horizons,
            "targets": targets,
            "acs_features": [f.name for f in ACS_FEATURES],
            "derivative_base": DERIVATIVE_BASE,
            "derivative_lags": DERIVATIVE_LAGS,
            "columns": list(panel.columns),
        }
        META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        log.info("panel saved: %s (%d rows, %d columns)", PANEL_PATH, len(panel), panel.shape[1])
    return panel


def load_panel() -> pd.DataFrame:
    if not PANEL_PATH.exists():
        raise FileNotFoundError(f"{PANEL_PATH} not found; run `python Main.py build-data` first")
    return pd.read_parquet(PANEL_PATH)
