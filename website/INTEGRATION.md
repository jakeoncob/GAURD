# Data integration

The website serves saved forecasts; no running model is required.

## Refresh

```sh
node scripts/import-partner.mjs /path/to/HackathonGroup-main
npm run check
npm test
```

Every value must agree across the current exports, including city IDs, reporting years, observed rates, predictions, national values, and the four-year horizon. The legacy `--prefer-frontend-forecasts` flag is available for explicitly reviewed older handoffs; the current snapshot needs no override.

Inputs: `exports/frontend_forecasts.csv`, `exports/national_rates_by_year.csv`, and `exports/city_forecasts_vs_national.csv`. Validation comes from `models/training_summary.json`, with the README summary as a fallback. Original inputs and SHA-256 hashes are retained outside the published assets. Git attributes preserve their exact bytes across operating systems.

## Chart contract

`web/data/city-crime.json` uses schema version 2 and annual rates per 100,000 people. City IDs are seven-digit GEOID strings. Categories are `violent` and `property`.

- `cities[geoid].metrics[category]`: baselineYear, currentRate, predictedYear, predictedRate.
- `national[year].rates[category]`: the matching national rate.
- `provenance.reportedValidation`: model evaluation metrics and source hash.

A forecast is exactly four years after its baseline. Null means unavailable; zero is a valid rate. Map boundaries and police reporting areas may differ. The national rate is not calculated from the displayed cities.

## Model files

`model-pipeline/models/` contains model weights, metadata, importance tables, and the training report. The frontend uses the report’s actual held-out metrics. Median percentage errors are not confidence intervals. Rebuilding the model is a separate offline workflow described in `model-pipeline/README.md`.

## Optional API

Set `mode: 'api'` and `apiBaseUrl` in `web/config.js` to use:

```text
GET /cities/{geoid}/crime-comparison?horizonYears=4&metric=violent
```

Return geoid, unit (`per100000`), metric definition, baselineYear, currentRate, nationalYear, nationalRate, predictedYear, predictedRate, sources, and optional provenance/modelVersion. The provider validates identity, category, units, and years and cancels stale selections.

## Gemma research

`POST /api/ai/research` and `POST /api/ai/chat` accept a city GEOID, category, and optional question. `GET /api/ai/status` returns connection status without secrets.

`server/gemma.js` uses Gemma for every AI call. Chat receives server-owned chart data for both crime categories, reporting years, national benchmarks, percentage comparisons, and the model's evaluation report and actual feature names. A bounded Gemma action loop can look up other supported cities and request news. The client supplies up to eight recent conversation messages; changing the selected city or category resets that context. User-supplied numbers never replace the server snapshot. Per-city input values and individual feature contributions are not part of the website export; the assistant must not invent them.

Chat uses Gemma 4 26B A4B; news search and synthesis use Gemma 4 31B with its Google Search tool. Live capability checks found 26B search unreliable in minimal thinking and slow with high thinking; 31B returned grounded news in about eight seconds with minimal thinking. The server reads publisher pages directly to verify dates, headlines and available article text. The tested hosted URL-context call returned HTTP 400 and is not used. Blocked or undated sources are skipped, never replaced with another model family. Only retrieved source IDs are allowed. Recent means the past 90 days. Failed verification stays distinct from no relevant coverage. News never changes the forecast. Responses cache for 15 minutes, with chat history and both model IDs included in the cache key.

Set `GEMINI_API_KEY` in `.env.local` locally and as a Sites runtime secret in production. This is Google's credential name, not a Gemini model selection; `GOOGLE_AI_API_KEY` is also accepted. `GEMMA_MODEL` and `GEMMA_RESEARCH_MODEL` may select only `gemma-*` models; other model families are rejected. `GOOGLE_SEARCH_MODEL` is no longer used. Keys stay outside source and browser responses.

`POST /api/ai/homes` takes a GEOID and the Home fit quiz `answers` (price, beds, baths, sqft option ids). `server/homes.js` works in two Gemma steps: a plain search request to the research model with Google Search grounding (retried once if Gemma answers without searching, since an ungrounded answer may be invented), then the chat model applies the quiz sentence with the filtered Zillow search link to that grounded research and returns the listing as JSON. Only a listing backed by grounding results is reported; otherwise the response is `unverified` or `no_match`. Google’s search suggestions are returned for display, as grounding requires. Listings never touch the model values.

The supported server build uses Vinext and the Sites Vite integration. `web/` is authored frontend source; `public/` and `dist/` are generated. Run `npm run build` with Node 22.13+ before publication. `npm run preview:local` runs the shared API handler and map through Node on machines that cannot run the Cloudflare emulator.

## Combined website updates

The Home fit quiz turns budget, bedroom, bathroom and floor-area choices into a Gemma home match (`POST /api/ai/homes`, see the Gemma research section). Choices are stored locally. The site itself never fetches or stores listings.

News first uses the live-tested Gemma 4 search pipeline. The team’s direct Google News RSS reader is retained as a fallback when search fails or its sources cannot be read. RSS fallback summaries are restricted to dated headlines; they do not claim full-article verification. All AI calls remain Gemma-only. The Windows path separator fix is retained in the preview server.
