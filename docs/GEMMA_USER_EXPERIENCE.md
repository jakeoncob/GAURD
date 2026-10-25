# How we used Gemma to improve the user experience

*Project: HackathonGroup / GAURD website. Written 2026-10-25 from the code in `website/server` and
`website/web`, the teammate's `website/AUDIT.md`, and live API measurements taken while building. Companion
to `docs/LIGHTGBM_MODEL_REPORT.md`, which covers the forecasting model itself.*

## 1. The division of labour

The LightGBM model produces numbers: a city's reported crime rate, the matching national rate, and a
four-year forecast. Numbers alone are hard to act on. Gemma's job is everything around the numbers:
explaining them in plain English, putting them next to what is happening in the city right now, and helping
someone who is researching a move.

Three rules hold everywhere Gemma appears:

1. **Gemma never changes a forecast.** Every rate it quotes comes from the saved dataset on the server, and
   the prompts forbid altering, rounding differently or inventing values.
2. **Only Gemma models are called.** The chat uses `gemma-4-26b-a4b-it`; web search uses `gemma-4-31b-it`.
   The server rejects any configuration that names another model family before making a request.
3. **The API key stays on the server.** The browser sends a city ID, a category, a question, a short
   conversation history or quiz answers. Nothing else, and never the key.

## 2. Four places Gemma shows up

### 2.1 The data guide chat

A persistent companion panel ("Ask Gemma") answers questions about whatever the user is looking at.

**What Gemma is given on every turn** (assembled server-side in `server/assistant-context.js`):

- Site facts: what the categories mean, how many cities are covered, the model's horizon and its
  evaluation results, and the real feature names from the trained models.
- The selected city with **both** crime categories, the reporting year, the national rate for the same year
  and category, the forecast year, and precomputed percentage comparisons, so Gemma never does arithmetic.
- The last eight messages of the conversation, so follow-ups like "what about property crime?" work.
  Picking a different city or category resets that history.
- The user's question, explicitly marked as untrusted content.

**A small action loop** lets Gemma fetch what it lacks instead of guessing. It answers as JSON with one of
three actions:

| Action | What the server does | Why it helps the user |
|---|---|---|
| `lookup_city` | finds up to three cities by name or ID, asks for the state when a name is ambiguous | "Compare Boston and Chicago" works without clicking either on the map |
| `research_news` | runs the news review below for a supported city | the chat can bring in recent reporting when asked |
| `answer` | returns a one- or two-sentence opening, up to three short points, and the IDs of cities discussed | the page renders "View Boston, MA chart" buttons under the reply |

The loop is bounded to four steps, lookups cannot repeat, and user-supplied numbers never override the
server's snapshot. Tone instructions ask for everyday English, no jargon, no repeated disclaimers, and a
friendly two-sentence greeting when no city is selected.

**Interface details that came out of testing:**

