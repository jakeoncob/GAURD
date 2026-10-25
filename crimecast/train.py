"""Train one LightGBM model per (target, horizon).

Target: y = log(rate_{t+h} + 1) - log(rate_t + 1). Validation mirrors deployment:
    * time hold-out: rows with feature-year t >= TEST_START_YEAR are never used for fitting;
    * unseen-city check: GroupKFold over cities inside the training years.
Baselines reported alongside: "no change" (y=0) and "trend continues" (past h-year change).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

from .config import HORIZONS, MODELS_DIR, TARGET_CLIP, TARGETS, TEST_START_YEAR
from .features import ID_COLUMNS, load_panel
from .utils import log

DEFAULT_PARAMS = {
    "objective": "regression",
    "metric": "rmse",
    "learning_rate": 0.03,
    "num_leaves": 15,
    "min_data_in_leaf": 30,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 5.0,
    "verbose": -1,
    "seed": 42,
    "num_threads": 0,
}
EXCLUDE_PREFIXES = ("y_", "future_")
EXCLUDE_EXACT = set(ID_COLUMNS) | {"aland_sqmi", "lat", "lon", "fbi_population", "population", "officers",
                                   "civilians", "acs_population"} | {f"{t}_rate" for t in TARGETS}


def feature_columns(panel: pd.DataFrame) -> list[str]:
    cols = []
    for c in panel.columns:
        if c in EXCLUDE_EXACT or c.startswith(EXCLUDE_PREFIXES) or c.endswith("_count"):
            continue
        if not pd.api.types.is_numeric_dtype(panel[c]):
            continue
        cols.append(c)
    return cols


def _metrics(y: np.ndarray, pred: np.ndarray) -> dict:
    err = pred - y
    return {"rmse": float(np.sqrt(np.mean(err ** 2))), "mae": float(np.mean(np.abs(err))), "n": int(len(y))}


def _rate_metrics(current_rate: np.ndarray, future_rate: np.ndarray, pred_logchange: np.ndarray) -> dict:
    pred_rate = (current_rate + 1.0) * np.exp(pred_logchange) - 1.0
    ok = np.isfinite(future_rate) & (future_rate > 0)
    ape = np.abs(pred_rate[ok] - future_rate[ok]) / future_rate[ok]
    return {"rate_mape": float(np.mean(ape)), "rate_median_ape": float(np.median(ape))}


def train_one(panel: pd.DataFrame, target: str, horizon: int, params: dict | None = None,
              test_start_year: int = TEST_START_YEAR, num_rounds: int = 4000, early_stopping: int = 150,
              cv_folds: int = 5) -> tuple[lgb.Booster, dict]:
    params = {**DEFAULT_PARAMS, **(params or {})}
    ycol = f"y_{target}_h{horizon}"
    feats = feature_columns(panel)
    df = panel.dropna(subset=[ycol]).copy()
    df = df[np.isfinite(df[ycol])]
    df[ycol] = df[ycol].clip(-TARGET_CLIP, TARGET_CLIP)
    train = df[df["year"] < test_start_year]
    test = df[df["year"] >= test_start_year]
    if len(train) < 100:
        raise RuntimeError(f"only {len(train)} training rows for {ycol}; lower MIN_CITY_POP or check the FBI data")
    log.info("%s: %d train rows (%d cities, years %d-%d), %d test rows, %d features", ycol, len(train),
             train["geoid"].nunique(), train["year"].min(), train["year"].max(), len(test), len(feats))

    # --- early stopping on held-out cities within the training years
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    fit_idx, val_idx = next(gss.split(train, groups=train["geoid"]))
    dfit = lgb.Dataset(train.iloc[fit_idx][feats], train.iloc[fit_idx][ycol])
    dval = lgb.Dataset(train.iloc[val_idx][feats], train.iloc[val_idx][ycol])
    booster = lgb.train(params, dfit, num_boost_round=num_rounds, valid_sets=[dval],
                        callbacks=[lgb.early_stopping(early_stopping, verbose=False), lgb.log_evaluation(0)])
    best_iter = max(booster.best_iteration or num_rounds, 50)

    # --- unseen-city cross-validation inside training years (honest generalisation estimate)
    cv_scores = []
    gkf = GroupKFold(n_splits=cv_folds)
    for tr, va in gkf.split(train, groups=train["geoid"]):
        b = lgb.train(params, lgb.Dataset(train.iloc[tr][feats], train.iloc[tr][ycol]), num_boost_round=best_iter)
        cv_scores.append(_metrics(train.iloc[va][ycol].to_numpy(), b.predict(train.iloc[va][feats]))["rmse"])

    # --- final fit on all training rows
    model = lgb.train(params, lgb.Dataset(train[feats], train[ycol]), num_boost_round=int(best_iter * 1.1))

    metrics = {
        "target": target, "horizon": horizon, "best_iteration": int(best_iter),
        "train_rows": int(len(train)), "test_rows": int(len(test)), "n_features": len(feats),
        "train_years": [int(train["year"].min()), int(train["year"].max())],
        "cv_unseen_city_rmse_mean": float(np.mean(cv_scores)), "cv_unseen_city_rmse_std": float(np.std(cv_scores)),
    }
    if len(test):
        y = test[ycol].to_numpy()
        pred = model.predict(test[feats])
        metrics["test_model"] = _metrics(y, pred)
        metrics["test_baseline_no_change"] = _metrics(y, np.zeros_like(y))
        trend_col = f"dlog_{target}_5y_slope"
        trend = (test[trend_col].fillna(0).to_numpy() * horizon) if trend_col in test else np.zeros_like(y)
        metrics["test_baseline_trend"] = _metrics(y, np.clip(trend, -TARGET_CLIP, TARGET_CLIP))
        metrics["test_model"].update(_rate_metrics(test[f"{target}_rate"].to_numpy(),
                                                   test[f"future_{target}_rate_h{horizon}"].to_numpy(), pred))
        metrics["test_baseline_no_change"].update(_rate_metrics(test[f"{target}_rate"].to_numpy(),
                                                                test[f"future_{target}_rate_h{horizon}"].to_numpy(),
                                                                np.zeros_like(y)))
    return model, metrics


def save_model(model: lgb.Booster, metrics: dict, feats: list[str], params: dict, target: str, horizon: int) -> None:
    stem = MODELS_DIR / f"{target}_h{horizon}"
    model.save_model(str(stem.with_suffix(".txt")))
    imp = pd.DataFrame({"feature": feats, "gain": model.feature_importance("gain"),
                        "split": model.feature_importance("split")}).sort_values("gain", ascending=False)
    imp.to_csv(stem.with_name(stem.name + "_importance.csv"), index=False)
    meta = {"features": feats, "params": params, "metrics": metrics,
            "trained_at": datetime.now(timezone.utc).isoformat(), "lightgbm_version": lgb.__version__}
    stem.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log.info("saved %s", stem.with_suffix(".txt"))


def train_all(panel: pd.DataFrame | None = None, targets: list[str] = TARGETS, horizons: list[int] = HORIZONS,
              params: dict | None = None, **kwargs) -> dict:
    panel = load_panel() if panel is None else panel
    feats = feature_columns(panel)
    results = {}
    for t in targets:
        for h in horizons:
            if f"y_{t}_h{h}" not in panel.columns:
                log.warning("panel has no target column y_%s_h%d; rebuild with --horizons", t, h)
                continue
            model, metrics = train_one(panel, t, h, params=params, **kwargs)
            save_model(model, metrics, feats, {**DEFAULT_PARAMS, **(params or {})}, t, h)
            results[f"{t}_h{h}"] = metrics
            log.info("metrics %s: %s", f"{t}_h{h}", json.dumps(metrics, indent=None))
    (MODELS_DIR / "training_summary.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results
