"""Local government spending: Census Annual Survey of State & Local Government Finances,
Individual Unit Files (public use), fiscal years 2017-2022.

ZIP: https://www2.census.gov/programs-surveys/gov-finances/tables/{year}/{year}_Individual_Unit_File.zip
Fixed-width layouts (from the technical documentation inside each ZIP):
    Fin_PID_{year}.txt : ID 1-12 (state 1-2, type 3, county 4-6, unit 7-12), name 13-76, county 77-111,
                         FIPS place 112-116, population 117-125, pop year 126-127, ..., FYE 141-144
    {year}FinEstDAT_*.txt : ID 1-12, item code 13-15, amount (thousands $) 16-27, year 28-31, flag 32
Type code 2 = city, 3 = township. Amounts are summed over the configured item codes and
expressed per resident (nominal dollars).
"""
from __future__ import annotations

import io
import zipfile

import numpy as np
import pandas as pd

from ..config import (EDUCATION_ITEM_CODES, GOV_FINANCE_YEARS, POLICE_ITEM_CODES, RAW_DIR,
                      SOCIAL_ITEM_CODES)
from ..utils import download, log

URL = "https://www2.census.gov/programs-surveys/gov-finances/tables/{year}/{year}_Individual_Unit_File.zip"

PID_COLSPECS = [(0, 12), (12, 76), (76, 111), (111, 116), (116, 125), (125, 127), (140, 144)]
PID_NAMES = ["unit_id", "unit_name", "county_name", "fips_place", "population", "pop_year", "fye"]
DAT_COLSPECS = [(0, 12), (12, 15), (15, 27), (27, 31), (31, 32)]
DAT_NAMES = ["unit_id", "item", "amount", "data_year", "flag"]


def _read_member(zf: zipfile.ZipFile, needle: str) -> bytes:
    names = [n for n in zf.namelist() if needle.lower() in n.lower() and n.lower().endswith(".txt")]
    if not names:
        raise FileNotFoundError(f"no member matching {needle!r} in {zf.filename}")
    return zf.read(names[0])


def load_gov_finance_year(year: int) -> pd.DataFrame:
    path = download(URL.format(year=year), RAW_DIR / f"{year}_Individual_Unit_File.zip")
    with zipfile.ZipFile(path) as zf:
        pid_raw = _read_member(zf, "Fin_PID")
        dat_raw = _read_member(zf, "FinEstDAT")
    pid = pd.read_fwf(io.BytesIO(pid_raw), colspecs=PID_COLSPECS, names=PID_NAMES, dtype=str, encoding="latin-1")
    pid["type"] = pid["unit_id"].str[2]
    pid = pid[pid["type"].isin(["2", "3"])].copy()
    pid["fips_place"] = pid["fips_place"].fillna("").str.strip()
    pid = pid[pid["fips_place"].str.fullmatch(r"\d{5}") & (pid["fips_place"] != "00000")]
    pid["geoid"] = pid["unit_id"].str[:2] + pid["fips_place"]
    pid["population"] = pd.to_numeric(pid["population"], errors="coerce")

    dat = pd.read_fwf(io.BytesIO(dat_raw), colspecs=DAT_COLSPECS, names=DAT_NAMES, dtype=str, encoding="latin-1")
    dat = dat[dat["unit_id"].isin(set(pid["unit_id"]))].copy()
    dat["amount"] = pd.to_numeric(dat["amount"], errors="coerce") * 1000.0  # thousands -> dollars
    dat["item"] = dat["item"].str.strip()

    def total(codes: list[str]) -> pd.Series:
        return dat[dat["item"].isin(codes)].groupby("unit_id")["amount"].sum()

    agg = pd.DataFrame({
        "gov_social_spend": total(SOCIAL_ITEM_CODES),
        "gov_police_spend": total(POLICE_ITEM_CODES),
        "gov_education_spend": total(EDUCATION_ITEM_CODES),
    })
    merged = pid.merge(agg, left_on="unit_id", right_index=True, how="left")
    # a place can host a city and a township with the same FIPS place code: prefer the city, then the larger unit
    merged = merged.sort_values(["geoid", "type", "population"], ascending=[True, True, False])
    merged = merged.drop_duplicates("geoid", keep="first")
    pop = merged["population"].where(merged["population"] > 0)
    out = pd.DataFrame({
        "geoid": merged["geoid"],
        "year": year,
        "gov_social_spend_pc": merged["gov_social_spend"].fillna(0) / pop,
        "gov_police_spend_pc": merged["gov_police_spend"].fillna(0) / pop,
        "gov_education_spend_pc": merged["gov_education_spend"].fillna(0) / pop,
        "gov_unit_population": merged["population"],
    })
    return out.reset_index(drop=True)


def load_gov_finance(years: list[int] = GOV_FINANCE_YEARS, geoids: set[str] | None = None) -> pd.DataFrame:
    frames = []
    for y in years:
        try:
            df = load_gov_finance_year(y)
        except Exception as exc:
            log.warning("government finance %s unavailable: %s", y, exc)
            continue
        if geoids is not None:
            df = df[df["geoid"].isin(geoids)]
        frames.append(df)
        log.info("government finance %s: %d municipal units", y, len(df))
    if not frames:
        return pd.DataFrame(columns=["geoid", "year", "gov_social_spend_pc", "gov_police_spend_pc"])
    return pd.concat(frames, ignore_index=True).replace([np.inf, -np.inf], np.nan)
