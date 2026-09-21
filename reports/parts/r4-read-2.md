# r4 trace read — shard3 + shard4 (59 tasks)

Run: `chrome-extension/e2e/results/mind2web-r4-2953c78`. Model gemini-2.5-flash (planner+navigator), Vertex europe-north1. Heavy 429 rate limiting across the whole run.

## shard3

### `0170ca95038b05fa58d463fe627ac605` — UK visa needed for healthcare work >6mo (gov.uk) — task.ok, judge PASS, 18 steps, 469s, 168k in / 3.1k out tok
- **Did:** Visas and immigration → Work in the UK → Health and Care Worker visa → `read_page` → "another type of visa to work in the UK" → "Start now" → walked the whole 6-question visa checker (nationality, other passport, reason, duration, sector) → `done` on the results page.
- **Went wrong:** nothing — succeeded.
- **Wasted:** 1 failed `select_dropdown_option {"text":"United States"}` at step 6 (option list is "United States of America"), costing a step and a re-ask-free retry; the step-3 `read_page` of the Health and Care Worker visa page (5334 chars) bought nothing since the agent then left that page for the checker; 2 `step_interval` re-plans (steps 5, 10) on a linear questionnaire. Also **66 rate-limit retries / 181s of backoff** — 39% of the 469s wall clock.
- **Could have been:** the checker is reachable directly from Visas and immigration; skip the Health and Care Worker detour and the read, fuzzy-match the dropdown → ~13 steps instead of 18.

### `0b51b4fa0295ae80ccd176ebdad6fff6` — red Toyota Corolla 2018-2023 (carmax.com) — limit_tokens, judge FAIL, 32 steps, 896s, 582k in / 9.7k out tok, $0.20
- **Did:** typed "Toyota Corolla" + submit (step 0), clicked "Show filters" (step 2), then spent **steps 3-31 entirely on scroll / read_page / find_in_page**, never touching a Color or Year control, until the 500k input-token cap killed it.
- **Went wrong:** step 2 → step 3. After `click_element {"index":20}` ("Show filters") validated `passed`, the next state clearly did not surface the filter controls to the navigator, and instead of re-opening or using `find_in_page` results, it began a scroll walk: `scroll down` at steps 3,4,5,7,8, `scroll bottom` 9, `scroll up` 14, `scroll down` 16, `scroll top` 17, `scroll down` 19,20,22,23,25,26, `scroll up` 27, `scroll bottom` 30.
- **Wasted:** **15 scroll actions**, 5 `read_page` (two of them `mode:"full"` re-reads of the same page, one with `cursor:11997`), 3 `find_in_page {"query":"Color"}` that produced no follow-up click, 2 `identical-repeat` refusals ("you have already done exactly this 3 times on this page and nothing on it changed"), 1 `unshown-index` refusal (index 661 from an earlier read), 1 navigator LLM timeout (14.5s then 21.7s) forcing a `navigator_error` re-plan, 5 `step_interval` re-plans. Essentially 29 of 32 steps bought nothing.
- **Could have been:** search → open filter panel → check Color=Red → set year min 2018 / max 2023 → read results. ~6 steps. Or straight to the faceted URL. The agent never even tried `find_in_page` for "Red" or "Year".

### `16200f51d63f0a47a58fa17acd49e368` — recipe with eggplant + mushrooms (cookpad.com) — task.ok, judge PASS, 5 steps, 28s, 64k in tok
- **Did:** typed "eggplant and mushrooms" into search → clicked search → opened first result "Eggplant and Mushroom Fried Rice" → `done` with title + URL.
- **Went wrong:** nothing — succeeded.
- **Wasted:** one `stale-index` refusal at t=15.1s ("[12] is not on the current page") cost step 2; otherwise clean.
- **Could have been:** 4 steps (search, open, done). Near-optimal already — this is the shape every task should have.

### `1df24ec81137386d6476bcf343a79012` — lowest-priced NordicTrack (bestbuy.com) — task.ok, judge PASS, 28 steps, 233s, 356k in / 8.7k out tok, $0.12
- **Did:** opened search box → typed "NordicTrack" → scrolled → opened Sort by and picked "Price Low to High" (steps 3-4) → then 15 steps of scrolling/reading to confirm the first price → re-applied the same sort at steps 20-21 → opened a product, `go_back` → `done` "$69.99 Treadmill Mat".
- **Went wrong:** nothing for the verdict — but the sort was already correct at step 4 (t=38s) and the agent took another 190s to believe it.
- **Wasted:** **9 scrolls**, 2 `find_in_page {"query":"\\$[0-9,]+\\.[0-9]{2}"}` (a regex over the whole page instead of reading the first card), 3 `read_page`, 1 `view_screenshot`, the **re-application of the identical sort at steps 20-21**, a `leave-applied` guard refusal at t=181s ("this page shows lowest price (URL parameter sp=Price-Low-To-High) applied, and going back removes it"), 1 `completion_refused` re-plan, 4 `step_interval` re-plans, and a hedged (duplicated) 9.2s planner call.
- **Could have been:** search → sort Price Low to High → read the first card → done. **~5 steps**, not 28.

### `26810ed9c123a62992e3eed31db3c5ee` — daily weather for NYC (accuweather.com) — task.ok outcome but judge FAIL, 5 steps, 139s
- **Did:** typed "New York City" + submit → picked "New York City, NY US" from the suggestion list → landed on the default TODAY tab → `extract` (returned 0 items) → `read_page` (5006ms) → `done` claiming the page was broken with ERR_TOO_MANY_REDIRECTS.
- **Went wrong:** step 3. The agent was on a working NYC page (03-05.jpg) with `TODAY / HOURLY / 10-DAY / MONTHLY` tabs in the nav, but its `extract` of a day/date/high/low schema returned nothing, and it converted that empty extraction into a claim that the *site* was broken instead of clicking the **10-DAY** tab that was visible. The judge: "It never opened the daily forecast view, which is the '10-DAY' tab visible in the same nav bar."
- **Wasted:** the whole `extract` + 5s `read_page` pair (2 steps) and 3 `DOMService: Failed to remove highlights` errors; the run also spent 30s of rate-limit backoff on 5 steps.
- **Could have been:** search → pick city → click "10-DAY" → done. **4 steps.** An empty `extract` should never become "the site is broken".

### `2fc51dd3febd447f0fdcdabca8d944ce_110325` — climate-controlled unit for two small bedrooms near 60538 (publicstorage.com) — task.ok, judge PASS (medium), 20 steps, 123s, 337k in tok
- **Did:** typed 60538 → Find Storage → clicked the site's "Climate Controlled" checkbox (trace shows the control flipping false→true) → scrolled → opened the Size Guide to map "two small bedrooms" → 10'x10' → `save_findings` with the Aurora IL result at step 8 → then 7 more steps → `done` with the same text.
- **Went wrong:** nothing — succeeded. The answer was already complete at step 8 (t=57s).
- **Wasted:** **steps 9-18 (10 steps) after the answer was already saved**: a click into a new tab at step 9 then **6 `switch_tab` actions ping-ponging between tab 1665387329 and 1665387330** (steps 10-15), which tripped a `progress_stall` re-plan at step 16, followed by 3 more scrolls. Half the run.
- **Could have been:** zip → search → Climate Controlled filter → size guide → read the matching unit → done. **~7 steps**, which is exactly what it had at step 8.

### `34ccd15a8ea8fd3895af83f5ccf62369` — what to do about an item lost on a bus (us.megabus.com) — task.ok, judge PASS, 12 steps, 423s, 124k in tok
- **Did:** Help (step 0) → expanded the FAQ "What do I do if I lost an item on the bus?" (step 1) → clicked the "form" link, which opened a **new tab** (step 2) → then six `switch_tab` actions → `save_findings` → `done`.
- **Went wrong:** nothing for the verdict — the FAQ answer was fully on screen after step 1 (t=145s).
- **Wasted:** **steps 3-9 are six `switch_tab` calls alternating 143822885 ↔ 143822886** with nothing done on either tab; they triggered two `progress_stall` re-plans and one `completion_refused`. That is 7 of 12 steps. Plus **58 rate-limit retries / 192s of backoff** (45% of the 423s).
- **Could have been:** Help → expand the FAQ → done from the FAQ text. **3 steps.** The Contact Us tab added nothing the FAQ did not say.

### `4091bdd3fa64a5b0d912bc08eaf9c824` — list of Brooklyn neighborhood maps (new.mta.info) — task.fail, judge PASS (page was right), 12 steps, 360s, 206k in / 9.2k out tok
- **Did:** Maps → Neighborhood maps → Brooklyn (3 clicks, t=115s) landed on exactly the right page — then tried to enumerate it with `extract` **seven times** (steps 3,4,5,6,7,8,9) and again at step 11, each returning 0 items, and died on `MaxFailuresReachedError`.
- **Went wrong:** step 3. The navigation was done; the failure is entirely in `extract`. The model kept inventing non-standard JSON-Schema keys — `{"name":{"type":"string","selector":"a[href^=\"/document/\"]","attribute":"aria-label"}}` — which returned nothing, and on the final attempt the provider rejected the whole tools payload: *"Invalid JSON payload received. Unknown name \"selector\" at 'tools[0].function_declarations[0].parameters.properties[0].value'"*, which flipped the task to prompt-rendered tools and then `no valid tool call after re-asks`.
- **Wasted:** **8 `extract` calls**, 2 `progress_stall` re-plans, 1 `identical-repeat` refusal, the provider-tools downgrade, and 40 rate-limit retries / 133s backoff. 9 of 12 steps bought nothing.
- **Could have been:** 3 clicks then `read_page` (or `done` on the visible list). **4 steps.** The agent had the answer at t=115s and spent 245s failing to copy it.

