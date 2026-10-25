"""Central configuration for the crime-forecasting pipeline.

Everything that a user is likely to want to tune lives here: API keys (via
environment / ``.env``), the city universe threshold, year ranges, forecast
horizons, and which government-finance item codes count as "social programs".
"""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"            # downloaded bulk files (gitignored)
CACHE_DIR = DATA_DIR / "cache"        # cached API responses (gitignored)
PROCESSED_DIR = DATA_DIR / "processed"  # the assembled panel (gitignored)
MANUAL_DIR = DATA_DIR / "manual"      # files the user downloads by hand (see docs/DATA_SOURCES.md)
MODELS_DIR = PROJECT_ROOT / "models"
CONFIG_DIR = PROJECT_ROOT / "config"

for _d in (RAW_DIR, CACHE_DIR, PROCESSED_DIR, MANUAL_DIR, MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def load_dotenv(path: Path = PROJECT_ROOT / ".env") -> None:
    """Minimal ``.env`` loader (``KEY=VALUE`` lines). Never overrides real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()

# --------------------------------------------------------------------------- keys
# Census Data API key: https://api.census.gov/data/key_signup.html (free, instant e-mail)
CENSUS_API_KEY: str = os.environ.get("CENSUS_API_KEY", "")
# FBI Crime Data Explorer key is an api.data.gov key: https://api.data.gov/signup/
# DEMO_KEY works for a handful of calls per hour only.
FBI_API_KEY: str = os.environ.get("FBI_API_KEY", "DEMO_KEY")
FBI_REQUESTS_PER_HOUR: int = int(
    os.environ.get("FBI_REQUESTS_PER_HOUR", "900" if FBI_API_KEY != "DEMO_KEY" else "10")
)

# --------------------------------------------------------------------------- universe
# Cities = Census incorporated places with population >= MIN_CITY_POP in UNIVERSE_BASE_YEAR.
MIN_CITY_POP: int = int(os.environ.get("CRIMECAST_MIN_POP", "100000"))
UNIVERSE_BASE_YEAR: int = 2020

# --------------------------------------------------------------------------- years
# ACS 5-year vintages (the "year" of a row is the last year of the 5-year window).
# 2011 is the first vintage with the B23025 employment table.
ACS_YEARS: list[int] = list(range(2011, 2024))
CRIME_START_YEAR: int = 2005
CRIME_END_YEAR: int = 2024
CBP_YEARS: list[int] = list(range(2012, 2024))
GOV_FINANCE_YEARS: list[int] = list(range(2017, 2023))   # individual-unit files published for 2017-2022
PRESIDENTIAL_YEARS: list[int] = [2008, 2012, 2016, 2020, 2024]

# --------------------------------------------------------------------------- model
HORIZONS: list[int] = [4]            # years ahead; add 1,2,3 to get a trajectory
DERIVATIVE_LAGS: list[int] = [1, 5]  # d1 = year-over-year change, d5 = non-overlapping ACS windows
TARGETS: list[str] = ["violent", "property"]
FBI_OFFENSES: dict[str, str] = {"violent": "violent-crime", "property": "property-crime"}
MIN_MONTHS_FOR_ANNUAL: int = 12      # require a full year of monthly reports for an annual count
TARGET_CLIP: float = 1.5             # clip |log change| of the training target (robustness)
TEST_START_YEAR: int = 2019          # feature-year t >= this -> hold-out set (targets 2023+ for h=4);
                                     # 2019 keeps the 2017+ government-finance years inside the training set

# --------------------------------------------------------------------------- government finance
# Census of Governments item codes (current operations E.., construction F..).
# "Social programs" = public welfare + health + hospitals + housing & community
# development + parks & recreation + libraries. Edit freely.
SOCIAL_ITEM_CODES: list[str] = [
    "E79", "F79",  # Public welfare NEC
    "E77", "F77",  # Welfare institutions
    "E32", "F32",  # Health
    "E36", "F36",  # Hospitals
    "E50", "F50",  # Housing & community development
    "E61", "F61",  # Parks & recreation
    "E52", "F52",  # Libraries
]
POLICE_ITEM_CODES: list[str] = ["E62", "F62"]
EDUCATION_ITEM_CODES: list[str] = ["E12", "F12"]  # only cities running dependent school systems

# --------------------------------------------------------------------------- states
STATE_FIPS_TO_ABBR: dict[str, str] = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
    "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
    "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}
STATE_ABBR_TO_FIPS: dict[str, str] = {v: k for k, v in STATE_FIPS_TO_ABBR.items()}
