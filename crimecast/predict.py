"""Inference: forecast a city's crime rate h years ahead from its latest panel row."""
from __future__ import annotations

import json
from functools import lru_cache

import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import HORIZONS, MODELS_DIR, TARGETS
from .features import load_panel
from .geo import place_base_name


@lru_cache(maxsize=None)
def load_model(target: str, horizon: int) -> tuple[lgb.Booster, dict]:
    stem = MODELS_DIR / f"{target}_h{horizon}"
    if not stem.with_suffix(".txt").exists():
        raise FileNotFoundError(f"no model at {stem.with_suffix('.txt')}; run `python Main.py train`")
    booster = lgb.Booster(model_file=str(stem.with_suffix(".txt")))
    meta = json.loads(stem.with_suffix(".json").read_text(encoding="utf-8"))
    return booster, meta


def find_city(panel: pd.DataFrame, name: str, state: str) -> str:
    """Resolve 'Baltimore', 'MD' -> geoid using the panel's city names."""
    cities = panel[["geoid", "name", "state_abbr"]].drop_duplicates()
    cities = cities[cities["state_abbr"].str.upper() == state.upper()]
    if cities.empty:
        raise KeyError(f"no cities for state {state!r} in the panel")
    wanted = place_base_name(name)
    cities = cities.assign(base=cities["name"].map(place_base_name))
    exact = cities[cities["base"] == wanted]
    if len(exact) == 1:
        return exact.iloc[0]["geoid"]
    partial = cities[cities["base"].str.contains(wanted, regex=False)]
    if len(partial) >= 1:
        return partial.iloc[0]["geoid"]
    raise KeyError(f"city {name!r}, {state!r} not in the panel (known: {sorted(cities['name'])[:10]} ...)")


def latest_row(panel: pd.DataFrame, geoid: str, target: str, as_of_year: int | None = None) -> pd.Series:
    rows = panel[(panel["geoid"] == geoid) & panel[f"log_{target}_rate"].notna()]
    if as_of_year is not None:
        rows = rows[rows["year"] <= as_of_year]
    if rows.empty:
        raise KeyError(f"no usable row for {geoid} / {target}")
    return rows.sort_values("year").iloc[-1]


def _contributions(booster: lgb.Booster, feats: list[str], row: pd.Series, top: int = 8) -> list[dict]:
    x = row[feats].to_frame().T.astype(float)
    contrib = booster.predict(x, pred_contrib=True)[0]
    pairs = sorted(zip(feats, contrib[:-1]), key=lambda p: -abs(p[1]))[:top]
    return [{"feature": f, "value": (None if pd.isna(row[f]) else float(row[f])), "contribution": float(c)} for f, c in pairs]


def predict_row(row: pd.Series, target: str, horizon: int, explain: bool = True) -> dict:
    booster, meta = load_model(target, horizon)
    feats = meta["features"]
    x = row[feats].to_frame().T.astype(float)
    logchange = float(booster.predict(x)[0])
    current = float(row[f"{target}_rate"])
    predicted = (current + 1.0) * float(np.exp(logchange)) - 1.0
    out = {
        "target": target,
        "horizon_years": horizon,
        "as_of_year": int(row["year"]),
        "forecast_year": int(row["year"]) + horizon,
        "current_rate_per_100k": current,
        "predicted_rate_per_100k": predicted,
        "predicted_pct_change": (predicted - current) / current * 100.0 if current > 0 else None,
        "predicted_log_change": logchange,
    }
    if explain:
        out["top_drivers"] = _contributions(booster, feats, row)
    return out


def predict_city(name: str, state: str, targets: list[str] = TARGETS, horizons: list[int] = HORIZONS,
                 as_of_year: int | None = None, panel: pd.DataFrame | None = None, explain: bool = True) -> dict:
    panel = load_panel() if panel is None else panel
    geoid = find_city(panel, name, state)
    city = panel[panel["geoid"] == geoid].iloc[0]
    result = {"geoid": geoid, "city": city["name"], "state": city["state_abbr"], "forecasts": []}
    for t in targets:
        row = latest_row(panel, geoid, t, as_of_year)
        for h in horizons:
            result["forecasts"].append(predict_row(row, t, h, explain=explain))
    return result


def predict_all(targets: list[str] = TARGETS, horizons: list[int] = HORIZONS, as_of_year: int | None = None,
                panel: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per city x target x horizon using each city's latest usable year (for the app's map/table)."""
    panel = load_panel() if panel is None else panel
    records = []
    for t in targets:
        booster, meta = load_model(t, horizons[0])
        feats = meta["features"]
        rows = panel[panel[f"log_{t}_rate"].notna()]
        if as_of_year is not None:
            rows = rows[rows["year"] <= as_of_year]
        latest = rows.sort_values("year").groupby("geoid").tail(1)
        for h in horizons:
            booster, meta = load_model(t, h)
            pred = booster.predict(latest[meta["features"]].astype(float))
            current = latest[f"{t}_rate"].to_numpy()
            predicted = (current + 1.0) * np.exp(pred) - 1.0
            records.append(pd.DataFrame({
                "geoid": latest["geoid"].to_numpy(), "city": latest["name"].to_numpy(),
                "state": latest["state_abbr"].to_numpy(), "target": t, "horizon_years": h,
                "as_of_year": latest["year"].to_numpy(), "forecast_year": latest["year"].to_numpy() + h,
                "current_rate_per_100k": current, "predicted_rate_per_100k": predicted,
                "predicted_pct_change": np.where(current > 0, (predicted - current) / current * 100.0, np.nan),
            }))
    return pd.concat(records, ignore_index=True)
