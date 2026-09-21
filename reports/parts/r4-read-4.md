# r4 trace read — shard7 + shard8 (58 tasks)

Run: `chrome-extension/e2e/results/mind2web-r4-2953c78/`. Build 9669d1b, gemini-2.5-flash planner+navigator, maxSteps 50.

---

### `0632e496d37badee0350dad358f047c5` — browse gluten-free nut-free chocolate chip cookie recipes, cookpad.com — **task.ok / judged SUCCESS (medium conf)** — 23 steps, 173s, 395k in / 12k out tok, $0.142.
**Did:** Typed "gluten-free chocolate chip cookies no nuts" into the search box (submit:true) → results page (53 hits) → nine `extract` calls with hand-written CSS selectors, four `read_page`, two `find_in_page` → `save_findings` of page-1 titles/URLs → clicked "Next" → repeated the same extract/read/find cycle on page 2 → `save_findings` → two scrolls → `done`.
**Went wrong:** nothing — succeeded. (Weakness only: the nut-free constraint went into the free-text query rather than cookpad's "Exclude" keyword box, per the judge.)
**Wasted:** 9 `extract` calls all returning "Extracted 0 items from the page" (the selectors never matched — the agent kept re-guessing `a`, `a[href*="/eng/recipes/"]`, `h2 > a`, then the same selector 4 more times); 1 refused `input_text` on a stale index at t=16.6s ("[12] is not on the current page"); 2 terminal `scroll` calls after the answer was already saved; 4 `step_interval` replans on a task that never changed plan. ~13 of 23 steps bought nothing.
**Could have been:** search → `read_page` on results → `save_findings` → click Next → `read_page` → `done`. ~6 steps.

### `11abb668c751dd56bb41f296a8bb3a13` — find Apple-authorized store near 30010 and set as my store, bestbuy.com — **task.ok / judged SUCCESS (high)** — 23 steps, 284s, 224k in / 3.4k out, $0.060.
**Did:** From the homepage it hunted for the store locator by clicking and scrolling, went to the wrong place twice (`go_back`, two `go_to_url` back to bestbuy.com), finally reached the locator, typed 30010, clicked Update, opened "Filter by services", checked "Apple Authorized Service Provider", clicked Show Results, clicked "Make This Your Store" on Northlake.
**Went wrong:** nothing — succeeded. The end state is verified in the screenshots (Northlake card reads "Your store").
**Wasted:** steps 0-13 are a 14-step hunt for the store locator: 5 `scroll`, 2 `go_back`, 2 `go_to_url` resets to the homepage, and an `input_text` of "30010" into the wrong (product search) box at step 6 followed by another at step 14. Plus 24 rate-limit retries (`rl=24`) that added ~80s of the 284s wall clock with zero steps.
**Could have been:** `go_to_url https://stores.bestbuy.com/` (or the locator link) → type 30010 → filter by service → Make This Your Store. ~4-5 steps; the reference length is 10.

### `1aeca99e6a60b0e3aefb3ef212bdce79` — full-time legal jobs in San Diego County, $4,000+/mo, ca.gov (CalCareers) — **task.fail / judged FAIL (high)** — 37 steps, 323s, 414k in / 24k out, $0.198.
**Did:** Navigated to calcareers.ca.gov, dismissed an alert banner, opened Advanced Job Search, typed "legal occupation", typed "San Diego County" into the location field, then spent the remaining 26 steps trying to set Work Type = "Permanent". Never clicked Search; ended on max failures.
**Went wrong:** step 8 — `select_dropdown_option {"index":36,"text":"San Diego County"}` → `Option "San Diego County" not found after opening the dropdown`, and then step 11/20 the same on Work Type: `Option "Permanent" not found. Available options: "Retired"`. The perception read a custom multi-select widget as a `<select>` with one option, so every subsequent attempt was doomed; the agent never switched strategy.
**Wasted:** steps 13-36 are a pure oscillation — `click_element 54` / `click_element 53` alternating **12 times** (open/close the same dropdown), 5 `find_in_page {"query":"Permanent"}` that returned nothing actionable, 3 `click_element 38` refused with "The element has no visible area", 3 `progress_stall` replans + 5 interval replans that all re-issued the same plan. ~28 of 37 steps bought nothing.
**Could have been:** the CalCareers advanced search is a plain GET form; open it, set the three fields, click Search Jobs. ~6 steps. Even from the observed page, after the second `Option not found` the agent should have clicked the listbox option element directly instead of re-calling `select_dropdown_option`.

### `23204728192da9f73197a613d9681c18` — symptoms and causes of fever, mayoclinic.org — **task.ok / judged SUCCESS (high)** — 7 steps, 84s, 94k in / 1.3k out, $0.028.
**Did:** Typed "fever" in site search (submit) → cookie banner blocked the result link → clicked the banner dismiss (index 109) → clicked the Fever result → `read_page {"section":"Symptoms"}` → `read_page {"section":"Causes"}` → `done`.
**Went wrong:** nothing — succeeded. The sectioned `read_page` is exactly the right tool here.
**Wasted:** 1 refused click at step 1 ("The element is covered by `<div>`; close or move past it first") costing the extra cookie-dismiss step; ~26s idle before the first action and ~13s after the refusal, both from 6 rate-limit retries. Only ~1 wasted step.
**Could have been:** cookie banner dismissed proactively on page load, then search → click → 2 sectioned reads → done. 5 steps.

### `29b7372d5a3884a2ba831af2d117af3c` — browse the first top news of MSFT, google.com/finance — **task.ok / judged SUCCESS (high)** — 5 steps, 125s, 57k in / 1.3k out, $0.019.
**Did:** Tried to type into the search `<div>` wrapper, retried into the real input (index 72), opened NASDAQ:MSFT, scrolled down then back up, clicked the first news headline.
**Went wrong:** nothing — succeeded.
**Wasted:** step 0 `input_text` refused — "A `<div>` does not accept text; type into an input, textarea or editable element" — the AX read offered the combobox wrapper before the input; and a `scroll down` / `scroll up` pair (steps 2-3) that returned to the same viewport. 3 of 5 steps were overhead. Wall clock 125s for 5 steps: 14 rate-limit retries.
**Could have been:** type into the search input → open MSFT → click the first news item. 3 steps.

### `330cd04c773ac498f51afa4665461ec8` — browse couches for sale, sort cheapest, titles only, craigslist.org — **task.ok (agent) / judged FAIL (high)** — 23 steps, 658s, 211k in / 6.6k out, $0.072.
**Did:** craigslist geolocated to India; the agent clicked into a region, went back, picked another, searched "couches" in for sale, ticked "search titles only", tried the sort control, then repeated the whole city → search → titles-only → sort cycle for Pune, Mumbai, Surat, Ahmedabad and Indore, all empty, and answered "no couches found".
**Went wrong:** step 5-6 — it clicked what it thought was the sort control and got `The element is covered by <div> "price free ₨ – ₨ apply"`, i.e. it had opened the **price filter popup, not the sort dropdown**. It never noticed; the judge confirms "the sort dropdown still reads 'relevance' in every screenshot". It then treated empty results as the finding instead of re-checking the region.
**Wasted:** steps 11-22 are the same four-click sequence (`15 → 36 → 48 → 50`) repeated across **4 more cities**, ~12 steps, none of which could change the outcome since the sort was never applied; plus `click_element 7` validated `unknown — the page did not visibly change`. 78 rate-limit retries made this the slowest task in the shard at 658s for 23 steps (28s/step).
**Could have been:** switch region once (craigslist has a "nearby cl" / site list), search "couch", tick titles-only, pick `price ↑` in the **sort** select. ~5 steps; reference length is 6.

### `3dca7cbe7d086619d837ff9f5312cebc_110325` — Zara Home → rug, filter beige, zara.com/us — **task.fail (max failures) / judged FAIL (high)** — 29 steps, 987s, 346k in / 11k out, $0.124.
**Did:** Opened the hamburger menu (index 0), clicked ZARA HOME, closed and reopened the menu repeatedly, scrolled the menu panel, ran `find_in_page {"query":"rug"}` three times and `read_page` twice, never reached a rug listing. Ended on max failures after a chain of LLM timeouts.
**Went wrong:** step 2 — after clicking ZARA HOME at step 1 it clicked index 0 again, closing the menu it had just opened; from there the run is a menu open/close loop. The agent never tried the obvious alternative of a direct URL or the site search box.
**Wasted:** `click_element 0` (menu toggle) 4 times, `scroll {"direction":"down","index":14}` 5 times (one validated `unknown — No change was visible after scrolling the element`), `find_in_page "rug"` 3 times with the same query, plus **34 LLM timeouts** and 62 rate-limit retries that account for roughly 600 of the 987 seconds. ~22 of 29 steps bought nothing.
**Could have been:** site search "rug", or `go_to_url` the ZARA HOME rugs category, then click the beige swatch in the colour filter. ~4 steps; reference length is 5.

### `461ab9b0c7b20ac5f912704480979c65` — NYSE Rule 605 Market Center Files, July 2024, nyse.com — **limit_tokens (cancelled) / judged FAIL (high)** — 49 steps, 412s, **721k in** / 17k out, $0.249.
**Did:** Opened the NYSE Rule Filings page, set Year=2024, typed "Rule 605 Market Center Files" into its filter → "No data found", then bounced between Rule Filings and the Market Data catalog for 40 more steps and was cancelled at the 500k input-token cap.
**Went wrong:** step 7 — it searched for the file name inside the **Rule Filings** table, which lists rule filings, not data files. "No data found" was the correct answer for that table; the agent read it as a UI problem and kept clearing and re-typing the same query instead of leaving the page.
**Wasted:** `input_text {"index":17,"text":"<0 characters>"}` (clearing the box) 5 times, `click_element 16` 6 times, the identical 28-char query typed 4 times, 9 `scroll` steps, one `go_back` that `failed — Navigation produced no observable URL or document change`, a `Node is detached from document` failure plus a `failed-retry` guard refusal for re-sending it. At step 34 it went back to nyse.com and restarted the *same* Rule Filings route it had already exhausted. ~35 of 49 steps bought nothing.
**Could have been:** NYSE publishes Rule 605 files under Market Data → Data Products; one `go_to_url` to the NYSE market-data page, follow "Rule 605", pick July 2024. ~5 steps; reference length is 5. A hard rule — "a site search that returns 'no results' twice means the wrong page, change page" — would have ended the loop at step 13.

### `4e0f5561a76478da87995dee00b09572` — monthly weather forecast for Florida City, accuweather.com — **task.ok / judged SUCCESS (medium)** — 5 steps, 120s, 67k in / 0.9k out, $0.020.
**Did:** Typed "Florida City" into search (submit) → clicked the "Florida City, FL US" suggestion → clicked the MONTHLY tab → an interstitial swallowed the click → clicked the interstitial close (index 120) and the monthly calendar was shown.
**Went wrong:** nothing — succeeded, though the answer quotes averages that differ from the on-screen calendar values (judge: "stated slightly differently").
**Wasted:** 1 stale-index refusal at t=41.4s ("[1] is not on the current page") and 1 click lost to the interstitial — `unknown — the page stayed at the same address: an overlay or interstitial probably intercepted the click` — costing a recovery step. 2 of 5 steps were overlay overhead; 12 rate-limit retries pushed a 5-step task to 120s.
**Could have been:** search → pick suggestion → Monthly tab. 3 steps, if the interstitial were dismissed automatically.

### `59912927c1fddee6ded8a49986896bc2_070826` — most useful reviews of highest-rated anti-reflective 55-64in TVs, samsung.com — **task.ok (agent) / judged FAIL (high)** — 20 steps, 218s, 388k in / 8.7k out, $0.132.
**Did:** Opened the TV category, accepted cookies, opened the Screen Size filter and ticked **55in and 65in**, ran `find_in_page {"query":"anti-reflective"}` (no match), sorted Highest Rated, opened the 65in S90H OLED, sorted reviews by Most Helpful and read them.
**Went wrong:** step 5-10 — the size filter. It ticked `1.63 m (65)`, outside the 55-64in band, and left the in-range `1.46 m (58)` unchecked; and after `find_in_page "anti-reflective"` returned nothing it simply dropped that requirement instead of opening the Features filter, where the judge says the option lives. Everything after step 10 is on the wrong product set.
**Wasted:** 7 `scroll down` steps hunting filter panels, 1 cookie-banner refusal, and 3 planner `completion_refused` round trips at step 20 (10 planner calls total for 20 steps) that re-planned a finished, wrong answer.
**Could have been:** category → Screen Size 55 + 58 → Features → anti-glare → sort Highest Rated → open top product → sort reviews Most Helpful. ~8 steps; reference length is 14, so the route length was fine — the filter *selection* was the failure.

### `6174e5ddd40cfbdc33ee1502f40bac39` — day-use park with horseback riding near Nashville, recreation.gov — **task.ok (agent) / judged FAIL (high)** — 45 steps, 401s, 578k in / 16k out, $0.196.
**Did:** Searched "horseback riding near Nashville" in the free-text box, then spent 40 steps toggling the filter panel (indices 15, 22, 23, 101, 120, 122) — opening and closing the same facets — and finally clicked "View 21 Results" from an **unfiltered** set and opened Mammoth Cave NP (Kentucky) as the answer.
**Went wrong:** step 6 — `click_element {"index":22}` → `The element has no visible area: it is hidden, or inside a collapsed section`. That was the Day Use checkbox inside a collapsed facet; instead of opening the facet, the agent retried the same hidden index repeatedly. The judge notes it *did* have Day Use checked around step 35 with 10 valid results, then cleared it again at step 38.
**Wasted:** **8 `invisible` guard refusals** (`click_element 22`/`101` re-sent 8 times), 1 `disabled` refusal, `click_element 15` (the filter toggle) pressed **9 times**, 9 `scroll down`, 2 `go_back`, 8 interval replans. ~35 of 45 steps bought nothing, and the one moment it had the right filter set it undid.
**Could have been:** search "Nashville", tick Day Use in the booking-type facet, tick Horseback Riding in the activity facet, read the first result. ~5 steps; reference length is 6.

### `65c4030f22fb6eb101acfee4825f1318` — female MD cardiologist in Jacksonville FL, mayoclinic.org — **task.ok / judged SUCCESS (high)** — 12 steps, 250s, 159k in / 3.2k out, $0.052.
**Did:** Cookie banner covered the "Find a doctor" link → dismissed it → opened Find a doctor → typed "Cardiologist" → picked the "Jacksonville, FL" location option → Search → scrolled, checked for a gender filter with `find_in_page "gender"` (none exists) → read the list → opened Mays T. Ali, M.D.
**Went wrong:** nothing — succeeded. Checking for a gender facet before falling back to reading names/photos was the right call.
**Wasted:** 1 covered-element refusal costing the banner-dismiss step; 2 `scroll down` before `read_page` that the read would have covered anyway. 3 of 12 steps. 30 rate-limit retries turned 12 steps into 250s (notably a 50s stall at step 4 and 42s in the final verification planner call).
**Could have been:** dismiss banner → Find a doctor → specialty + location → Search → open the first female result. ~6 steps; reference length is 8.

### `7072d09436972a5d5fe7476e3e9f1559` — compare first two personal cards with no foreign transaction fees, americanexpress.com — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 453s, 541k in / 13k out, $0.163.
**Did:** Opened the personal cards listing, then for 45 steps repeated: open a card's "Learn More" or "Schedule of Fees and Charges" → `find_in_page "foreign transaction fees"` → no match → `go_back`. Never identified two qualifying cards, never opened the compare view. Cancelled at the 50-step cap.
**Went wrong:** step 3 — `find_in_page {"query":"foreign transaction fees"}` on the listing page returned nothing, and the agent concluded the information must be behind each card's detail page rather than using Amex's own "No Foreign Transaction Fees" **filter/benefit facet** on the listing. Every later step inherits that decision.
**Wasted:** `go_back` **11 times**, the identical `find_in_page "foreign transaction fees"` **4 times** always with no match, 8 `scroll`, a stray `switch_tab close` + a `go_back` that failed with `History entry to navigate to not found`, and 8 interval replans that never changed the strategy. ~40 of 50 steps bought nothing.
**Could have been:** listing → apply the "no foreign transaction fee" benefit filter → tick the first two cards → Compare. ~5 steps; reference length is 10.

### `7680a920359cb1a508fbddb001b98167` — child height prediction, babycenter.com — **task.ok / judged SUCCESS (high)** — 9 steps, 87s, 98k in / 2.6k out, $0.034.
**Did:** Consent dialog covered the tool link → clicked consent → opened the Child Height Predictor → chose girl and "7 years" → `fill_form` with all seven fields in **one action** (4/0 height, 55 lbs, 5/2 mother, 5/8 father) → Calculate → `assert` the result → `done`.
**Went wrong:** nothing — succeeded. This is the cleanest run in the shard: `fill_form` collapsed what would otherwise have been 7 `input_text` steps, and the `assert` gave the planner explicit evidence for the verification.
**Wasted:** 1 covered-element refusal costing the consent-dismiss step. 1 of 9.
**Could have been:** 8 steps — essentially what it did. Reference length is 11, so the agent beat the human trajectory.

### `8103786e0e5976ebf961bd062d5f39cd` — causes of sharp chest pain with anxiety, mayoclinic.org — **task.ok / judged SUCCESS (high)** — 10 steps, 192s, 117k in / 2.2k out, $0.037.
**Did:** Typed "chest pain in adults" in search → cookie banner covered the result → dismissed it (index 127) → opened the Symptom Checker → picked "Sharp" → picked "Anxiety" → "Find causes" → `extract` the causes list → answered.
**Went wrong:** nothing — succeeded; it used the site's own symptom-checker wizard rather than reading prose, which is what the task wanted.
**Wasted:** 1 covered-element refusal (the cookie banner again) costing 1 step; 16 rate-limit retries stretched 10 steps to 192s, including a 25s wait before the first action and a 42s gap at step 7.
**Could have been:** 8 steps if the banner were auto-dismissed. Reference length is 9.

### `864244b6969e0f8733b0eb1ca06cd51f` — race time of the 2023 F1 finale winner, espn.com — **task.ok / judged SUCCESS (high)** — 7 steps, 49s, 111k in / 1.5k out, $0.036.
**Did:** ESPN → F1 → Calendar & Results → `select_dropdown_option "2023"` → two scrolls to the end of the calendar → opened the Abu Dhabi GP → `assert` the winning time 1:27:02.624 → done.
**Went wrong:** nothing — succeeded, and it is the fastest task in the shard (49s, 7 steps, zero rate limits).
**Wasted:** essentially nothing; the two scrolls were needed to reach the season's last row.
**Could have been:** 6 steps (`scroll {"direction":"bottom"}` instead of two downs). Reference length is 6 — the agent matched it.

### `92160852a6bbbc165cee4e14ab0b1d59` — flat-rate cost of a common medium box vs other carriers, ups.com — **task.ok (agent gave up) / judged FAIL (high)** — 27 steps, 233s, 301k in / 11k out, $0.119.
**Did:** Opened Calculate Time and Cost, `fill_form`ed Atlanta 30303 → New York 10001 in one action, then spent 20 steps trying to press Update/Continue, which a sticky "Hello there! Create a profile…" header covered. Finally answered that it could not proceed.
**Went wrong:** step 6 — `The element is covered by <header> "Hello there! Create a profile and receive access to:"`. The agent never closed that header. It tried `scroll up`, `scroll down`, `scroll top`, `send_keys Escape`, `click_element {"hover":true}` and a `go_back`, but not the header's own dismiss control, and never tried scrolling the *form container* so the button left the header's band.
**Wasted:** 5 `invisible` + 2 `covered` guard refusals on indices 43/83/0 re-sent repeatedly; the origin/destination form re-typed a **second time** at steps 20-22 as four separate `input_text` after `fill_form` had already worked at step 4; 6 `scroll`; 2 `validation` replans and 2 `completion_refused` round trips at the end. ~22 of 27 steps bought nothing.
**Could have been:** a sticky-header-aware click (scroll the target clear of fixed overlays, or dismiss it) would have made this ~6 steps: open calculator → fill origin/destination → Continue → pick medium flat-rate box → read rate → compare panel.

### `9c04b71bb8db6cf8e743b2290cbc8797` — UPS drop-off point near Miami FL, ups.com — **task.ok / judged SUCCESS (high)** — 30 steps, **631s**, 324k in / 6.8k out, $0.103.
**Did:** Tried the header location widget, typed city/zip into it several times with no result, hit a cookie dialog and an invisible control, then at step 18 `go_to_url` back to the UPS home, opened "Find Closest UPS Location", typed Miami + 33101, pressed Look Up, saved and reported the five nearest drop-off points.
**Went wrong:** nothing — succeeded, but only after the step-18 reset. The first 18 steps on the header widget were a dead end.
**Wasted:** steps 1-17: `input_text {"index":101}` **3 times** with different strings, `click_element` on 103/104/105/106/108 probing the same widget, `click_element 1` refused **twice** as invisible, 1 cookie-dialog refusal, 1 `failed-retry` refusal, 1 `unknown — the page did not visibly change`. ~17 of 30 steps. **72 rate-limit retries** account for most of the 631s (21s/step).
**Could have been:** `go_to_url` the UPS location finder, type Miami FL, Look Up, read results. ~4 steps; reference length is 6.

### `a0a18ca6a3529f3e97c771aadd42d3a0_110325` — add best-selling men's L short-sleeve Halloween T-shirt to cart, jcpenney.com — **task.ok / judged SUCCESS (medium)** — 28 steps, 508s, 501k in / 6.3k out, $0.163.
**Did:** Opened the men's department by menu, ran `find_in_page "Men"`, then `go_to_url` straight to a `/g/men?...` listing URL, applied the Short Sleeve, Large and Halloween facets and `sort=BS`, opened the top Batman graphic tee, chose Large, Add to Cart, confirmed the cart panel.
**Went wrong:** nothing — succeeded. The one blemish the judge notes is an extra, unrequested `s1_deals_and_promotions=SALE` filter that came in with the URL it typed at step 7.
**Wasted:** steps 0-6 (menu click ×2, 2 scrolls, 2 clicks, a 5s `find_in_page "Men"`) were replaced wholesale by the step-7 `go_to_url`; 3 more `scroll down` and a `find_in_page "Large"` at steps 14-17 that the facet panel answered anyway; 5 LLM timeouts and 38 rate-limit retries cost ~180s. ~10 of 28 steps.
**Could have been:** `go_to_url` the men's T-shirt listing → 3 facet clicks → sort Best Sellers → open first → size L → Add to Cart. ~8 steps; reference length is 12.

### `a8b9edd598561d2de901864d5f40fe67` — shipping cost for a 4 lb package TX → NY, fedex.com — **task.ok / judged SUCCESS (high)** — 20 steps, 145s, 180k in / 4.0k out, $0.057.
**Did:** Opened "Get a quote", scrolled to the form, typed "Texas" in the origin, hit the `user-value` guard when it tried to overwrite it, **asked the user for a Texas ZIP**, used the answer (78701), filled destination NY, continued, entered weight 4, clicked SHOW RATES and read the rate table.
**Went wrong:** nothing — succeeded. The `user-value` guard firing here is the system working as designed: it stopped the agent silently substituting its own ZIP for the user's "Texas" and routed it to `ask_human`.
**Wasted:** 5 `scroll down` finding the form fields; the `ask_human` round trip cost 2 steps + a `human_needed` replan, arguably avoidable since the field itself accepts a state name with a city. ~6 of 20 steps.
**Could have been:** quote form → origin (city+state) → destination → weight → Show Rates. ~6 steps; reference length is 9.

### `b3a7da968de13bbdcaed12ffe4993df6` — compare Afghan Hound, Akita and Azawakh, akc.org — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 478s, **651k in** / 25k out, $0.266.
**Did:** Opened the Compare Breeds page, typed "Afghan Hound" into a breed combobox and clicked the suggestion — which never registered — then repeated the type/clear/type/click cycle across three slots for 45 steps, never pressed COMPARE BREEDS, ended at the step cap on the AKC home page.
**Went wrong:** step 2 — `click_element {"index":45}` validated `unknown — click_element was sent, but the page did not visibly change`. The AKC breed picker is a JS autocomplete whose option only commits on a keyboard/`mousedown` sequence; the CDP click landed but selected nothing. The agent got **9 identical "page did not visibly change"** verdicts and never changed technique (e.g. `select_dropdown_option`, arrow keys + Enter, or the per-breed URL).
**Wasted:** `input_text {"index":45}` with the same 12-char breed name **5 times** plus 3 clear-to-empty writes; `click_element 43/46/47` re-sent **8 times** after the same unknown verdict; 11 `scroll`; 9 interval replans; 2 covered-element refusals from the sticky nav. ~42 of 50 steps.
**Could have been:** AKC's compare tool takes breeds in the URL, or three keyboard selections; realistically ~8 steps. Reference length is 9. The fatal gap is that `unknown — page did not visibly change` never escalates to a different interaction method.

### `b99c02965196d51e80ac7539e33f335b` — graduate CS courses, Tuesdays 2-6 PM, Fall 2023, berkeley.edu — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 386s, 621k in / 13k out, $0.188.
**Did:** Searched berkeley.edu, clicked through Graduate Division → EECS → CS course pages, scrolled and `find_in_page "schedule"` repeatedly, `go_back` each time, and at step 48 found only "No match for Fall 2023" on the current (Fall 2026) class schedule. Cancelled at the step cap with no answer.
**Went wrong:** steps 3-8 — it entered the departmental/marketing pages instead of `classes.berkeley.edu`, the only place where term + day + time filters exist. Nothing in the next 42 steps could have produced an answer from those pages.
**Wasted:** `go_back` **9 times**, `find_in_page "schedule"` **4 times** with the identical query on four different pages, **16 `scroll down`**, one `go_back` that failed outright, a `switch_tab` recovery, 7 interval replans. ~44 of 50 steps.
**Could have been:** `go_to_url https://classes.berkeley.edu/` → set term Fall 2023 → filter Computer Science + Graduate + Tuesday + start time → read the list. ~6 steps; reference length is 9. (Archived terms may not be reachable, in which case the right move was to report that within ~8 steps rather than spend 50.)

### `bd1e3770b7181f6fce9c35e18caa9785` — browse solar panel installer services, hide duplicates, craigslist.org — **task.ok / judged SUCCESS (medium)** — 8 steps, 284s, 84k in / 1.4k out, $0.027.
**Did:** Clicked into a region, `go_back`, clicked "services", searched "solar panel installer", `wait_for text_gone "retrieving"`, ticked "hide duplicates", clicked apply, reported no results (craigslist geolocated to Pune).
**Went wrong:** nothing — the judge accepts an honestly empty result because both required actions were performed and the task named no location.
**Wasted:** the step-0 click + `go_back` pair (2 steps) exploring a region it then abandoned; the apply click at step 6 validated `unknown — the page did not visibly change` (the filter was already live). 46 rate-limit retries turned 8 steps into 284s — 80s before the first action alone.
**Could have been:** services → search → tick hide duplicates. 3 steps; reference length is 3.

### `c39d6c245f8243993e707d54d2f4acec` — browse the final skin for Ahri, leagueoflegends.com — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 383s, 434k in / 18k out, $0.158.
**Did:** Navigated to Ahri's champion page and its skins carousel, then clicked the right arrow (`click_element {"index":23}`) ~20 times, interleaving a `save_findings` after nearly every click to log the current skin name and the running list. Cancelled at the step cap without naming a final skin.
**Went wrong:** step 4 onward — it treated the carousel as something to walk one frame at a time. The skin names are all in the page DOM; a single `read_page` or a correct `extract` at step 4 would have returned the whole list. At step 32 it did try `extract` with `{"type":"array","items":{"type":"string"}}` and got `failed — schema names no fields: give an object schema with properties`; after that one schema rejection it gave up on extraction and went back to clicking.
**Wasted:** **~20 `click_element 23`** arrow presses and **~16 `save_findings`** calls that re-wrote the same growing list (steps 10-37 alternate click/save), 25 `not_applicable` validations, 9 interval replans, 4 LLM timeouts. ~45 of 50 steps.
**Could have been:** open Ahri's page → `read_page` or `extract` the skins list → name the last entry. ~4 steps. (Reference length is 18, so the human trajectory also clicked through — but the page text made that unnecessary.) Two fixes apply: `save_findings` should not be spent once per item, and a rejected `extract` schema should be auto-repaired rather than abandoned.

### `c801d1c951f59297f526bab84fa86c6e` — latest negative reviews, 100h+ players, 2023 VR GOTY winner, store.steampowered.com — **task.ok (gave up) / judged FAIL (high)** — 4 steps, 46s, 100k in / 3.3k out, $0.043.
**Did:** Typed "VR Game of the Year 2023" into Steam search, ran it, scrolled once, then `ask_human "What is the name of the game that won the 2023 VR Game of the Year Award?"` and, on the answer, gave up anyway.
**Went wrong:** step 3 — it asked the user after **one** search and **one** scroll. Steam's own 2023 awards page lists the VR GOTY winner, and the store search supports the "Steam Awards" tag; neither was tried. This is the opposite failure mode to the 50-step loops: it abandoned a solvable task in 4 steps, and then even after the human answer arrived it still refused.
**Wasted:** nothing repeated — the waste here is the *whole run*, 4 steps and 8 LLM calls producing no progress, plus a `completion_refused` round trip on a give-up answer.
**Could have been:** `go_to_url` the Steam Awards 2023 page (or search "Steam Awards VR") → open the winner → Reviews → set Negative + Playtime >100h + Most Recent. ~6-7 steps; reference length is 11.

### `d392e154c1c6ffbb26e2331c3afafc67` — add a $100 birthday gift card to cart, bestbuy.com — **task.ok (gave up) / judged FAIL (medium)** — 11 steps, 233s, 169k in / 5.3k out, $0.065.
**Did:** Searched "best buy gift card", opened the $100 Yellow Tag card (page failed with ERR_HTTP2_PROTOCOL_ERROR), went back, `ask_human` to choose between two $100 cards, then opened the Any Occasion gift-card listing, applied the $100-149.99 price filter, scrolled twice, `read_page` found no tiles and it reported "the page is protected by reCAPTCHA".
**Went wrong:** step 1-4 — the product page returned a protocol error and the agent never retried the load (`go_to_url` the same URL, or a reload). It then mis-diagnosed empty product tiles as a reCAPTCHA block; the judge confirms no bot-check page was ever shown. It also chose the "Any Occasion" facet rather than a birthday occasion.
**Wasted:** a `Node is detached from document` failure (1 step), an `ask_human` round trip that changed nothing (2 steps + a `human_needed` replan), 2 scrolls on an empty listing, 2 LLM timeouts and 20 rate-limit retries (233s for 11 steps).
**Could have been:** gift cards → Birthday occasion facet → $100 denomination → Add to Cart. ~5 steps; reference length is 6. A single reload on the HTTP2 error would probably have finished it.

### `dcd26e662a616d373ddd339747c6ce5b` — Healthline weight-management quiz → motivating article, healthline.com — **task.ok / judged SUCCESS (high)** — 40 steps, 280s, 365k in / 10k out, $0.116.
**Did:** Found the quiz under Tools, then answered every question by clicking options (support system, joys: cooking/family/travel, exercise none, eats out most of the time, struggles: portion control + cravings), reached the results page and opened "16 Ways to Motivate Yourself to Lose Weight", `read_page` for the tips.
**Went wrong:** nothing — succeeded, and it mapped a messy free-text profile onto the right multi-select answers, which is the hard part.
**Wasted:** steps 0-4 (3 scrolls + `find_in_page "quiz"`) before finding Tools; a `Node is detached from document` failure at step 25 followed by a `find_in_page` + `go_back` recovery (3 steps); steps 29-37 re-answer questions the quiz had already taken, suggesting the back-navigation reset it. ~10 of 40 steps.
**Could have been:** Tools → Weight Management quiz → ~10 answer clicks → result → open article → read. ~15 steps; reference length is 22, so the agent was already under the human trajectory.

### `eb323dc584156d0eb3a2b90bb8c4b791_110325` — cheapest 2-bed 3+-bath rental in New York, compass.com — **limit_tokens (cancelled) / judged FAIL (high)** — 31 steps, **741s**, 633k in / 12k out, $0.221.
**Did:** Searched New York rentals, opened the filter panel, set Beds "2" and Baths "3+" (leaving Beds as "2 – No Max"), never pressed "See 630 Homes", then tried to read prices off an unrendered list with `read_page` ×3, `extract` ×4 and a regex `find_in_page`, and hit the token cap.
**Went wrong:** step 19 — after setting the two facets it marked the todo "2 beds" complete and moved to reading results **without applying the filter**; the judge's final screenshot shows the unpressed "See 630 Homes" button. Every later read was of an empty list.
**Wasted:** `click_element {"index":16}` (the filter dropdown) **5 times**; two `extract` calls rejected back to back with `schema is not valid JSON (Bad escaped character…)` because the model kept putting a regex `pattern` with `\$` into the schema, then two more corrected-but-empty extracts; a `find_in_page` whose query was a raw regex; 2 `unshown-index` refusals; **84 rate-limit retries** (the most in the shard, ~400s of the 741s). ~20 of 31 steps.
**Could have been:** search → Beds exactly 2 → Baths 3+ → Apply → Sort by price ascending → read the first card. ~6 steps; reference length is 15.

### `f389398d2eeb29e5571e00439c57eb76` — latest climate news, theweathernetwork.com — **task.ok / judged SUCCESS (high)** — 5 steps, 169s, 62k in / 1.3k out, $0.021.
**Did:** NEWS → consent banner → Climate → `read_page` → `save_findings` → answered with the three lead stories and their URLs.
**Went wrong:** nothing — succeeded; a minimal route.
**Wasted:** essentially no steps. But 24 rate-limit retries produced **48s before the first planner call** and a 39s final verification; a 5-step task took 169s, ~34s/step, the worst step latency in the shard.
**Could have been:** exactly what it did, 5 steps; reference length is 3 (the `save_findings` before `done` was redundant given the answer followed immediately).

### `07bdc595306729a028ba06cc7451a80a` — select a Shanghai→Beijing high-speed train before 23:00, us.trip.com — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 428s, 559k in / 20k out, $0.209.
**Did:** Opened the Trains section, was blocked by a "Sign in to access member rates" overlay and an "Install app" dialog, filled the route, reached a results page, then clicked indices 83/84/85/86/19 in rotation for ~30 steps. Cancelled at the step cap on a sign-in page.
**Went wrong:** step 4 — `input_text` refused with `The field is read-only: the page fills it through its own control (a picker, a list, a pair of buttons)`. It recovered, but from step 15 it entered a click cycle on the filter/sort strip (83-86) that never validated as progress, and at step 43 it tried to `go_back` off the correctly filtered page and hit the `leave-applied` guard: *"this page shows from Shanghai … to Beijing applied, and going back removes it."*
**Wasted:** `click_element` on 83/84/85/86 repeated **19 times** across steps 15-48, `click_element 19` 5 times, 2 covered-element refusals, a `go_back` that failed with `History entry to navigate to not found`, 6 interval replans. ~35 of 50 steps.
**Could have been:** trains search → Shanghai → Beijing → date → tick the "high speed (G/D)" type → pick a departure before 23:00. ~7 steps; reference length is 7. The `leave-applied` guard fired correctly but arrived after 40 wasted steps — the same signal earlier would have stopped the loop.

### `1223b07536a87e0170ff87cbbebd1d3c` — 10-question multiplication quiz (11-12), perfect score, coolmath4kids.com — **task.ok / judged SUCCESS (high)** — 28 steps, 182s, 229k in / 4.2k out, $0.063.
**Did:** Opened the multiplication quiz, set facts 11-12 / 10 questions / Unlimited time via three `select_dropdown_option` calls, then answered all ten questions as `input_text` + submit-click pairs, and `assert`ed "10 out of 10".
**Went wrong:** nothing — succeeded with a perfect score.
**Wasted:** the answer/submit split costs 2 steps per question (20 steps for 10 answers); `input_text {"submit":true}` would have halved that. One `completion_refused` round trip at the end.
**Could have been:** 3 dropdowns + start + 10 submitting inputs + assert = ~15 steps; reference length is 24, so it already beat the human trajectory.

### `1b867afecf072cb877ebfa4069263746` — figure comparing unemployment among women, IL vs MI, americashealthrankings.org — **task.ok / judged SUCCESS (medium)** — 9 steps, 60s, 106k in / 1.9k out, $0.033.
**Did:** Explore → measures → searched "unemployment" → opened Unemployment – Women → picked Illinois → opened State Comparison → added Michigan → `view_screenshot` to confirm the chart → done with the comparison URL.
**Went wrong:** nothing — succeeded. Using `view_screenshot` to confirm a *visual* deliverable before claiming done is exactly right for a "display the figure" task.
**Wasted:** 1 `Node is detached from document` failure and 1 stale-index refusal, costing ~2 steps.
**Could have been:** 7 steps; reference length is 15 — the second-best margin in the shard.

### `239a29bde438fe44fe17fe1390ef1634` — gluten-free weight-loss diet for a pregnant woman, healthline.com — **task.ok / judged SUCCESS (medium)** — 9 steps, 241s, 113k in / 2.5k out, $0.038.
**Did:** Site search with the whole task sentence → opened "How to Safely Lose Weight During Pregnancy" → `go_back` → opened "The Gluten-Free Diet: A Beginner's Guide" → 3 scrolls → `find_in_page "Can you lose weight by going gluten-free?"` → answered that the site has no article combining all three conditions.
**Went wrong:** nothing — succeeded; reporting the honest absence with the evidence is the right outcome for an unsatisfiable query.
**Wasted:** the step-2 open + step-3 `go_back` (2 steps) on an article it discarded; 3 `scroll down` before the `find_in_page` that answered the question. 28 rate-limit retries → 241s for 9 steps, including a 54s stall at step 3 and a 43s one at step 4.
**Could have been:** search → open the gluten-free guide → `find_in_page` the weight-loss section → answer. 4 steps; reference length is 8.

### `2c20d87a046fadcb6ff07ee877bfbf37` — open Form 8843 for tax year 2022, irs.gov — **task.ok / judged SUCCESS (high)** — 14 steps, 200s, 150k in / 2.4k out, $0.044.
**Did:** Forms & Instructions → search "8843" → a cover element blocked the result → dismissed it → opened the form page → scrolled to prior revisions → opened the 2022 PDF.
**Went wrong:** nothing — succeeded, landing exactly on `irs.gov/pub/irs-prior/f8843--2022.pdf`.
**Wasted:** 1 covered-element refusal (1 step) and **4 `scroll down`** hunting the prior-year table; 20 rate-limit retries produced a 45s stall at step 3 and a 31s one at step 5. ~5 of 14 steps.
**Could have been:** search 8843 → open form page → prior-year row 2022. ~5 steps; reference length is 8.

### `33bd2cdcea4fcc42a09a8a1e4e5841c6_110325` — order Box Combo + Kids Combo for pickup near ZIP 10001, raisingcanes.com — **task.ok (false answer) / judged FAIL (high)** — 11 steps, 88s, 100k in / 4.8k out, $0.043.
**Did:** `go_to_url order.raisingcanes.com`, typed 10001 in the store picker, clicked the search button — which never did anything — scrolled, clicked around, typed 10001 again, clicked again, then answered "No Raising Cane's locations were found near ZIP 10001".
**Went wrong:** step 2 — `click_element {"index":6}` validated `unknown — click_element was sent, but the page did not visibly change`. It got that verdict **three times** on the same control and then converted "the button didn't work" into a factual claim about the world. The judge calls this out: "the site never returned a result at all". This is the most dangerous failure in the shard — a confident false negative rather than a visible give-up.
**Wasted:** 3 no-op clicks on the same picker button, 2 scrolls, an `ask_human` round trip, 2 `completion_refused` replans (7 planner calls for 11 steps).
**Could have been:** picker → 10001 → **Enter/submit** instead of a button click → choose store → menu → 2 combos with drink options → pickup time. ~12 steps; reference length is 20. A rule that "an action whose verdict is `unknown` three times on the same element may not be reported as a fact about the site" would have prevented the wrong answer.

### `3ec0f6138d37fadcb989347a6088ec45` — open the "get accredited" page, bbb.org — **task.ok / judged SUCCESS (high)** — 4 steps, 127s, 37k in / 1.0k out, $0.013.
**Did:** Two clicks to BBB's Get Accredited page, `read_page`, `done`.
**Went wrong:** nothing — succeeded in the minimum number of moves.
**Wasted:** no steps. But 16 rate-limit retries made a 4-step task take 127s — **24s before the first click** and 43s in the final verification planner call, i.e. more than half the wall clock was waiting on the provider.
**Could have been:** 3 steps (the `read_page` was optional); reference length is 2.

### `47186fac8e7c7277af01144644eb4e0b_070826` — ownership cost of the first car in "best cars", parkers.co.uk — **limit_tokens (cancelled) / judged FAIL (high)** — 41 steps, 332s, **707k in** / 15k out, $0.234.
**Did:** Reached a car page, then spent the entire run fighting a newsletter modal: `handle_dialog` ×2, `find_in_page "Close"` / `"X"` / `"No thanks"`, `send_keys Escape`, `view_screenshot` ×6, and clicks on indices from an old element list. Cancelled at the token cap still behind the overlay.
**Went wrong:** step 2 — `The element is covered by <div> "Sign up to receive the PARKERS newsletters…"` and it never got past it. The error message *listed the overlay's buttons* (`[334] "Submit"`, `[335] "bauerdatapromise.co.uk"`) but no close control, and the agent then clicked indices (337, 336, 343) that had already gone stale: `Element index 337 is not in the element list you were given`.
**Wasted:** **6 covered-element refusals**, **4 `unshown-index` refusals**, 6 `view_screenshot` calls (13 `not_applicable` validations overall), 9 `scroll`, 2 `handle_dialog` on a non-native modal, 3 `find_in_page` for a close button, 1 `send_keys Escape` that changed nothing, and a `todo_list` created at step 41 when the budget was gone. ~38 of 41 steps.
**Could have been:** with a working overlay dismissal, this is search "best cars" → open list → first car → running-costs tab. ~4 steps; reference length is 3. **This task is entirely an overlay-dismissal failure.**

### `4e3f6a538cc1f7321cfc50260db9545d` — current temperature for ZIP 10019, theweathernetwork.com — **task.ok / judged SUCCESS (medium)** — 4 steps, 35s, 67k in / 1.3k out, $0.023.
**Did:** Typed 10019 into the location search (submit), scrolled, clicked the Manhattan NY suggestion, read 18 °C, done.
**Went wrong:** nothing — succeeded, the fastest run of the shard at 35s.
**Wasted:** 1 `scroll` and 1 `completion_refused` planner round trip at the end.
**Could have been:** 3 steps; reference length is 2.

### `59b7b990b4828bc305ab0d7ed6071b55` — owner-financed Luna County NM homesite land, last 30 days, contact cheapest per acre, landwatch.com — **limit_tokens (cancelled) / judged FAIL (high)** — 36 steps, 296s, **677k in** / 19k out, $0.250.
**Did:** Got through a map-search overlay, set New Mexico → Luna County, ticked Homesite and owner-financing, set "Past 30 days" (28 results) — then tried to read price-per-acre out of the list with **8 consecutive `extract`/`find_in_page` attempts** and hit the token cap before ever contacting a seller.
**Went wrong:** step 25 — the first `extract` with a `pattern`-bearing schema returned nothing, and the agent responded by permuting CSS selectors (`a[aria-label*="$"][aria-label*="Acres"]`) six more times instead of falling back to `read_page`, which would have handed it the card text.
**Wasted:** `extract` **7 times** with near-identical schemas (steps 25-32), 2 regex `find_in_page`, `click_element 37` + `go_back` **3 times** (6 steps), 5 distinct guard refusals including `identical-repeat` ("you have already done exactly this 3 times on this page and nothing on it changed") and the `user-value` guard protecting "New Mexico". ~24 of 36 steps.
**Could have been:** filters (5 clicks) → sort by price/acre if offered, else `read_page` the 28 cards once → open the cheapest → Contact. ~10 steps; reference length is 9. The filters were right; **only the reading strategy failed.**

### `627f7a18d85f29a687234f1ade4585c2` — current league leader in total blocked shots, nba.com — **task.ok / judged SUCCESS (medium)** — 10 steps, 89s, 211k in / 2.4k out, $0.065.
**Did:** nba.com/stats → Official Leaders → `select_dropdown_option "Totals"` → tried `"Blocks"`, got `Option "Blocks" not found. Available options: … "BLK" …` → retried with `"BLK"` → four `extract` calls to read the top row → answered Victor Wembanyama, 78 blocks.
**Went wrong:** nothing — succeeded. The dropdown error message that lists the real options is a good design: the agent self-corrected in one step.
**Wasted:** **4 `extract` calls** for one table row (`{"Player"}` → `{"Player"}` array → `{"PLAYER"}` → `{"PLAYER"}` with `scope:"table"`) — the case-sensitivity of the column header cost 3 steps. A `read_page` would have answered at step 6. Also the SEASON TYPE control stayed on the page default "Playoffs" (judge's caveat).
**Could have been:** leaders → Totals → BLK → read row 1. ~5 steps; reference length is 5.

### `662ae0f2d3ac851dbcdd245f908277e3` — second best stop on a Yellowstone→Las Vegas road trip, wanderlog.com — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 424s, **679k in** / 11k out, $0.200.
**Did:** Scrolled the Wanderlog home page, `find_in_page "road trip"`, then for 45 steps re-typed the same 48-character query into whichever search box was on screen, clicked a result, `go_back`, and repeated. Cancelled at the step cap on the empty road-trip-planner landing page.
**Went wrong:** step 5 — it put the whole task sentence ("best stops along the road trip from Yellowstone National Park to Las Vegas") into a *destination* autocomplete that expects a place name. Every subsequent attempt repeated that shape.
**Wasted:** the identical 48-char query typed **6 times** (steps 5, 11, 41, 43, 46 and a 24-char variant twice), `go_back` **11 times**, `click_element 122`/`134` **6 times**, 5 `wait_for`, 8 `scroll`, 7 interval replans. ~45 of 50 steps.
**Could have been:** Wanderlog has a canonical guide URL for a route pair; `go_to_url` it (or fill start=Yellowstone, end=Las Vegas in the two separate boxes) → read the "best stops along the way" list → name #2. ~4 steps; reference length is 5.

### `71f8de1834599fba443f40dbbfab8edd` — arXiv search: RL, cs + math, Sep 2024 – Jan 2025, arxiv.org — **task.ok / judged SUCCESS (high)** — 10 steps, 99s, 198k in / 5.1k out, $0.072.
**Did:** Opened Advanced Search, typed the term, ticked Computer Science and Mathematics, filled the two date fields (all five in **one batched step 3**), searched — got 67,150 results — the planner refused the `done`, it fixed the term field and re-searched to 1,029 results matching every constraint.
**Went wrong:** nothing — succeeded. This is the clearest case of the **`completion_refused` loop earning its keep**: the first `done` claimed success on a 67k-result page that ignored the term, and the planner sent it back twice until the numbers were right.
**Wasted:** the first `done`/refusal cycle cost ~4 steps and 3 planner round trips, but it bought the correct answer.
**Could have been:** advanced search → 5 fields → search. ~4 steps; reference length is 11.

### `783ce6a3499fa7cf25bc12f8f0ecbbbb` — Florida internship programs, Mayo Clinic College of Medicine, mayoclinic.org — **task.fail (max failures) / judged SUCCESS (medium)** — 17 steps, 172s, 194k in / 6.6k out, $0.072.
**Did:** Two covered-element refusals to get to the program finder, set Location = Florida and Program type = Internship, clicked Search → "Results 1 – 10 of 24 for Florida Internship" was on screen — then died trying to scrape the titles.
**Went wrong:** step 8 — `extract {"schema":"{\"type\":\"array\",\"items\":{\"type\":\"string\"}}"}` → `schema names no fields: give an object schema with properties`. It then issued **six more `extract` calls** permuting `selector: "article"` / `"article a"` / `attribute: "aria-label"` / `scope`, tripped the `identical-repeat` guard, and the executor stopped on 3 consecutive failures. **The task was already visibly complete when the scraping started.**
**Wasted:** 7 `extract` calls (steps 8-14, two of them byte-identical), a `find_in_page`, a `progress_stall` replan, 2 covered refusals. ~10 of 17 steps — and they turned a success into a `task.fail`.
**Could have been:** finder → 2 dropdowns → Search → `read_page`. ~5 steps; reference length is 5. Two general fixes apply: **after N failed `extract`s fall back to `read_page`**, and **do not fail a task whose goal state is already on screen**.

### `816851ff92ff0219acf4364dcc2c4692_070826` — blue baby boys' pajamas under $40, 5-star, price low→high, jcpenney.com — **task.ok (agent) / judged FAIL (high)** — 39 steps, **898s** (the longest in the shard), 656k in / 12k out, $0.217.
**Did:** Searched "baby boys pajamas", opened the listing, applied the 5-Rating facet, the $1-$40 price range and Sort By: Price Low–High (22 results), hunted for a colour facet with `find_in_page "Color"` three times, concluded none exists, and listed the 22 non-blue results as the answer.
**Went wrong:** step 16 — `find_in_page {"query":"Color"}` (a 5-second call) found no global colour facet, and the agent decided to **report the unfiltered list as if it satisfied "blue"**. The judge: "the answer lists coral, cream and mint items as the requested blue pajamas." The honest move was to filter visually or to say the colour constraint could not be applied.
**Wasted:** **17 `scroll`** steps (up/down/top oscillation across steps 1-37), `find_in_page "Color"` **3 times** at ~5s each, 1 covered refusal. ~22 of 39 steps. **109 rate-limit retries** — the most in either shard — give a 23s mean step time.
**Could have been:** search → 3 facets → sort → read the list, checking colour per card. ~8 steps; reference length is 9.

### `8689af4d33ce00bf2cdd8987d3bbfd86` — cheapest certified refurbished 256GB blue iPad Air to bag, apple.com — **task.ok / judged SUCCESS (high)** — 31 steps, 280s, 526k in / 13k out, $0.184.
**Did:** Hunted the refurbished store, then `go_to_url apple.com/us/shop/goto/special_deals`, faceted Models = iPad Air 11", Storage = 256GB, sorted Price: Low to High, opened the $669 blue unit and added it to the bag.
**Went wrong:** nothing — succeeded; the judge confirms the bag shows the correct line item.
**Wasted:** **6 `invisible` refusals** on facet checkboxes inside collapsed panels (steps 7-17) plus 1 `failed-retry` refusal; then steps 21-28 are a `click_element {"index":73}` / `go_back` ping-pong repeated **5 times** that fired two `progress_stall` replans before it broke out; 3 early scrolls + a `find_in_page "refurbished"` replaced by the step-5 `go_to_url`. ~17 of 31 steps. 14 planner calls for 31 steps.
**Could have been:** `go_to_url` special_deals → 2 facets → sort → open first blue → Add to Bag. ~6 steps; reference length is 8.

### `92a3d4236f167af4afdc08876a902ba6` — find a 2022 Tesla Model 3, carmax.com — **task.ok / judged SUCCESS (medium)** — 2 steps, 23s, 47k in / 0.7k out, $0.016.
**Did:** Typed "2022 Tesla Model 3" in the CarMax search with submit; CarMax turned the query into three facets; read 94 matches and the first listing; `done`.
**Went wrong:** nothing — succeeded. The **cheapest task in the shard**: one action, one done, 2 steps against a reference length of 10.
**Wasted:** none.
**Could have been:** exactly this. 2 steps.

### `9c97bab9c2abfb90a426cbe9addae8d0_110325` — track order 12345 with email and last name, michaels.com — **task.ok / judged SUCCESS (high)** — 7 steps, 96s, 83k in / 1.5k out, $0.027.
**Did:** Track My Order → `fill_form` with order number, last name and email in **one action with `submit:true`** → site returned "Not found / Please search for another order number" → reported that verbatim.
**Went wrong:** nothing — succeeded. The `intent-share` guard **allowed** the user's own email/order data through (correctly: the user supplied it for this purpose), and the agent reported the site's message rather than inventing an order.
**Wasted:** a click + scroll + click after submitting (3 steps) confirming the result page. 10 rate-limit retries; a 20s and a 40s stall.
**Could have been:** Track My Order → `fill_form` submit → read result. 3 steps; reference length is 9.

### `a11ecdff735b51372d536c866011af6f` — explore psychology courses, coursera.org — **task.ok / judged SUCCESS (high)** — 5 steps, 26s, 67k in / 1.1k out, $0.020.
**Did:** Searched "Psychology" (submit), scrolled three times, `read_page`, listed the courses.
**Went wrong:** nothing — succeeded in 26s.
**Wasted:** the 3 `scroll` steps — `read_page` returns the list without them. 3 of 5 steps.
**Could have been:** search → `read_page` → answer. 2 steps; reference length is 4.

### `a96fca87a17d792644e736d1d10d3cbe` — Business plan price for 100 users / 1PB / 50TB, mega.io — **task.ok (agent) / judged FAIL (high)** — 9 steps, 71s, 111k in / 5.0k out, $0.049.
**Did:** Pricing → Business tab → calculator → typed 100 (users), 1000 (TB storage), 50 (TB transfer) into the three number boxes → `assert` the total → `done` with ₹439,622.60.
**Went wrong:** step 4 — `input_text` failed with `Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'`, and the retry at step 6 wrote "50" into the transfer box **without moving its slider**, so the calculator still priced 3 TB. The judge reconstructs the arithmetic and confirms the quoted total is the 3 TB price. The agent even appended "Not applied: 100 users; 1PB storage quota; 50 TB transfer quota" to its own answer and still reported success.
**Wasted:** 2 `completion_refused` replans (8 planner calls for 9 steps) that did not catch the discrepancy the answer text itself declared.
**Could have been:** the same 9 steps, with the slider driven (drag or arrow keys) rather than the text box. The general fix: **a `done` whose text contains "not applied" must not be accepted as success.**

### `b3f8bd9198d9d157e0848109563c4b23` — permanent logistics job near zip 11005, middle income, HS diploma, ohiomeansjobs.ohio.gov — **task.ok (agent) / judged FAIL (high)** — 13 steps, 397s, 164k in / 3.6k out, $0.055.
**Did:** Opened job search, typed "Logistics", typed 11005 in the zip box, chose "20 miles", then ticked Job Type: Permanent, Salary: Middle Income, Career/Education: High school diploma, `assert`ed the filter panel and answered with the filter list.
**Went wrong:** step 2-3 — the zip and radius never took: the judge's final screenshot shows `State: OH` in Current Filters with no zip or radius, and the count stayed at 7,133 jobs throughout. The agent verified the filters it *could* see (`assert` on the education filter) but never checked that the result count changed or that the listings were near New York, and **named no actual job**.
**Wasted:** `click_element 108`/`109` re-sent 3 times; a `done` issued in the same turn as another action and rejected (`The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions`); 51 rate-limit retries → 397s for 13 steps (30s/step).
**Could have been:** the same 8 filter steps plus a check that the result count moved and one listing opened. ~10 steps; reference length is 15.

### `ba01ea557b73f864c35ebba0dd6f3cb2` — top-rated Manhattan hotel for 4, fastest transit to LGA, google.com/maps — **task.ok / judged SUCCESS (medium)** — 13 steps, 86s, 145k in / 2.7k out, $0.046.
**Did:** Searched "hotels in Manhattan, NY", set guests = 4 through the occupancy menu, opened Sort by → Rating, took the top organic result (Pestana Park Avenue 4.8), opened its Location summary → Airports tab, read "LaGuardia Airport — 39 min (transit)", saved findings, done.
**Went wrong:** nothing — succeeded. Notably it used the site's **own sort** rather than eyeballing ratings, and correctly skipped the two sponsored ads above the first organic result.
**Wasted:** 3 `scroll`; the `save_findings` immediately before `done` was redundant. ~4 of 13 steps.
**Could have been:** ~9 steps; reference length is 14. One of the best runs in the shard on a hard task.

### `be9e7dca1222714571ef3d7d59d2a41c` — cold & flu forecast + today's air quality in Champaign IL, weather.com — **task.ok (agent) / judged FAIL (medium)** — 33 steps, **633s**, 454k in / 9.4k out, $0.144.
**Did:** weather.com served an en-IN/New Delhi locale; the agent searched Champaign three separate times (steps 1, 10, 26), got the air quality (33 – Good) at step 12, then hunted for a cold & flu forecast — opened the Allergy Tracker by mistake, `go_back`, scrolled, `find_in_page "cold and flu"` twice, `go_to_url` weather.com and weather.com/en-US — and finally declared it unavailable.
**Went wrong:** step 13-18 — it looked only in the city page's "Health & Activities" section, which on the served locale shows allergy only, and never used weather.com's Health navigation where the cold & flu tracker lives. The judge: "the absence is not established — weather.com does carry one."
**Wasted:** the Champaign search repeated **3 times** (locale redirects kept throwing it back), `find_in_page "cold and flu"` twice (one taking 5s), 7 `scroll`, 3 `go_back`, 3 `go_to_url` resets, 2 covered refusals, a `failed-retry` refusal on a detached node, and a flood of `DOMService: Failed to remove highlights` errors (20+) interleaved with every step. ~24 of 33 steps; 28 rate-limit retries.
**Could have been:** set the location once, read air quality from the city page, then open the cold & flu tracker from the Health menu. ~7 steps; reference length is 6.

### `c3a333968fc3c43d7f2688f425a0d633` — cheapest CPO Porsche 911, 2019+, within 200 mi of 97007, porsche.com — **task.ok / judged SUCCESS (high)** — 20 steps, 137s, 255k in / 6.4k out, $0.082.
**Did:** Opened the Porsche Finder, set Model Lines = 911, Condition = Certified Pre-Owned, Min. Year = 2019, Location 97007 + 200 mi radius, then **Sort By: Price – Low to High**, `read_page` the first card and `assert`ed it.
**Went wrong:** nothing — succeeded, with every constraint as a visible facet chip.
**Wasted:** 1 covered-element refusal from a marketing layer; a `done` issued alongside another action and rejected (`You MUST NEVER call 'done' in the same turn as other actions`), costing a `completion_refused` round trip. ~3 of 20 steps.
**Could have been:** ~15 steps; reference length is 15. A model run on a hard task — the superlative came from the site's sort, not from the model's arithmetic.

### `c8c1ff115879b3afd14280beb1559b13` — latest MP4 Doraemon video over 20 min, medium size, 4shared.com — **task.ok (agent) / judged FAIL (high)** — 14 steps, 121s, 176k in / 5.5k out, $0.068.
**Did:** Searched "Doraemon", switched to the Video category, tried three times to open the filter panel, gave up on it, applied "Newest first" sort, read the first card and answered with it.
**Went wrong:** steps 2-5 — three consecutive `The element has no visible area` refusals on the Duration/File-type/Size filter controls. 4shared's own panel offers exactly those facets ("Resolution All / Duration All / File type All / Specify size All"), and all three stayed on "All". The agent then **asserted** the unverified claim: its `assert` evidence is only the title and duration, with nothing about file size.
**Wasted:** 3 `invisible` refusals, 1 covered refusal, 1 `failed-retry` refusal, 1 `unknown` click, 2 `validation` replans, a rejected same-turn `done`. ~9 of 14 steps.
**Could have been:** search → Video → open the filter panel (its toggle is a visible label, not the hidden input) → 3 facets → Newest first → read card 1. ~8 steps; reference length is 12.

### `d4fb78b7e74508cd3b33f01cf9200997` — figure comparing occupational fatalities, OH vs NY, americashealthrankings.org — **task.ok / judged SUCCESS (medium)** — 10 steps, 86s, 101k in / 2.3k out, $0.032.
**Did:** Searched the measure name, opened Occupational Fatalities, picked Ohio, opened State Comparison, added New York, `view_screenshot` to confirm the trends figure, answered.
**Went wrong:** nothing — succeeded. Same clean pattern as `1b867afe` on the same site, including the confirming screenshot.
**Wasted:** 3 `scroll` steps between clicks. 3 of 10.
**Could have been:** 7 steps; reference length is 12.

### `dd44c665cec1e9c929a4c5f074e7844a_110325` — SpotHero parking near SFMOMA, Sunday 1-5 PM, F-150, in/out, cheapest, spothero.com — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, 490s, 554k in / 18k out, $0.194.
**Did:** Typed the destination three times (steps 0, 5, 10 — each followed by a `go_back` that undid it), then set the date and 1:00 PM / 5:00 PM via dropdowns, entered the Ford F-150, applied Self Park and Garage-Covered chips — and spent the last 25 steps alternating `click_element 15` / `click_element 57` trying to open the sort menu. Cancelled at the step cap with the sort dropdown still open.
**Went wrong:** steps 0-9 — the destination/`go_back` cycle wasted 10 steps before anything stuck. Then from step 25, `click_element 15` produced `The element has no visible area` **7 times** and the agent kept alternating the same two indices.
**Wasted:** 3 destination entries + 3 `go_back`; **7 `invisible` refusals**; **3 `failed-retry` refusals**; `click_element 15`/`57` re-sent 10 times; a `send_keys ArrowDown` that changed nothing; 4 `validation` replans + 6 interval replans (13 planner calls). ~32 of 50 steps. 30 rate-limit retries.
**Could have been:** destination → date/times → vehicle → Garage + in/out facets → Sort by Price → open the first spot. ~12 steps; reference length is 17. The planner's own ledger said "requirements applied 5/7" — it knew it was not finished but had no budget left.

### `ec78d3a635e417bc2a80d03ca93d7165` — benefits for a single over-pension-age unemployed carer in England, gov.uk — **limit_steps (cancelled) / judged FAIL (high)** — 50 steps, **1364s (23 min, the longest run in either shard)**, 488k in / 18k out, $0.184.
**Did:** Browsed gov.uk's benefit pages one at a time — Pension Credit, Carer's Allowance, Warm Home Discount — reading and `extract`ing each, `go_back`, open the next. Never used gov.uk's "Check benefits and financial support you can get" questionnaire, which answers exactly this task. Cancelled at the step cap with no answer.
**Went wrong:** step 2-5 — it entered the *browse* tree instead of the questionnaire. The judge's final screenshot shows the low-income browse page "with the questionnaire link still unclicked" after 23 minutes.
**Wasted:** `go_back` **8 times** paired with re-clicking the same nav indices (7, 8, 13, 15, 16) — steps 40-48 are pure click/go_back alternation; 4 `extract` calls on prose pages, two of which took **20s and 11s**; 7 interval replans. **168 rate-limit retries** — the worst in either shard, ~27s of dead time per step. ~40 of 50 steps.
**Could have been:** open the "Check benefits and financial support you can get" tool → answer ~8 questions → read the result list. ~12 steps; reference length is 16.

### `f707d765bca668830745d20807d7bee6` — young female English Spot rabbits within 50 mi of Chicago, petfinder.com — **task.ok / judged SUCCESS (high)** — 32 steps, **640s**, 390k in / 8.7k out, $0.117.
**Did:** Set pet type Rabbits, location Chicago IL, distance 50 miles, then opened the Filters panel and ticked Breed = English Spot, Age = Young, Gender = Female; the header read "2 pet results"; `save_findings`, `assert` with the two names, `done`.
**Went wrong:** nothing — succeeded with every constraint as a real facet, which is the standard the judge applies.
**Wasted:** the facet panel took 20 steps because each checkbox needed open-panel → scroll → click → re-open: `click_element 113`/`120` repeated 4 times, `click_element 13` 3 times, 2 covered refusals, 2 `unshown-index` refusals, 1 stale-index refusal; plus 2 `completion_refused` round trips at the end. ~14 of 32 steps. 64 rate-limit retries → 20s/step.
**Could have been:** Petfinder encodes all of these in the URL; realistically ~12 steps through the UI. Reference length is 14.

---

## Run totals (58 tasks)

43 `task.ok`, 8 `limit_steps`, 4 `limit_tokens`, 3 `task.fail`. **Judge: 32 success / 26 fail** — so 11 of the 43 "ok" runs carried an answer the judge rejected. 1,329 steps, 22.9 steps and 301s per task, 17.2M input tokens. 619 rate-limit retry lines, 67 LLM timeouts. Guard refusals: invisible 33, covered 32, stale-index 10, unshown-index 9, failed-retry 8.

## 1. Recurring waste patterns

| Pattern | Tasks hit | Steps it cost |
|---|---|---|
| Overlay / cookie / newsletter / sticky header blocks a click (`covered` + `invisible` refusals, 65 total) | 23 | ~110 |
| Same action re-sent after a failure or an `unknown — page did not visibly change` verdict, no change of technique | 15 | ~180 |
| Scroll runs where one `read_page` would do (17 in `816851ff`, 16 in `b99c0296`, 11 in `b3a7da96`) | 18 | ~95 |
| `go_back` / re-enter churn (11 in `7072d09`, 11 in `662ae0f2`, 9 in `b99c0296`, 8 in `ec78d3a6`) | 12 | ~70 |
| `extract` schema flailing — empty results or rejected schemas, never falling back to `read_page` | 7 | ~85 |
| Answering with a required filter never applied (false success) | 10 | turns 10 runs into judged failures |
| Menu-walking a site that has a canonical deep link or a search-first path | 9 | ~150 |
| Redundant terminal steps (`save_findings`/`scroll`/duplicate `done` just before finishing) | 8 | ~20 |
| Rate-limit and timeout dead time (619 retries, 67 timeouts) | 34 | 0 steps, ~40% of wall clock |

## 2. Five changes that would save the most

1. **Dismiss overlays as a first-class recovery.** On the first `covered`/`invisible` refusal, run a dismissal pass (consent, newsletter, app-install, sticky header) and scroll the target clear of fixed elements before retrying. `47186fac` (~38 steps, the whole task), `92160852` (~20), `dd44c665` (~10), `6174e5dd` (~9), `8689af4d` (~7), `c8c1ff11` (~5), plus 1-2 steps each in `23204728`, `65c4030f`, `7680a920`, `8103786e`, `2c20d87a`, `59912927`, `c3a33396`, `4e0f5561`, `f707d765`. **≈110 steps, 2 rescued runs.**
2. **Escalate modality after two failed attempts on the same target.** Today the agent re-sends the same click; `identical-repeat` only fires at 3 and only per page. After two identical failures or `unknown` verdicts, force a different route: keyboard selection, `select_dropdown_option`, a direct URL, or `done(success:false)`. `b3a7da96` (~42), `662ae0f2` (~40), `07bdc595` (~30), `1aeca99e` (~28), `461ab9b0` (~20), `dd44c665` (~20), `6174e5dd` (~20), `33bd2cde` (3 + a wrong answer). **≈200 steps, 5 rescued runs.**
3. **Reading rule: `read_page` first, `extract` only for structure, and never more than two schema attempts.** `c39d6c24` (~40 — 20 carousel clicks + 16 `save_findings` for a list already in the DOM), `59b7b990` (~15), `783ce6a3` (~9, and it turned a visibly-complete task into `task.fail`), `0632e496` (9 empty extracts), `eb323dc5` (~8), `627f7a18` (3), `ec78d3a6` (4). **≈88 steps, 2 rescued runs.**
4. **Gate `done` on evidence that each requirement is applied** — a facet chip, a URL parameter or a changed result count — and refuse a `done` whose own text admits a requirement was not applied. `a96fca87` (the answer literally says "Not applied: 100 users; 1PB storage; 50 TB transfer" and still reports success), `816851ff`, `59912927`, `6174e5dd`, `330cd04c`, `b3f8bd91`, `c8c1ff11`, `be9e7dca`, `33bd2cde`, `d392e154`. **10 wrong answers prevented**, and the runs would stop or re-plan early rather than spending their tail on a doomed answer.
5. **Prefer the site's own search/deep link over menu walking, and abandon a page that answers "no results" twice.** `662ae0f2` (~45), `b99c0296` (~44), `7072d09` (~40), `ec78d3a6` (~38), `461ab9b0` (~35), `3dca7cbe` (~22), `a0a18ca6` (~7 — its own step-7 `go_to_url` proves the pattern), `8689af4d` (~5), `c801d1c9` (the opposite: gave up in 4 steps without trying the awards page). **≈230 steps, 4-5 rescued runs.**

*(A sixth, outside the agent: 619 rate-limit retries and 67 timeouts. `ec78d3a6` spent 23 minutes on 50 steps, `816851ff` 15 minutes on 39. Pacing or a second region would cut wall clock ~40% with zero effect on the routes.)*

## 3. What the agent did well — do not break it

- **Superlatives through the site's own sort, not the model's arithmetic.** `c3a33396` (Price Low→High before naming the cheapest 911), `ba01ea55` (Sort by → Rating, and it correctly skipped the two sponsored ads above the first organic result), `a0a18ca6` (`sort=BS`), `8689af4d`, `627f7a18`, `f707d765`. This is the single biggest driver of judged success.
- **Batched form filling.** `fill_form` did seven fields in one step in `7680a920`, four in `92160852`, three with `submit:true` in `9c97bab9`; `71f8de18` batched five arXiv controls into one step. Compare `1223b075`, which spent 20 steps on 10 answers because it split input and submit.
- **`assert` before `done`.** `864244b6`, `7680a920`, `c3a33396`, `f707d765`, `1223b075` — quoting the on-page evidence is what let the judge confirm them at high confidence.
- **`view_screenshot` for visual deliverables.** `1b867afe` and `d4fb78b7` both confirmed the figure was rendered before claiming done.
- **The planner's `completion_refused` loop.** In `71f8de18` it rejected a `done` that claimed success on a 67,150-result page and pushed the agent to the correct 1,029-result query.
- **Guards that fired correctly.** `user-value` in `a8b9edd5` stopped the agent substituting its own ZIP for the user's "Texas" and routed it to `ask_human`; `intent-share` in `9c97bab9` correctly allowed the user's own order data; `leave-applied` in `07bdc595` stopped a `go_back` that would have dropped applied filters; `identical-repeat` in `59b7b990` and `783ce6a3`.
- **Actionable error text.** `Option "Blocks" not found. Available options: … "BLK" …` let `627f7a18` self-correct in one step. `select_dropdown_option` errors that list the real options are worth extending to other actions.
- **Honest empty results.** `bd1e3770`, `239a29bd` and `9c97bab9` reported the site's own "no results"/"Not found" message with evidence instead of inventing an answer — all three were judged successes. (`33bd2cde` shows the failure mode when this reflex is applied to a *broken button* rather than a genuine empty result.)
