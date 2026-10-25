# How we used LightGBM to forecast city crime rates, and how accurate it was

*Project: HackathonGroup / GAURD. Models trained 2026-10-24 with LightGBM 4.7.0. All numbers below come from
`models/training_summary.json`, `models/feature_weights_with_direction.csv` and a direction check run on the
saved panel; nothing is estimated.*

## 1. The question the model answers

Given everything we can measure about a U.S. city today, what will its reported **violent** and **property**
crime rate be **four years from now**?

We frame this as predicting the *change*, not the level:

```
y = log(rate_in_4_years + 1) - log(rate_now + 1)        (rates are offenses per 100,000 residents)
predicted_rate = (rate_now + 1) * exp(y_hat) - 1
```

Two separate LightGBM models are trained, one per crime type. Predicting the change matters because a model
asked to predict the level simply learns "next rate ≈ current rate". We tried that variant: it put about
63% of its weight on the current rate and performed no better than assuming nothing changes.

## 2. The data behind it

| Item | Value |
|---|---|
| Unit of observation | one city in one year |
| Cities | 323 incorporated places with 100,000+ residents (322 matched to a police agency; Honolulu has no usable agency data) |
| Years | feature years 2011–2023 (ACS 5-year vintages); FBI crime counts 2005–2024 |
| Panel size | 4,199 city-years, 129 columns |
| Rows with a 4-year outcome | 2,983 (the rest are too recent to have an outcome yet) |
| Input features used by the model | 104 |

Feature groups, all documented in `docs/DATA_SOURCES.md`:

- **Demographics**: young men aged 18–26, race and ethnicity shares, age structure, population and density.
- **Economy and housing**: income, poverty, unemployment, SNAP (EBT) receipt, single-parent households, renters,
  recent movers, vacancy and "other vacant" (abandoned) housing, housing age, commercial density from County
  Business Patterns.
- **Civic**: county presidential margins and their change, mayor's party, religious adherence and
  congregations per 100,000.
- **Public spending and policing**: social-program and police spending per resident, sworn officers per 1,000.
- **Crime history**: current log rates, their 1-year change and 3- and 5-year slopes.
- **Derivatives**: for every input, the 1-year change (`d1_`) and the 5-year change (`d5_`), so the model sees
  which way a city is moving, not just where it is.

## 3. Why LightGBM

LightGBM is a gradient-boosted decision-tree library. It fit this problem well for practical reasons:

- **Tabular data with gaps.** Many sources are missing for some cities or years (spending data exists only for
  fiscal 2017–2022, some agencies have partial years). LightGBM handles missing values natively; nothing had
  to be imputed.
- **Non-linear effects and interactions.** The relationship between, say, income growth and crime change is
  not a straight line and depends on the starting level. Trees capture that without hand-built terms.
- **Small data.** With about 2,400 training rows, a heavily regularised booster (shallow trees, bagging,
  L2 penalty, early stopping) is less prone to overfitting than a deep network and more flexible than a linear
  model. A ridge regression baseline we tried did not beat the "no change" benchmark on the hold-out.
- **Explainability.** LightGBM gives per-prediction feature contributions, which power the "top drivers" shown
  for each city.

## 4. Training setup

Settings in `crimecast/train.py`:

| Parameter | Value |
|---|---|
| Objective / metric | regression (L2) / RMSE |
| Learning rate | 0.03 |
| Leaves per tree | 15 |
| Minimum rows per leaf | 30 |
| Feature fraction / bagging fraction | 0.7 / 0.8 (bagging every round) |
| L2 regularisation | 5.0 |
| Target clipping | |y| ≤ 1.5 log units (removes a handful of reporting artefacts) |
| Boosting rounds | up to 4,000 with early stopping after 150 rounds without improvement |

Procedure for each target:

1. Hold out 20% of *cities* from the training years and use them as the early-stopping set, so the stopping
   point is chosen on cities the booster has never seen. Best iterations: 170 (violent), 207 (property).
2. Estimate performance on unseen cities with 5-fold GroupKFold over cities inside the training years.
3. Refit on all training rows with 1.1 × the best iteration count. Final models: 187 and 227 trees.

## 5. How we backtested

The honest test for a forecasting model is: train only on the past, predict a period you did not train on.

- **Training window**: feature years 2011–2018, whose 4-year outcomes fall in 2015–2022. 2,390 rows.
- **Hold-out window**: feature years 2019–2020, whose outcomes are the actual 2023 and 2024 reported rates.
  593 rows. These rows were never used for fitting, early stopping or tuning.
- **Unseen-city check**: the GroupKFold described above answers a different question, how the model does on a
  city it has never seen, within the training years.

Two baselines keep the numbers honest:

- **No change**: assume the rate in four years equals today's rate. This is the bar any forecaster must clear.
- **Trend continues**: extrapolate the recent 3-year slope four more years.

Metrics:

- **RMSE and MAE of the log change** (what the model is trained on).
- **Median and mean absolute percentage error of the rate** (what a user sees).
- **Direction accuracy**: the share of hold-out city-years where the model correctly said whether the rate
  would rise or fall. The "no change" baseline cannot make this call, so we compare against the trend sign and
  against always guessing the more common direction.

## 6. Results

### Error on the 2023–2024 outcomes (593 hold-out city-years)

