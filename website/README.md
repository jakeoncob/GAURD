# GAURD

**Geographic Urban Analysis of Risk Dynamics.** A map for exploring reported crime, national comparisons, and four-year city forecasts.

## Run

```sh
npm run preview:local
npm run check
npm run typecheck
npm test
```

Open `http://127.0.0.1:4173`. Requires Node 22.13+ and `npm install`. The local preview uses the same research handler as production.

The same preview server also runs on any Node host: it binds to `PORT` on all interfaces when that variable is set and reads `GEMINI_API_KEY` from the environment as well as `.env.local`. A ready-made Render blueprint and step-by-step deploy notes are in the repository root [`render.yaml`](../render.yaml) and [README](../README.md#deploy-to-a-live-url).

## Data and models

- Saved violent/property forecasts power the charts.
- `model-pipeline/models/` contains LightGBM weights, metadata, feature weights, and the training report.
- `scripts/import-partner.mjs` validates and refreshes the saved data.
- `web/data-service.js` supports static data or an optional HTTP API.

See [INTEGRATION.md](./INTEGRATION.md) for data updates and [ACCESSIBILITY.md](./ACCESSIBILITY.md) for the WCAG 2.2 AA target and checks.

See [AUDIT.md](./AUDIT.md) for the error audit, fixes, verification, and remaining manual review.

Gemma explains the saved crime data, compares supported cities, remembers follow-up questions, and researches recent local news. Every AI request uses Gemma, including its Google Search step. The server reads article pages directly to verify dates and source links. Answers use short paragraphs and bullets; news stays separate from the saved forecasts.

Set `GEMINI_API_KEY` in the ignored `.env.local` file for local use. Production uses the Sites runtime secret with the same name. Never put a key in `web/` or Git.

## Data and third-party software

- MapLibre GL JS 5.6.0, BSD 3-Clause. Bundled license: `web/assets/MAPLIBRE-LICENSE.txt`.
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public domain. Boundary files retrieved on October 24, 2026 from the [Natural Earth vector repository](https://github.com/nvkelso/natural-earth-vector). Admin 1 geometries are simplified to 0.012 degrees and coordinates rounded to four decimals for this overview interface. Administrative display IDs come from `adm1_code`; they are not model IDs. Features without a usable name or geometry are omitted. These generalized boundaries are for exploration, not precise jurisdictional analysis.
- Vector background: OpenFreeMap Positron (locally customized), © OpenMapTiles, using OpenStreetMap contributors; attribution remains visible. Tiles are an external runtime dependency; geographic boundaries and application files are bundled locally.
- City catalog: user-supplied `cities.csv` (323 cities, 46 states/DC represented). Coordinates: [2025 Census Gazetteer Places](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html), matched by GEOID. These representative points are not city boundaries. The catalog's population year is unspecified.
- Crime comparisons: saved `frontend_forecasts.csv`, `city_forecasts_vs_national.csv`, and `national_rates_by_year.csv` exports, confirmed by the team to use real data. The current snapshot passes strict agreement across all three files and records their exact hashes. Values retain their supplied years and categories. Validation metrics come from the retained training report; model performance and the national benchmark have not been independently reproduced or checked against an official source.
- Positron style: code BSD 3-Clause, visual design CC BY 4.0; derived from CartoDB Basemaps by Stamen and Paul Norman for CartoDB Inc. The local version removes nonessential labels and adjusts water/woodland styling. See bundled `web/assets/POSITRON-LICENSE.md` and `OPENFREEMAP-LICENSE.md`.

To regenerate regional boundaries, download `geojson/ne_10m_admin_1_states_provinces.geojson` from the Natural Earth vector repository and run:

```sh
node scripts/prepare-boundaries.mjs /absolute/path/to/source.geojson
npm run check
```

To regenerate the city catalog, download `2025_Gaz_place_national.zip` from the Census Gazetteer and run `python3 scripts/prepare-cities.py data-sources/cities.csv /absolute/path/to/2025_Gaz_place_national.zip`.

## Combined website updates

The Home fit quiz turns budget, bedroom, bathroom and floor-area choices into a Gemma home match: Gemma searches current for-sale listings with its Google Search tool and reports the best match, with the filtered Zillow search linked alongside. Choices are stored locally. The site itself never fetches or stores listings.

News first uses the live-tested Gemma 4 search pipeline. The team’s direct Google News RSS reader is retained as a fallback when search fails or its sources cannot be read. RSS fallback summaries are restricted to dated headlines; they do not claim full-article verification. All AI calls remain Gemma-only. The Windows path separator fix is retained in the preview server.
