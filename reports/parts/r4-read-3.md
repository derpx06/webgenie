# r4 trace read — shard5 + shard6 (58 tasks)

Run: `chrome-extension/e2e/results/mind2web-r4-2953c78/`. Model gemini-2.5-flash (planner + navigator),
cold memory, maxSteps 50. Note: this run was heavily rate-limited by Vertex (429s); wall-clock seconds are
inflated on many tasks and are not a measure of agent effort. Step counts and token counts are.

---

## `046138801a05ddf56ad94e8672942496_070826` — most-replied FlightAware community discussion, flightaware.com — task.ok / **FAIL** — 5 steps, 169.5s, 66.7k in / 1.1k out
- **Did:** Clicked `Discussion` (idx 45) → landed on discussions.flightaware.com → clicked `Top` (idx 8) → clicked the `Replies` column header (idx 10) to sort → opened `Stream1090` (idx 13) → `done`.
- **Went wrong:** step=1 `click_element {"index":8}` ("Top"). Discourse's Top tab defaults to a period selector; the judge notes `00.jpg` reads "Year SEP 20, 2025 - SEP 20, 2026". The agent never touched the period dropdown, so it sorted the *last-year* list, not all time. It read "most replies of all time" as satisfied by a Replies sort alone — a missing-qualifier failure, not a navigation failure.
- **Wasted:** nothing structurally; 4 actions, all validated `passed`. The cost was 13 rate-limited provider calls (85.8s backoff) out of 20, and one `contract_complete` re-plan that rubber-stamped an incomplete answer.
- **Could have been:** Discussion → Top → set period to "All time" → Replies sort → open top row = 5 steps. It used 4 and skipped the one that mattered.

## `0e5536aaad9d3462b06cf725e6ed535a` — CBP airport wait times for RDU on 2025-03-12, cbp.gov — task.ok / **OK** — 9 steps, 185.1s, 76.9k in / 3.0k out
- **Did:** `Border Wait Times` → `Airport Wait Times` → scroll → typed "Raleigh-Durham International Airport" into the airport box → picked the `RDU` suggestion → set both date fields to `2025-03-12` → `Create Report` → `extract` on scope "Current View Averages" → answered 20 min.
- **Went wrong:** nothing — succeeded.
- **Wasted:** one `scroll down` at step=2 that reported "The page height did not change: no more content loaded" (1 step). The `extract` call cost 13.4s and 8 of the 9 steps' latency came from the provider, not the page.
- **Could have been:** identical minus the dead scroll = 8 steps. This is near-optimal for an 11-action reference task.

## `199be0b54a436daee74247971fc684ee_070826` — buy/customise a $100 Dillard's eGift card, dillards.com — limit_steps / **FAIL** — 50 steps, 630.5s, 618k in / 17.4k out
- **Did:** Typed "eGift Card" into the header search five separate times across the run, dismissed two overlays, then spent ~35 steps alternating `click_element` on carousel items, `scroll`, `find_in_page`, `read_page` and `go_back`, never reaching a gift-card customisation form.
- **Went wrong:** step=0. `input_text {"index":7,...,"submit":true}` validated `unknown — The field now shows "egift card"`. The search box lower-cased the text and the agent treated the whole submit as suspect; from step=3 on it clicked chrome it could not use: `click_element FAILED ... The element is disabled` then six consecutive `The element has no visible area` failures on indices 78/79/32/29/31. It was clicking collapsed-carousel items whose visible area is zero, and never once re-read the page state between the failure and the next identical click.
- **Wasted:** 6 invisible-element refusals + 1 disabled refusal (7 steps, 0 progress); 5 re-types of the same query (5); 8 `scroll down` of which 6 returned "page height did not change" (6); 6 `go_back` (6); 3 `read_page`/`view_screenshot` re-reads of the same 3740-char page (3); 12 re-plans (4 `validation`, 7 `step_interval`). Roughly 27 of 50 steps bought nothing.
- **Could have been:** `go_to_url https://www.dillards.com/c/gift-cards` (the site has a gift-card landing page the carousel links to) → choose eGift → fill amount/recipient/email/sender/date/message via one `fill_form` → review = ~5-6 steps.

## `20a460a8fe1971b84411c5b1e6ac4186` — theatre events in Las Vegas, stubhub.com — task.ok / **OK** — 8 steps, 165.5s, 104.6k in / 1.6k out
- **Did:** `Theater` tab → opened the location search → typed "Las Vegas" → scrolled → picked `Las Vegas, NV, USA` → `Theater & Comedy` chip → opened `The Phantom of the Opera`.
- **Went wrong:** nothing — succeeded. But the *answer text* is wrong: it saw a StubHub bot-check frame (`06.jpg`) and fired `ask_human` about a CAPTCHA, then reported "the task cannot be fully completed" even though `07.jpg` shows the event page had already loaded. The judge passed it on trajectory.
- **Wasted:** the `ask_human` + the `human_needed` re-plan (2 steps and ~40s) triggered by a transient interstitial that resolved itself. One `scroll down` before the suggestion click (1 step).
- **Could have been:** Theater → location box → "Las Vegas" → pick suggestion → open first event = 5 steps. The category chip was arguably redundant since the Theater tab was already applied.

