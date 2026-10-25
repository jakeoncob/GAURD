"""Key-free end-to-end smoke test.

Replaces every network-bound source with synthetic data (except the small, key-free Census
population/Gazetteer files) and pushes it through the real panel assembly, LightGBM training
and prediction code. Models go to a temporary folder, nothing in models/ is touched.

    .\\.venv\\Scripts\\python.exe tests\\smoke_test.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crimecast.features as F  # noqa: E402
import crimecast.predict as P  # noqa: E402
import crimecast.train as T  # noqa: E402
from crimecast import config  # noqa: E402
from crimecast.geo import city_universe  # noqa: E402
from crimecast.utils import setup_logging  # noqa: E402


def main() -> int:
    setup_logging()
    rng = np.random.default_rng(0)
    tmp = Path(tempfile.mkdtemp(prefix="crimecast_models_"))
    T.MODELS_DIR = tmp
    P.MODELS_DIR = tmp

    real = city_universe(100000).head(80)
    geoids = list(real.geoid)
    F.city_universe = lambda *a, **k: real

    def fake_acs(years, geoids_set=None, national_query=True):
        rows = []
        for g in geoids:
            base = rng.uniform(0.05, 0.6, size=len(F.ACS_FEATURES))
            trend = rng.normal(0, 0.01, size=len(F.ACS_FEATURES))
            for i, y in enumerate(years):
                rows.append({"geoid": g, "year": y, "acs_name": g,
                             **{f.name: base[j] * (1 + trend[j] * i) for j, f in enumerate(F.ACS_FEATURES)}})
        return pd.DataFrame(rows)

    def fake_crime(matches, start, end):
        rows = []
        for g in geoids:
            lvl, pop = rng.uniform(200, 1500), rng.uniform(1e5, 1e6)
            for y in range(start, end + 1):
                lvl *= np.exp(rng.normal(0, 0.08))
                rows.append({"geoid": g, "ori": "X" + g, "year": y, "fbi_population": pop,
                             "violent_count": lvl * pop / 1e5, "property_count": 4 * lvl * pop / 1e5,
                             "officers": pop / 1000 * 2.5, "civilians": 100})
        return pd.DataFrame(rows)

    F.build_acs_features = fake_acs
    F.build_place_county_crosswalk = lambda u: pd.DataFrame({"geoid": geoids, "county_geoid": "24510", "county_name": "x"})
    F.match_cities_to_agencies = lambda u: pd.DataFrame({"geoid": geoids, "ori": ["X" + g for g in geoids],
                                                         "agency_name": "pd", "match_method": "exact", "match_km": 0.0})
    F.build_crime_panel = fake_crime
    F.load_county_presidential = lambda: pd.DataFrame({"county_geoid": "24510", "election_year": [2008, 2012, 2016, 2020],
                                                       "dem_share": [.6, .62, .64, .66], "gop_share": [.38, .36, .34, .32],
                                                       "dem_margin": [.22, .26, .30, .34], "total_votes": 1e5})
    F.load_mayoral_elections = lambda: pd.DataFrame({"geoid": geoids[:10], "year": 2011, "mayor_dem": 1.0, "mayor_prob_dem": 0.9})
    F.load_religion_county = lambda: pd.DataFrame({"county_geoid": ["24510"], "rel_adherence_rate": [0.4],
                                                   "rel_congregations_per_100k": [100.0]})
    F.load_cbp_county = lambda: pd.DataFrame({"county_geoid": "24510", "year": config.CBP_YEARS, "cbp_estab_all": 15000.0,
                                              "cbp_emp_all": 2e5, "cbp_estab_retail": 2000.0, "cbp_estab_food_accommodation": 1500.0})
    F.load_gov_finance = lambda geoids=None: pd.DataFrame(
        [{"geoid": g, "year": y, "gov_social_spend_pc": rng.uniform(100, 800), "gov_police_spend_pc": rng.uniform(200, 600),
          "gov_education_spend_pc": 0.0, "gov_unit_population": 1e5} for g in geoids for y in config.GOV_FINANCE_YEARS])

    panel = F.build_panel(save=False, horizons=[4])
    assert len(panel) == 80 * len(config.ACS_YEARS), panel.shape
    assert panel["y_violent_h4"].notna().sum() > 0
    assert "d5_poverty_rate" in panel.columns

    results = T.train_all(panel, horizons=[4], cv_folds=3)
    assert set(results) == {"violent_h4", "property_h4"}

    out = P.predict_city("Baltimore", "MD", panel=panel)
    assert out["forecasts"][0]["predicted_rate_per_100k"] > 0
    table = P.predict_all(panel=panel)
    assert len(table) == 2 * 80

    print(json.dumps(out["forecasts"][0], indent=1)[:800])
    print(f"\nSMOKE TEST PASSED: panel {panel.shape}, {len(T.feature_columns(panel))} features, models in {tmp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
