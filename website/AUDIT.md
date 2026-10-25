# GAURD error audit — 2026-10-25

The audit covers the website, its research API, saved data, dependency graph, and desktop/mobile interactions. It does not independently reproduce model training or certify WCAG conformance.

## Corrections

- Invalid JSON values such as `null` and arrays return a JSON 400 response instead of crashing the research route.
- Escape dismisses city search without the browser reopening hidden suggestions. Enter cannot select a dismissed result; the down arrow can reopen the list.
- Superseded research requests settle their loading messages. Closing chat, changing the selected city, or switching crime categories cancels stale research.
- A connected Gemma asks for a city when none is selected, rather than reporting a false connection failure.
- Unverified news offers a retry button. HTML and malformed upstream responses produce a short, useful error. Failed verification remains distinct from no relevant news.
- City-list failures remain visible when the forecast capability request succeeds. Partial comparisons are described as partial data.
- The corrected combined CSV passes strict agreement with the flat forecast export. Source hashes are regenerated from the retained bytes, and Git attributes prevent cross-platform newline conversion. All displayed rates, years, categories, national benchmarks, and city identities are unchanged.
- Missing Vite HTML-import types and optional hosting-binding declarations are corrected; `npm run typecheck` is available.

## Dependency review

The final full `npm audit` reports zero known advisories. Next.js, React/RSC, Vite, Zod, Sharp, and affected transitive packages are patched. The unused, unconfigured database migration CLI was removed. The existing Vinext/Cloudflare hosting structure and private audience are retained.

Relevant maintainer notices include the [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), [React server-function advisory](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g), and [Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w). An advisory count is a point-in-time dependency check, not a guarantee that all software defects are absent.

## Verification

- 40 automated tests pass, including exact reconstruction of the saved dataset from the retained exports and all 644 city/category records.
- 37 browser interface states pass automated WCAG checks: desktop, 390px and 320px phones, landscape, 200% text, text-spacing overrides, and forced colors.
- 20 failure/recovery checks pass, including cancelled requests, invalid API bodies, news retries, absent city data, missing map styles, and unavailable external tiles.
- Foreign selections and deep links remain disabled; U.S. state selection and city charts work.
- Type checking, syntax/data checks, and the production build pass.
- Source and generated output were scanned for the actual local secret and common credential patterns; no secret was found in published files.
- Production worker logs had no recorded errors during the initial three-hour review window.

## Remaining manual review

VoiceOver/NVDA testing and usability sessions with assistive-technology users remain outstanding. External map tiles and news publishers can be unavailable; the tested fallback and retry states handle those conditions. Model performance and source benchmark accuracy remain separate validation tasks.

## Gemma follow-up correction — 2026-10-25

The reported conversation bug was real: all connected city questions entered the news-only pipeline, no conversation history was sent, and no-selection questions fell back to canned text. Chat now receives canonical city data for both categories, national comparisons, reporting/forecast years, evaluation results and the trained models' feature names. Bounded server lookups let Gemma answer for named cities without a map selection. Eight recent messages support follow-ups; selecting a new city/category resets that context. Missing per-city feature contributions remain explicitly unavailable.

Every AI call now uses a Gemma model. Chat uses `gemma-4-26b-a4b-it`; news search and synthesis use `gemma-4-31b-it`. Live testing found the smaller model's search unreliable or slow; 31B produced grounded search results with minimal thinking. The unsupported URL-context call was removed after an actual HTTP 400 response. Direct publisher metadata supplies verified dates/headlines; inaccessible sources produce a retry state. Company releases retain a source label. News failures do not block chart explanations. Non-Gemma configuration overrides are rejected before any provider call.

Answers render as a short opening and up to three points, with optional chart buttons and separate dated source links. Tests cover no-selection chat, named-city lookups, multi-city comparisons, follow-up history, server-owned numbers, model restrictions, cache separation and failed news isolation. All 50 automated tests pass. The revised interface passed 46 checks across seven layouts/display settings, including 44 automated WCAG scans and two cancellation checks. Live API checks verified greetings, chart values, property-crime follow-ups, Wichita lookup, Boston/Chicago comparison and dated Wichita news. Saved forecasts, model files and source data were not changed.

## GitHub integration — 2026-10-25

The current UI, data-chat and audit fixes were merged with the team's Home fit quiz, filtered Zillow links and Windows preview fix. Root model and experiment files are unchanged. The Google News RSS implementation is retained as a dated-headline fallback when Gemma search fails or its publisher pages cannot be verified. Malformed feeds remain failures rather than empty-news results. The quiz preserves filters and the tailored question across research retries; its disclosure explains that submitted preferences reach Gemma and Zillow.

All 57 automated tests, syntax/data checks, type checking and the production build pass. The merged UI passed 46 conversation/interface checks across seven display settings, plus desktop and phone quiz/filter/retry/focus/accessibility checks. Changed files were checked for credentials before publication. These browser tests use deterministic API fixtures; they are not a new live-provider performance or model-validation study.
