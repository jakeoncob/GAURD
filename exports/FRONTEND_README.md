# Front-end data handoff

Two files with the same content at different depth. Regenerate with
`.\.venv\Scripts\python.exe scripts\export_frontend.py` after `Main.py build-data` and `Main.py train`.

## frontend_forecasts.csv  (flat: one row per city x target, 644 rows)

| column | meaning |
|---|---|
| geoid | 7-digit Census place id (state + place), stable key |
| city, state | display name, two-letter state |
| lat, lon | city centre, for a map |
| population_2020 | residents |
| target | `violent` or `property` |
| as_of_year, forecast_year | year of the latest complete data and the year forecast (+4) |
| current_rate_per_100k | latest actual rate |
| predicted_rate_per_100k | model forecast |
| pct_change | predicted vs current, percent |
| typical_error_pct | show as a +/- band around the forecast |
| top_driver_1..3 | human-readable labels of the strongest model drivers |
| note | empty, or a caveat such as "latest complete crime year is 2020; forecast is for 2024" |

## frontend_data.json  (everything the app might show)

```
{
  generated, model, rate_unit,
  metrics: { violent: {holdout_rmse_log_change, no_change_baseline_rmse, median_abs_pct_error}, property: {...} },
  feature_labels: { feature_key: "human label" },
  cities: [
    {
      geoid, name, state, lat, lon, population_2020,
      history:   [ {year, violent_rate, property_rate, population}, ... ]      // 2005-2024 actuals, for trend charts
      forecasts: { violent: FORECAST, property: FORECAST },
      features:  { feature_key: {value, change_1y, label}, ... },               // current city profile ("city facts" panel)
      data_note: null | "latest complete crime year is 2020; forecast is for 2024" | "no matching police agency; forecast unavailable"
    }, ...
  ]
}

FORECAST = {
  as_of_year, forecast_year, current_rate_per_100k, predicted_rate_per_100k, pct_change, typical_error_pct,
  top_drivers: [ {feature, label, direction: "pushes up" | "pushes down", weight, value}, ... x8 ]
}
```

## Display guidance

* Rates are offenses per 100,000 residents per year. `pct_change` compares the forecast with the current rate.
* Always show `as_of_year` and `forecast_year`. Ten cities forecast from data older than 2023 (see `data_note`);
  Urban Honolulu has no forecast and an empty `forecasts` object.
* Show the typical error band (`typical_error_pct`, the hold-out median error: about +/-16% for violent and
  +/-14% for property crime). These are statistical expectations for a city's reported crime rate, not
  predictions of events.
* `city_forecasts_vs_national.csv` is a one-row-per-city version with the US national rate for the same year
  (from the FBI) alongside each city's current and predicted rate; `national_rates_by_year.csv` is the national
  series 2005-2024 for a reference line on charts.
* `top_drivers` are the model's feature contributions for that city: association, not cause. Positive `weight`
  pushes the forecast up. Shares are fractions (0.236 = 23.6%).
* A feature `value` of `null` means the input was unavailable for that city; hide it rather than showing 0.
* Regenerate rather than hand-edit; the files are produced from the trained models.
