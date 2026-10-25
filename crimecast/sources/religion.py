"""Religion: U.S. Religion Census 2020 (county summaries).

File: https://www.usreligioncensus.org/sites/default/files/2023-06/2020_USRC_Summaries.xlsx
(sheet "2020 County Summary"). The site sometimes refuses scripted downloads; if the automatic
download fails, save the file to data/manual/2020_USRC_Summaries.xlsx.

Religion shares move slowly, so the 2020 county values are applied to every year of the panel.
The 2010 county file (ARDA study RCMSCY10) can be dropped into data/manual/ as
``2010_USRC_County.csv`` with columns FIPS, TOTRATE (adherence rate per 1,000) to add a trend.
"""
from __future__ import annotations

import pandas as pd

from ..config import MANUAL_DIR, RAW_DIR
from ..utils import download, log

USRC_2020_URL = "https://www.usreligioncensus.org/sites/default/files/2023-06/2020_USRC_Summaries.xlsx"
USRC_2020_PATH = RAW_DIR / "2020_USRC_Summaries.xlsx"
USRC_2020_MANUAL = MANUAL_DIR / "2020_USRC_Summaries.xlsx"
USRC_2010_MANUAL = MANUAL_DIR / "2010_USRC_County.csv"


def _usrc_2020_file():
    if USRC_2020_MANUAL.exists():
        return USRC_2020_MANUAL
    try:
        return download(USRC_2020_URL, USRC_2020_PATH)
    except Exception as exc:
        log.warning("USRC 2020 download failed (%s). Download it in a browser to %s", exc, USRC_2020_MANUAL)
        return None


def load_religion_county() -> pd.DataFrame:
    """Columns: county_geoid, rel_adherence_rate (share of pop), rel_congregations_per_100k, [rel_adherence_change_10y]."""
    path = _usrc_2020_file()
    if path is None:
        return pd.DataFrame(columns=["county_geoid", "rel_adherence_rate", "rel_congregations_per_100k"])
    df = pd.read_excel(path, sheet_name="2020 County Summary", dtype={"FIPS": str})
    df.columns = [str(c).strip() for c in df.columns]
    adherents_col = next(c for c in df.columns if c.lower().startswith("adherents as %"))
    cong_col = next(c for c in df.columns if c.lower().startswith("congregations per 100,000"))
    out = pd.DataFrame({
        "county_geoid": df["FIPS"].str.zfill(5),
        "rel_adherence_rate": pd.to_numeric(df[adherents_col], errors="coerce"),
        "rel_congregations_per_100k": pd.to_numeric(df[cong_col], errors="coerce"),
    }).dropna(subset=["county_geoid"])
    if USRC_2010_MANUAL.exists():
        old = pd.read_csv(USRC_2010_MANUAL, dtype={"FIPS": str})
        old["county_geoid"] = old["FIPS"].str.zfill(5)
        old["rate_2010"] = pd.to_numeric(old["TOTRATE"], errors="coerce") / 1000.0
        out = out.merge(old[["county_geoid", "rate_2010"]], on="county_geoid", how="left")
        out["rel_adherence_change_10y"] = out["rel_adherence_rate"] - out["rate_2010"]
        out = out.drop(columns=["rate_2010"])
    return out
