"""Build the front-end handoff: exports/frontend_data.json (full) and exports/frontend_forecasts.csv (flat).

    .\\.venv\\Scripts\\python.exe scripts\\export_frontend.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crimecast.config import PROJECT_ROOT  # noqa: E402
from crimecast.features import load_panel  # noqa: E402
from crimecast.geo import city_universe  # noqa: E402
from crimecast.predict import load_model  # noqa: E402

HORIZON = 4
TARGETS = ["violent", "property"]
TYPICAL_ERROR_PCT = {"violent": 16, "property": 14}
FEATURE_LABELS = {
    "young_male_18_26_share": "Share of residents who are men aged 18-26",
    "share_white_nh": "Share White, non-Hispanic",
    "share_black_nh": "Share Black, non-Hispanic",
    "share_hispanic": "Share Hispanic or Latino",
    "share_asian_nh": "Share Asian, non-Hispanic",
    "share_other_nh": "Share other or multiracial, non-Hispanic",
    "poverty_rate": "Share below the poverty line",
    "unemployment_rate": "Unemployment rate",
    "single_parent_share": "Share of families with children headed by one parent",
    "renter_share": "Share of households renting",
    "moved_last_year_share": "Share who moved in the last year",
    "vacancy_rate": "Share of housing units vacant",
    "other_vacant_share": "Share of units classed 'other vacant' (abandonment proxy)",
    "disconnected_youth_16_19_share": "Share of 16-19 year olds not in school or work",
    "housing_pre1950_share": "Share of housing built before 1950",
    "housing_pre1980_share": "Share of housing built before 1980",
    "snap_share": "Share of households receiving SNAP/EBT",
    "median_age": "Median age",
    "share_65plus": "Share aged 65 and over",
    "share_under18": "Share under 18",
    "median_hh_income": "Median household income (dollars)",
    "log_population": "Log of population",
    "pop_density": "Residents per square mile",
    "officers_per_1000": "Police officers per 1,000 residents",
    "pres_dem_share": "County Democratic vote share, latest presidential election",
    "pres_dem_margin": "County presidential margin (Democratic minus Republican share)",
    "pres_dem_margin_change": "Change in that margin since the previous election",
    "pres_years_since_election": "Years since the last presidential election",
    "mayor_dem": "Sitting mayor is a Democrat (1) or Republican (0)",
    "mayor_prob_dem": "Estimated probability the sitting mayor is a Democrat",
    "rel_adherence_rate": "Share of county residents adhering to a congregation (2020)",
    "rel_congregations_per_100k": "Congregations per 100k county residents (2020)",
    "cbp_estab_per_1000": "Business establishments per 1,000 county residents",
    "cbp_retail_food_estab_per_1000": "Retail and food/accommodation establishments per 1,000 county residents",
    "cbp_estab_per_sqmi": "Business establishments per square mile (county)",
    "gov_social_spend_pc": "City social-program spending per resident (dollars)",
    "gov_police_spend_pc": "City police spending per resident (dollars)",
    "gov_education_spend_pc": "City education spending per resident (dollars)",
    "violent_rate": "Violent crimes per 100k residents",
    "property_rate": "Property crimes per 100k residents",
    "log_violent_rate": "Log violent crime rate",
    "log_property_rate": "Log property crime rate",
    "dlog_violent_1y": "1-year change in violent crime (log)",
    "dlog_violent_3y_slope": "3-year trend in violent crime (log per year)",
    "dlog_violent_5y_slope": "5-year trend in violent crime (log per year)",
    "dlog_property_1y": "1-year change in property crime (log)",
    "dlog_property_3y_slope": "3-year trend in property crime (log per year)",
    "dlog_property_5y_slope": "5-year trend in property crime (log per year)",
}
PROFILE_FEATURES = [k for k in FEATURE_LABELS if not k.startswith(("log_", "dlog_"))]


def label_for(feature: str) -> str:
    if feature.startswith("d1_"):
        return "1-year change in " + FEATURE_LABELS.get(feature[3:], feature[3:]).lower()
    if feature.startswith("d5_"):
        return "5-year change in " + FEATURE_LABELS.get(feature[3:], feature[3:]).lower()
    return FEATURE_LABELS.get(feature, feature)


def clean(v):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return None if (math.isnan(v) or math.isinf(v)) else float(v)
    return v


def national_rates() -> dict[str, dict[int, float]]:
    """US annual rates per 100k, summed from the monthly 'United States Offenses' rates the FBI returns
    with every agency query (any cached summarized response for a full 2005-2024 window works)."""
    import collections
    import glob

    nat: dict[str, dict[int, float]] = {}
    for f in glob.glob(str(PROJECT_ROOT / "data" / "cache" / "*.json")):
        try:
            j = json.load(open(f, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(j, dict) or "offenses" not in j:
            continue
        us = (j["offenses"].get("rates") or {}).get("United States Offenses") or {}
        if len(us) < 240:
            continue
        yearly: dict[int, float] = collections.defaultdict(float)
        for k, v in us.items():
            if v is not None:
                yearly[int(k.split("-")[1])] += v
        # the cache does not record the offense slug; identify it by magnitude of the 2019 national rate
        if "violent" not in nat and 250 < yearly[2019] < 500:
            nat["violent"] = dict(yearly)
        elif "property" not in nat and 1500 < yearly[2019] < 2500:
            nat["property"] = dict(yearly)
        if len(nat) == 2:
            break
    return nat


def write_national_comparison(flat: pd.DataFrame, exports: Path) -> None:
    nat = national_rates()
    if len(nat) < 2:
        print("national rates not found in cache; skipping city_forecasts_vs_national.csv")
        return
    wide = flat.pivot(index=["geoid", "city", "state"], columns="target",
                      values=["as_of_year", "forecast_year", "current_rate_per_100k", "predicted_rate_per_100k", "pct_change"])
    wide.columns = [f"{t}_{c}" for c, t in wide.columns]
    wide = wide.reset_index()
    latest = max(nat["violent"])
    cols = ["geoid", "city", "state"]
    for t in TARGETS:
        wide[f"{t}_as_of_year"] = pd.to_numeric(wide[f"{t}_as_of_year"]).astype("Int64")
        wide[f"{t}_forecast_year"] = pd.to_numeric(wide[f"{t}_forecast_year"]).astype("Int64")
        wide[f"national_{t}_rate_as_of_year"] = wide[f"{t}_as_of_year"].map(
            lambda y: round(nat[t][int(y)], 1) if pd.notna(y) and int(y) in nat[t] else None)
        wide[f"national_{t}_rate_{latest}"] = round(nat[t][latest], 1)
        cols += [f"{t}_as_of_year", f"{t}_current_rate_per_100k", f"{t}_forecast_year", f"{t}_predicted_rate_per_100k",
                 f"{t}_pct_change", f"national_{t}_rate_as_of_year", f"national_{t}_rate_{latest}"]
    wide[cols].sort_values(["state", "city"]).to_csv(exports / "city_forecasts_vs_national.csv", index=False)
    years = sorted(nat["violent"])
    pd.DataFrame({"year": years,
                  "national_violent_rate_per_100k": [round(nat["violent"][y], 1) for y in years],
                  "national_property_rate_per_100k": [round(nat["property"].get(y, float("nan")), 1) for y in years]}
                 ).to_csv(exports / "national_rates_by_year.csv", index=False)


def main() -> None:
    panel = load_panel()
    uni = city_universe().set_index("geoid")
    models = {t: load_model(t, HORIZON) for t in TARGETS}
    cities = []
    for geoid, g in panel.groupby("geoid"):
        g = g.sort_values("year")
        u = uni.loc[geoid]
        entry = {
            "geoid": geoid, "name": u["name"], "state": u["state_abbr"],
            "lat": clean(u["lat"]), "lon": clean(u["lon"]), "population_2020": clean(u["base_population"]),
            "history": [
                {"year": int(r.year), "violent_rate": clean(r.violent_rate), "property_rate": clean(r.property_rate),
                 "population": clean(r.population)}
                for r in g.itertuples() if not (pd.isna(r.violent_rate) and pd.isna(r.property_rate))
            ],
            "forecasts": {}, "features": {}, "data_note": None,
        }
        usable = g[g["log_violent_rate"].notna() & g["log_property_rate"].notna()]
        if usable.empty:
            entry["data_note"] = "no matching police agency; forecast unavailable"
            cities.append(entry)
            continue
        row = usable.iloc[-1]
        entry["features"] = {
            k: {"value": clean(row.get(k)), "change_1y": clean(row.get(f"d1_{k}")), "label": FEATURE_LABELS[k]}
            for k in PROFILE_FEATURES if k in row.index
        }
        for t in TARGETS:
            booster, meta = models[t]
            feats = meta["features"]
            x = row[feats].to_frame().T.astype(float)
            logchange = float(booster.predict(x)[0])
            current = float(row[f"{t}_rate"])
            predicted = (current + 1.0) * math.exp(logchange) - 1.0
            contrib = booster.predict(x, pred_contrib=True)[0][:-1]
            drivers = sorted(zip(feats, contrib), key=lambda p: -abs(p[1]))[:8]
            entry["forecasts"][t] = {
                "as_of_year": int(row.year), "forecast_year": int(row.year) + HORIZON,
                "current_rate_per_100k": round(current, 1), "predicted_rate_per_100k": round(predicted, 1),
                "pct_change": round((predicted - current) / current * 100, 1) if current > 0 else None,
                "typical_error_pct": TYPICAL_ERROR_PCT[t],
                "top_drivers": [
                    {"feature": f, "label": label_for(f), "direction": "pushes up" if c > 0 else "pushes down",
                     "weight": round(float(c), 4), "value": clean(row.get(f))}
                    for f, c in drivers
                ],
            }
        if int(row.year) < panel["year"].max():
            entry["data_note"] = f"latest complete crime year is {int(row.year)}; forecast is for {int(row.year) + HORIZON}"
        cities.append(entry)

    summary = json.loads((PROJECT_ROOT / "models" / "training_summary.json").read_text(encoding="utf-8"))
    out = {
        "generated": date.today().isoformat(),
        "model": f"LightGBM, {HORIZON}-year horizon, trained on US cities with 100k+ residents, 2011-2024",
        "rate_unit": "offenses per 100,000 residents per year",
        "metrics": {
            t: {
                "holdout_rmse_log_change": round(summary[f"{t}_h{HORIZON}"]["test_model"]["rmse"], 3),
                "no_change_baseline_rmse": round(summary[f"{t}_h{HORIZON}"]["test_baseline_no_change"]["rmse"], 3),
                "median_abs_pct_error": round(100 * summary[f"{t}_h{HORIZON}"]["test_model"]["rate_median_ape"], 1),
            } for t in TARGETS
        },
        "feature_labels": FEATURE_LABELS,
        "cities": cities,
    }
    exports = PROJECT_ROOT / "exports"
    exports.mkdir(exist_ok=True)
    json_path = exports / "frontend_data.json"
    json_path.write_text(json.dumps(out, indent=1), encoding="utf-8")

    rows = []
    for c in cities:
        for t, f in c["forecasts"].items():
            rows.append({
                "geoid": c["geoid"], "city": c["name"], "state": c["state"], "lat": c["lat"], "lon": c["lon"],
                "population_2020": c["population_2020"], "target": t,
                **{k: v for k, v in f.items() if k != "top_drivers"},
                "top_driver_1": f["top_drivers"][0]["label"], "top_driver_2": f["top_drivers"][1]["label"],
                "top_driver_3": f["top_drivers"][2]["label"], "note": c["data_note"],
            })
    csv_path = exports / "frontend_forecasts.csv"
    flat = pd.DataFrame(rows)
    flat.to_csv(csv_path, index=False)
    write_national_comparison(flat, exports)
    print(f"{len(cities)} cities -> {json_path} ({os.path.getsize(json_path) / 1e6:.2f} MB), {csv_path} ({len(rows)} rows)")
    sample = next(c for c in cities if c["name"].startswith("Baltimore"))
    print(json.dumps(sample["forecasts"]["violent"], indent=1))


if __name__ == "__main__":
    main()