| Target | Metric | LightGBM | No change | Trend continues |
|---|---|---|---|---|
| Violent | RMSE (log change) | **0.279** | 0.314 | 0.417 |
| Violent | MAE (log change) | **0.201** | 0.227 | 0.297 |
| Violent | Median error on the rate | **15.8%** | 16.7% | – |
| Violent | Mean error on the rate | 28.9% | 28.8% | – |
| Property | RMSE (log change) | **0.253** | 0.272 | 0.371 |
| Property | MAE (log change) | **0.179** | 0.194 | 0.259 |
| Property | Median error on the rate | **13.6%** | 15.9% | – |
| Property | Mean error on the rate | **18.4%** | 21.5% | – |

### Direction: will the rate rise or fall?

| Target | LightGBM | Trend sign | Always guess the common direction |
|---|---|---|---|
| Violent | **62.2%** | 49.1% | 53.8% |
| Property | **65.4%** | 56.9% | 60.0% |

Counting only city-years where the rate actually moved by 5% or more, the model's direction accuracy rises
to 64.6% (violent) and 67.1% (property).

### Unseen cities inside the training years (5-fold GroupKFold)

| Target | RMSE (log change), mean ± sd across folds |
|---|---|
| Violent | 0.266 ± 0.011 |
| Property | 0.222 ± 0.010 |

### Reading these numbers

- The model beats persistence on every headline metric: RMSE improves by 11% (violent) and 7% (property)
  over "no change", and by about a third over naive trend extrapolation.
- For a typical city the forecast is within roughly **±16%** (violent) or **±14%** (property) of the rate
  actually reported four years later. The website shows these as the error band around each forecast.
- The *mean* violent-crime error is essentially the same as the baseline (28.9% vs 28.8%). A few cities with
  very large swings, usually reporting changes rather than real crime changes, dominate the mean. The median,
  which is robust to those outliers, is the fairer summary.
- Direction calls are right about two times in three, clearly better than trend extrapolation, which is no
  better than a coin flip for violent crime.
- Performance on completely unseen cities (CV) is slightly *better* than on the 2023–2024 hold-out. The
  hold-out is the harder test because it spans the post-pandemic period and the national switch to NIBRS
  reporting; the CV number is the more optimistic figure.

An earlier version of the same pipeline, split at 2017 instead of 2019, was weaker on every metric
(direction accuracy 57.7% / 61.2%). Moving the split later keeps the 2017–2022 government-finance data inside
the training window, which is why the 2019 split was promoted.

## 7. What drives the forecasts

Average share of model gain, both targets combined (`models/feature_weights_with_direction.csv`):

| Rank | Feature | Weight | Direction (violent) | Direction (property) |
|---|---|---|---|---|
| 1 | Current violent-crime rate (log) | 3.2% | strongly negative | strongly positive |
| 2 | 5-year change in median household income | 3.1% | strongly positive | strongly positive |
| 3 | Share of households on SNAP | 2.9% | strongly negative | strongly negative |
| 4 | Share Black, non-Hispanic | 2.8% | strongly negative | strongly negative |
| 5 | Population density | 2.7% | strongly negative | positive |
| 6 | 5-year slope of property crime | 2.6% | strongly positive | strongly negative |
| 7 | 3-year slope of violent crime | 2.6% | strongly negative | negative |
| 8 | Share other race, non-Hispanic | 2.5% | strongly positive | strongly positive |
| 9 | Retail and food establishments per 1,000 | 2.4% | strongly negative | strongly negative |
| 10 | Religious adherence rate | 2.4% | strongly negative | strongly negative |

Weight is spread thinly across 104 features; no single input dominates. Two cautions:

- **Direction means association with the *change*, not causation.** "Strongly negative" for the current
  violent rate means cities starting high tended to come down toward the mean (regression to the mean), not
  that a high rate lowers future crime.
- **Demographic shares are aggregate city attributes** in a statistical model. They say nothing about
  individuals and must not be presented as such.

## 8. Limitations to state when presenting this

- **Only two outcome years are backtested** (2023 and 2024). A longer history of out-of-sample years would make
  the error estimates firmer.
- **Reporting, not crime.** The targets are rates reported to the FBI. Agencies that switched to NIBRS mid-year
  (most big cities in 2021) have partial years, which are dropped rather than imputed, and a few large agencies
  are missing entire years.
- **County proxies.** Elections, religion and commercial density are county-level, mapped to the city.
- **No calibrated prediction interval.** The ±16% / ±14% band is the hold-out median error, a typical-case
  figure, not a confidence interval.
- **Correlation only.** Feature contributions explain the model, not the city.

## 9. Reproducing the numbers

```powershell
.\.venv\Scripts\python.exe Main.py build-data     # pulls all sources (needs CENSUS_API_KEY and FBI_API_KEY in .env)
.\.venv\Scripts\python.exe Main.py train          # writes models/*.txt, *.json and training_summary.json
.\.venv\Scripts\python.exe scripts\export_frontend.py   # writes the exports the website imports
```

Key files: `crimecast/features.py` (panel, derivatives, targets), `crimecast/train.py` (training and
backtest), `crimecast/predict.py` (forecasts and per-city drivers), `models/training_summary.json` (every
metric above), `models/feature_weights_with_direction.csv` (importances with direction).
