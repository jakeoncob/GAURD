"""crimecast: city-level crime-rate forecasting with LightGBM.

Pipeline:
    1. ``crimecast.features.build_panel``  -> city x year panel with features, derivatives, targets
    2. ``crimecast.train.train_all``        -> one LightGBM model per (target, horizon)
    3. ``crimecast.predict.predict_city``   -> forecast for any city in the universe
"""

__version__ = "0.1.0"