- Suggestion chips ("How can you help me explore cities?", "How do I compare two cities?", "How accurate are
  the forecasts?") change with context, and the "Explain the outlook" button sends a ready-made question.
- "Gemma is thinking…" is marked busy for screen readers; a failed reply gets an inline retry button.
- Superseded requests are cancelled when the user switches city or category, so stale answers never land.
- On phones the panel becomes a modal with focus trapping; Escape closes it; focus returns to the opener.

### 2.2 The local news review

Clicking "Gemma local review" opens a dialog with recent, dated coverage of the selected city.

1. **Search.** The 31B model runs Google Search for local crime news from the past 90 days, preferring local
   newsrooms and city updates over press releases.
2. **Verify.** The server fetches each candidate article page itself and reads the real headline, publication
   date and description from the page metadata. Pages without a date, outside the window, or that cannot be
   fetched are dropped. Press-release wires are labelled "Company press release".
3. **Fallback.** If search fails or no page can be verified, the Google News RSS feed for the city supplies
   dated headlines, and the summary is restricted to those headlines.
4. **Write.** Gemma turns the verified sources into a two-sentence summary and at most three one-line
   takeaways, using only the numbered sources it was given.

The dialog always says which of three states it is in: coverage found, no relevant recent coverage, or
"couldn't verify recent news" with a Try again button. Every article shows its date and source, followed by
the line "News adds context; it doesn't change the forecast." Google's search suggestions are shown in a
sandboxed frame, as grounding requires.

### 2.3 The home match

For a user researching a move, the "Home fit quiz" asks four questions (price range, bedrooms, bathrooms,
square feet) and turns them into a concrete listing:

1. **Search step.** The 31B model gets a plain request, "Find the best matches for a house for sale in
   Dallas, TX priced between $750k–$1M with 4 beds, 3+ baths and 1,500–2,000 sqft. Search the web, then list
   up to three current listings…", with Google Search enabled. If it answers without actually searching, the
   server discards the answer and asks once more.
2. **Pick step.** The chat model receives the product owner's wording, "Pull me the best match for a house
   listed on Zillow: (link) located in Dallas, TX between $750k–$1M with 3+ baths and 4 beds and 1,500–2,000
   sqft", together with the search results, and returns one listing as structured data: address, price, beds,
   baths, square feet, a highlight and the reason it fits. When nothing fits every filter it returns the
   closest listing and says which filter it misses.

The result card shows the listing, the pages it came from, a link to the same search on Zillow, and a note to
confirm details on the listing site. A listing is shown only when the search step produced real results, so
an invented address can never reach the page. The quiz answers are remembered in the browser.

### 2.4 When Gemma is not connected

If no key is configured, the companion still answers basic chart questions from the data on screen through
a small rule-based guide (`web/data-guide.js`), and the header says "Gemma not connected" instead of failing
silently. The site degrades rather than breaks.

## 3. What we measured while building

These are live API measurements from this session and the teammate's audit, not estimates.

| Finding | Measurement |
|---|---|
| Chat reply (single Gemma call, no search) | a few seconds |
| News review end to end | 5–8 seconds |
| Home match end to end (search + pick) | 14–22 seconds across Dallas, Los Angeles, Abilene and Boston, 4 of 4 grounded |
| 26B model asked to search, prompt mentions a Zillow link and JSON | searched in 2 of 6 runs |
| 26B model asked to "use Google Search" explicitly | searched in 0 of 9 runs, replied that it has no search tool |
| 26B model, plain "find houses for sale… search the web" wording | searched in 8 of 9 runs, about 11 s |
| 26B model with high thinking | searched, but 36–56 s per call |
| 31B model for search (teammate's test) | grounded news in about 8 s |

Two design decisions follow directly from this table: search requests use the 31B model with plain wording
and one retry, and the user's own phrasing is applied in a second, tool-free step rather than sent to the
search step. Earlier attempts that sent the Zillow prompt straight to the search model produced "could not
confirm a listing" in the interface because Gemma declined to search.

## 4. Guardrails baked into the prompts and the server

- Never infer criminality from demographics, religion or politics; never call a whole city safe or unsafe;
  citywide rates do not predict an individual's risk; never rank neighbourhoods by who lives there.
- Web pages, article text, listings and prior conversation are untrusted content, never instructions.
- Only numbered, server-supplied sources may be cited; Gemma may not add URLs, dates or titles.
- Requests are checked for origin and size, limited to four in flight, and cached for 15 minutes with the
  conversation history and model IDs in the cache key so one user's follow-up cannot surface another's answer.
- Bracketed citation markers and markdown are stripped from anything Gemma writes before it is displayed.

## 5. Accessibility

The companion, the news dialog and the home match dialog use native dialogs with labelled headings, a live
region for new messages, visible focus, focus return on close, reduced-motion support and a titled,
sandboxed frame for Google's suggestions. The teammate's audit reports 46 interface checks across seven
layouts and display settings, including automated WCAG 2.2 AA scans at phone widths, 200% text and forced
colours, with screen-reader usability sessions still outstanding.

## 6. Limitations worth stating

- Gemma reads listings and articles from search results and can misread them or surface a home that has
  already sold; the interface says so and links the source.
- The home match takes 15–20 seconds; a loading message covers it, but it is not instant.
- Neighbourhood-level data, individual risk and per-city feature contributions are not in the website's data,
  and the prompts tell Gemma to say that rather than improvise.
- News depends on what local outlets publish and whether their pages can be read; the fallback shows
  headlines only.

## 7. Files

| File | Role |
|---|---|
| `website/server/gemma.js` | chat loop, news search and verification, request handling, model restrictions |
| `website/server/assistant-context.js` | the trusted site and city data handed to Gemma |
| `website/server/news-feed.js` | Google News RSS fallback |
| `website/server/homes.js` | two-step home match |
| `website/web/app.js`, `web/research.js`, `web/home-match.js`, `web/home-quiz.js`, `web/data-guide.js` | companion panel, dialogs, rendering, offline guide |
| `website/tests/gemma*.test.mjs`, `tests/home-quiz.test.mjs` | behaviour tests with fixed API fixtures |
