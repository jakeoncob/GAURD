"""Political context.

* County presidential returns (dominant party + its derivative):
    - preferred: MIT Election Data + Science Lab "County Presidential Election Returns 2000-2024"
      (Harvard Dataverse doi:10.7910/DVN/VOQCHQ). The download needs a guestbook click, so
      save the CSV as data/manual/countypres_2000-2024.csv and it is used automatically.
    - automatic fallback: tonmcg/US_County_Level_Election_Results_08-24 on GitHub (2008-2024).
* Mayoral partisanship: American Local Government Elections Database
  (de Benedictis-Kessner, Lee, Velez & Warshaw 2023; OSF https://osf.io/mv5e6), auto-downloaded.
"""
from __future__ import annotations

import io

import numpy as np
import pandas as pd

from ..config import MANUAL_DIR, RAW_DIR
from ..utils import download, github_file_text, log

MEDSL_PATH = MANUAL_DIR / "countypres_2000-2024.csv"
TONMCG_REPO = "tonmcg/US_County_Level_Election_Results_08-24"
TONMCG_FILES = {
    2016: "2016_US_County_Level_Presidential_Results.csv",
    2020: "2020_US_County_Level_Presidential_Results.csv",
    2024: "2024_US_County_Level_Presidential_Results.csv",
}
TONMCG_WIDE_08_16 = "US_County_Level_Presidential_Results_08-16.csv"
LEDB_URL = "https://osf.io/download/tbwzd/"  # ledb_candidatelevel.csv
LEDB_PATH = RAW_DIR / "ledb_candidatelevel.csv"


# --------------------------------------------------------------------------- county presidential
def _from_medsl(path=MEDSL_PATH) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"county_fips": str}, low_memory=False)
    df = df[df["office"].str.upper().str.contains("PRESIDENT", na=False)].copy()
    df["county_fips"] = df["county_fips"].str.replace(r"\.0$", "", regex=True).str.zfill(5)
    df["party"] = df["party"].str.upper()
    votes = df.groupby(["year", "county_fips", "party"])["candidatevotes"].sum().unstack("party")
    total = df.groupby(["year", "county_fips"])["totalvotes"].max()
    out = pd.DataFrame({
        "dem_votes": votes.get("DEMOCRAT"),
        "gop_votes": votes.get("REPUBLICAN"),
        "total_votes": total,
    }).reset_index()
    out = out.rename(columns={"year": "election_year", "county_fips": "county_geoid"})
    return out


def _from_tonmcg() -> pd.DataFrame:
    parts = []
    wide = pd.read_csv(io.StringIO(github_file_text(TONMCG_REPO, TONMCG_WIDE_08_16)), dtype={"fips_code": str})
    for y in (2008, 2012):
        parts.append(pd.DataFrame({
            "election_year": y,
            "county_geoid": wide["fips_code"].str.zfill(5),
            "dem_votes": pd.to_numeric(wide[f"dem_{y}"], errors="coerce"),
            "gop_votes": pd.to_numeric(wide[f"gop_{y}"], errors="coerce"),
            "total_votes": pd.to_numeric(wide[f"total_{y}"], errors="coerce"),
        }))
    for y, fname in TONMCG_FILES.items():
        df = pd.read_csv(io.StringIO(github_file_text(TONMCG_REPO, fname)), dtype=str)
        fips_col = next(c for c in ("county_fips", "combined_fips", "fips_code", "fips") if c in df.columns)
        parts.append(pd.DataFrame({
            "election_year": y,
            "county_geoid": df[fips_col].str.replace(r"\.0$", "", regex=True).str.zfill(5),
            "dem_votes": pd.to_numeric(df["votes_dem"], errors="coerce"),
            "gop_votes": pd.to_numeric(df["votes_gop"], errors="coerce"),
            "total_votes": pd.to_numeric(df["total_votes"], errors="coerce"),
        }))
    return pd.concat(parts, ignore_index=True)


