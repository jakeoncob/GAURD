# Model files

`models/` contains the violent/property LightGBM models, metadata, feature weights, and training report. Model metadata and feature lists match the supplied training report and tree files.

The website displays saved forecasts. Python inference is not required to serve it. Raw training data and the processed panel remain outside this source snapshot.

Use the root `scripts/import-partner.mjs` to refresh chart data. It reads `models/training_summary.json` when available. The training report’s median errors are evaluation metrics, not city prediction intervals.