## `27fa3ac20745d3d35e89fae157f63069` — grad chemistry courses, Monday afternoons, Winter 2023, stanford.edu — task.ok / **FAIL** — 31 steps, 218.8s, 352k in / 9.0k out
- **Did:** Academics → Graduate Programs → Courses → typed "Chemistry" into two different boxes → `Clear Filters` (wiping its own work) → set `Student Career = Graduate` → set `Subject Code = CHEM` → then 15 steps of scroll/find/read hunting for a term and day filter → `go_to_url` to a hand-built bulletin URL → gave up.
- **Went wrong:** step=5 `click_element {"index":14}` = **"Clear Filters"**, immediately after typing the subject twice. It then rebuilt the same two filters by hand. The real failure is that it never found the term/day controls: the timeline shows `find_in_page {"query":"quarter"}` → no match, `{"query":"day"}` → no match, `{"query":"term"}` → 2 matches, and it never clicked the match — `find_in_page` reports counts, so the agent had a hit and dropped it.
- **Wasted:** `Clear Filters` + re-entering 2 filters (3 steps); 9 `scroll` of which 8 said "page height did not change" (9); 6 `find_in_page` that were never acted on (6); 2 `read_page` full re-reads of the same page (2); 1 `go_back`; 5 `step_interval` re-plans. ~21 of 31 steps.
- **Could have been:** explore.courses.stanford.edu (or the bulletin's term selector) → term = Winter 2022-23 → subject CHEM → career Graduate → day Monday + time afternoon in the schedule filters = ~6 steps.

## `3084bc225219fcb73dc1cb0f97276c1c` — UPS shipping quote LB 90802 → Portland 97201, ups.com — task.ok / **FAIL** — 5 steps, 67.0s, 52.0k in / 0.7k out
- **Did:** `Shipping` → closed an overlay → one `fill_form` writing zips 90802/97201 and 2/2/2/10 into six fields → `Get a Quote` → `Get a Quote` again → gave up citing "Temporary Service Issues".
- **Went wrong:** step=2, the `fill_form`. Both zip fields autocompleted to Chilean postal codes ("9080268 Santiago, Cerro Navia, Chile", "9720158 Padre Hurtado, Chile") and the dimension fields were the **cm** variants — the judge read this off `05.jpg`. `fill_form` validated `passed` because the fields were non-empty; nothing checked that the value the field *settled on* matched what was typed, which is exactly the check `input_text` does do.
- **Wasted:** the duplicate `Get a Quote` click (1 step, refused with "the page did not visibly change").
- **Could have been:** same route, but re-read the form after fill, pick the US suggestion for each zip, switch units to in/lbs = ~7 steps and a correct quote.

## `3621b099326c7aebd2e2dac6be3b52d1` — profile of the Nvidia Learning & Perception Lab leader, nvidia.com — task.ok / **OK** — 10 steps, 67.5s, 135k in / 2.3k out
- **Did:** First click refused (cookie dialog) → `Accept All` → `Research` → `Visit Our Labs` (twice, the second opened a new tab) → `Learning and Perception` → `Dr. Jan Kautz` → `switch_tab` → clicked `Jan Kautz` → `assert` with the bio as evidence → done.
- **Went wrong:** nothing — succeeded.
- **Wasted:** the first `click_element {"index":196}` refused with "covered by `<div>` behind the dialog Privacy" (1 step the cookie banner cost); `Visit Our Labs` clicked twice at step=3 and step=4 (1 step); an explicit `switch_tab` after the tool already said "New tab opened - switching to it" (1 step); the final `assert` (1 step) plus a `step_interval` re-plan after `done` was already justified.
- **Could have been:** dismiss cookie → Research → Visit Our Labs → Learning and Perception → Jan Kautz = 5 steps. It used 10.

## `442a450e696a96085257db6297891a4d` — Chase 401(k) calculator, age 22→65, 3%, $8k+$8k, chase.com — task.ok / **OK** — 30 steps, 218.0s, 423k in / 8.4k out
- **Did:** Education & goals → Education center → scrolled/searched, found nothing → `go_back` → Investing by J.P. Morgan → Retirement and IRAs → `401K/403b Calculator` → then 18 steps bouncing between three different "401K/403b Calculator" links before finally filling 22 / 65 / 3 / 8000 / 8000 in one burst at step=28 and reading $1,239,722.
- **Went wrong:** nothing — succeeded, and the number matches the screenshot.
- **Wasted:** the whole Education-center detour (4 steps, ended in `go_back`); `click_element {"index":70}` ("401K/403b Calculator") tried at step=18, 23 and 24 — twice refused, once with "The click left the page at the same address with the same content as before" (3 steps); 9 `scroll`; 2 `find_in_page` ("current age", "age" → 28 matches) neither acted on; 2 full `read_page` of a 16k-char page (2); 1 `view_screenshot`; 5 `step_interval` re-plans + a `completion_refused` round-trip. ~18 of 30 steps.
- **Could have been:** the calculator is at a stable chase.com URL reachable in 3 clicks (Investing → Retirement and IRAs → 401K/403b Calculator). Then one `fill_form` with all five inputs and read the result: **5-6 steps**.

## `4c572a627b53b0f9a734ab37f21819b8` — craigslist apartments 2bd/2ba max $4000 — task.ok / **OK** — 5 steps, 111.0s, 72k in / 1.7k out
- **Did:** first click refused ("Node is detached from document") → `apts / housing` → scroll → one `fill_form` setting max price 4000, min beds 2, min baths 2 → submit. Empty result list, reported honestly.
- **Went wrong:** nothing — succeeded (empty results are the site's own answer for the pune region).
- **Wasted:** the detached-node refusal (1 step); one `scroll down` that reported "page height did not change" (1); a `completion_refused` re-plan round trip at the end.
- **Could have been:** apts/housing → fill_form → submit = 3 steps. Best use of `fill_form` in the shard — three filters in one action.

## `515f2e5811cfdd5e0e669e40f17886d8` — Samsung M.2 internal SSD $25-$200, bestbuy.com — task.ok / **BLOCKED** — 11 steps, 282.3s, 135k in / 3.6k out
- **Did:** dismissed the country chooser → searched "internal M2 Samsung SSD drive" → scrolled to facets → typed 25 and 200 into the price min/max → `Set` → `Samsung` facet → scroll ×3 → `read_page` (562 chars) → `M.2 2280` facet → done with the faceted URL.
- **Went wrong:** not the agent's fault — Best Buy served a reCAPTCHA-enterprise frame and withheld the grid; the judge marks it blocked. But the agent *had the signal*: `read_page` returned **562 characters** on a search-results page, and it still reported success rather than flagging an empty grid.
- **Wasted:** 3 `scroll` (one "page height did not change", one immediately scrolling back up) around a page with no content to scroll (3 steps); the `contract_complete` → `completion_refused` planner round trip at the end added ~40s and two planner calls without changing the answer.
- **Could have been:** search → price min/max + Set → Samsung facet = 4 steps; nothing more was obtainable from a bot-blocked grid.

## `608c595eec271fa5dc03506923519994` — FedEx Ground rate, 3 lb, 10019 → 90028, fedex.com — limit_steps / **FAIL** — 50 steps, 1207.2s, 438k in / 15.7k out
- **Did:** cookies → ENGLISH → `Get a quote` → typed 10019, picked "New York, NY 10019, USA" → typed 90028 → then never escaped the destination field. It re-entered the From/To pair three separate times (steps 4-6, 31-33, 44-50), detoured to "Rate Tools", and ended with the To autocomplete still open.
- **Went wrong:** step=9, `click_element {"index":20}` refused with "The element is disabled". Instead of filling the remaining required field, it clicked index 20 again at step=11 (same refusal), then index 13 (covered by `<header>`). From there it never returned to the package/weight section; weight was never typed once in 50 steps.
- **Wasted:** 6 `covered` refusals + 2 `disabled` + 1 `failed-retry` ("this exact action just failed... Sending it again unchanged fails the same way") = **9 refused steps**; `Rate Tools` clicked 4 times (4); 3 full restarts of the address entry (~9); 12 `scroll`, several "page height did not change"; 2 `wait_for` that both returned "was already gone before the wait began, so nothing was waited for and this proves nothing" (2); 10 re-plans. Well over 30 of 50 steps.
- **Could have been:** `Get a quote` → fill From zip + pick suggestion → fill To zip + pick suggestion → weight 3 lb → Show rates = ~6 steps. The single blocker was a disabled Continue button whose missing prerequisite the agent never diagnosed.

## `644a856c3897665e475e0dce50bf217d` — ANC wireless headphones ≤$100, add to cart, amazon.com — task.ok / **OK** — 13 steps, 338.3s, 272k in / 6.2k out
- **Did:** typed the query → took the "…100 or less" search suggestion → scrolled → opened a product → `go_back` → opened a second product → 3 scrolls → `find_in_page "Add to Cart"` → **no match** → `go_back` to the results → clicked the in-grid add button (idx 130) → done.
- **Went wrong:** nothing — succeeded. Note the constraints went into the query string rather than facets, but the judge confirmed the carted item satisfies them on screen.
- **Wasted:** the first product open + `go_back` (2 steps); on the second PDP, 3 consecutive `scroll down` then `find_in_page "Add to Cart"` returning no match, then `go_back` (5 steps) — the Add-to-Cart button was in an iframe/buybox the read did not cover, and the agent burned 5 steps discovering it before using the grid button it could have used at step=2. Also **three** planner round trips at the end (`contract_complete` + 2× `completion_refused`, ~80s, 4 planner calls) on an answer that did not change.
- **Could have been:** search with "under $100" suggestion → grid add-to-cart on an ANC model = **3 steps**.

## `6db4a0e346976f2729ba9afcd3208941` — FedEx tracking #3023858502 — task.ok / **OK** — 5 steps, 84.3s, 45.9k in / 1.2k out
- **Did:** `ACCEPT ALL COOKIES` → typed the number into the tracking box → `TRACK` → `read_page` (233 chars) → reported the site's own "We can't find that tracking number" message.
- **Went wrong:** nothing — succeeded. This is the cleanest trace in the shard: 4 actions, no refusals, no scrolls, and it correctly reported a negative result instead of inventing one.
- **Wasted:** effectively none. The `read_page` was load-bearing (it is where the error string came from).
- **Could have been:** the same 4 steps. Lowest token count in the shard at 45.9k.

## `7562d9b4e4829a44245aafce2e1f62db` — nearest size-4 P.O. Box to zip 54620, usps.com — task.pause / **FAIL** — 25 steps, 598.2s, 297k in / 7.9k out
- **Did:** Locations → typed 54620 → Search → `Filter & Sort` → `Common Services / Hours` → then 18 steps of `find_in_page "PO Box"` / scroll / re-open the same filter panel, opened the CATARACT location, and ended on `Return to Search Results` when the tab was closed.
- **Went wrong:** step=5. USPS's Locations page has a **Location Type** selector whose options include "PO Boxes"; the agent opened `Filter & Sort` and picked `Common Services / Hours` instead, then at step=15 clicked `Post Office™` — still not "PO Boxes". Without that type it never got the box-size availability grid, and its own `find_in_page {"query":"size"}` came back "No match for 'size' in the 6150 characters of this page" — the right conclusion (wrong page) drawn from the wrong inference (feature missing).
- **Wasted:** `find_in_page "PO Box"` run **6 times** with the identical query and the identical 6-match answer (6 steps); 9 `scroll`, 5 of them "page height did not change" (9); `Filter & Sort` opened twice, `Common Services / Hours` clicked twice (2); one `progress_stall` re-plan and 4 `step_interval` re-plans. ~19 of 25 steps.
- **Could have been:** Locations → zip 54620 → Location Type = "PO Boxes" → Search → read the nearest result's available sizes = **5 steps**.

## `7e1047f4803237f319c004f7a7f6bccb_121125` — Best Buy laptop trade-in value + in-store route — task.ok / **OK** — 27 steps, 860.3s, 318k in / 8.4k out
- **Did:** country chooser → `Trade-In` → 3 scrolls + `find_in_page "Trade-In"` (no match) → searched "trade-in" in the site search → `Computers` → HP → Continue → Intel 10th Gen Core i5 → 2021 → 8 GB → `Select This Device` → No → Fair → Functional → Yes → accepted terms → `Accept estimated value` ($91) → `Drop-off at a Best Buy store` → Continue → `ask_human` for phone/email.
- **Went wrong:** nothing — succeeded. The `ask_human` for phone/email is exactly right: personal data the task never supplied.
- **Wasted:** steps 2-5 — three `scroll down` then `find_in_page "Trade-In"` returning **no match** on the page it had just navigated to via the Trade-In link (4 steps), before restarting with a site search; 3 `read_page` of 55-2702 char pages between wizard clicks (3); one `invisible` refusal on idx 19 before finding the visible sibling idx 20 (1); two `completion_refused` planner round trips at the end (~40s). ~8 of 27.
- **Could have been:** search "trade-in" → Computers → HP → Continue → i5/2021/8GB → Select → condition answers (one batched click run, as step=20 already did) → Accept → Drop-off → Continue = **~12 steps**. Note step=20 batched **four** clicks in one step — that is the pattern the rest of the run should have used.

## `853afd530c72f4b00ffc32ae854efaf8` — wind flow map for Belo Horizonte, accuweather.com — limit_steps / **FAIL** — 50 steps, 1347.6s, 587k in / 13.8k out
- **Did:** searched Belo Horizonte → city page → hunted for "wind flow map" → clicked `RADAR`/`RADAR & MAPS` five separate times, each time hitting an interstitial → closed it → went back → re-searched → `go_to_url https://www.accuweather.com/en/br/national/wind-flow` (the right family of URL!) → immediately navigated away from it → repeated the whole cycle twice more.
- **Went wrong:** step=8. `click_element {"index":26}` (Belo Horizonte Weather Radar) refused: *"The link points to /en/br/belo-horizonte/44403/weather-radar/44403, but the page stayed at the same address: an overlay or interstitial probably intercepted the click."* The refusal **names the destination URL**. The agent closed the overlay and clicked again instead of navigating to the URL the error handed it. It hit the same refusal again at step ~38.
- **Wasted:** 5 separate RADAR/RADAR & MAPS click attempts (5); 3 `stale-index` refusals from acting on an index read before an overlay repainted (3); 6 `go_back` (6); 4 re-types of "Belo Horizonte"/"Belo Horizonte wind flow map" into the search box, 3 of which failed with "[N] is not on the current page" (4); ~13 `scroll`; 8 `step_interval` re-plans. 35+ of 50 steps produced nothing.
- **Could have been:** search Belo Horizonte → city page → RADAR & MAPS → wind layer, i.e. **4 steps**; or `go_to_url` the `/weather-radar/44403` path the step=8 error printed = **2 steps**.

## `8f80e64e44e1fada018997b2fe869683_110325` — top posts from last year, 9gag.com — task.fail / **OK** (judge) — 18 steps, 266.3s, 187k in / 12.7k out
- **Did:** `Top` → `wait_for network_idle` → `Last Year` tab → 3 scrolls → `read_page` (828 chars) → then **11 consecutive `extract` calls** with progressively more baroque CSS selectors, all returning 0 items or erroring, until `MaxFailuresReachedError`.
- **Went wrong:** step=7. The task was already done at step=2 (URL `9gag.com/top/last-year`, feed visible in `01.jpg`) — the judge passes it on trajectory. The agent then decided it had to *extract* the posts to prove it, and every extract on this image-feed returned nothing because 9gag's post titles live in `aria-label`/img alt, not text nodes. It never re-read the reason: three of the eleven ended with `schema names no fields: give an object schema with properties, or an array of such objects` — the same validation error, **repeated three times with the same malformed `{"items":{"type":"string"}}` shape**, at steps 9, 14 and 17.
- **Wasted:** 11 `extract` calls (~55s of tool time alone, 11 steps) + 3 scrolls + the `wait_for`. 15 of 18 steps. Output tokens 12.7k, almost all of it re-writing selectors.
- **Could have been:** `Top` → `Last Year` = **2 steps**. A browse task needs no extraction.

## `9af05e392cf3f5a8ff17aa764ba5bda6` — quote from a C+ solar company ≤10mi of Miami, bbb.org — task.ok / **OK** — 23 steps, 168.1s, 233k in / 4.8k out
- **Did:** cookies + banner → typed "solar energy equipment" → took the `Solar Energy Contractors` suggestion → location "Miami, Florida" → picked the suggestion → Search → `Distance` → `< 10 Miles` → `BBB Rating` → ticked `A and above`, `B rated`, `C rated` → scrolled → `Get a Quote` (new tab) → `ask_human` for zip/description → one `fill_form` → consent → second `fill_form` with 5 contact fields → `Send My Request`.
- **Went wrong:** nothing — succeeded, and the facet work (C-and-above expressed as three checkboxes) is genuinely good reasoning.
- **Wasted:** very little. Two dismissal clicks at the start (2); the `ask_human` + `human_needed` re-plan (2) asked for a zip it could have taken from the business's own address (33127 — which is exactly what it then filled in itself). It also **invented contact details** (`John Doe`, `test@example.com`, `555-555-5555`) on a real submission — that is the `ask_human` that should have fired, and did not.
- **Could have been:** ~18 steps on the same route; the facet and form work is near-irreducible for a 16-action reference task.

## `9ef1a8972f375db59c0e6329e11b7939` — cheapest Farms land in Wilkes County NC, landwatch.com — limit_tokens / **FAIL** — 37 steps, 762.1s, 682k in / 7.8k out
- **Did:** typed the county (after one `<div> does not accept text` refusal) → Search → hit a map-search interstitial → `Continue to List View` → applied `Farms and Ranches` → then entered a **12-step click/Remove loop** on the filter chips, lost the county, and spent the last 7 steps re-typing "Wilkes County, NC" into the search box, ending at the token cap with the suggestion list still open.
- **Went wrong:** step=19-30. `click_element {"index":40}` (label "g") then `click_element {"index":4}` ("Remove") alternating **six times** — it was toggling a filter chip open and removing it, with two `go_back` mixed in. The trigger was that the "Farms and Ranches" facet reset the location to nationwide (28,140 listings); the agent tried to fix it by removing chips rather than re-searching, and `progress_stall` never fired because the page *did* change each time.
- **Wasted:** the 12-step chip/Remove loop (12); 3 identical `input_text` refusals "A `<div>` does not accept text; type into an input, textarea or editable element" at steps 0, 31 and 35 — the **same mistake three times, 700s apart** (3); 10 `scroll`; 2 `go_back`; 3 re-searches for the county (6). ~30 of 37 steps. 682k input tokens for zero output.
- **Could have been:** LandWatch has a canonical URL per county+type; even by UI: search "Wilkes County, NC" → Continue to List View → property type Farms → sort "Price: Low to High" → read the first card = **5 steps**.

## `a69d2934fe54fef165490a5a2d95bf38_070826` — flourless pancake recipes in Japan, cookpad.com — task.ok / **FAIL** — 8 steps, 117.1s, 132k in / 5.4k out
- **Did:** switched region to 日本 → searched パンケーキ → typed 小麦粉 into the 含まない (exclude) box → clicked 絞り込み検索 → **`go_back`** → retyped 小麦粉 into the same box → scrolled → `save_findings` with a hand-picked list.
- **Went wrong:** step=4, `go_back`. It had just submitted the exclude filter at step=3 and then reversed it; the judge confirms every screenshot shows the 含まない box empty with the unfiltered header "パンケーキ (14,242)". The second attempt (step=5) typed into the box with `submit:true` but nothing committed, and the agent stopped checking.
- **Wasted:** the `go_back` + the re-type (2 steps); the `save_findings` list is worse than wasted — it hand-curated results off an unfiltered page and half its entries (米粉 = rice flour) contradict the task.
- **Could have been:** region 日本 → search パンケーキ → type 小麦粉 into 含まない → submit → verify the header count dropped = **4-5 steps**. It took the right route and undid it.

## `b2f4fde2fce122a93c7b578086cb0585` — cheapest hotel+flight+car package NYC→SFO, booking.com — task.fail / **FAIL** — 37 steps, 312.4s, 487k in / 12.3k out
- **Did:** dismissed sign-in → `Flight + Hotel` → cookies → set New York / San Francisco (two `Node is detached` refusals on the autocomplete) → dates 21→24 → 3 travellers incl. a 6-year-old → `Find` → `Show map` → `All filters` → then **17 straight steps** failing to tick the Breakfast checkbox, ending on `MaxFailuresReachedError`.
- **Went wrong:** step=19. `click_element {"index":64}` → "The element has no visible area". It retried index 64 at steps 23, 28; index 62 at 26, 27; index 388/390 at 31, 32, 33, 34, 35, 36 — **10 `invisible` refusals** on four indices, including one `failed-retry` refusal telling it in plain words "Sending it again unchanged fails the same way". The underlying issue (Booking's filter checkboxes are zero-area inputs behind a styled `<label>`) is exactly what the error message advises: "click its visible label". The agent never tried the label.
- **Wasted:** 10 invisible refusals + 1 failed-retry + 2 stale-index (13 steps); 4 `scroll {"index":44}` inside the filter panel, one refused "No change was visible after scrolling the element" (4); 4 `validation` re-plans that re-issued the same click (4). ~21 of 37. Also note the task was unsatisfiable on this site — Booking's Flight+Hotel product has no car leg — and nothing in the run noticed that.
- **Could have been:** recognise at step=17 that Booking has no hotel+flight+car product and report it = **~17 steps**, or with label-clicking working, filters + cheapest sort = ~22.

## `b922508886ded315c9835457a6eb43ea` — tenure-track CS faculty jobs in California, jobs.chronicle.com — task.fail / **OK** (judge) — 12 steps, 144.5s, 183k in / 12.2k out
- **Did:** `Computer Sciences & Technology` → `Tenured/Tenured Track` → `Location` → `California`. Done in 4 steps ("Found 3 jobs"). Then **8 `extract` calls** returning 0 items, the last two refused by the `identical-repeat` guard, ending the run as task.fail.
- **Went wrong:** step=4. The facets were already right; `extract` returned 0 every time because the listing markup did not match its schema. The guard message is explicit — *"you have already done exactly this 3 times on this page and nothing on it changed, so this one is refused"* — and the planner still re-planned into the same extract twice more (2 `progress_stall` re-plans).
- **Wasted:** 8 `extract` (8 steps, 12.2k output tokens); 2 `progress_stall` re-plans that did not change the action. 8 of 12 steps, two-thirds of the run.
- **Could have been:** the 4 facet clicks = **4 steps**. Identical shape to `8f80e64e…`: task complete, agent could not tell, extraction loop burned the budget.

## `bbbc243b4f18a7a897f0bc84e11d293f` — Chris Paul's assists per game this season, nba.com — limit_tokens / **FAIL** — 26 steps, 519.6s, 553k in / 7.0k out
- **Did:** cookies → `Stats` → `Advanced Filters` → 9 scrolls → searched the page for "search player", "search", "Chris Paul" (all no match) → set a dropdown to "All" → set the season dropdown to **2023-24** (not the current season) → 2 `extract` (0 items) → 2 more no-match searches → died at the token cap.
- **Went wrong:** step=2. It went to the league-wide **stats leaders grid** instead of the player page. From there every read was against a 337,360-character table — `find_in_page {"query":"Chris Paul"}` → "No match ... in the 337360 characters of this page", because the grid paginates and CP3 was not on page 1. It never used nba.com's player search, and at step=17 made it worse by switching the season away from current.
- **Wasted:** 10 `scroll` (several "page height did not change"); 5 `find_in_page` on a 300k-char page, 4 of them no-match (5); 2 `read_page {"mode":"full"}` that each truncated at 12,000 of 337,360 characters — **the single biggest token sink in the shard at 553k input for zero output** (2); 2 empty `extract` (2); 2 `view_screenshot` (2). ~21 of 26 steps.
- **Could have been:** nba.com player search → "Chris Paul" → his player page shows APG in the season header = **3 steps**. Reading a 337k-char leaderboard was never going to work.

## `c09721cc937d4dcfb391a0bc2c574b28` — next available date for Albion Basin, recreation.gov — task.ok / **FAIL** — 15 steps, 350.9s, 209k in / 3.0k out
- **Did:** typed "Albion Basin" → clicked the **category header** "Recreation Areas, Facilities, Tours, Trails" instead of the result → `go_back` → **repeated that exact pair three more times** (steps 3-4, 7-8, plus a `go_to_url` reset) → finally at step=10 typed the query and pressed `SEARCH` → opened the Albion Basin result → scrolled → answered "January 10, 2027".
- **Went wrong:** step=1, `click_element {"index":16}` on the dropdown's *group label* rather than a suggestion. That mis-click was repeated at step=4 and step=8 — three identical mistakes, ~190 seconds. Then the answer itself is wrong: the page said "Availability is not yet released. Check back on January 10, 2027 to view availability", which the agent reported as the next available date, and it never used the visible "Next Available" control.
- **Wasted:** 3 identical mis-click + `go_back` cycles (6 steps) plus one `go_to_url` reset (1) = 7 of 15 steps spent re-entering the same search. 6 `DOMService: Failed to remove highlights` errors around step=5-6.
- **Could have been:** type "Albion Basin" → SEARCH → open the facility → click "Next Available" = **4 steps**.

## `c6c9dc6079677cef594cec2fa6b16602` — cheapest black 3-seat leather 4★ sofa to cart, ikea.com — task.ok / **FAIL** — 21 steps, 171.5s, 429k in / 10.1k out
- **Did:** cookies → store selector → `Sofas & armchairs` → `Black sofa` facet → `Number of seats` → `3-seats` → opened `Material` → 3 scrolls → opened `Customer rating` → 3 scrolls → `find_in_page "Leather"` (2 matches) → empty `extract` → `ask_human` listing 5 candidates → added GAMMALBYN → `assert` → done.
- **Went wrong:** steps 6-13. It **opened** the Material panel and the Customer rating panel and then scrolled past both without selecting anything. `find_in_page {"query":"Leather"}` returned 2 matches — the option was on the page — and it still concluded "leather finish could not be met". It also never sorted by price, so "cheapest" was unestablished.
- **Wasted:** 6 `scroll` around two opened-but-unused facet panels (6); 1 empty `extract` (1); the `ask_human` + `human_needed` re-plan on a question it could have answered by clicking the facet it had open (2); a `done`-with-other-actions refusal (*"You MUST NEVER call 'done' in the same turn as other actions"*) (1); `completion_refused` + `contract_complete` planner rounds. ~11 of 21.
- **Could have been:** the four facets (colour, seats, material=leather, rating 4+) then sort by price then add the first = **7 steps**. It had two of those facet panels open and walked away from them.

## `d1807551297ac60ecaaabbd2a2ed301a_110325` — Dallas divorce lawyer once in Top 50 Women Texas Super Lawyers — task.ok / **OK** — 45 steps, 761.2s, **748k in** / 12.0k out
- **Did:** searched Divorce + Dallas, TX → then opened lawyer profiles **one at a time**, returning via `Back to Results` or `go_back` after each, eight times, until Jennifer Stanton Hargrave's profile showed "Top 50: Women Texas Super Lawyers: 2014".
- **Went wrong:** nothing — succeeded, and the accolade check is genuine evidence. But it is the most expensive success in the shard (748k input tokens) purely from the linear open/back scan.
- **Wasted:** 4 `stale-index` refusals ("[29] is not on the current page") caused by clicking a profile index read *before* the Back-to-Results re-render (4 steps); ~14 `scroll`; `find_in_page "Top 50 Women Texas Super Lawyers"` on the results page (no match — the accolade only exists on profiles) (1); one `read_page` truncated at 11,986 of 24,967 chars (1); 7 `step_interval` re-plans; a `done`-with-other-actions refusal (1).
- **Could have been:** the profile-by-profile scan is unavoidable given the accolade is only on profiles, but at ~2 steps per lawyer instead of 4 (no stale re-click, no scroll between) it is **~20 steps**. Better: the site's own "Top 50 Women" list page, ~4 steps.

## `d9d8b7d84a3f8d057e368254fe8d65e2` — first NielsRogge commit to the SAM2 repo, github.com — task.ok / **OK** — 8 steps, 47.8s, 122k in / 1.5k out
- **Did:** opened GitHub search → "SAM2 model" → `facebookresearch/sam2` → `76 Commits` → `All users` author filter → `NielsRogge` → `scroll bottom` → `assert` with the commit line as evidence.
- **Went wrong:** nothing — succeeded, fastest run in the shard (47.8s).
- **Wasted:** effectively none. The `scroll bottom` returned "page height did not change" but was load-bearing (it put the oldest commit in view).
- **Could have been:** the same 7 actions. This is the model trace: use the site's own filter, then one scroll, then assert against the exact text.

## `e7f6cca9a8875f98fee3b711ead3a444_110325` — posts liked by Taylor Swift, tumblr.com — task.ok / **FAIL** — 25 steps, 653.9s, 471k in / 13.4k out
- **Did:** searched "Taylor Swift" → `Filter search` → 3 scrolls → `Blogs` → the blog → `Likes` tab (correct destination, `tumblr.com/taylorswift/likes`) → then **6 `extract`, 4 `read_page`, 3 `find_in_page`** trying to pull post text out of a page that was behind a sign-up wall, and gave up.
- **Went wrong:** step=10 onward. The Likes tab was open but Tumblr pins a "Join over 100 million people using Tumblr" wall over the feed; every scroll said "page height did not change: no more content loaded". The agent read that as a parsing problem, not a login wall — it never said "the content is gated", which would have been the honest and correct answer.
- **Wasted:** 6 `extract` all returning 0 items, one with the by-now-familiar `schema names no fields` error (6 steps); 4 full `read_page` of the same 3-9k page (4); 3 `find_in_page` of which 2 were the identical `#taylorliked` query (3); ~5 scroll. ~18 of 25 steps, 471k tokens.
- **Could have been:** search → blog → Likes tab, then report that the feed is behind a sign-up wall = **4 steps**.

## `f27b393bbd2082f92b566270c4b74fe6` — large van 2024+ under 10k miles, parkers.co.uk — task.ok / **OK** — 29 steps, 251.9s, 422k in / 12.8k out
- **Did:** `Vans & Pickups` → `VANS & PICKUPS FOR SALE` → hit a newsletter modal → **14 steps fighting the modal** → finally got past it → `Large Van` → `Year from` → `2024` → `Mileage` → `Up to 10,000 miles` → 875 results.
- **Went wrong:** nothing — succeeded. Once the modal was gone the filter work took **4 clean steps**.
- **Wasted:** the modal fight is the whole story — 4 `covered` refusals naming the same `<div>` "Sign up to receive the PARKERS newsletters"; `send_keys Escape` refused; index 13 ("div", the close button) clicked 5 times with 3 different unknown/failed verdicts; **2 `invented-data` refusals** — the navigator tried to type `test@example.com` and `dummy@example.com` into the newsletter field and the guard correctly stopped it (*"Never make up personal details… ask_human for them"*); 2 `ask_human` for an email that was never needed; 1 `unshown-index` refusal; 4 `validation` re-plans. **~20 of 29 steps** on one newsletter overlay.
- **Could have been:** dismiss the modal in 1 step → 4 filter clicks = **7 steps**. Contrast `c6c9dc60…` (ikea) where the same agent passed cookie walls in one click; the difference is this modal's close control was an unlabelled `div`.

---
# shard6

## `05483c50cc9b04c8ac44c574758fb2bd` — best-rated BBB accredited charity near 12023, bbb.org — task.ok / **OK** — 30 steps, 494.8s, 305k in / 7.1k out
- **Did:** cookies ×2 → typed "charity" + "12023" → Search → `go_back` → retyped both → 12 more steps fighting the two autocomplete dropdowns → finally Search → `BBB Accredited` filter → `Sort By` → `Rating` → `assert` → done.
- **Went wrong:** nothing — succeeded, and the last 4 steps (accredited filter + Rating sort + assert) are exactly right.
- **Wasted:** the form entry took **23 steps to do what takes 3**. Two `covered` refusals both saying "the open list of suggestions of the focused field … choose an option from it, or press Escape to close it first" — the agent eventually learned `send_keys Escape` and then used it 3 times; a `go_back` that threw away a submitted search (1); "charity" typed 4 times and "12023" 3 times (7); a `Node is detached` refusal; a "click left the page at the same address" refusal; a `clear input` + retype cycle. ~20 of 30.
- **Could have been:** type charity → pick the zip suggestion → Search → BBB Accredited → Sort by Rating = **5 steps**.

## `11857213ca01510f12813740afd59918_110325` — top-selling brown Birkenstock men's clogs size 10-10.5 to cart — task.ok / **FAIL** — 27 steps, 222.0s, 459k in / 8.8k out
- **Did:** cookies → `Herren` → `Clogs` → sorted by `Bestseller` → `FILTER` → picked size **45** and colour `Braun` → applied → opened three products and `go_back` from each → opened Naples Wrapped → size 45 → `IN DEN WARENKORB` → the commit guard asked the user → declined.
- **Went wrong:** step=11, `click_element {"index":39}` = size **45**. It was on the German storefront (`birkenstock.com/de/`) with EU sizing and mapped "10-10.5" to 45 (EU 43 is the right one); it never switched the size scale or the locale. The run then ends undone because the `commit` guard asked for confirmation on the 165,00 € add-to-cart and the harness declined.
- **Wasted:** 2 `covered` refusals on the same size swatch behind a `<span> "Größe"` (2); 3 `scroll {"index":24}` inside the filter drawer between them (3); **three open-product-then-`go_back` cycles on the same index 49** before finally opening index 50 (6); 4 `step_interval` + 2 `completion_refused` re-plans.
- **Could have been:** Herren → Clogs → Bestseller sort → size + brown facets → open first result → size → add = **7 steps**, with the locale/size-scale switched first.

## `1ab384fb3a791edfb410213cc6b82151_110325` — proton emission decay of Be with 4p/2n, phet.colorado.edu — limit_steps / **FAIL** — 50 steps, 1049.8s, 435k in / **27.1k out** — highest output tokens in the shard
- **Did:** EXPLORE OUR SIMS → site search → `go_back` → `Build a Nucleus` → `Play Simulation` → then **~35 steps clicking "Decay Screen" / "Chart Intro Screen" / bare "button" elements**, none of which changed anything, with four `go_back` + `Play Simulation` restarts in between.
- **Went wrong:** step=9. `click_element {"index":0}` ("Decay Screen") → "click_element was sent, but the page did not visibly change". PhET sims are a **canvas**: the AX tree exposes a handful of `button` nodes with no usable geometry, and CDP clicks land nowhere. The agent repeated that same click at steps 10, 11, 17, 21, 24, 26, 29, 37, 39, 41 — **~14 attempts on index 0 alone**, plus index 1 ×3, index 16 ×5 (two refused by `identical-repeat`), `send_keys Enter` ×3.
- **Wasted:** 21 steps validated `unknown` ("did not visibly change") — the largest unknown count in the shard; 4 restart cycles (`go_back` + `Play Simulation`, 8 steps); 3 `view_screenshot` and 2 `read_page` that returned 397 characters; 9 `validation` re-plans that re-issued the identical click. ~45 of 50 steps.
- **Could have been:** after 3 identical "did not visibly change" verdicts on a canvas sim, the correct move is to stop and report that the simulation is not operable through the accessibility tree — **~12 steps**. Nothing on this page was reachable.

## `2207bb4f21786690cfed20b37253fb8b` — current wind speed in Calgary, theweathernetwork.com — task.ok / **OK** — 5 steps, 185.7s, 74.6k in / 0.9k out
- **Did:** typed "Calgary, Alberta" → picked the suggestion → opened the Calgary current-conditions page → `assert` with "Wind 6 km/h SW Gust: 9 km/h" → done.
- **Went wrong:** nothing — succeeded. 3 real actions.
- **Wasted:** the `done`-with-other-actions refusal (*"You MUST NEVER call 'done' in the same turn as other actions"*) cost 1 extra turn; a `contract_complete` planner round at the end. The 185s is almost entirely provider latency (one 10.8s timeout + retry).
- **Could have been:** the same 3 steps.

## `28e7574e7bd6d14f36d2988a5ef2bd23` — part-time chef job near Moscow, Idaho, ohiomeansjobs.ohio.gov — task.ok / **FAIL** — 1 step, 49.4s, 28.2k in / 1.2k out
- **Did:** nothing. The only action was `done {"success":false}` declaring the site is Ohio-only and asking for a different job board. Two screenshots of the untouched landing page.
- **Went wrong:** step=0. The refusal is defensible reasoning (Moscow, Idaho is out of Ohio's scope) but it is **untested** — no search box was ever used, and the judge notes the requested filters were never opened. The site's search does accept arbitrary locations; the correct behaviour is to run the search and report the empty result (rule 6), not to predict failure from the site's name.
- **Wasted:** the planner **sent the `done` back twice** (`completion_refused` ×2) and the navigator re-issued the same refusal both times; 5 LLM calls, 49s, for zero browsing.
- **Could have been:** search + 4 facets = ~8 steps, or a one-step honest report *after* one attempted search = **2 steps**. This is the opposite failure mode to every other task in the shard: giving up before acting rather than after too much acting.

## `323bd85e3559655d89e5496b951a25e8` — what ID to bring on an Amtrak trip — task.fail / **FAIL** — 18 steps, 555.8s, 223k in / 6.3k out
- **Did:** cookie dialog → `Baggage Policy & Services` (wrong page) → `PLAN` → `Passenger ID, Safety & Security` → `Learn more` → landed on the **right page** → then 9 steps of `extract` / `read_page {"section":"Valid Photo ID Required"}` / `find_in_page`, and died on a planner timeout with no answer.
- **Went wrong:** step=9. It had the page and ran `read_page {"mode":"full"}` returning 11,959 of 12,829 characters — **the answer was in hand**. It then spent every remaining step trying to re-extract the same text into a schema. One `extract` took **54.3 seconds**. `read_page {"section":"Valid Photo ID Required"}` failed with "No section … on this page. Its sections are: s1 ## [Frame …recaptcha…]" and it repeated that same call at steps 11, 14 and 15 until `identical-repeat` refused it.
- **Wasted:** 3 `extract` (54.3s + 15.2s + 2.4s = 72s of tool time, 3 steps); 4 `read_page` re-reads of a page already read in full (4); `find_in_page` with an 88-character literal sentence as the query — which **found 1 match**, i.e. the answer, and was still not used (1); 2 `progress_stall` re-plans. 10 of 18 steps after the content was already retrieved.
- **Could have been:** PLAN → Passenger ID → `read_page` → answer = **4 steps**. The content was read at step=8 and never reported.

## `38203be65401943aea2179c4c680059a` — disruptions on bus S92, new.mta.info — task.ok / **OK** — 14 steps, 110.4s, 127k in / 2.3k out
- **Did:** `Bus` → typed S92 → picked S92 → clicked through → `read_page` (105 chars) → `Planned Service Changes` → `wait_for` → `read_page` → then re-did the selection through the alerts tool (`Bus` → `Staten Island` → `S92` → `Select`) → `assert` "No planned service changes on S92" → done.
- **Went wrong:** nothing — succeeded, and it correctly reported an empty result as the answer.
- **Wasted:** the first route (steps 0-4) was abandoned: 4 clicks + a 105-char `read_page` before restarting inside the alerts tool (5 steps); a `wait_for {"text_gone":"Loading"}` that returned *"'Loading' was already gone before the wait began, so nothing was waited for and this proves nothing about what you did"* (1).
- **Could have been:** Planned Service Changes → Bus → Staten Island → S92 → Select = **5 steps**.

## `4464a8421f8bc8786524a499258dfad3` — specs of the best-selling HP FHD i7/16GB/Win11 laptop, bestbuy.com — limit_tokens / **FAIL** — 37 steps, 434.3s, **660k in** / 11.3k out
- **Did:** country → searched the whole spec string as free text → sort `Best Selling` → applied facets HP, Windows, 1920x1080, Intel Core i7 14th Gen → then **17 steps of scrolling and searching for a product list that was not rendered**, and died at the token cap.
- **Went wrong:** step=6. `find_in_page` with a **121-character full product title** as the query (`"HP - 15.6'' FHD IPS Touchscreen Laptop, Intel i7-1255U,16GB DDR4 RAM,1TB SSD+1TB Docking Station Set,Win 11 Pro - Silver"`) — a title it had invented/remembered, not read. From step=21 the grid was empty (the same Best Buy bot-wall as `515f2e58…`) and it never concluded that; `read_page {"mode":"main"}` returned **587 characters** on a search page and it kept scrolling.
- **Wasted:** **15 `scroll`**, 9 of which reported "page height did not change: no more content loaded" (15 steps); 4 `find_in_page`, 2 on the identical query "RAM" (4); 2 `read_page` of a 587-char page (2); 6 `step_interval` re-plans. ~23 of 37. Never applied the 16 GB RAM or Windows 11 facet, never opened a product.
- **Could have been:** search "HP laptop" → Best Selling sort → facets HP / FHD / i7 / 16GB / Win 11 → open first result → read specs = **8 steps**; and on an empty grid after two "no more content" scrolls, stop and say the listings are withheld = ~10.

## `4d3157aab34b54e5f0c4b965dfe930f3` — community posts on pregnancy fever, past 30 days, babycenter.com — task.ok / **OK** — 15 steps, 394.6s, 164k in / 3.2k out
- **Did:** consent dialog → `Community` → 3 scrolls → `find_in_page "search|filter|sort"` (no match) → opened the nav menu → searched "pregnancy fever" → scroll → `Filter` → `Posts` → `Past 30 Days` → `Apply` → `read_page`.
- **Went wrong:** nothing — succeeded, and the `Posts` + `Past 30 Days` chips are exactly the site's own filters.
- **Wasted:** steps 3-6 — 3 scrolls plus a `find_in_page` whose query was the regex-ish literal `"search|filter|sort"` on a 15,796-char page returning no match (4 steps), before it thought to open the nav menu for the search box; one more `scroll` at step=9 (1); a `completion_refused` round at the end (~20s, 2 planner calls).
- **Could have been:** search "pregnancy fever" → Community tab → Filter → Posts → Past 30 Days → Apply = **6 steps**.

## `52efbab520734ef9bf7c09ba0f62cdc8` — find the iOS app, recreation.gov — task.ok / **OK** — 4 steps, 27.9s, 58.1k in / 0.8k out
- **Did:** `Download our iOS App` → `Download on the App Store` (new tab, auto-switched) → `assert` → done.
- **Went wrong:** nothing — succeeded. Fastest run in the shard at 27.9s, 2 real clicks.
- **Wasted:** none.
- **Could have been:** exactly this. Note how the new-tab handling worked silently here, versus `3621b099…` where the agent added a redundant `switch_tab`.

## `60cbbbd58eb9d28b053aef945f464228` — is phone 555555555 a scam, bbb.org — task.ok / **FAIL** — 2 steps, 17.3s, 14.9k in / 0.7k out
- **Did:** tried to navigate to `https://www.google.com`, was refused by the firewall (*"nothing in the user's request leads to https://www.google.com, and no link on the pages you visited points there"*), then called `done {"success":false}` saying web search is unavailable.
- **Went wrong:** step=0. BBB's own **Scam Tracker** is in the top navigation of the landing page it was looking at (`00.jpg`) and takes phone-number lookups. The agent's first instinct on a lookup task was to leave the site for a search engine; when that was blocked it treated the whole task as impossible rather than looking at the page in front of it.
- **Wasted:** the whole run — 2 steps, 5 LLM calls, no page ever touched.
- **Could have been:** `Scam Tracker` → search the number → report = **3 steps**. The `intent-open` guard did its job; the agent's recovery from it did not.

## `64b76158720a69e4a5c31a55d54928bf` — compare two pescatarian diets, healthline.com — limit_steps / **FAIL** — 50 steps, 801.5s, **693k in** (highest in shard) / 15.6k out
- **Did:** searched "pescatarian diets" → opened the Pescatarian Diet article → hit a newsletter modal → **14 steps fighting the modal** → `go_back` → reopened the same article → then an open-article / `read_page` / `go_back` loop across 6 more articles (Vegetarian vs Vegan vs Pescatarian, What Is a Pescatarian Diet, 6 Types of Vegetarian Diets, Is Seafood Healthy, Mediterranean Diet **twice**, Blue Zone Diets) → one `save_findings` → `go_back` → step limit.
- **Went wrong:** step=4, a `covered` refusal by the "Newsletter Subscription Modal". Steps 5-18 are click index 1 ("h"/"Health Conditions") ×4, `send_keys Escape`, `handle_dialog {"accept":false}` → "No dialog is showing", 2 `view_screenshot`, `wait_for`, `find_in_page "Close|x"` → no match, a full `read_page`. The modal was never dismissed by any of it; the page simply moved on. The second failure is conceptual: after the modal it never fixed on **two** diets, opening seven articles and comparing none.
- **Wasted:** 14 modal steps (14); Mediterranean Diet opened twice and read twice (2); 5 `go_back` (5); 11 `read_page`, several of them **5,000 ms each** and truncating (11); ~10 scroll; 9 re-plans. Also **~30 `DOMService: Failed to remove highlights` errors** through steps 8-19, each adding ~10-17s to the step — that is where much of the 801s went.
- **Could have been:** open the Pescatarian Diet article → open "Vegetarian vs. Vegan vs. Pescatarian" → read both → write the comparison = **5 steps**.

## `6ebde509dca8f15c0fa1bd74f071e8d6` — job in Miami HR, target.com — task.ok / **BLOCKED** — 3 steps, 46.2s, 53.2k in / 1.3k out
- **Did:** the landing page was Target's "Press & hold to confirm you're a human" interstitial. `ask_human` to complete it → after no answer, `done {"success":false}` reporting the block. One `challenge-element` refusal stopped it touching the widget.
- **Went wrong:** nothing the agent could control — the judge marks it blocked.
- **Wasted:** a `completion_refused` planner round after the `done` (the planner sent back a correctly-reported block).
- **Could have been:** this is the right handling of a bot wall, and the `challenge-element` guard is doing exactly what it should. **Do not change this path.**

## `75a1b5dcd2c28508a971d98d51fe5767` — open reviews of a beef sirloin recipe, allrecipes.com — task.ok / **OK** — 4 steps, 128.4s, 74.0k in / 1.0k out
- **Did:** typed "beef sirloin" → search → opened "Sirloin Tips and Mushrooms" → clicked `523 REVIEWS`.
- **Went wrong:** nothing — succeeded in 4 actions.
- **Wasted:** none, though 2 `DOMService: Failed to remove highlights` errors added ~10s each at step=0.
- **Could have been:** exactly this.

## `7e6993f2c5cd72c44809024f0bc85dc1` — meme with a frog background and text "Enjoy your life", imgur.com — task.fail / **FAIL** — 34 steps, 546.1s, 334k in / 10.3k out
- **Did:** `Make a Meme` → `Background` → `Templates` → scrolls and searches → `go_to_url imgur.com` reset → **tried twice to navigate to a Google search for "online meme generator"** (both refused by `intent-open`) → back into the editor → `Text` → `Add a heading` → three failed attempts to type the caption → `MaxFailuresReachedError`.
- **Went wrong:** two separate walls. (a) It never searched the Templates panel for "frog" — it scrolled the template grid instead and then `ask_human`'d for a frog image. (b) The caption: `input_text {"index":28}` → "A `<div>` does not accept text", repeated at step=31, then `input_text {"index":14}` → "**Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'**" — a genuine harness bug typing into imgur's canvas text layer.
- **Wasted:** 2 `intent-open` refusals + the `go_to_url` reset (3); `Background`/`Templates`/`Uploads` panel clicked 8 times across the run (several repeats, ~5); 5 scrolls; `find_in_page "contenteditable|textarea|input[type='text']"` — a CSS selector passed as a text query (1); `ask_human` + re-plan (2); ~30 `DOMService: Failed to remove highlights` errors adding 10-16s per step through steps 0-7.
- **Could have been:** Make a Meme → Templates → search "frog" → pick → Text → type → done = **6 steps**, if `input_text` worked on that editor. The `dispatchEvent` error is a real bug worth fixing.

## `85b284c18d7e78c9b5a9e074e7aa3b98_051526` — cheapest NYU student apartment with WIFI + cleaning, student.com — task.ok / **OK** — 6 steps, 142.1s, 83.3k in / 1.3k out
- **Did:** `New York University` → `All Filters` → ticked `Wifi` and `Cleaning Service` → `Apply Filters (36 results)` (all three in **one batched step**) → opened the Sort menu → `Price Low to High` → read the first card.
- **Went wrong:** nothing — succeeded. The judge notes it reported from the grid rather than opening the property, which is the only soft spot.
- **Wasted:** none. Step=2 batching three clicks in one step is the pattern that makes this the best filter-task trace in the shard.
- **Could have been:** exactly this, 6 steps.

## `8fdec8eeffd3491e6526cc78c028120b` — Nissan and Honda near Kentwood MI 49512, carmax.com — task.ok / **OK** — 7 steps, 131.1s, 115k in / 1.5k out
- **Did:** dismissed a banner → searched "Nissan and Honda" → opened the store picker → typed 49512 → searched stores → `Set as my store` → `read_page`.
- **Went wrong:** nothing — succeeded.
- **Wasted:** none material.
- **Could have been:** the same 6 actions; setting the store before searching would have saved a re-render but not a step.

## `9b5dfe54a1c14c5c6336bae7374c3bb5` — UPS Access Point near SPRING, TX and its services, ups.com — task.ok / **FAIL** — 10 steps, 46.9s, 108k in / 1.7k out
- **Did:** `Location Finder` → typed "SPRING, TX" → `Look Up` → `Filter By` → `Location Type +` → `UPS Access Point™` → `Location Type −` → `Available Services +` → `Available Services −` → `Filter By` (closing everything it had just opened) → answered "no access points found".
- **Went wrong:** steps 6-9. It expanded and then **immediately collapsed** each accordion it opened — `Location Type` opened then closed, `Available Services` opened then closed, then the whole `Filter By` closed — and never re-ran the lookup. Every action validated `passed` (10/10, the only all-pass fail in the shard) because collapsing a panel *is* a visible change. The judge notes the final screenshots show "Look Up" never pressed with results and the cookie banner still covering the panel.
- **Wasted:** the 4 open/close accordion toggles (4 steps) and the final answer, which asserts an empty result that was never observed — the worst kind of failure, a confident negative with no evidence.
- **Could have been:** Location Finder → SPRING, TX → Look Up → Location Type → UPS Access Point → apply → open the first result = **6 steps**.

## `9f1cba613830ca1c6a58f9498c06e679_110325` — most experienced agent in St Augustine FL, remax.com — task.ok / **OK** — 34 steps, 702.4s, 506k in / 9.8k out
- **Did:** `Find an Agent` → typed the city → picked the suggestion → hit a detached node → restarted the search **three more times** → tried a "Years of Experience 24+" numeric filter → opened an agent, `go_back` → re-entered everything → finally found `No Sort` → `Experience (High to Low)` → opened Thomas Dorazil's profile → `assert` "54 Years Experience".
- **Went wrong:** nothing in the end — succeeded via the site's own sort, which is the right way to get a superlative. But it took 28 steps to find the sort control it used at step=26.
- **Wasted:** "St Augustine, FL" typed **5 times** and the suggestion clicked 4 times (9 steps); a `Node is detached` refusal plus a `failed-retry` refusal for resending it unchanged (2); the whole 24+-years numeric-filter detour including opening SALLY HARASZ and going back (6); `Experience (High to Low)` selected **twice** (steps 27 and 30) with a `go_back` between (3); 2 `wait_for` both reporting *"'Searching...' was already gone before the wait began, so nothing was waited for"* (2); ~8 `DOMService: Failed to remove highlights` errors adding 10-15s per step in steps 11-15.
- **Could have been:** Find an Agent → Saint Augustine FL → Sort: Experience (High to Low) → open first card = **4 steps**. It did those four moves — spread over 34.

## `a6f0434ce6aff5f9b03681241b03ad82` — Tesla closing price on 2023-03-17, finance.yahoo.com — task.ok / **OK** — 10 steps, 98.7s, 219k in / 2.5k out
- **Did:** searched Tesla → `Historical Data` → opened the date-range picker → typed 2023-03-17 into start and end → the `overwrite` guard refused the duplicate end date (*"this field already holds '2023-03-17', which you typed earlier"*) → changed end to 2023-03-18 → `Done` → `assert` with the full OHLC row.
- **Went wrong:** nothing — succeeded, and the guard's intervention actually **fixed** the range (a start==end range would have returned nothing).
- **Wasted:** the `done`-with-other-actions refusal (1 turn). Otherwise tight.
- **Could have been:** the same 7 actions.

## `b320c68bffc1f3c7f2a8dc9d5478fb27` — walkthrough for Zelda BotW, ign.com — task.ok / **FAIL** — 30 steps, 882.5s, 386k in / 8.8k out
- **Did:** typed "The Legend of Zelda: Breath of the Wild walkthrough" into IGN's search **five times** across the run, cycling between the All / Guides / Games tabs and `go_back`, and never found a result.
- **Went wrong:** step=0. It was on **IGN India**, whose search returns only "Did you mean" suggestions for this title. The agent's whole strategy was the search box; the judge notes IGN's `Wiki` and `Guides` **left-nav entries — where walkthroughs actually live — were never used**, and no `go_to_url` to `ign.com/wikis/the-legend-of-zelda-breath-of-the-wild` was tried.
- **Wasted:** 5 identical searches (5 steps); 15 `scroll`, **10 of which reported "page height did not change: no more content loaded"** (15); 3 `go_back`; 2 `find_in_page` no-match (2); a `read_page` of 579 characters; 4 `step_interval` + 1 `completion_refused` re-plan. ~26 of 30 steps, and 882 seconds.
- **Could have been:** after the first empty search, `go_to_url` the wiki path or click the `Wiki` nav = **3 steps**. Five identical searches is the clearest "same action, same result" loop in the shard.

## `b962927dfe03bf2274a54381127ed433` — best-selling classical vinyl by a NYC artist, bandcamp.com — task.ok / **FAIL** — 30 steps, 249.6s, 534k in / 8.1k out
- **Did:** cookies → `Vinyl` → `classical` → `best-selling` → then got stuck behind its **own open sort dropdown** for 9 steps → `clear all filters` (wiping the vinyl format) → re-applied classical + best-selling + `artists from anywhere` → `new york city` → answered with a Mitski record.
- **Went wrong:** step=4. `click_element {"index":61}` → *"The element is covered by `<div>` behind the dialog 'Sort by best-selling new arrivals surprise me'; close or move past it first"* — the sort menu it had just opened was covering everything. It retried index 61 twice more (once refused by `failed-retry`), then indices 11, 7, 56 — **5 `covered` + 1 `invisible` + 1 `failed-retry` refusals**. It eventually learned `send_keys Escape`, which worked, but only after `clear all filters` had thrown away the vinyl facet it never restored. The final answer then names a record (Mitski) that is **not in the displayed grid at all** — a hallucinated pick on top of a wrong filter state.
- **Wasted:** 7 refused clicks (7 steps); `clear all filters` + rebuilding the filters (5); 3 scrolls + a no-match `find_in_page "New York City"` + a `go_back` (5); 2 `validation` and 2 `completion_refused` re-plans.
- **Could have been:** Vinyl → classical → best-selling → location "new york city" → read the first card = **5 steps**. Pressing Escape after opening a dropdown would have saved 7 of them.

## `bc2ce7f206045dd2d322e5695a947219` — federal tax on $158,500, ZIP 97007, single, smartasset.com — task.ok / **OK** — 10 steps, 235.3s, 155k in / 1.4k out
- **Did:** `TAXES` → `Income Tax Calculator` → typed 158500 (validated `unknown`: "The field now shows '$158,500'") → typed 97007 → `Single` → `Calculate` → the ZIP had not resolved, so typed "Beaverton, OR" → `Calculate` again → scroll → `assert "$27,107"`.
- **Went wrong:** nothing — succeeded, and the re-entry as "Beaverton, OR" after the ZIP failed to resolve is a good recovery.
- **Wasted:** the second `Calculate` + location retype (2 steps), which were caused by the location field not accepting a raw ZIP — avoidable if the agent had checked the field's resolved value before clicking Calculate the first time.
- **Could have been:** TAXES → calculator → fill all three (one `fill_form`) → Calculate → read = **5 steps**.

## `c181f903ec1107b850032c17cad88393` — identify a pink round pill imprinted 150, webmd.com — task.ok / **OK** — 21 steps, 242.4s, 300k in / 6.8k out
- **Did:** `Pill Identifier` → imprint "150" → picked the suggestion → `Select Color` → `Pink` → **10 steps stuck behind an autocomplete list on an unrelated "Conditions" field** → `View 4 Result(s)` → `Select Shape` → `Round` → `View 2 Result(s)` → `save_findings`.
- **Went wrong:** step=5-15. Two `covered by <div>` refusals, then it clicked index 1 ("Conditions") — a **different search box in the site header** — which opened its own suggestion list and covered everything. Five more refusals followed, all saying *"the open list of suggestions of the focused field 'Conditions': choose an option from it, or press Escape to close it first"*; two `send_keys Escape` both validated `unknown — the page did not visibly change`. It escaped only when the list happened to close.
- **Wasted:** 6 `covered` refusals (6 steps); `Conditions` clicked 4 times (4); 2 ineffective `Escape` (2); 4 `validation` re-plans that re-issued the same click (4). **~13 of 21 steps**, all caused by opening a field it did not need.
- **Could have been:** Pill Identifier → imprint → colour → shape → View Results = **5 steps**. The pill-identifier form itself was handled perfectly.

## `c7c07ec10c668625a21ba64165d719bb` — monthly price of 4 prepaid unlimited lines, no autopay, verizon.com — task.ok / **OK** — 13 steps, 75.3s, 143k in / 2.9k out
- **Did:** `Verizon Prepaid` → `Plans` → `Phone plans` → scroll → clicked `+` three times to get 4 lines → an `invisible` refusal on the autopay toggle → clicked its `label` instead → `save_findings` → `assert "$180/mo"` **rejected** (*"not on the page you are on… Quote the page word for word, read it first with read_page or find_in_page"*) → `find_in_page "$180/mo"` → 1 match → re-asserted → done.
- **Went wrong:** nothing — succeeded, and the assert/find/re-assert cycle is the single best evidence-checking sequence in the shard: the guard caught an unverified claim and the agent went and verified it.
- **Wasted:** the failed `assert` + the `find_in_page` (2 steps) — but that is the cost of the check working, not waste. Clicking `+` three separate times could have been one batched step (2).
- **Could have been:** ~9 steps. Note the recovery from the `invisible` refusal — clicking the `label` — is exactly what the error message advises and what `b2f4fde2…` (booking.com) never did.

## `d1970c16271496cbbe166ecbecc0a1d8` — 2020 US dry red wine $15-20, 5 bottles to cart, macyswineshop.com — task.ok / **FAIL** — 9 steps, 260.6s, 150k in / 4.2k out
- **Did:** hit a welcome overlay → tried `select_dropdown_option {"text":"Texas"}` → failed ("Option 'Texas' not found. Available options: … 'TX' …") → selected `TX` → `YES` → opened `Shipping Policy` → `go_back` → selected TX again → an `invisible` refusal → `done {"success":false}` reporting "Item cannot ship to your state".
- **Went wrong:** step=3-4. It read a per-product shipping restriction on **one** product as a site-wide block and stopped. Its own answer lists all five requirements as "Not applied": no varietal, vintage, country or price filter was ever opened. The `Texas` vs `TX` dropdown miss (step=1) is a separate, smaller bug — the error message listed the valid options and the agent used them correctly on the retry.
- **Wasted:** the `Shipping Policy` detour + `go_back` (2 steps); the repeated TX selection (1); **four `completion_refused` planner rounds** at the end (steps 8-9, ~100s, 7 planner calls) all of which accepted the same answer.
- **Could have been:** apply the filters first (dry red / 2020 / US / $15-20), then discover the shipping limit at cart time and report it with the filtered list shown = **~8 steps** and a much better answer.

## `da8f3823a827c7d3a492f383808e7912` — earliest Instructure press release — task.ok / **OK** — 10 steps, 65.9s, 104k in / 1.9k out
- **Did:** cookie dialog (one `covered` refusal, then scroll, `Close`, `Accept`) → `Resources` → `Press Releases` → year dropdown → `2020` (the earliest year offered) → `scroll bottom` → `Read More` on the last entry → `assert` with the dateline.
- **Went wrong:** nothing — succeeded. The reasoning ("earliest year in the selector, then the last item in a newest-first list") is exactly right.
- **Wasted:** the cookie dialog cost 4 steps (refusal, scroll, Close, Accept) where one `Accept` would have done.
- **Could have been:** Accept → Resources → Press Releases → 2020 → scroll bottom → Read More = **6 steps**.

## `eb2db4b769c145dbe6ba4f74f3e0de98` — energetic hairless dog with medium barking, akc.org — task.ok / **FAIL** — 34 steps, 254.6s, 392k in / 10.7k out
- **Did:** `FIND YOUR MATCH` → ran AKC's 8-question breed-selector quiz to the end → `SEE RESULTS` → answered "Bichon Frise".
- **Went wrong:** step=6. The quiz has no hairless question, so the agent substituted `"I want a dog that doesn't shed"` and later hypoallergenic for **hairless** — two different properties. The judge: "the resulting breed is the Bichon Frise (43% Match), a densely coated breed and plainly not hairless; AKC's own breed search offers a hairless coat-type filter that was never used." The `assert` at step=32 even quotes "Shedding Level: I want a dog that doesn't shed Matched" as evidence for "hairless", which it is not.
- **Wasted:** **9 `unknown` validations** all reading "The link points to /question/N, but the page stayed at the same address: an overlay or interstitial probably intercepted the click" — the quiz is a hash-router, so every CONTINUE looked like a failure to the validator while actually working (9 noisy steps, several re-plans); 4 `covered by <nav>` refusals on the sticky Back/CONTINUE bar (4); an `ask_human` about a priority-reorder widget it did not need (1) plus its re-plan.
- **Could have been:** AKC breed search with the **coat type = hairless** facet + energy + barking filters = **5 steps**. The quiz was the wrong tool for a three-attribute lookup.

## `f2be37a9a60fbc25b6b11cf622d17352_110325` — obedience trials in New York next month, akc.org — task.ok / **OK** — 30 steps, 855.4s, 476k in / 15.4k out
- **Did:** cookies → `Event Search` (new tab) → `Companion Events` → `Obedience (O/SO/PO/LO)` → state New York → dates 09/20/2026-10/20/2026 → cookie banner again → `RETRIEVE EVENTS` → then **15 steps of extract/read/find** before finally listing 17 events from `find_in_page` snippets.
- **Went wrong:** nothing in the end — succeeded, and the form filling (steps 4-12) is exemplary.
- **Wasted:** everything after `RETRIEVE EVENTS`. **7 `extract` calls all returning 0 items** with ever-more-elaborate `pattern` regexes (7 steps); **6 `read_page`**, three of them refused/flagged, one by `identical-repeat` ("you have already done exactly this 3 times on this page and nothing on it changed") (6); 3 `find_in_page` with hand-built regex alternations, the last of which finally produced the answer (3); a `wait_for` that reported *"'Fetching Results…' was already gone before the wait began"*; a `progress_stall` re-plan. **~17 of 30 steps and ~470 of 855 seconds** after the data was already on screen.
- **Could have been:** the 12 form steps → `read_page` → report = **13 steps**. The `read_page` at step=16 returned 7,439 of 13,916 characters — the events were in it.

---

# Summary

58 tasks, 1,186 steps. Judge: **29 OK, 27 FAIL, 2 BLOCKED**. Guard refusals across the shard: `covered` 38 (16 tasks),
`invisible` 20 (6), `stale-index` 12 (6), `identical-repeat` 6 (4), `failed-retry` 4 (4), `disabled` 3 (2),
`intent-open` 3 (2), `invented-data` 2 (1), `unshown-index`/`challenge-element`/`overwrite` 1 each.
Action mix: 489 `click_element`, **211 `scroll`**, 100 `input_text`, 58 `find_in_page`, 54 `read_page`, 43 `go_back`, 37 `extract`.
Re-plans: 150 `step_interval` (48 tasks), 33 `validation`, 28 `completion_refused` (20 tasks), 25 `contract_complete`, 8 `progress_stall`.

## 1. Recurring waste patterns

| Pattern | Tasks hit | Steps it cost | Worst offenders |
|---|---|---|---|
| **Overlay/modal fight** — repeated clicks on elements a cookie banner, newsletter modal, sticky nav or the agent's own open dropdown is covering. 38 `covered` + 20 `invisible` + 4 `failed-retry` refusals | 20 | **~110** | `f27b393b` 20, `b2f4fde2` 21, `b962927d` 7, `c181f903` 13, `eb2db4b7` 13, `64b76158` 14 |
| **Blind scrolling** — 211 scrolls total, 56 of them returning "page height did not change: no more content loaded", often 2-3 in a row | 39 (dead scrolls in 18) | **~90** | `4464a842` 19 scrolls/9 dead, `b320c68b` 13/8, `27fa3ac2` 9/8, `d1807551` 14 |
| **Extraction loop after the task is already done** — `extract` returning 0 items, re-issued with ever-more-complex selectors/regex until the failure budget dies | 8 (37 calls) | **~45** | `8f80e64e` 11, `b922508886` 8, `e7f6cca9` 6, `f2be37a9` 7, `323bd85e` 3 |
| **Re-entering a form/search already entered** — same query or field typed 3-5 times after a `go_back`, a reset or a filter wipe | 11 | **~60** | `05483c50` (charity ×4, zip ×3), `b320c68b` (×5), `c09721cc` (×4), `9f1cba61` (×5), `9ef1a897`, `608c595e` (×3) |
| **Repeating the identical failing action** — same index, same args, 3-14 times; `identical-repeat`/`failed-retry` eventually refuse it | 12 | **~70** | `1ab384fb` (index 0 ×14), `b2f4fde2` (×10), `853afd53` (RADAR ×5), `199be0b5` (×6) |
| **Re-reading a page already read in full** — `read_page` on the same unchanged page 2-4 times, several truncating at 12,000 chars | 9 | **~25** | `323bd85e` 4, `f2be37a9` 6, `e7f6cca9` 4, `64b76158` 11 |
| **`find_in_page` whose hit is never acted on** — the match is found and the agent moves on, or the query is a 90-120 char literal / CSS selector / regex | 14 | **~25** | `27fa3ac2` ("term" 2 matches, ignored), `c6c9dc60` ("Leather" 2 matches, ignored), `4464a842` (121-char title), `7e6993f2` (CSS selector as query) |
| **Planner round-trips that change nothing** — `contract_complete` then 1-4 `completion_refused` on an answer the planner then accepts unchanged | 20 | ~0 steps but **60-100s and 2-7 planner calls each** | `d1970c16` (4 rounds), `644a856c` (3), `28e7574e` (2 on a task with zero actions) |
| **Superlative/qualifier asserted without the site's control** — sorting or filtering by only part of the requirement | 8 | — (causes the failure, not the steps) | `046138` (no "all time"), `c6c9dc60` (no leather/4★/price sort), `eb2db4b7` (shed ≠ hairless), `b962927d` (vinyl facet cleared), `11857213` (EU 45 ≠ US 10) |
| **Confident answer with no observation behind it** | 4 | — | `9b5dfe54` ("no access points found" — lookup never run), `b962927d` (names a record not in the grid), `c09721cc` (booking-window date as availability), `20a460a8` (reports a CAPTCHA block after the page loaded) |
| **`DOMService: Failed to remove highlights` storms** — 10-17s added per step | 5 | ~0 steps, **~300s** | `64b76158`, `7e6993f2`, `9f1cba61`, `c09721cc`, `75a1b5dc` |

## 2. The five changes that would have saved the most steps

**1. Dismiss-the-overlay as a first-class recovery, and never re-send a click the same way.**
When a click is refused with `covered by <X>` / `invisible`, the error already names the covering dialog's buttons or says
"click its visible label". Make that a forced next action: close the named overlay (or click the label / press Escape)
before anything else, and forbid re-issuing the same index until the page state changes.
Tasks: `f27b393b`, `b2f4fde2`, `b962927d`, `c181f903`, `eb2db4b7`, `64b76158`, `608c595e`, `199be0b5`, `05483c50`, `11857213`, `7562d9b4`.
**≈110 steps saved**, and it flips `b2f4fde2` and plausibly `608c595e` from fail to reachable. `c7c07ec1` shows the correct
behaviour already exists in the model's repertoire (invisible → clicked the `label`); it just is not reliably chosen.

**2. Stop the extraction loop: after one `extract` returns 0 items, fall back to `read_page` and answer from text.**
`extract` was called 37 times across 8 tasks and produced usable output **twice**. Three tasks died on the failure budget
(`8f80e64e`, `b922508886`, `323bd85e`) *after the task was already complete on screen*, and the judge passed two of them
on trajectory anyway. Cap `extract` at one attempt per page, and treat "schema names no fields" as a hard stop rather
than something to retry with a new schema.
Tasks: `8f80e64e`, `b922508886`, `e7f6cca9`, `f2be37a9`, `323bd85e`, `bbbc243b`, `c6c9dc60`, `4464a842`. **≈45 steps**, and
two task.fail → task.ok.

**3. Kill blind scrolling: no second scroll after "page height did not change", and no scroll when the page text is already read.**
211 scrolls, 56 dead, and in `4464a842`/`b320c68b` the agent scrolled a page whose `read_page` had returned 587 and 579
characters. Two consecutive dead scrolls should force a different action (read, find, or conclude the content is absent/gated).
Tasks: `4464a842`, `b320c68b`, `27fa3ac2`, `d1807551`, `199be0b5`, `7562d9b4`, `853afd53`, `608c595e`, `64b76158`. **≈90 steps**.

**4. Act on what the error message hands you — destination URLs, option lists, resolved field values.**
Three distinct wastes with one root: the agent ignores structured information in its own failure text.
(a) `853afd53`: the refusal printed `/en/br/belo-horizonte/44403/weather-radar/44403` and the agent kept clicking instead of
navigating there (≈35 steps). (b) `d1970c16`: "Option 'Texas' not found. Available options: … TX …" — one wasted step, but
the same class. (c) `3084bc22`: `fill_form` validated `passed` while the zips had autocompleted to **Chilean** postal codes;
`input_text`'s settle-check exists and `fill_form` does not run it. Give `fill_form` the same post-fill value check.
Tasks: `853afd53`, `3084bc22`, `d1970c16`, `608c595e`, `bc2ce7f2`. **≈45 steps** plus two failures fixed.

**5. Before answering, check that every qualifier in the task is expressed by a site control — and that the answer text was read off the page.**
Eight failures are not navigation failures: the agent reached the right page and answered with a requirement unapplied
(`046138` "all time", `c6c9dc60` leather/4★/cheapest, `eb2db4b7` hairless→"doesn't shed", `11857213` EU 45 for US 10,
`b962927d` vinyl facet cleared, `27fa3ac2` term/day, `4464a842` 16GB/Win11, `9b5dfe54` lookup never run). The `assert`
guard in `c7c07ec1` ("$180/mo is not on the page you are on — quote the page word for word") is exactly the right
mechanism; extend it from "is this string on the page" to "is each task qualifier visible as an applied filter/sort".
Tasks: the eight above. **0 steps saved but up to 8 FAIL → OK**, the largest accuracy win available in this shard.

*(Honourable mention, not in the top five: `step_interval` fired 150 times across 48 tasks and `completion_refused`
28 times across 20, several of them 3-4 rounds accepting the same unchanged answer — `d1970c16`, `644a856c`, `28e7574e`.
These cost wall-clock and planner tokens rather than steps, but they are the cheapest thing to trim.)*

## 3. What the agent did well — do not break it

- **Using the site's own filters and sorts for superlatives.** `05483c50` (BBB Accredited + Sort by Rating),
  `9f1cba61` (Experience High→Low), `85b284c1` (Price Low→High after two bill filters), `d9d8b7d8` (GitHub author filter),
  `da8f3823` (earliest year in the selector, then last item of a newest-first list), `9af05e39` (expressing "C and above"
  as three rating checkboxes). This is the behaviour the successes are made of.
- **`assert` with quoted page evidence before `done`.** 17 asserts across 16 tasks; `c7c07ec1` shows the full loop working —
  assert rejected → `find_in_page` → 1 match → re-assert. Keep the rejection message that demands a word-for-word quote.
- **Batching independent clicks into one step.** `85b284c1` (two filters + Apply), `7e1047f4` step 20 (four condition
  answers), `9af05e39` and `4c572a62` (`fill_form` with 3-6 fields in one action). Where this happened, step counts halved.
- **Reporting a genuine negative instead of inventing one.** `6db4a0e3` ("We can't find that tracking number"),
  `38203be6` ("No planned service changes on S92"), `4c572a62` (empty craigslist result) — all judged OK under the
  empty-result rule.
- **The safety guards fired correctly and cheaply.** `invented-data` stopped `test@example.com` going into a real form
  (`f27b393b`); `challenge-element` + `ask_human` + honest `done(false)` is the right bot-wall handling (`6ebde509`);
  `commit` asked before a 165 € add-to-cart (`11857213`); `intent-open` blocked the off-site Google hops
  (`60cbbbd5`, `7e6993f2`); `overwrite` turned a start==end date range into a working one (`a6f0434c`).
  None of these should be loosened — the failures around them are recovery failures, not guard failures.
- **New-tab following is silent and correct** (`52efbab5`, `f2be37a9`, `9af05e39`); only `3621b099` added a redundant
  `switch_tab` after the tool had already switched.