def load_county_presidential() -> pd.DataFrame:
    """Columns: county_geoid, election_year, dem_share, gop_share, dem_margin, total_votes."""
    if MEDSL_PATH.exists():
        log.info("using MEDSL county presidential returns from %s", MEDSL_PATH)
        df = _from_medsl()
    else:
        log.info("MEDSL file not found; using tonmcg GitHub county returns (2008-2024)")
        df = _from_tonmcg()
    df = df.dropna(subset=["total_votes"])
    df = df[df["total_votes"] > 0].copy()
    df["dem_share"] = df["dem_votes"] / df["total_votes"]
    df["gop_share"] = df["gop_votes"] / df["total_votes"]
    df["dem_margin"] = df["dem_share"] - df["gop_share"]
    return df[["county_geoid", "election_year", "dem_share", "gop_share", "dem_margin", "total_votes"]]


def presidential_as_of(pres: pd.DataFrame, keys: pd.DataFrame) -> pd.DataFrame:
    """For each (county_geoid, year) row in ``keys``: latest election <= year and change since the prior one."""
    pres = pres.sort_values(["county_geoid", "election_year"]).copy()
    pres["prev_dem_margin"] = pres.groupby("county_geoid")["dem_margin"].shift(1)
    pres["prev_election_year"] = pres.groupby("county_geoid")["election_year"].shift(1)
    out = keys[["county_geoid", "year"]].drop_duplicates().dropna().copy()
    out["year"] = out["year"].astype(int)
    out = out.sort_values("year")
    pres = pres.sort_values("election_year")
    merged = pd.merge_asof(
        out, pres, left_on="year", right_on="election_year", by="county_geoid", direction="backward"
    )
    merged["pres_dem_margin"] = merged["dem_margin"]
    merged["pres_dem_share"] = merged["dem_share"]
    merged["pres_dem_margin_change"] = merged["dem_margin"] - merged["prev_dem_margin"]
    merged["pres_years_since_election"] = merged["year"] - merged["election_year"]
    return merged[["county_geoid", "year", "pres_dem_share", "pres_dem_margin", "pres_dem_margin_change",
                   "pres_years_since_election"]]


# --------------------------------------------------------------------------- mayors
def load_mayoral_elections() -> pd.DataFrame:
    """Winning mayoral candidates: geoid (7-digit place), year, mayor_dem (1/0), mayor_prob_dem."""
    try:
        path = download(LEDB_URL, LEDB_PATH)
    except Exception as exc:
        log.warning("could not download LEDB mayoral data (%s); mayor features will be NaN", exc)
        return pd.DataFrame(columns=["geoid", "year", "mayor_dem", "mayor_prob_dem"])
    df = pd.read_csv(path, dtype={"fips": str}, low_memory=False)
    m = df[(df["office_consolidated"] == "Mayor") & (df["winner"] == "win")].copy()
    m = m[m["fips"].str.len() == 7]
    m["geoid"] = m["fips"]
    m["mayor_dem"] = np.where(m["pid_est"] == "D", 1.0, np.where(m["pid_est"] == "R", 0.0, np.nan))
    m["mayor_prob_dem"] = pd.to_numeric(m["prob_democrat"], errors="coerce")
    m["year"] = m["year"].astype(int)
    # one winner per place-year (runoffs): keep the latest month
    m = m.sort_values(["geoid", "year", "month"]).drop_duplicates(["geoid", "year"], keep="last")
    return m[["geoid", "year", "mayor_dem", "mayor_prob_dem"]]


def mayor_as_of(mayors: pd.DataFrame, keys: pd.DataFrame, max_age_years: int = 8) -> pd.DataFrame:
    """Sitting mayor's party for each (geoid, year): most recent election won within ``max_age_years``."""
    out = keys[["geoid", "year"]].drop_duplicates().copy()
    out["year"] = out["year"].astype(int)
    if mayors.empty:
        out["mayor_dem"] = np.nan
        out["mayor_prob_dem"] = np.nan
        return out
    m = mayors.rename(columns={"year": "election_year"}).sort_values("election_year")
    merged = pd.merge_asof(out.sort_values("year"), m, left_on="year", right_on="election_year", by="geoid",
                           direction="backward")
    stale = (merged["year"] - merged["election_year"]) > max_age_years
    merged.loc[stale, ["mayor_dem", "mayor_prob_dem"]] = np.nan
    return merged[["geoid", "year", "mayor_dem", "mayor_prob_dem"]]