### `47e314cc452c540524ffb7cf520285a3` — park with the cheapest paddling permits (recreation.gov) — limit_steps, judge FAIL, 50 steps, 408s, 677k in / 11.6k out tok, $0.19
- **Did:** Permits search "paddling permits" → `select_dropdown_option {"text":"Price"}` at **step 3 (t=32s)**, which already sorted the list — then abandoned the sort and opened **eight permit detail pages in new tabs** (North Cascades, Desolation Gray-Green, Dolores River, Yellowstone, Boundary Waters, Somerville Lake, Pine National Scenic River, Ruby Horsethief), `read_page {"section":"Fee Policies"}` + `save_findings` on each, returning to the tab in between, until the 50-step cap.
- **Went wrong:** step 5. After sorting by Price it did not read the top card; the planner set it on an exhaustive fee comparison instead. It even re-navigated twice to `…&sort=price%20asc` (steps 31, 38) and *still* opened more detail pages rather than reading position 1.
- **Wasted:** the entire enumeration loop — **8 open/read/save cycles ≈ 32 steps**, **9 `switch_tab`**, **5 `go_back`** (two of which failed with "History entry to navigate to not found"), 10 `step_interval` re-plans, 2 hedged 13s planner calls, and ~35 `DOMService: Failed to remove highlights` errors clustered on go_back/switch_tab. Never produced an answer at all.
- **Could have been:** search → sort by Price → read the first result's park name and fee → done. **~5 steps.** The site's own sort made the superlative free and the agent threw it away.

### `50d91eabde542906937ab4c5b6f8f23a_121425` — baby growth percentiles (babycenter.com) — task.ok, judge PASS, 18 steps, 598s, 189k in tok
- **Did:** opened the growth-chart calculator → `fill_form` with both dates + weight/height/head (step 2) → the two date fields refused text and kept showing "09-20-2026" → retried with `12/01/2025` (step 3) → gave up on typing and drove the **date picker by hand**: year view → 2025 → Next month ×3 → day 1, twice (steps 4-14, 11 clicks) → re-filled the four numeric fields → Calculate → `done` with 55th/69th/66th.
- **Went wrong:** nothing for the verdict — but step 2/3 shows the real cost: `fill_form` on a date-picker-backed input reports `unknown — The field now shows "09-20-2026" instead of "12-01-2025"` rather than a hard failure, so the agent burned a second identical attempt with only the separator changed before switching strategy.
- **Wasted:** 1 duplicate `fill_form` (step 3, same values, `-` → `/`), 1 `validation` re-plan, and **82 rate-limit retries / 294s of backoff — 49% of the 598s**. The 11-click date-picker walk was genuinely necessary.
- **Could have been:** if the first `unknown` verdict had routed straight to the picker, ~16 steps; the date picker itself costs 10 of them. Realistically **15-16 steps**, but 300s instead of 598s without the throttling.

### `5dec0e6620849459f29e6465982c597e` — 33-49" QLED 240Hz gaming monitor $1000-2000 (bestbuy.com) — task.ok outcome, judge FAIL, 45 steps, 346s, 738k in / 22.8k out tok, $0.27
- **Did:** searched "Qled gaming monitor" → applied screen-size facets by ticking **three** boxes (`31.5"-33.9"`, `34"-39.9"`, `40" or More`, steps 3-5) → 240Hz facet → typed 1000/2000 into the price min/max and applied (steps 6-9) → then **steps 10-44 (35 steps) trying and failing to see any product card**, ending with "despite the search results indicating 26 items, no product listings are visible on the page".
- **Went wrong:** two things. (a) Step 3-5: the size range was over-selected — `31.5"-33.9"` and `40" or More` both exceed the requested 33-49", which the judge marks as a too-broad filter. (b) Step 10 onward: Best Buy's result grid was simply **not present in the agent's page state**, and instead of accepting that and reporting, the agent hammered it.
- **Wasted:** **12 `find_in_page`** probes (`"monitor"`, `"Add to Cart"` ×2, `"$"`, `"Customer Reviews"`, `"inch"`, `"Product"`, `"search results"`, `"product-item"`, `"product-title"`, `"no results"`, `"item"`), **11 scrolls**, **7 `read_page`** (3× `mode:"full"`), 2 `extract`, 1 `view_screenshot`, 7 `step_interval` re-plans, 2 `completion_refused`, 1 `progress_stall`, and a hedged 9-10s planner call. 35 of 45 steps bought nothing.
- **Could have been:** search → tick only `34"-39.9"` + `40" or More` (or the nearest single band) → 240Hz → price min/max → read results. **~7 steps.** The 35-step grid hunt is a perception failure: the same site cost `1df24ec…` a similar scroll/read run.

