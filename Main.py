

"""Command-line entry point for the crime-forecasting pipeline.

    python Main.py check            # verify keys and reachability of each data source
    python Main.py build-data       # download everything (cached) and build data/processed/panel.parquet
    python Main.py train            # train LightGBM models -> models/
    python Main.py predict --city Baltimore --state MD
    python Main.py predict-all --out forecasts.csv
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from crimecast import config
from crimecast.utils import setup_logging


def cmd_check(_: argparse.Namespace) -> int:
    from crimecast.utils import get_json

    ok = True
    print(f"CENSUS_API_KEY set: {'yes' if config.CENSUS_API_KEY else 'NO  -> https://api.census.gov/data/key_signup.html'}")
    print(f"FBI_API_KEY: {'DEMO_KEY (10 requests/hour; get a real key at https://api.data.gov/signup/)' if config.FBI_API_KEY == 'DEMO_KEY' else 'set'}")
    checks = {
        "Census ACS metadata": ("https://api.census.gov/data/2023/acs/acs5/groups/B01003.json", {}),
        "FBI CDE agencies (DE)": (f"https://api.usa.gov/crime/fbi/cde/agency/byStateAbbr/DE", {"API_KEY": config.FBI_API_KEY}),
        "Census Geocoder": ("https://geocoding.geo.census.gov/geocoder/geographies/coordinates",
                            {"x": -76.6122, "y": 39.2904, "benchmark": "Public_AR_Current", "vintage": "Current_Current",
                             "layers": "Counties", "format": "json"}),
    }
    if config.CENSUS_API_KEY:
        checks["Census ACS data (needs key)"] = ("https://api.census.gov/data/2023/acs/acs5",
                                                 {"get": "NAME,B01003_001E", "for": "place:04000", "in": "state:24",
                                                  "key": config.CENSUS_API_KEY})
    for label, (url, params) in checks.items():
        try:
            get_json(url, params=params, use_cache=False, timeout=60)
            print(f"  [ok]   {label}")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"  [FAIL] {label}: {exc}")
    return 0 if ok else 1


def cmd_build(args: argparse.Namespace) -> int:
    from crimecast.features import build_panel

    skip = set(args.skip or [])
    panel = build_panel(min_pop=args.min_pop, horizons=args.horizons, skip=skip)
    print(f"panel: {len(panel)} rows, {panel['geoid'].nunique()} cities, {panel.shape[1]} columns")
    for t in config.TARGETS:
        for h in args.horizons:
            col = f"y_{t}_h{h}"
            if col in panel:
                print(f"  rows with target {col}: {int(panel[col].notna().sum())}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    from crimecast.train import train_all

    results = train_all(horizons=args.horizons, test_start_year=args.test_start_year)
    print(json.dumps(results, indent=2))
    return 0


def cmd_predict(args: argparse.Namespace) -> int:
    from crimecast.predict import predict_city

    result = predict_city(args.city, args.state, horizons=args.horizons, as_of_year=args.as_of_year)
    print(json.dumps(result, indent=2))
    return 0


def cmd_predict_all(args: argparse.Namespace) -> int:
    from crimecast.predict import predict_all

    df = predict_all(horizons=args.horizons, as_of_year=args.as_of_year)
    df.to_csv(args.out, index=False)
    print(f"wrote {len(df)} forecasts to {args.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="City crime-rate forecasting (LightGBM)")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="verify API keys and data-source reachability").set_defaults(func=cmd_check)

    p = sub.add_parser("build-data", help="download sources and assemble the city x year panel")
    p.add_argument("--min-pop", type=int, default=config.MIN_CITY_POP, help="city population threshold (2020)")
    p.add_argument("--horizons", type=int, nargs="+", default=config.HORIZONS)
    p.add_argument("--skip", nargs="*", choices=["cbp", "gov_finance", "mayors", "religion", "elections"],
                   help="sources to leave out")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("train", help="train LightGBM models from the panel")
    p.add_argument("--horizons", type=int, nargs="+", default=config.HORIZONS)
    p.add_argument("--test-start-year", type=int, default=config.TEST_START_YEAR)
    p.set_defaults(func=cmd_train)

    p = sub.add_parser("predict", help="forecast one city")
    p.add_argument("--city", required=True)
    p.add_argument("--state", required=True, help="two-letter state code")
    p.add_argument("--horizons", type=int, nargs="+", default=config.HORIZONS)
    p.add_argument("--as-of-year", type=int, default=None)
    p.set_defaults(func=cmd_predict)

    p = sub.add_parser("predict-all", help="forecast every city in the panel")
    p.add_argument("--out", default="forecasts.csv")
    p.add_argument("--horizons", type=int, nargs="+", default=config.HORIZONS)
    p.add_argument("--as-of-year", type=int, default=None)
    p.set_defaults(func=cmd_predict_all)

    args = parser.parse_args(argv)
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
