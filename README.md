# HackathonGroup: city crime-rate forecasting (LightGBM)

## GAURD website

The interactive crime forecast map, comparison charts, and Gemma news research are in [`website/`](website/README.md).

With Node.js 22.13 or newer:

```sh
cd website
npm ci
npm run preview:local
```

Open `http://127.0.0.1:4173`. For local Gemma answers, copy `website/.env.example` to `website/.env.local` and add your Google AI Studio key. Environment files are ignored by Git.


Forecasts a U.S. city's violent and property crime rate **four years ahead** from its current
demographic, economic, housing, political, religious, policing and public-spending profile,
plus the *direction* those inputs are moving (their derivatives). One model generalises across
cities: it is trained on a panel of every incorporated place with 100k+ residents (323 cities,
2011-2024) and can score any city in that universe, or a smaller one if you lower the threshold.

Everything is pulled from public sources by `python Main.py build-data`. Two free API keys are
needed; see **Setup**. The feature-by-feature sourcing is in [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Setup

```powershell
# 1. dependencies (a .venv already exists in this folder with everything installed)
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. keys: copy .env.example -> .env and fill in
#    CENSUS_API_KEY  https://api.census.gov/data/key_signup.html   (the Census API now refuses keyless data requests)
#    FBI_API_KEY     https://api.data.gov/signup/                  (DEMO_KEY only allows 10 requests/hour)

# 3. verify
.\.venv\Scripts\python.exe Main.py check
```

## Run

```powershell
.\.venv\Scripts\python.exe Main.py build-data            # ~1-2 h first time (FBI API is rate limited); everything is cached
.\.venv\Scripts\python.exe Main.py train                 # a few minutes -> models/violent_h4.txt, models/property_h4.txt
.\.venv\Scripts\python.exe Main.py predict --city Baltimore --state MD
.\.venv\Scripts\python.exe Main.py predict-all --out forecasts.csv
```

Useful flags: `build-data --min-pop 50000` (more cities, ~3x the FBI calls), `build-data --horizons 1 2 3 4`
then `train --horizons 1 2 3 4` to get a year-by-year trajectory, `build-data --skip cbp gov_finance`
to leave out slow or optional sources.

Smoke test without any keys (synthetic sources through the real panel / training / prediction code):

```powershell
.\.venv\Scripts\python.exe tests\smoke_test.py
```

## Using it from the application

```python
from crimecast.predict import predict_city, predict_all

predict_city("Baltimore", "MD")            # dict: current rate, predicted rate, % change, top drivers
predict_all()                              # DataFrame: one row per city x target x horizon
```

`predict_city` returns, per target and horizon:

```json
{"target": "violent", "horizon_years": 4, "as_of_year": 2023, "forecast_year": 2027,
 "current_rate_per_100k": 1037.2, "predicted_rate_per_100k": 986.9, "predicted_pct_change": -4.8,
 "top_drivers": [{"feature": "share_white_nh", "value": 0.09, "contribution": -0.017}, "..."]}
```

`top_drivers` are LightGBM per-row feature contributions (log-change units), ready for an
"why does the model think this" panel.

## How the model works

* **Unit of observation**: city x year. "Year t" = last year of the ACS 5-year window and the
  calendar year of the FBI counts.
* **Inputs at year t** (your list, in the order given):

  | Requested input | Feature(s) |
  |---|---|
  | Young male population 18-26 and its derivative | `young_male_18_26_share`, `young_male_18_26_count`, `d1_`/`d5_` versions |
  | Race statistics and derivative | `share_white_nh`, `share_black_nh`, `share_hispanic`, `share_asian_nh`, `share_other_nh` + `d1_`/`d5_` |
  | Dominant political parties | county presidential margin `pres_dem_margin`, `pres_dem_share`, its change since the previous election, and the sitting mayor's party `mayor_dem` |
  | Religion statistics | `rel_adherence_rate`, `rel_congregations_per_100k` (county, 2020) |
  | Government investment in social programs and derivative | `gov_social_spend_pc` (welfare, health, hospitals, housing & community development, parks, libraries; dollars per resident) + `d1_`/`d5_`; also `gov_police_spend_pc` |
  | Political parties by age group | **no public city-level source** (see `docs/DATA_SOURCES.md`); age structure `share_65plus`, `median_age`, `share_under18` and their derivatives are included so the model can learn the "older electorate shrinking" interaction with partisanship |
  | EBT statistics | `snap_share` (households receiving SNAP) |
  | Poverty / unemployment | `poverty_rate`, `unemployment_rate` |
  | % single-parent households | `single_parent_share` (share of families with children headed by one parent) |
  | % renters / % moved in last year | `renter_share`, `moved_last_year_share` |
  | Vacant / abandoned buildings | `vacancy_rate`, `other_vacant_share` ("other vacant" is the Census category closest to abandoned) |
  | Commercial density | `cbp_estab_per_1000`, `cbp_retail_food_estab_per_1000`, `cbp_estab_per_sqmi` (county) |
  | % youth 16-24 not in school or working | `disconnected_youth_16_19_share` (the ACS place-level table stops at 19; 16-24 needs microdata) |
  | Police officers per capita | `officers_per_1000` + derivatives |
  | % housing built before 1950 / 1978 | `housing_pre1950_share`, `housing_pre1980_share` (ACS buckets are decades) |
  | Population density | `pop_density`, `log_population` |

  Plus the crime history itself: `log_violent_rate`, `log_property_rate`, their 1-year change and 3/5-year
  slopes. A model forecasting a *change* must know the starting level; without these the forecast is
  just "what do cities with this profile look like", not "where is this city going".
* **Derivatives**: `d1_x = x_t - x_{t-1}` and `d5_x = x_t - x_{t-5}`. ACS 5-year windows overlap, so `d1`
  is smoothed; `d5` compares non-overlapping windows and is the cleaner trend signal.
* **Target**: `y = log(rate_{t+4} + 1) - log(rate_t + 1)` per 100k residents, for violent and property
  crime separately (two models). Predicted rate = `(rate_t + 1) * exp(y_hat) - 1`.
* **Validation**: rows with feature-year >= 2019 (outcomes 2023-2024) are a time hold-out never used
  for fitting; inside the training years a GroupKFold over cities estimates performance on *unseen*
  cities. Both are compared with "no change" and "trend continues" baselines and written to
  `models/training_summary.json`.
* **Current results** (trained 2026-10-24 on 2,390 city-years, 2011-2018; hold-out 593 rows):

  | Target | Model RMSE (log change) | "No change" | "Trend continues" | Median error on the rate |
  |---|---|---|---|---|
  | Violent | 0.279 | 0.314 | 0.417 | 15.8% (no-change: 16.7%) |
  | Property | 0.253 | 0.272 | 0.371 | 13.6% (no-change: 15.9%) |

  Variable importances with direction of effect: `models/feature_weights_with_direction.csv`.

## Known limitations (read before demoing)

* **FBI reporting gaps.** Agencies that switched to NIBRS mid-year (most big cities in 2021) have
  partial years; those are dropped, not imputed. A few large agencies (e.g. parts of 2021-2022 for
  NYC/LA) are missing entirely in the FBI data.
* **County proxies.** Elections, religion and commercial density are county-level, mapped through
  the county containing the city's centre.
* **Spending data** exist for fiscal years 2017-2022 only (interpolated between, carried forward after).
* **Religion** is the 2020 census of congregations applied to all years (slow-moving).
* **Correlation, not causation.** Feature contributions explain the model, not the city.
* **Government spending** only exists for fiscal 2017-2022, so its 5-year changes are always missing and
  its levels enter with small weight. Earlier years would need the Lincoln Institute FiSC database.
* **Direction of effect is not causation.** The model forecasts *change*; a variable marked "negative" means
  cities with high values tended to decline from high starting rates, not that the variable lowers crime.

## Layout

```
Main.py                      CLI (check / build-data / train / predict / predict-all)
crimecast/config.py          keys, thresholds, year ranges, item codes
crimecast/geo.py             city universe, populations, land area, place->county
crimecast/sources/           census_acs, census_cbp, fbi_cde, elections, religion, gov_finance
crimecast/features.py        panel assembly, derivatives, targets  -> data/processed/panel.parquet
crimecast/train.py           LightGBM training + validation        -> models/
crimecast/predict.py         predict_city / predict_all
config/ori_overrides.csv     manual city -> police agency mappings for consolidated governments
docs/DATA_SOURCES.md         where every input comes from, with URLs and caveats
data/manual/                 drop zone for the two files that cannot be downloaded by script
tests/smoke_test.py          key-free end-to-end check with synthetic sources
```