### `63d6866fc000fcb1f153e07604bd1395` — Nearby Attractions of HK's most popular attraction (us.trip.com) — task.fail, judge FAIL, 21 steps, 237s, 395k in tok
- **Did:** clicked into search → two clicks blocked by an overlay → typed "Hong Kong" + submit → opened **Hong Kong Disneyland** (labelled "#10" in the listing, not the site's top-ranked HK attraction) → scrolled to the "Nearby Attractions" accordion → then **six `extract` attempts**, five of which hard-errored.
- **Went wrong:** two failures. (a) Step 5: it picked an attraction ranked #10 rather than establishing "most popular" from the site's ranking, so the superlative was never grounded. (b) Step 13 onward: it repeatedly sent `extract {"schema":"{\"type\":\"array\",\"items\":{\"type\":\"string\"}}"}`, which returns the hard error *"schema names no fields: give an object schema with properties, or an array of such objects"* — at step 18 it briefly got the schema right (`items.properties.name`) and got a clean result, then **reverted to the broken string-array schema at steps 19 and 20** and died on `MaxFailuresReachedError`. It also never clicked the collapsed accordion open; 21.jpg shows "Nearby Attractions" still chevron-down.
- **Wasted:** 5 identical-shape `extract` failures, 2 `covered` refusals ("The element is covered by \<div\> \"Hong Kong\""), 1 `Node is detached from document`, 1 `failed-retry` refusal, 1 `stale-index`, 3 `validation` re-plans, 3 scroll runs. ~12 of 21 steps.
- **Could have been:** search HK → take the #1 ranked attraction from the "Things to do" list → open it → **click the Nearby Attractions accordion** → read it. **~6 steps.** The whole failure is one un-clicked accordion plus an un-coerced extract schema.

### `6b5be1764692d1dc8f17dc4375b2daa8` — historical data for EUR/USD (finance.yahoo.com) — task.fail, judge PASS (view was reached), 9 steps, 395s, 134k in tok
- **Did:** typed "EURUSD" into the top search + submit → the submit did not navigate, so `go_to_url` back to the homepage → typed again → clicked into the search field → typed again → picked the EURUSD=X suggestion → clicked the "Historical Data" tab (step 6, t=239s) → `extract` returned 261 rows → then the planner timed out repeatedly and the run died.
- **Went wrong:** the goal was reached at step 7; the failure is purely infrastructure. **Four planner/navigator LLM timeouts** (10.4s then 15.5s, three rounds) after the answer was already on screen, and the harness reported `task.fail` with the answer text attached.
- **Wasted:** steps 0-4 are **three separate attempts to type EURUSD into search** plus one `go_to_url` recovery — the first `input_text {submit:true}` validated `passed` but did not actually advance. Plus **37 rate-limit retries / 145s of backoff** and ~80s of timeouts. Only 3 of the 9 steps were productive.
- **Could have been:** type EUR/USD → pick the suggestion → click Historical Data → done. **4 steps**, ~30s without throttling. The `done` after a reached view should not have been gated behind a planner call that could time out.

### `73d08420706ae205a9c5be28b6d4e80f` — rules & cancellation for Alley Spring (recreation.gov) — task.ok, judge PASS, 44 steps, 391s, 533k in / 10.3k out tok, $0.16
- **Did:** typed "Alley Spring" into the homepage search, clicked the suggestion, landed somewhere wrong, `go_back` — **and then repeated that same cycle eight times** (steps 0-41: `input_text {index:15}` → `click {index:16}` → `click {index:10}` → `input_text {index:2}` → `click {index:4}` → `go_back` / `go_to_url https://www.recreation.gov/`). At step 40 it finally used `input_text {..., "submit": true}` instead of clicking a suggestion, got the real result list, opened Alley Spring (step 41), clicked "Rules & Cancellations" (step 42) and saved the rules.
- **Went wrong:** step 1. The suggestion click never reached the Alley Spring page and the agent had no way to notice — every action in the loop validated `passed`, so neither the validator nor the stall detector fired until step 34 ("2 consecutive steps did not validate"). The single thing that fixed it was submitting the query instead of clicking a dropdown suggestion.
- **Wasted:** **~40 of 44 steps**: 8 `input_text` re-entries of the same 12-char query, 9 `go_back`, 3 `go_to_url` back to the homepage, one `repeat-address` refusal at t=262s ("you already opened this address 3 times in this task, and it gives the same page each time"), 4 `step_interval` + 2 `completion_refused` re-plans, 2 hedged planner calls.
- **Could have been:** type "Alley Spring" + submit → open the Alley Spring result → click "Rules & Cancellations" → done. **4 steps**, ~30s. It did exactly this in steps 40-43.

### `7abdceee212151f187ee1a1744c57606` — filing fee for a self-petitioned I-140 (uscis.gov) — task.ok, judge PASS, 6 steps, 92s, 71k in tok
- **Did:** searched "filing fee I-140" → Filing Fees → Fee Schedule → opened the I-140 section → two `assert` calls quoting the $715/$665 General Filing and $300 Asylum Program Fee rows → `done` with both totals.
- **Went wrong:** nothing — succeeded, and the `assert` pair is exactly the evidence discipline you want.
- **Wasted:** one refusal at t=89.9s — *"The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions"* — the navigator batched `assert` + `done`, so `done` had to be re-issued after a `step_interval` re-plan, costing one extra round trip. 43s of the 92s was rate-limit backoff.
- **Could have been:** 5 steps. Near-optimal; the only avoidable cost is the assert+done batching rule.

### `828c2d98616a9478d5864d847d5a1b28` — browse Civil Division forms (justice.gov) — task.ok, judge PASS, 5 steps, 151s, 70k in tok
- **Did:** Resources → Forms → `select_dropdown_option {"text":"Civil Division"}` → Apply Filters → `extract` the 11 rows → `done` with the list and PDF links.
- **Went wrong:** nothing — succeeded.
- **Wasted:** the step-4 `extract` again used non-standard `selector`/`attribute` keys, which made the provider **reject the whole tools payload** (*"Unknown name \"selector\" at 'tools[0]…'"*) and downgraded the task to prompt-rendered tools; the retry then took **40 seconds** for one extract. 43s of the 151s was rate-limit backoff.
- **Could have been:** 5 steps is right; the loss is 40s of wall clock and a degraded tool mode, both from an un-sanitised extract schema.

### `8ae510355d978424f490798f900bfa2c_051526` — NY private rooms with private bathroom + wifi + gas (student.com) — task.ok, judge PASS, 15 steps, 349s, 169k in tok
- **Did:** typed "New York" → picked it → Room Type → Private Room → All Filters → scroll → ticked Private (bathroom), Gas, Wifi → "Apply Filters (4 results)" → `read_page` → 2 `extract` → `done` with the four listings.
- **Went wrong:** nothing — succeeded, and every requirement went through a real site control.
- **Wasted:** after the filtered list was on screen at step 10, it spent steps 11-13 on `read_page` + **two `extract` calls** (the second adding useless `"pattern": "### (.*)"` / `"From(.*)/month"` keys) to re-derive names it could already read. 3 steps. Plus **44 rate-limit retries / 76s backoff**.
- **Could have been:** 11-12 steps. The filter walk itself was efficient; only the read/extract tail was surplus.

### `96afb3c51146b0c2a9c55f039a5ea6d6` — most frequent 3-syllable rhyme for "thought" (merriam-webster.com) — task.ok outcome, judge FAIL, 21 steps, 467s, 317k in / 4.9k out tok
- **Did:** searched "thought" → opened "See All Rhymes for thought" → 5 scrolls → 2 `find_in_page` → **6 `read_page` calls** trying to isolate the "3 syllables" section → took the *first alphabetical* word, "aeronaut", and reported it as the most frequent.
- **Went wrong:** step 19. `save_findings` states the error outright: *"The first word listed is 'aeronaut'. **This is assumed to be the most frequent.**"* The list is alphabetical, and the page's own Advanced View / sort controls (visible in 18.jpg) were never touched. A superlative was invented from list position.
- **Wasted:** **6 `read_page`** (four of them `mode:"full"` or the same `section:"3 syllables"` re-read, each ~5.1s), 2 `find_in_page`, 7 scrolls, 1 `identical-repeat` refusal, 1 `scroll to text` failure ("Attempted to use detached Frame"), 3 `step_interval` re-plans. ~14 of 21 steps.
- **Could have been:** search → See All Rhymes → switch to the frequency/Advanced sort → filter to 3 syllables → read the top entry. **~5 steps.** Alternatively: if the ordering cannot be made frequency-based, say so rather than guessing.

### `9d46ccb915eff39ee1ae1e7328f5f20d` — UPS quote, fastest service, 5 lb 4x4x4, NY→Truckee (ups.com) — task.ok outcome, judge FAIL, 25 steps, 364s, 316k in / 12.7k out tok
- **Did:** reached the Time and Cost tool → filled origin New York/10001 and destination Truckee/96162 → fought an overlay and invisible elements for ~130s → clicked the first "Update" (step 19), which produced a *time-only* table → turned off UPS Simple Rate and typed 4/4/4 in and 5 lbs (step 23) → `extract` → `done` naming "UPS Next Day Air Early".
- **Went wrong:** step 23→24. After typing the package details it **never pressed the second "Update" submit** (`ctc_second_submit`, element [60] in the page state), so the table it read was the one computed *before* weight and dimensions existed, and the Cost column was empty. The judge: "no dollar amount appears anywhere in the run." It answered a cost question with no cost.
- **Wasted:** 5 `click_element` failures — 1 `covered` ("The element is covered by \<header\> \"Hello there! Create a profile…\"") and **4 `invisible`** ("The element has no visible area…"), each burning a step; a needless `ask_human` confirmation on a *quote* form ("Enter, which submits \"Edit\"… This may place an order, make a payment"); **3 `completion_refused` + 2 `validation` re-plans**; 3 hedged 9-12s planner calls; 1 `view_screenshot`, 1 `find_in_page`, 2 `read_page`.
- **Could have been:** open Time and Cost → fill both addresses → Update → fill 4/4/4 + 5 lbs → **Update again** → read the fastest row's service and cost. **~7 steps.** One missed submit button cost the task.

### `a48e2f1ee8d87eaeea56fe5e730427e6` — pass the first trending chess puzzle (chess.com) — limit_steps, judge FAIL, 50 steps, 645s, 374k in / 12.6k out tok
- **Did:** opened the Puzzles menu, `find_in_page {"query":"trending puzzles"}` returned "No match" (step 4) — and from there it cycled **three full times** through Puzzles landing → Puzzles menu → Daily Puzzle → Solve Puzzles → Puzzle Rush → `go_back` → repeat, until the 50-step cap. **It never made a single chess move.**
- **Went wrong:** step 5. Once "trending puzzles" did not exist as a label, the planner had no fallback and never committed to just solving the puzzle that was on screen. And decisively, the agent has no board affordance: 39.jpg shows an open puzzle ("White to move — You can play checkmate soon") that it simply could not play, because nothing in its action set drags or clicks a piece to a square.
- **Wasted:** essentially all 50 steps — **11 `go_back`** (two of them taking a full 15.0s), 4 `go_to_url` back to `chess.com` / `chess.com/puzzles`, **9 `read_page`** (5 with `mode:"full"`, three taking 5.0s), 7 `step_interval` re-plans, ~20 repeated clicks on the same index 2/45/46/49 menu items, 46 rate-limit retries / 110s backoff.
- **Could have been:** open Puzzles → open the top puzzle → play the correct move(s). **~4 steps** — if a board move were possible at all. As built, the right behaviour was to stop at step 5 and report that the puzzle cannot be played, not to loop 45 more steps.

### `ade4c09ad3fdb1607209750924cd232f` — compare AeroAPI plans (flightaware.com) — task.ok, judge PASS, 20 steps, 455s, 290k in / 10.6k out tok
- **Did:** one click to "Integrate AeroAPI into your platform" (t=12s) put the whole comparison table on screen. It then spent steps 1-13 on **eight `extract` calls** that all returned 0 items, and steps 14-19 writing the table out **one row per `save_findings` call — 15 of them** ("- Alerts: Not included in Personal…", "- Monthly minimum fee: No minimum for Personal…").
- **Went wrong:** nothing for the verdict — the answer is correct and came from `read_page` at step 11.
- **Wasted:** **8 `extract`** (varying only `scope`: none, `"Included APIs"`, `"16"`, `"table"`, `"Find the right tier for your needs"`), 1 `find_in_page {"query":"table role=\"table\""}` (a CSS selector passed to a text search), **15 single-line `save_findings`** where one call would do, 4 `step_interval` + 1 `completion_refused` re-plan, 44 rate-limit retries / 125s backoff. Validation counters tell the story: `passed: 3, not_applicable: 25`.
- **Could have been:** click the AeroAPI link → `read_page` → `done` with the table. **3 steps**, ~20s.

### `b6d10e9bd19b4009a02dea0e98f4e1ae` — current MLS standings (foxsports.com) — task.ok outcome, judge PASS on the view but the answer is wrong, 7 steps, 212s
- **Did:** clicked MLS → clicked STANDINGS (t=34s) — the 2026 LIVE STANDINGS table was then on screen (06.jpg) — `extract` returned nothing → `wait_for network_idle` → `read_page` (5.0s) → `ask_human` "Please solve the reCAPTCHA" → after the answer, `done(success:false)` claiming reCAPTCHA still blocked it.
- **Went wrong:** step 2. The standings table was visible; the failed `extract` was read as "the site is blocking me". It then **invented a reCAPTCHA that the screenshots do not show** and escalated to the user over it. The judge: "a claim contradicted by the screenshot".
- **Wasted:** 1 failed `extract`, 1 `wait_for`, 1 5s `read_page`, **1 needless `ask_human` + the `human_needed` re-plan**, 8 `DOMService: Failed to remove highlights` errors, 1 `contract_complete` re-plan. 5 of 7 steps.
- **Could have been:** MLS → STANDINGS → `read_page` → done with the table. **3 steps**, ~40s. An empty extract must fall back to reading the page, never to a blocked-site claim or a human question.

### `bb518416a786fdb9b9bbf0c78515595e` — browse graduate CS class schedule (osu.edu) — limit_steps, judge PASS (view was reached), 50 steps, 333s, 568k in tok
- **Did:** navigated to the CSE Courses search, set Academic Career = Graduate + Level = 5000 and pressed Search (**steps 12-14, t=81s — task effectively done**), expanded CSE 5022/5023/5032, then re-did the filter as Subject = Computer Science and Engineering + Graduate (steps 27-29), and spent steps 30-49 clicking around the Current Students / Advising menus until the step cap.
- **Went wrong:** step 15. With the filtered list on screen the planner never accepted completion, so the agent kept "browsing" — and after step 26's `go_back` the guard had to tell it: *"this page shows graduate-level computer science courses (URL parameter field_subject_target_id=112&field_academic_career_target_id=132) applied, and going back removes it."* It did it anyway later.
- **Wasted:** **~35 of 50 steps** — the entire post-step-15 tail: 3 `go_back`, a second identical filter application (steps 27-29), ~12 repeat clicks on index 11/37/25, 12 scrolls, 2 `covered` refusals (Cookie banner; Advising menu), 1 `leave-applied` refusal, 6 `step_interval` re-plans, 4 hedged planner calls, and a final `AbortError`.
- **Could have been:** CSE → Courses → Academic Career=Graduate → Search → done. **~5 steps.** The filtered schedule existed at t=81s and the run burned 250s more.

### `c00437fd76a7a83b57f3dc4e5dbc41f8` — most recent full-time medical health & safety jobs, 1-3 yrs, US (amazon.jobs) — limit_steps, judge FAIL, 50 steps, 835s, 444k in / 17.3k out tok
- **Did:** searched "medical health and safety", then **toggled the "1-3 years" experience chip on and off more than a dozen times** (`click_element {"index":11}` at steps 1,2,9,10,13,14,29,36,37,39,40,41,42,43,44,46 — each click adds the chip, the next click hits its "X" and removes it). It never applied full-time, never applied a job category, never got a US location filter to stick, never sorted by date. Final screen: "Sorry, there are no jobs that meet your criteria".
- **Went wrong:** step 2. Index 11 alternated between the chip and its remove button as the page re-rendered, and because *the page did change each time*, neither the `identical-repeat` guard nor the stall detector ever fired — the agent oscillated for 800 seconds with every action validating `passed`.
- **Wasted:** ~16 toggle clicks, 3 `find_in_page {"query":"full-time"}` that all reported no match (steps 4, 12, 48) without ever changing approach, 2 `read_page {"section":"JOB CATEGORY filters"}` that reported no such section, 9 scrolls, 3 `covered` refusals, 7 `step_interval` re-plans, 3 hedged 8-13s planner calls, **73 rate-limit retries / 173s backoff**. ~45 of 50 steps.
- **Could have been:** search the category → tick Full-time → tick 1-3 years → set country US → sort by most recent → read. **~6 steps.** Once `find_in_page "full-time"` failed twice the agent should have reported the filter as absent, not looped.

### `c577a14301a725e09ccd269a3e0b271e_110325` — highest critic-scored OR wine <$40 pairing fish/dessert (wineaccess.com) — task.ok, judge PASS (medium), 30 steps, 274s, 419k in tok
- **Did:** walked the facet rail: red + white type, Oregon/Willamette region, Max $ = 40, Food Pairing = Fish + Dessert, and `ordering=-expert_rating` (the site's Critic Score sort) — all confirmed in the resulting URL — then reported "No Products Match Selected Filters", which the trace confirms is the site's genuine answer.
- **Went wrong:** nothing — succeeded, including correctly reporting a real empty result set rather than inventing one.
- **Wasted:** heavy facet churn — `click_element {"index":72}` **five times in a row** at steps 23-27 and `{"index":65}` four times across steps 8,9,16,21,22, re-opening/collapsing the same facet panels; 1 `Node is detached from document` failure; 2 LLM timeouts (12.8s, 5.1s) and 3 hedged planner calls; and **3 consecutive `completion_refused` re-plans** at step 30 arguing about a correct empty-result answer. ~9 steps.
- **Could have been:** ~18-20 steps — this task genuinely needs 6 facets plus a sort. The avoidable part is the facet re-click churn and the trio of completion refusals.

### `ce616721ce9aeda69890fbccb29677a6` — price a large flat-rate box 77449→77084 (usps.com) — task.ok, judge PASS, 5 steps, 34s, 53k in tok
- **Did:** Quick Tools → Calculate a Price → filled both ZIPs and clicked FlatRateBoxes **in one batched turn (step 2, three actions)** → scroll → `done` with "$34.00 Retail, Wed Sep 23".
- **Went wrong:** nothing — succeeded.
- **Wasted:** nothing measurable. 34 seconds, zero rate limits, zero re-plans beyond initial + completion check.
- **Could have been:** this *is* the shortest route. **Best run in the shard** — note the multi-action turn at step 2, which is exactly the batching other tasks never do.

### `d8e2a81fa621ce4737e5ea85671b630e_110325` — in-person full-time jobs within 10mi of 14810 with Quick Apply (ziprecruiter.com) — task.ok outcome, judge BLOCKED, 6 steps, 51s
- **Did:** typed the query + ZIP → Search → Cloudflare "Verify you are human" interstitial → `wait_for {"text_gone":"Verifying..."}` → the `challenge-element` guard refused to touch the widget → `ask_human` once → after the answer the challenge persisted → `done(success:false)` listing exactly which filters were not applied.
- **Went wrong:** nothing the agent could control — the site refused access. The handling is textbook: refuse the CAPTCHA, ask once, report precisely what was not applied.
- **Wasted:** **3 consecutive `completion_refused` re-plans at step 6** (t=40.3 → 44.0 → 47.2 → 50.3s), four planner calls arguing with a correct blocked report. That is 10 of the 51 seconds and 4 of the 13 LLM calls.
- **Could have been:** identical 6 steps minus the three refusals. A `blocked` report should not be sent back to the planner repeatedly.

### `e43cbc8a0bf9e999884928d11006f894_110325` — Miami experience, 2 adults, 1-3h, <$100, next Mon-Fri, 4.5+ (airbnb.com) — task.ok, judge PASS (medium), 31 steps, 275s, 500k in / 15.3k out tok
- **Did:** dismissed a promo overlay → Experiences tab → searched Miami → picked 21-25 Sept → 2 adults → Filters → set max duration and max price (₹8,330 ≈ $100) → read the cards and answered with five 4.5+ experiences.
- **Went wrong:** nothing — succeeded; Airbnb has no rating facet, so picking 4.5+ cards from the displayed list was the only route.
- **Wasted:** **7 scrolls inside the filter panel** (`scroll {"direction":"down","index":208}` ×5, one returning "No change was visible after scrolling the element"), **3 `extract` calls** (steps 25, 26, 28) that all came back empty before it gave up and read the cards, 1 `find_in_page {"query":"rating"}`, 1 `covered` refusal on the "Take 10% off" banner, 4 `step_interval` + 1 `completion_refused` re-plan, 1 hedged 11.6s planner call. ~10 steps.
- **Could have been:** ~20 steps. The date/guest/filter work is irreducible; the extract-then-fall-back-to-reading tail and the filter-panel scroll churn are not.

### `f158345f8489e0d1d91e28768c39bca1` — Azure cost for GPT-4o + GPT-4o Mini, 5M in/5M out (azure.microsoft.com) — task.ok outcome, judge FAIL, 24 steps, 375s, 341k in / 10k out tok
- **Did:** opened the pricing calculator → added **one** Azure OpenAI item → set Data Zone + 5000×1,000 input/output → selected GPT-4o-mini ($4.13) → then changed **the same dropdown** to GPT-4o-128K ($110.00), overwriting the mini config → reported a total of $114.13.
- **Went wrong:** step 13→20. The calculator only ever held one model. The judge checked: "$114.13 appears nowhere on the site; grepping trace.jsonl shows it only inside the agent's own findings and done text." The agent **arithmetic'd two readings taken at different times into a total the page never showed**, exactly what a calculator task forbids.
- **Wasted:** 2 dropdown exact-match failures — `"GPT-4o Mini"` (the option is `"GPT-4o-mini"`) and `"GPT-4o"` (options are `"GPT-4o-128K"` / `"GPT-4o-2024-08-06"`); a duplicate `save_findings` (steps 16 and 17, identical text); **3 `todo_list {"action":"complete"}` calls in a row** (steps 21-23) marking the same item done; 2 `completion_refused` re-plans; 38 rate-limit retries / 86s backoff.
- **Could have been:** add Azure OpenAI item → configure GPT-4o → **"Add" a second item** → configure GPT-4o-mini → set support = Basic → read the calculator's own total. **~12 steps**, and the total would have come from the page.

### `fc53ddd3421411a41c1020a3fdc84ec4_070826` — open-box Galaxy S25+ with S22 trade-in cost (bestbuy.com) — limit_tokens, judge FAIL, 41 steps, 557s, 678k in / 22.7k out tok, $0.27
- **Did:** searched "open-box Samsung Galaxy S25 Plus" and then **never left the results page**. All 41 steps are scrolls, `find_in_page` probes and clicks on hidden/detached elements; no product page, no open-box condition, no trade-in flow, no device attributes.
- **Went wrong:** step 2. `scroll` returned *"The page did not scroll: it may be locked behind an open dialog or scroll only inside an element"*, then three clicks failed with "The element has no visible area" and one with "Node is detached from document" — the result grid was behind a modal the agent never identified or closed. It spent the next 35 steps working around a dialog instead of closing it.
- **Wasted:** **17 scrolls** (4 of them `scroll {"direction":"down","text":"Add to Cart"}` that never matched), **4 `find_in_page`** including `{"query":"no results|no items|no products|0 results"}` (a regex alternation aimed at a text search), 3 `read_page`, 3 `invisible` + 2 `stale-index` + 1 `disabled` + 1 `failed-retry` refusals, 7 `step_interval` + 2 `validation` + 1 `progress_stall` re-plan, 2 hedged planner calls, a late `ask_human` asking which S25+ to buy **after 553s of no progress**, 38 rate-limit retries / 114s backoff. ~38 of 41 steps.
- **Could have been:** close the dialog → open the Excellent open-box S25+ → start trade-in → answer the device questions → read the net price. **~12 steps.** Third Best Buy task in this shard (with `1df24ec…`, `5dec0e…`) where the product grid was effectively invisible to perception.

## shard4

### `01abae9608f2d8752a83e08f136f720c` — code of the top mover in BEPTEC (cboe.com) — task.ok outcome, judge FAIL, 8 steps, 71s, 80k in tok
- **Did:** navigated the index menus to the BEPTEC dashboard (6 clicks) → `wait_for network_idle` → answered "AT&S Austria Technologie & Systemtechnik AG Akt … 5.64%".
- **Went wrong:** the final answer. The task asked for **the company's code**; the TOP MOVERS widget columns are Company/Curr/Price/Chg%/Time, so the ticker was not there, and the agent neither opened the constituent page nor said the code was unavailable — it just answered with the name and shipped it.
- **Wasted:** a re-click of index 14 at step 4 after step 2's identical click, one hedged 8.3s planner call, one `wait_for` at the end that changed nothing. 2-3 steps.
- **Could have been:** reach BEPTEC → read the top mover → **open that constituent / the symbol listing for its code** → done. **~8 steps**, same budget, correct answer. The miss is a requirements check: the plan's checklist should have blocked `done` on an answer with no code in it.

### `0e42c3a73f2aece1f854e0ba55b7c8b0` — Manhattan gas station >4.0, sort reviews lowest (google.com/maps) — task.ok outcome, judge FAIL, 5 steps, 45s, 44k in tok
- **Did:** searched "gas station in Manhattan, NY" → clicked a result → **one** scroll → `find_in_page {"query":"rating"}` → clicked another result → declared that no Manhattan gas station is rated above 4.0.
- **Went wrong:** step 5. It saw four results (Mobil 3.5, Mobil 3.2, Shell 3.7, bp 2.8) and generalised "none above 4.0" from a single scroll of a long list — a 4.3-rated station exists further down. It never opened a place's reviews and never touched the review Sort menu, so the *action* the task asked for was never attempted.
- **Wasted:** nothing much in steps — the run is short. The waste is the opposite kind: 1 `completion_refused` re-plan and 2 hedged 9-10s planner calls spent ratifying a 45-second give-up.
- **Could have been:** search → scroll the result list until a >4.0 station appears → open it → Reviews → Sort → Lowest rating. **~6 steps.** A negative claim over a scrollable list should require reaching the end of the list.

### `180ed2ec377ef3a4af9035a21522091a` — how to give a gift to UM-Dearborn (umich.edu) — task.ok outcome, judge BLOCKED, 4 steps, 32s
- **Did:** clicked the "Dearborn" campus link → Cloudflare "Verify you are human" → `wait_for text_gone` → the `challenge-element` guard refused the widget → `ask_human` once → reported the block.
- **Went wrong:** the CAPTCHA handling is correct, but the **give-up is too early**: umich.edu's own U-M Giving section offers a Dearborn designation and was never tried. The judge flags exactly this ("an alternative route via U-M Giving on umich.edu existed and the agent gave up after 5 steps without trying it").
- **Wasted:** nothing — 4 steps, 32s.
- **Could have been:** when a *sub-domain* is challenge-blocked, try the starting site's own route: umich.edu → Giving → Dearborn. **~4 steps**, and the task would have succeeded. "Blocked" should mean the whole task is blocked, not one link.

### `1fc28d91d25ccd1c6ba268101326a654` — 5-day Bitcoin price chart (google.com/finance) — task.ok, judge PASS, 10 steps, 121s, 137k in tok
- **Did:** typed "Bitcoin" (twice — first into the wrong box) → opened the BTC/USD panel → clicked 5D → screenshot → `assert` → two `find_in_page` → `done`.
- **Went wrong:** nothing for the verdict — the 5D chart was up by step 2 (t=24s).
- **Wasted:** a failed `assert` at step 4 — *"\"5D; Sep 16; Sep 17; Sep 18; Sep 19\" is not on the page you are on"* — because the agent quoted a **screenshot** it had just taken rather than page text; that triggered a `completion_refused` re-plan and then 4 steps of re-verification (`scroll`, `find_in_page "5D"`, `find_in_page "Sep 16"`, a second `view_screenshot`). Another `completion_refused` at step 10. 1 duplicate search typing. ~6 of 10 steps.
- **Could have been:** search Bitcoin → open BTC/USD → click 5D → done. **4 steps**, ~30s. `assert` needs to accept evidence read from a screenshot the agent itself captured, or the navigator must not be pushed to quote pixels.

### `271b36efd4346721b5542488ff997042` — browse open-box 8K Samsung TVs (bestbuy.com) — task.ok outcome, judge FAIL, 45 steps, 407s, 620k in / 22.6k out tok, $0.24
- **Did:** typed the whole requirement into the search box ("open box 8K Samsung TVs") instead of using Best Buy's Open-Box condition facet, then spent 40 steps trying to read the resulting grid, ticked the **Clearance** facet at step 33 (which returned zero results), backed out, and answered with two ordinary new 8K sets carrying Clearance badges.
- **Went wrong:** step 1/8. Putting "open box" in the query is not applying the open-box filter; the judge's criterion 3 fails on exactly that. It then compounded it by substituting Clearance for Open-Box.
- **Wasted:** **7 `extract` calls** (steps 18,26,28,29,30,31 — four with invented `selector` keys like `"a[aria-label*='Samsung'][aria-label*='8K']"`), **6 `read_page`** (5× `mode:"full"`), **6 `find_in_page`** (`"open box"` ×2, `"Open Box"`, `"Add to Cart"`, `"5 items"`), **13 scrolls**, **5 `invisible` click refusals in a row at steps 39-44** on indices 189-192, 7 `step_interval` + 2 `validation` + 2 `completion_refused` re-plans, **8 hedged/duplicated slow LLM calls**. ~38 of 45 steps.
- **Could have been:** TVs → Brand=Samsung → Resolution=8K → Condition=Open-Box → read. **~5 steps.** Fourth Best Buy task in this shard whose result grid was unreadable — `1df24ec…`, `5dec0e…`, `fc53ddd…`, this one.

### `301f267f421b93045874726183e8f722` — 5-minute high-protein savory vegan snack recipes (healthline.com) — task.ok outcome, judge FAIL, 15 steps, 411s, 180k in tok
- **Did:** typed "vegan snack" into the recipe search, then **toggled the same three chips over and over** — `click_element {"index":14}` (steps 2, 7), `{"index":15}` (steps 3, 8, 11, 14), `{"index":23}` (steps 4, 9) — with a `go_back` and a full re-search in the middle (steps 5-6 repeat steps 1-4 verbatim). It ended on a degraded state (only the Snacks chip, 2 results) and declared no such recipe exists.
- **Went wrong:** step 5. After reaching Snacks+Vegan it pressed `go_back`, throwing away the filter state, and re-ran the identical sequence; from then on the chips oscillated. The intermediate screenshots show Snacks+Vegan (17 results) and Vegan+High protein (2 results) each existed at some moment, **never together**. The absence claim comes from the wrong page.
- **Wasted:** the whole steps 5-9 re-run of steps 1-4 (5 steps), 4 redundant `{"index":15}` toggles, 1 `disabled` refusal on the greyed-out High protein chip, **3 `completion_refused` re-plans** (steps 10, 15, 15), 44 rate-limit retries / 103s backoff. ~9 of 15 steps.
- **Could have been:** open Recipes → tick Snacks + Vegan + High protein in one pass → read the results (or report that High protein greys out under that combination, with that state on screen). **~5 steps.**

### `354b4ddf048815f8fd4163d0d7e1aaa3` — marketing jobs filtered to Bachelor's degree (ohiomeansjobs.ohio.gov) — task.ok, judge PASS, 9 steps, 185s, 115k in tok
- **Did:** searched "marketing jobs" → Filters → Career/Education Level → Bachelor's degree → scrolled → Display Results → `assert` quoting "Results based on filters ( 16872 jobs found )" → `done`.
- **Went wrong:** nothing — succeeded, with the count cross-checked against the facet's own 16,872.
- **Wasted:** 1 `find_in_page {"query":"Display Results"}` used to locate a button already in the element list, and the same **`done`-batched-with-`assert` refusal** seen in `7abdcee…` ("The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions"), costing a re-plan and an extra step. 43s of the 185s was rate-limit backoff.
- **Could have been:** 7 steps. Close to optimal.

### `415bf9da6f3db3a735ecbba3b0c76c15` — nearest vet within 50 miles of 75228 (akc.org) — limit_steps, judge FAIL, 50 steps, 432s, 568k in / 23.5k out tok, $0.23
- **Did:** got to the AKC Vet Search form and entered ZIP 75228 by step 24 — then spent **steps 27-49 failing to change the RADIUS dropdown from 25 to 50 miles**, and never submitted the search. 39.jpg shows the radius still at "25 miles" with an empty results area.
- **Went wrong:** step 27. The radius control is a **custom (non-native) dropdown**: `click_element {"index":54}` opens it and validates `passed`, but the option `[57]` then fails with "The element has no visible area", and `select_dropdown_option {"index":54,"text":"50 miles"}` fails with *"Option \"50 miles\" not found after opening the dropdown"* (twice, at t=287s and t=407s). Neither tool can drive this widget, and the agent had no third way.
- **Wasted:** **~12 `click_element {"index":54}` open attempts** paired with **7 `invisible` failures on [57]**, 2 `failed-retry` refusals, 2 failed `select_dropdown_option`, 3 `validation` + 7 `step_interval` re-plans, 5 hedged slow calls, plus an earlier 10-step detour to `marketplace.akc.org` and back (steps 5-13). ~40 of 50 steps.
- **Could have been:** ZIP → radius 50 → Search → read the first result. **~4 steps.** The blocker is a tooling gap, not planning: a custom listbox whose options are invisible to the click path needs a keyboard fallback (focus + arrow/type-ahead + Enter).

### `48c73f3f53e2611c4a1052457c1033db` — FEIS report for Jamaica Bus Depot expansion (new.mta.info) — task.ok, judge PASS, 14 steps, 325s, 155k in tok
- **Did:** site search for the project → opened the project page → environmental-review documents → opened the FEIS Volume 2 PDF (371 pages, document 10341) → `done`.
- **Went wrong:** nothing — succeeded, with the PDF viewer actually on screen.
- **Wasted:** two open-then-`go_back` probes of the wrong documents (steps 5-6 and 7-8, 4 steps), a 224s-mark `read_page {"mode":"full"}` on a document index, and a final `click_element` that returned `unknown — the page did not visibly change`. **44 rate-limit retries / 101s backoff** — 31% of the run.
- **Could have been:** search → project → documents → open FEIS. **~5 steps.** The two go_back probes are the only real navigation waste.

### `512fd4deab099b8dc0dcfc0ec48a3c63` — open issue with most comments in the week's top trending repo (github.com) — task.fail, judge FAIL, 16 steps, 194s, 297k in / 17.8k out tok
- **Did:** opened Trending → clicked through to a repo's issues — but **left the date range on its default "Today"** (01.jpg: "Date range: Today", affaan-m/ECC at "837 stars today") — then made **eleven `extract` attempts** (steps 4-14) to enumerate issues and comment counts, and finally answered from the few issues visible on an unsorted page.
- **Went wrong:** two places. (a) Step 0-1: "this week" was never selected, so the wrong repo was used. (b) Step 4: GitHub's issue list has a **Sort → Most commented** control; the agent never touched it and tried to compute the superlative itself. 16.jpg shows the list still sorted "Newest".
- **Wasted:** **11 `extract` calls**, every one carrying invented `selector`/`extract` keys (`"ul[aria-label=\"Search results\"] > li > a[href*=\"/issues/\"]"`), one of them rejected outright as *"schema is not valid JSON"* because the model emitted Python-style single quotes; 3 `step_interval` + 2 `completion_refused` + 1 `progress_stall` re-plan; 6 hedged slow calls; 1 `identical-repeat` refusal. ~12 of 16 steps.
- **Could have been:** Trending → Date range: This week → first repo → Issues → Sort: Most commented → read the top row. **~6 steps.**

### `5e1b8254c123c80178cc28e0afdb14f0_110325` — help page "how presale works" (ticketmaster.com) — task.ok, judge PASS, 8 steps, 154s, 86k in tok
- **Did:** Help Center → searched → clicked a result → Buy Tickets → Presale → "How do presales work?" → `done` with URL and title.
- **Went wrong:** nothing — succeeded.
- **Wasted:** steps 3-6 are four clicks drilling the breadcrumb tree after the search results were already on screen; at least two were redundant. **18 rate-limit retries / 41s backoff** on an 8-step run.
- **Could have been:** Help → search "presale" → open the article. **3 steps**, ~25s.

### `64345c365f544375357c7b67917f08a0_070826` — most-viewed 33-36" stainless fridge, 4+ stars (us-appliance.com) — limit_tokens, judge FAIL, 38 steps, 358s, 710k in / 16.9k out tok, $0.25
- **Did:** opened Refrigerators, clicked a run of facet checkboxes (steps 3-10), set `select_dropdown_option "Most Viewed"` at step 13 — then wandered: opened a product, `go_back`, scrolled, opened another, and at step 35 named the Frigidaire FRSS2623AS (4.4 stars). The planner refused that `done`, it went back to browsing, and the token cap ended it with "Task cancelled". The final screen shows **every width and rating facet unchecked**.
- **Went wrong:** step 19. `go_back` from the product page **dropped the whole filter + sort state**, and it was never rebuilt — so the sorted, filtered list that existed around step 13-18 was gone and the later answer had no page behind it.
- **Wasted:** **4 identical `extract {"scope":"38"}` / `{"scope":"Rated 4.4 out of 5 stars"}` calls** (steps 27-30, one taking 10.5s) for a star rating already visible; **12 scrolls**; **4 `go_back`** each losing state; 1 `identical-repeat` refusal; the `assert`+`done`-in-one-turn refusal again; 4 `step_interval` + 1 `progress_stall` + 1 `completion_refused` re-plan; 6 hedged slow calls. ~22 of 38 steps.
- **Could have been:** Refrigerators → width 33-36 → stainless → 4 stars & up → Sort: Most Viewed → read the top card. **~6 steps.** Never leave a filtered+sorted list to verify something the list already shows.

### `6ca20f1da01edeb49a7a42c816d8c6fe` — Child Benefit eligibility / how it works / how to claim (gov.uk) — task.ok, judge PASS, 12 steps, 106s, 143k in tok
- **Did:** found the Child Benefit guide in 3 clicks, `read_page` + `save_findings` on eligibility, clicked "Make a claim", `read_page` + `save_findings`, `done` — the planner refused, so `go_back` to "How it works", `save_findings`, `done` again.
- **Went wrong:** nothing — succeeded, and all three sections are quoted page text.
- **Wasted:** **2 `contract_complete` + 2 `completion_refused` re-plans** (steps 9 and 12) — the first `done` at t=41s was rejected because one of three sections was unread, which was the right call, but the *second* `done` at t=95s was also sent back and cost another 10s of planner arguing. 4 extra planner calls.
- **Could have been:** read all three guide sections in sequence then one `done`. **~8 steps**; the run is close to that already.

### `753f372c189d3b306623cb0c65b50320` — SEC ETP Odd Lot Rate, Q1 vs Q4, by price, log axis (sec.gov) — task.ok, judge PASS (medium), 40 steps, 419s, 527k in / 16.5k out tok
- **Did:** hunted for the chart through Data & Research → Statistics → Market Activity → ETP → Odd Lot Rate (steps 0-27, with three `go_back`s and a lot of `find_in_page`), then in **12 clean steps** set View Quartiles by Price, deselected Quartile 2 and 3, opened Chart Controls and flipped Vertical Scale to LOG — and then reported "The logarithmic scale for the vertical axis could not be applied", which the screenshots contradict (39.jpg shows the LOG toggle and a log-spaced axis 6, 8, 10, 20, 30, 40, 50, 70).
- **Went wrong:** the final answer. The agent **did** apply the log scale at step 34/36 and then failed to recognise its own success — a perception gap between the toggle state and what it believed.
- **Wasted:** the 28-step navigation hunt: **7 `find_in_page`** (`"U.S. ETP Odd Lot Rate (%)"` ×2, `"Odd Lot"` ×2, `"Market Activity"`, `"logarithmic|scale|axis"`, `"LOG"`), **11 scrolls**, **4 `go_back`**, a click that "only changed the address fragment (none to #market-activity)", 1 `covered` refusal, 1 `identical-repeat`, 7 `step_interval` + 1 `progress_stall` + 1 `completion_refused` re-plan, 1 LLM timeout (15.6s). ~24 of 40 steps.
- **Could have been:** go straight to the market-structure data page → pick ETP → Odd Lot Rate → Price → deselect Q2/Q3 → Chart Controls → LOG → read. **~10 steps.**

### `7be8cd8dba885cddd9af5320f49bc41b` — roofing contractors within 5 miles of 10002 (bbb.org) — task.ok, judge PASS (medium), 15 steps, 259s, 172k in tok
- **Did:** searched "Roofing Contractors" near 10002, applied the site's Distance = "< 5 Miles" facet (11.jpg shows the chip and "128 results"), then two `extract` calls failed and it reported "The extraction failed… but I cannot extract the data" even though the filtered list was on screen.
- **Went wrong:** step 13. The task was already satisfied; the agent turned a failed extract into a self-reported failure in the answer text. The judge passed it anyway, but the answer names no contractor.
- **Wasted:** 2 `extract` (the second with invented `selector` keys), a duplicate `click_element {"index":1}` at steps 0-1, 1 `Node is detached` failure + its `failed-retry` refusal, 1 `covered` refusal on an open suggestion list (recovered with `send_keys Escape` — good), 1 `stale-index`, 1 `validation` + 2 `step_interval` re-plans, **30 rate-limit retries / 47s backoff**. ~6 of 15 steps.
- **Could have been:** search → set Distance < 5 Miles → `read_page` and name the top few contractors. **~6 steps.**

### `82eb3bfedd78456a0230b389f4e7a938` — XRP yearly chart (coinmarketcap.com) — task.ok outcome, judge BLOCKED, 7 steps, 372s
- **Did:** the site never loaded — every screenshot is `ERR_CONNECTION_TIMED_OUT`. It retried `go_to_url` twice (15s timeout each), `wait_for network_idle`, `read_page` on an empty page, `ask_human` for a URL, tried coingecko.com and was correctly refused by the `intent-open` guard, and reported the block.
- **Went wrong:** nothing the agent controls — the site was unreachable.
- **Wasted:** 372 seconds on a dead site. Two 15s `go_to_url` timeouts, a `wait_for network_idle` on an unreachable host, a `read_page {"mode":"full"}` of Chrome's error page, an `ask_human` that could not help, 20 rate-limit retries / 36s backoff, and an 8.2s final planner call.
- **Could have been:** `ERR_CONNECTION_TIMED_OUT` on the *start page*, twice, should end the task in **~3 steps / 60s**, not 372s. Note the `intent-open` guard correctly blocked both unsolicited domains.

### `8ea6c3a2ea3f59150619935261a76d19` — staffed FedEx location near 10019 for a return (fedex.com) — task.ok, judge PASS (medium), 9 steps, 161s, 105k in tok
- **Did:** Locations → Find FedEx locations → entered 10019 → Search → ticked the "Drop off" service filter → scrolled → `save_findings` with the FedEx Ship Center at 606 W 49th St, 0.32 mi.
- **Went wrong:** nothing decisive, but it filtered only on **Drop off** and never used the "FedEx staffed" location-type filter under MORE FILTERS — the "staffed" requirement was satisfied by the agent's own reasoning that a Ship Center is staffed, not by a site control. That is the judge's medium-confidence caveat.
- **Wasted:** a duplicate `click_element {"index":14}` (steps 3 and 5), **68s of rate-limit backoff on a 161s run**.
- **Could have been:** Locations → 10019 → Search → MORE FILTERS → FedEx staffed + Drop off → read the nearest. **~7 steps**, and the "staffed" criterion would have come from the page.

### `9829f3087ab1f9c8eba6b6dd2b831d25_112325` — play the recap of the most recent NBA game (espn.com) — task.ok outcome, judge FAIL, 5 steps, 106s
- **Did:** clicked into NBA → `find_in_page "recap"` → scrolled the offseason front page → opened one article → `go_back` → declared that no NBA recaps exist.
- **Went wrong:** step 1. The scoreboard was showing the **current** week ("WED 30 SEP – TUE 6 OCT, No games on this date") and the agent read that as "there are no recent games". It never stepped the scoreboard calendar back to the last date games were played, never opened Schedule, never reached a game page, never played anything.
- **Wasted:** the article open + `go_back` pair (2 steps), 3 hedged slow LLM calls including an 11.0s planner call, 3 `DOMService: Failed to remove highlights` errors.
- **Could have been:** NBA → Scores → page the date strip back to the last played date → open that game → Recap → play. **~6 steps.** A date-scoped "no games" is not evidence of "no recent games".

### `9ed3827266b3b804f485859c3d00401e_070826` — Traditional vs Roth IRA comparison chart (chase.com) — task.ok, judge PASS, 11 steps, 67s, 163k in tok
- **Did:** navigated to the Traditional-vs-Roth calculator → **one `fill_form` setting all six parameters** (age 30, retire 65, $30,000, 3%, 13%, 24%) → scrolled → `read_page` → clicked "See chart as table" → `extract` → `done` with the year-by-year table.
- **Went wrong:** nothing — succeeded, and the numbers come from the site's own table.
- **Wasted:** 1 `extract` and 1 `find_in_page {"query":"Estimated account value"}` after "See chart as table" had already put the table on screen; 1 `completion_refused` re-plan; 3 hedged slow calls on a 67s run.
- **Could have been:** ~9 steps. **Second-best run in the shard** — the single six-field `fill_form` is the pattern that `50d91eab…` and `9d46ccb9…` needed.

### `a5c87cc1c94a090c9a8dc2c8b6a125d0` — SO2 air quality for Maine North, Co. Cork (accuweather.com) — task.ok outcome, judge FAIL, 8 steps, 98s
- **Did:** searched the location → a click that "stayed at the same address: an overlay or interstitial probably intercepted the click" → recovered and opened the air-quality page → 2 scrolls → `find_in_page {"query":"SO2"}` → immediately `done(success:false)` saying SO2 is not listed.
- **Went wrong:** step 6→7. The pollutant panel showed NO2 13, O3 13, PM2.5 12, PM10 6 **followed by a "View More" control the agent never clicked**. One failed text search on the collapsed view became a definitive absence claim.
- **Wasted:** 1 `stale-index` refusal, 1 `validation` re-plan, 2 scrolls. Small — the failure is under-work, not over-work.
- **Could have been:** search → open air quality → **click "View More"** → read SO2. **~5 steps.** Same failure shape as `26810ed9…` (never clicked the 10-DAY tab) and `63d6866f…` (never opened the Nearby Attractions accordion).

### `b1ce968a361e1088ce8d2ade6c2c9af0` — young cats in Seattle, newest additions (petfinder.com) — task.ok, judge PASS, 18 steps, 140s, 201k in tok
- **Did:** searched Seattle (repeatedly), then `go_to_url` straight to `/search/cats-for-adoption/us/wa/seattle/`, closed a Purina modal, applied the Young age filter and Sort By: Newest Addition, `read_page`, `done` with the ten newest names.
- **Went wrong:** nothing — succeeded, with filter chip and sort both visible in 18.jpg.
- **Wasted:** **`input_text {"index":11,"text":"Seattle"}` five times** (steps 1,2,5,6,7) on a location box that kept not taking, which tripped a `progress_stall` re-plan at step 8; 1 `covered` refusal on the modal. ~5 steps.
- **Could have been:** the `go_to_url` shortcut it eventually used at step 9 → close modal → Young → Newest Addition → read. **~6 steps.** Note the `intent-open-site` guard **allowed** that URL (same site) — correct behaviour.

### `b7258ee05d75e6c50673a59914db412e_110325` — closest Trader Joe's to 90028 + set as home store (traderjoes.com) — task.ok outcome, judge FAIL, 27 steps, 402s, 315k in tok
- **Did:** found the Hollywood (206) store at 1600 N Vine St with hours 9AM-9PM (correct, and `assert`ed against page text at step 24) — but never set a home store, finishing with "this functionality does not appear to be available".
- **Went wrong:** step 19. The "set as home store" half of the task got exactly **two `find_in_page {"query":"home store"}` probes** (steps 19, 21) and two `read_page {"mode":"full"}`, then was declared impossible. A store page's own "Make this my store" control was never looked for by clicking anything.
- **Wasted:** 2 `click_element` returning `unknown — the page did not visibly change` followed by a third identical click (steps 11, 16, 17); a `go_back` + `go_to_url` reset at steps 8-9; **3 `switch_tab`** between tabs 541703807/541703809; 2 `read_page {"mode":"full"}` of the same store page; **4 `step_interval` + 2 `completion_refused` re-plans**. ~10 of 27 steps.
- **Could have been:** store search → 90028 → open Hollywood (206) → read location/hours → click the store's "make my store" control. **~7 steps.** Two text searches are not a basis for "the site cannot do this".

### `bb5d90e6f2fbc0ae146f7c1998c2b4a1` — most viewed TED talk on robots, 12-18 min (ted.com) — task.ok outcome, judge FAIL, 25 steps, 249s, 472k in / 10.5k out tok
- **Did:** fought a covering hero panel, searched "robots" twice (steps 6 and 20, with a full `go_to_url` home reset between), scrolled and read the unsorted result list, and answered "I could not find a way to filter or sort by 'most viewed' or by talk duration".
- **Went wrong:** step 10 and step 18. The Talks browse page **does** carry Duration and Most-viewed controls; the agent looked for them with text searches on the *search-results* page only, and when it tried `go_to_url https://www.ted.com/talks` at t=164s the `intent-open` guard refused it — *"nothing in the user's request leads to https://www.ted.com/talks, and no link on the pages you visited points there."* That guard, correct in general, blocked the one route to the required controls; the agent never found the site's own Watch/Talks link instead.
- **Wasted:** **5 `find_in_page`** (`"filter|sort"`, `"sort|filter|options|refine"`, `"close|accept"`, `"DEMOCRACY How to use tech to outsmart dictators In seven ye"` — the last pasting a page fragment as a query), **8 scrolls**, 3 `read_page` (2× full), a full home-page reset and re-search (steps 18-21, 4 steps), 5 `step_interval` + 2 `completion_refused` re-plans. ~18 of 25 steps.
- **Could have been:** click Watch → Talks → Topic: robots → Duration 12-18 → Sort: Most viewed → read the top. **~6 steps.**

### `c03ee2be3d73556ab789c0ad1cbd3451` — dog groomer for nail trimming within 100mi of 10005 (akc.org) — task.ok outcome, judge FAIL, 11 steps, 298s, 111k in tok
- **Did:** typed into the Service, ZIP and Distance fields (steps 2-4), was blocked by the cookie banner, accepted it at step 6 — **and the banner dismissal reset the form**: 06.jpg shows Service back on its placeholder and Distance empty. It searched anyway, getting an unfiltered "Groomers near New York, NY, showing 1-7 of 7", opened Woofie's of Cherry Hill and said prices are not listed.
- **Went wrong:** step 6. After accepting cookies the agent re-clicked search without re-checking the form state, so neither the nail-trimming service nor the 100-mile radius was applied. It also never opened the profile's "My Services" section before declaring prices absent.
- **Wasted:** the three field entries in steps 2-4 (thrown away), 1 `covered` refusal, 1 `wait_for`, 2 `step_interval` + 1 `completion_refused` re-plan, **32 rate-limit retries / 90s backoff** (30% of the run).
- **Could have been:** accept cookies **first**, then Service=nail trimming, ZIP=10005, Distance=100, Search, open the first result, expand My Services. **~7 steps.** Dismissing an overlay must re-read the form, not assume the typed values survived.

### `c698ff3fc0f6cbce39947c597ab5749b_121425` — school activity events in New York this month (eventbrite.com) — limit_tokens, judge FAIL, 36 steps, **1001s**, 630k in tok, $0.21
- **Did:** searched "school activity" in New York — then **typed the same query and pressed `go_back` five times** (steps 11-12, 13-14, 15-16, 21-22, 25), scrolled a lot, and from step 27 made **four identical `click_element {"index":33}` attempts** that each failed "The element has no visible area", until the token cap. A cookie banner sat over the left rail the whole time.
- **Went wrong:** step 11. The date filter ("this month") was never applied; the results shown are Oct 2, Oct 1, Jan 31, Sep 26 with no date chip. The agent alternated search/`go_back` instead of opening the Date filter, and the cookie banner it never dismissed is very likely why the filter control at index 33 was unclickable.
- **Wasted:** **5 search+`go_back` cycles (10 steps)**, **12 scrolls**, 5 `find_in_page` (`"filter"` ×2, `"category"`, `"Date"`), 4 `invisible` failures + 1 `failed-retry` refusal on the same index 33, 5 `step_interval` + 1 `validation` re-plan, and **118 rate-limit retries / 394s of backoff — 39% of a 1000-second run**. ~30 of 36 steps.
- **Could have been:** search "school activity" + New York → dismiss the cookie banner → Date: This month → read the list. **~5 steps.**

### `cf757a775fa1224acfc7998489e199a8` — flight Dublin → anywhere under $100 tomorrow (ryanair.com) — task.fail, judge PASS (answer delivered), 24 steps, 168s, 293k in tok
- **Did:** set From=Dublin, To=Any destination, one-way, Depart Mon 21 Sept, applied the site's "Up to €100" price chip — correct by step 15 — then made **eight `extract` attempts** on the destination list and died on "Stopping due to 3 consecutive failures", though the answer text still went out.
- **Went wrong:** step 16. The fare list was on screen; every extract carried invented `selector`/`attribute` keys, and two of them used `items:{"type":"string"}` which hard-errors with *"schema names no fields"*.
- **Wasted:** **8 `extract`** (steps 16-23, several byte-identical repeats of `{"flight_details":{"selector":"button[aria-label]","attribute":"aria-label"}}`), 1 `view_screenshot`, 1 `find_in_page {"query":"date"}`, 2 scrolls, 4 `step_interval` re-plans. ~10 of 24 steps, and the *task outcome* flipped to fail purely on extract failures.
- **Could have been:** From/To/date/price → `read_page` the fare list → done. **~8 steps.**

### `d9a8689393effeed75ea0866e44e1def` — address and phone of the DOJ OIG (justice.gov) — task.ok, judge PASS, 4 steps, 61s, 60k in tok
- **Did:** two clicks to oig.justice.gov → **two `assert` calls**, each verified against the live footer ("https://oig.justice.gov/ shows it; the claim is backed and you may report it") → `done`.
- **Went wrong:** nothing — succeeded, and this is the cleanest evidence discipline in either shard.
- **Wasted:** the `done`-batched-with-`assert` refusal again ("The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions"), costing one extra turn.
- **Could have been:** 4 steps is already right. **Third-best run in the shard.**

### `e7301bb694871429bf2eb36c3a72186c_110325` — boys' shoes under $20 with 5-star rating (jcpenney.com) — task.ok outcome, judge FAIL, 30 steps, 341s, 464k in / 9.5k out tok
- **Did:** searched boys' shoes, then ticked the 5 Rating facet and the price bands **$5-$9 and $10-$14** — leaving the visible `$15 - $19 (2)` band unticked — and answered with the 5 products that survived.
- **Went wrong:** steps 20-25. The price filter is narrower than "under $20"; two qualifying products in the $15-$19 band were excluded. A "under $X" requirement needs *every* band below X.
- **Wasted:** **steps 2-9 are the same `click {30}` → `click {31}` → `go_back` cycle three times** (8 steps, nothing applied); a `go_back` at step 16 that took **15.0 seconds**; 7 scrolls; a `find_in_page {"query":"Under $5"}` that took 5.0s; 3 LLM timeouts (3.6s, 10.7s) and 4 hedged calls on one planner turn; 3 `step_interval` re-plans. ~18 of 30 steps.
- **Could have been:** search → 5-star facet → tick $5-9, $10-14 **and $15-19** → read. **~6 steps.**

### `f2097f92a10d42a842c14179f422311e` — add a $50 Uber gift card to the cart (bestbuy.com) — task.ok, judge PASS, 12 steps, 324s, 130k in tok
- **Did:** searched "uber gift card" → scrolled → opened the product → scrolled → `find_in_page` → selected the $50 denomination → Add to Cart → `done`; 11.jpg/12.jpg show the cart with "Uber - $50 Gift Card [Digital]", subtotal $50.00.
- **Went wrong:** nothing — succeeded, and it actually completed the add rather than claiming it.
- **Wasted:** 4 scrolls and 1 `find_in_page` hunting the card on the Best Buy grid, 1 `stale-index` refusal, and **42 rate-limit retries / 138s of backoff — 43% of the 324s**.
- **Could have been:** search → open the Uber card → pick $50 → Add to Cart. **~5 steps**, ~60s without throttling.


---

# Summary

## 1. Recurring waste patterns

| # | Pattern | Tasks hit (of 59) | Steps it cost | Worst offenders |
|---|---|---|---|---|
| 1 | **`extract` returns 0 items / invalid schema, retried with invented `selector`/`attribute`/`pattern` keys or `items:{type:"string"}`** | 16 | **~70** + 3 task-level failures + 2 provider tool-payload downgrades | `512fd4`(11), `4091bd`(8), `cf757a`(8), `ade4c0`(8), `271b36`(7), `63d686`(6) |
| 2 | **Superlative computed by hand instead of using the site's sort** (or after the sort was applied and then abandoned) | 7 | **~85** | `47e314`(32), `64345c`(15), `bb5d90`(15), `96afb3`(14), `512fd4`(10) |
| 3 | **Filter/toggle oscillation and state loss** — same index clicked on↔off, or `go_back` destroying an applied filter/sort | 8 | **~100** | `73d084`(38), `c00437`(16), `415bf9`(12), `64345c`(10), `c698ff`(10), `301f26`(9) |
| 4 | **Work continues after the answer is already on screen** | 7 | **~95** | `bb5184`(35), `1df24e`(20), `ade4c0`(17), `2fc51d`(10), `34ccd1`(7) |
| 5 | **Scroll / `find_in_page` hunting for a results grid perception cannot see** (all 5 Best Buy tasks + Eventbrite) | 6 | **~120** | `fc53ddd`(38), `271b36`(38), `5dec0e`(35), `0b51b4`(29) |
| 6 | **Rate-limit backoff ≥25 % of wall clock** (Vertex 429s) | **13** | 0 steps, **~1,700 s** | `c698ff`(394 s/39 %), `50d91e`(294 s/49 %), `34ccd1`(192 s/45 %), `0170ca`(181 s/39 %) |
| 7 | **Hidden / covered / detached element refusals on custom widgets** (`invisible`, `covered`, `Node is detached`) | 11 | **~35** | `415bf9`(7), `271b36`(5), `9d46cc`(5), `c698ff`(4) |
| 8 | **Premature absence claim from one probe** (one `find_in_page`, one scroll, one empty `extract`) | 9 | 0 wasted steps — **6 outright task failures** | `a5c87c`, `26810e`, `0e42c3`, `9829f3`, `b7258e`, `b6d10e` |
| 9 | **`switch_tab` ping-pong between two tabs with no work done on either** | 5 | **~25** | `47e314`(9), `2fc51d`(6), `34ccd1`(6) |
| 10 | **Redundant `completion_refused` re-plans against a correct or blocked answer** | 6 | ~15 planner calls | `d8e2a8`(3), `c577a1`(3), `301f26`(3) |
| 11 | **`done` batched with another action → "The 'done' action was ignored"** | 4 | 4 | `7abdce`, `354b4d`, `d9a868`, `64345c` |
| 12 | **Dropdown exact-text mismatch** ("United States" vs "United States of America", "GPT-4o Mini" vs "GPT-4o-mini") | 3 | 3 | `f158345`(2), `0170ca`(1) |

## 2. The five changes that would have saved the most steps

**1. Fix `extract` — sanitise the schema, then fall back. (~70 steps, 3 task failures, 2 provider downgrades)**
Strip non-JSON-Schema keys (`selector`, `attribute`, `extract`, `pattern`, `optional`) before the schema reaches the provider; coerce `{"type":"array","items":{"type":"string"}}` to an object-item schema instead of hard-erroring; repair single-quoted JSON. Then: **after two consecutive empty `extract` results on the same page, force `read_page` and forbid a third.**
Helps `4091bd`(+8), `512fd4`(+11), `cf757a`(+8), `ade4c0`(+8), `271b36`(+7), `63d686`(+6), `e43cbc`(+3), `7be8cd`(+2), `8ae510`(+2), `64345c`(+4), `5dec0e`(+2), `828c2d`, `b6d10e`, `26810e`, `9ed382`, `1fc28d`. Two runs (`4091bd`, `63d686`) died on `MaxFailuresReached` from this alone; two (`828c2d`, `4091bd`) knocked the whole task into prompt-rendered tools with a provider 400 on `"Unknown name \"selector\""`.

**2. Make the site's sort the only legal source of a superlative, and stop after it. (~85 steps)**
When the task says most/least/cheapest/newest/highest, require a sort or ranking control to be applied, then **read position 1 and finish** — never enumerate items to compare, and never take list position as a ranking when the list is alphabetical.
Helps `47e314`(+32: it sorted by Price at step 3 then opened 8 permit pages), `64345c`(+15), `bb5d90`(+15), `96afb3`(+14: called the first alphabetical word "most frequent"), `512fd4`(+10), `0e42c3`, `01abae`.

**3. Guard state, not just repetition: refuse a click that returns a control to a state it already held, and block `go_back` off any page carrying applied filter/sort params. (~100 steps)**
The `identical-repeat` guard never fires on a toggle because the page *does* change each time; the `leave-applied` guard exists but only fired twice in 59 tasks and after the fact.
Helps `c00437`(+16: toggled the "1-3 years" chip on/off for 800 s), `73d084`(+38: eight identical search→go_back cycles), `415bf9`(+12), `64345c`(+10: `go_back` dropped the filter+sort and it was never rebuilt), `c698ff`(+10), `301f26`(+9), `b1ce96`(+5), `e7301b`(+8).

**4. Finish when the requirements are evidenced. (~95 steps)**
The plan already carries a `requirements` checklist; when every item is satisfiable from the current page state, emit `done` instead of continuing to browse.
Helps `bb5184`(+35: the filtered graduate CS list was up at t=81 s of a 333 s run), `1df24e`(+20: correct sort at t=38 s, answered at t=230 s), `ade4c0`(+17: table on screen at t=12 s, answered at t=455 s), `2fc51d`(+10: answer `save_findings`-ed at step 8 of 20), `34ccd1`(+7), `753f37`, `48c73f`.

**5. Overlay-first + keyboard fallback for widgets the click path cannot reach. (~50 steps)**
On the first `covered` / `invisible` / `Node is detached` failure: dismiss the top-most dialog, re-read the form (values may have been reset), and drive custom listboxes by focus + type-ahead + Enter rather than clicking an option node.
Helps `415bf9`(+19: 12 open attempts and 7 invisible failures on one radius dropdown, task lost), `fc53ddd`(+8: a modal it never identified blocked the whole grid), `c698ff`(+6), `271b36`(+5), `9d46cc`(+5: the missed second Update), `c03ee2`(+4: accepting cookies wiped the typed form and it searched anyway), `0b51b4`.

*Not a code change but the largest single cost:* Vertex 429s consumed **~1,700 seconds across 13 of 59 tasks** (up to 49 % of a run) and pushed three runs into token/step caps they would otherwise have cleared.

## 3. What the agent did well — do not break this

- **`assert` against live page text.** `d9a868` and `7abdce` verified every reported value before answering, and `1fc28d`'s assert was correctly *rejected* — *"\"5D; Sep 16…\" is not on the page you are on… Never report what no page showed."* This is the strongest anti-hallucination mechanism in the harness.
- **The guard family works when it fires.** `leave-applied` stopped `1df24e` throwing away `sp=Price-Low-To-High`; `intent-open` blocked coingecko in `82eb3b` and ted.com/talks in `bb5d90`; `challenge-element` correctly refused CAPTCHAs in `d8e2a8` and `180ed2`; `repeat-address` caught `73d084`'s loop; `identical-repeat` caught `0b51b4` and `96afb3`.
- **Honest empty results.** `c577a1` applied six facets plus a critic-score sort, got "No Products Match Selected Filters", and reported exactly that instead of inventing a wine. `d8e2a8` reported "Not applied: in-person; full-time; within 10 miles of ZIP 14810; allow Quick Apply" — a precise statement of what was and was not done.
- **Multi-action turns are dramatically faster.** `ce6167` filled two ZIPs and clicked FlatRateBoxes in one turn and finished in **34 s / 5 steps**; `9ed382` set six calculator fields in a single `fill_form` and finished in **67 s / 11 steps**. These are the two fastest runs in the shard and the pattern generalises.
- **Error messages are genuinely actionable.** The dropdown failures list every available option, the invisible-element message names lookalike elements on the current page, and the fragment-only click is flagged ("only changed the address fragment (none to #market-activity); do not count it as progress"). Keep the text; the problem is that the navigator often ignores it.
- **`send_keys Escape` to clear a covering suggestion list** (`7be8cd`) and closing a named modal by its listed button (`b1ce96`) are the right recovery moves — they just need to be the *default* response to a `covered` failure.
