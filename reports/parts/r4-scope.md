# r4 — where the remaining score is, and what would have to change to get it

**Run:** `mind2web-r4-2953c78` (Online-Mind2Web, 300 slots, Gemini 2.5 Flash on Vertex,
50 steps / 40 min / 500k input tokens). **Judged 124 / 228 = 54.4%** after excluding 64
`site_blocked`, 1 `site_down` and 7 judge-marked blocked. Up from r3's 52.3% on 222.
All percentages below use **228** as the denominator, so **1 task = 0.44 points**.

Method: the judge's `reasoning` and `evidence` in `<task>/judgment-claude.json` was read for
every one of the **104 failed, non-blocked tasks**. Each task is assigned to exactly one
*primary* capability — the thing the judge names as the blocker. Secondary blockers are noted
but never counted twice, so the point columns sum to the whole loss and nothing is
double-sold. Where the judge shows two independent blockers, the task is assigned to the
deeper one and flagged "multi".

## Shape of the loss

| Run outcome | judged ok | judged fail |
| --- | ---: | ---: |
| `task.ok` — the agent believed it had finished | 117 | **54** |
| `limit_tokens` | 0 | 18 |
| `limit_steps` | 1 | 21 |
| `task.fail` | 6 | 10 |
| `task.pause` | 0 | 1 |

By difficulty: easy 49/66 (74%), medium 47/101 (47%), hard 28/61 (46%).

Two facts carry over unchanged from r3: **31.6% of the agent's own `done` verdicts are wrong**
(54 of 171), and **39 of 104 failures (17.1 pts) die at a limit** with the answer "Task
cancelled".

## Ranked table

| # | Capability | Tasks | Points | Plan item | Evidence |
| --- | --- | ---: | ---: | --- | --- |
| 1 | **Apply a requirement through the site's own filter/sort control, and keep it applied** | 26 | **11.4** | 2.5, 2.6, 3.6 (partial); **no item for filter persistence or an Apply button** | see A1–A3 below |
| 2 | **Click a target that is covered, hidden, or absorbs the click with no effect** | 15 | **6.6** | 1.5, 1.6, 2.1, 2.2, 2.7 (consent only) | 40 tasks contain "is covered by" (239 hits); 19 contain "has no visible area" (260 hits); 25 contain "did not visibly change" (198 hits) |
| 3 | **Find the right page on the site instead of circling** | 14 | **6.1** | 3.1, 3.2, 3.5 stop *repeats*; **nothing proposes a better route** | see I1/I2 below |
| 4 | **Operate a non-standard control: custom select, slider, carousel, canvas, contenteditable** | 10 | **4.4** | 4.2 (select merge, gated G3), 2.4 (checkboxes/dates only); **nothing for sliders, carousels, canvases, contenteditable** | see C1–C4 below |
| 5 | **Don't claim absence or refuse before the site has been asked properly** | 6 | **2.6** | 3.4 (two route kinds); **nothing for "expand the collapsed section" or "page the date-stepper back"** | `a5c87cc1` never clicked "View More" on the pollutant list; `9829f308` never stepped the scoreboard back to a date with games; `60cbbbd5` tried google.com, was firewalled, gave up without touching BBB Scam Tracker |
| — | *Site behaviour, geo-served edition, or evidence that is not there* | 6 | *2.6* | out of scope | §Ceiling |
| 6 | **Verify the answer against the page before finishing** (as a *primary* blocker) | 5 | **2.2** | **Stream 6 — deferred**. Nothing else in the plan | `01abae96` answered the company name when the task asked for its code; `c09721cc` read "check back January 10, 2027" as the next available date; `b962927d` named a Mitski record that is nowhere in the classical/NYC grid it filtered; `f158345f` reported $114.13, a sum that exists only in its own findings; `26810ed9` claimed ERR_TOO_MANY_REDIRECTS on a page that had loaded |
| 7 | **Read a rendered result list; survive the `extract` tool** | 5 | **2.2** | 1.1, 1.8, 1.9; **nothing about `extract`'s schema argument** | 3 runs died outright on malformed extract schemas (`0059adc6`, `63d6866f`, `949dc965`; 56+29 occurrences across 9 tasks). `4464a842`/`5dec0e66` show filter chips applied with an empty results area — 30 and 17 steps of scrolling for tiles that were never perceived |
| 8 | **Our own guards: firewall and the commit confirmation** | 5 | **2.2** | 2.8 covers 2 of 5; 10.1/2.9 do not cover the other 3 | `bb5d90e6` was refused `ted.com/talks` as an "unlinked URL" *on the task's own start host*; `157f4a79` was refused shopdisney.com from disney.com three times and finished on an Indian third-party retailer; `11857213` and `c43a7dcc` did all the work and then stalled on a commit confirmation that no human could answer; `9d09bc94`/`d392e154` (counted at #7) falsely reported being blocked — 2.8 |
| 9 | **Commit an autocomplete/typeahead choice and read the value back** | 4 | **1.8** | 2.3 + 1.7 — **fully covered** | `3084bc22` let 90802/97201 autocomplete into Chilean postal codes and quoted from them; `608c595e` ended 51 steps with the To-box suggestion list still open; `9ef1a897`, `c03ee2be` the same |
| 10 | **Press the apply/submit control, and perform the task's terminal action** | 3 | **1.3** | 2.1 partially; **no check that the terminal action happened** (Stream 6) | `eb323dc5` left "See 630 Homes" unpressed with the filters set; `9d46ccb9` typed 4×4×4 / 5 lb then never pressed the second Update and answered off the pre-input table; `b7258ee0` found the store and hours, never set it as home store |
| 11 | **Turn a spent budget into a partial answer instead of silence** | 3 | **1.3** | 3.9 (gated, G2) | `323bd85e` had read Amtrak's "Valid Photo ID Required" section and died with only an LLM-timeout string as its answer; `47e314cc` sorted permits by price correctly then spent 45 steps opening permit pages without concluding; `dd44c665` had 5/7 requirements and was selecting "Sort by Price" on its last step |
| 12 | **Get a range filter exactly right** | 2 | **0.9** | 2.6 — **fully covered** | `87f4c512` filtered "under $50" as the single band $25–$49.99, excluding everything under $25, with a Min/Max box on the same panel; `e7301bb6` filtered "under $20" as $5–$9 + $10–$14 and left the "$15 – $19 (2)" band unticked |
| | **Total** | **104** | **45.6** | | |

## Sub-splits that matter, because the plan covers them unevenly

### 1. Filters (26 tasks, 11.4 pts)

- **A1 — the criterion was typed into the search box instead of the facet (2 tasks, 0.9 pts).**
  Covered by **2.5**. `271b36ef` searched "open box 8K Samsung TVs" instead of using Best Buy's
  Open-Box condition facet; `0059adc6` typed "support services Bentonville Arkansas" at Walmart
  careers.
- **A2 — the filter was set and then lost (4 tasks, 1.8 pts). NOT IN PLAN.**
  `a13e4231` typed a price range into Airbnb's filter dialog, hit a failed click, closed and
  reopened the dialog and lost it — the final URL carries `price_filter_input_type` but no
  `price_min`; `6174e5dd` had Day Use checked at 35.jpg and cleared at 38.jpg, then answered from
  the unfiltered set; `301f267f` held Snacks+Vegan and Vegan+High-protein at different moments and
  never both; `a69d2934` typed 小麦粉 into Cookpad's exclude box twice and navigated away before it
  committed. **2.6 checks that the evidence names the bound at the moment a requirement is marked
  applied; nothing re-checks an applied requirement against the current page later.** The executor
  already sends a planner `done` back when "an applied requirement's evidence is gone from the
  current page" — that check fires only at `done`, far too late to re-apply the filter.
- **A3 — the facet was on the page and simply never selected (20 tasks, 8.8 pts).**
  This is the bulk. It is not one defect: it is #2 (covered/no-effect clicks) and #4 (custom
  controls) hitting facet panels, plus the model not opening the panel at all. **3.6**'s facet
  check would tell the planner which requirement has no matching control; it does not make the
  control clickable. Examples: `636b07af` (JCPenney colour and fabric lists visible and
  unselected for 20 steps), `c6c9dc60` (IKEA Material and Customer-rating panels opened, nothing
  selected), `c8c1ff11` (4shared's Duration / File type / Specify size all left on "All"),
  `eb2db4b7` (AKC has a hairless coat filter; the agent ran the breed quiz and substituted
  "doesn't shed", then named the Bichon Frise).

### 3. Route finding (14 tasks, 6.1 pts)

- **I1 — the same dead route re-issued (6 tasks, 2.6 pts).** Covered by **3.1/3.2**.
  `005be9dd` bounced between the Qatar Airways homepage and Help for 54 steps with the "Check my
  baggage allowance" link unclicked; `662ae0f2` re-typed the same 48-character query into
  Wanderlog's home page a dozen times; `6b2cfae0`, `bbbc243b` both scrolled NBA league-wide stat
  tables looking for one player.
- **I2 — the right page exists and was never sought through the site's own navigation, index or
  archive (8 tasks, 3.5 pts). NOT IN PLAN.** `ab6ee3b8` landed on the current MacBook Pro specs
  page; the November-2023 model lives in Apple's support specs archive. `b320c68b` searched IGN
  for a Zelda walkthrough, got a "Did you mean" list, and never used the Wiki/Guides nav where IGN
  walkthroughs live. `78baf9db` free-text-searched Statista and picked arbitrarily instead of
  opening Market Insights. `461ab9b0`, `b99c0296`, `64b76158`, `7072d094`, `be9e7dca` the same
  shape. The route ledger records what failed; **no item asks for the next route to be chosen from
  the site's own structure.**

### 4. Non-standard controls (10 tasks, 4.4 pts)

- **C1 — custom `<select>`/listbox that will not take a value (4 tasks, 1.8 pts).**
  `1aeca99e` (CalCareers Work Type ends on "Retired" after 25 failed steps), `415bf9da`
  (`select_dropdown_option`: `Option "50 miles" not found after opening the dropdown`, twice),
  `824eb7bb` (clicked Speedo's sort control 19 times, "Price - Low to High" hanging open and never
  chosen), `b3a7da96` (59 steps, every AKC breed-select click "did not visibly change the page").
  **4.2** merges the dropdown tool into click or `input_text` — a tool-surface change, gated to
  **G3**. It does not address "option not found" or "click had no effect on a custom listbox".
  Under-covered.
- **C2 — range sliders (2 tasks, 0.9 pts). NOT IN PLAN.** `8244409b` never moved WebMD's distance
  slider (`d=40` in the URL from first request to last, request was 50 miles); `a96fca87` typed 50
  into mega.io's transfer box while the slider stayed at value=0/3 TB, and the judge's arithmetic
  on the trace proves the quoted ₹439,622.60 is the 3 TB price. **2.4** sets checkboxes and dates
  by value; `input[type=range]` is the obvious third case and is absent.
- **C3 — canvas, game board, carousel (3 tasks, 1.3 pts). NOT IN PLAN, and at risk.**
  `a48e2f1e` never made a single chess move in 50 steps; `1ab384fb` reached PhET's Decay screen
  with "Protons: 0, Neutrons: 0" and every decay greyed out; `c39d6c24` clicked the Ahri skin
  carousel's arrow ~20 times while the viewport had scrolled the carousel off screen. **Plan 4.1
  deletes `drag_element`** as unused — it is the only tool that could move a chess piece or drag a
  slider thumb. Deleting it closes the door on #C2 and #C3 (5 tasks, 2.2 pts) rather than opening
  it. Worth reconsidering, or replacing with a single `drag{from,to}`.
- **C4 — contenteditable (1 task, 0.4 pts). NOT IN PLAN.** `7e6993f2` failed three times with
  "A `<div>` does not accept text" on Imgur's meme caption. **1.3** fixes native date/time inputs;
  contenteditable is the same class of bug and is not listed.

### 2. Covered / hidden / inert clicks (15 tasks, 6.6 pts)

- **D1 — something is on top (7 tasks, 3.1 pts).** `47186fac` lost ~40 steps to the Parkers
  newsletter modal; `92160852` could never reach UPS's Update button under a "Hello there! Create
  a profile" sticky header; `c94551d2` failed the Petfinder Adult checkbox on `covered by <div>
  dialog "Privacy"` and never retried; `853afd53` lost the run to AccuWeather interstitials;
  `9b5dfe54` never pressed Look Up under a cookie banner and then claimed no access points exist;
  `07bdc595` was walled by sign-in and install-app dialogs; `0b2623e9` could not operate
  Petfinder's own "What kind of pet" modal. **2.7 bundles autoconsent, which is a *consent*
  ruleset.** Newsletter modals, interstitial ads, app-install prompts, sign-in walls and sticky
  marketing headers are ~5 of these 7 and **are not consent dialogs**. The generic half —
  "identify the topmost thing covering the target and deal with it" — is 1.5 (covered marks) plus
  2.1 (return the fix), which is the right mechanism; the gap is that no item says what the fix
  *is* for a modal that is not a CMP.
- **D2 — "has no visible area" (4 tasks, 1.8 pts)** and **D3 — click dispatched, nothing changed
  (4 tasks, 1.8 pts)**: 1.5, 2.1 and 2.2 are aimed squarely at these. Covered.

## The answer layer — the verifier's territory

The table above counts a capability only where the judge names it as *the* blocker, which
understates the answer layer, because a bad answer usually sits on top of a bad operation.
Counting every failure where **the agent's delivered answer is wrong, partial, unbacked, or a
false claim of absence or of being blocked**, regardless of what else went wrong:

**24 tasks = 10.5 points.**

`01abae96` `0e42c3a7` `26810ed9` `323bd85e` `33bd2cdc` `47e314cc` `59b7b990` `6174e5dd`
`78baf9db` `816851ff` `96afb3c5` `9829f308` `9b5dfe54` `9d09bc94` `9d46ccb9` `a5c87cc1`
`a96fca87` `b962927d` `be9e7dca` `c09721cc` `d392e154` `eb2db4b7` `f158345f` `fa9adb81`

Five of them are *self-reported* failures the verifier could catch without reading the page at
all — the agent's own answer text admits it: `a96fca87` appends "Not applied: 100 users; 1PB
storage quota; 50 TB transfer quota" to a price it presents as correct; `816851ff` opens "The
website does not offer a filter by color" and then lists cream, coral and mint pyjamas as the
requested blue ones; `c6c9dc60` concedes "A leather finish and 4-star rating could not be met"
after adding the item to the bag anyway.

Four are false claims about the *world*: `9d09bc94` reported a StubHub CAPTCHA that 04.jpg shows
had already cleared; `d392e154` blamed reCAPTCHA when the only reCAPTCHA in the trace is Best
Buy's ordinary embedded script; `9b5dfe54` and `33bd2cdc` reported "none found" for lookups that
were never submitted. **2.8** (re-read before accepting a "blocked" answer) covers the first two.

Splitting by what it would take to fix:

| | Tasks | Points |
| --- | ---: | ---: |
| A page-reading verifier alone plausibly converts it — the work was done, only the answer is wrong or missing | **9** | **3.9** |
| The verifier catches it, but converting also needs one of capabilities 1–4 to fix what it flags | 15 | 6.6 |

The 9: `01abae96` (open the constituent page for the ticker), `26810ed9` (click the 10-DAY tab),
`323bd85e` (answer from the section already read), `47e314cc` (the price-sorted list already
names the cheapest), `9829f308` (step the calendar back), `9d46ccb9` (press the second Update —
the Cost column is empty in the very table it quoted), `a5c87cc1` (click "View More"),
`b962927d` (read the #1 of the grid it had filtered), `c09721cc` (use the "Next Available"
control visible in the toolbar).

**Stream 6 is deferred.** It is the only place in the plan where this class is addressed, and on
this run it is the single largest identified block of lost score: 10.5 points, of which 3.9 is
reachable by verification alone. The research already argues for it (11 §B7: Skyvern
68.7 → 85.9% with a validator; 12 R9–R11: factor per question part, never show the agent's own
claim).

## Realistic ceiling

Of the 104 failures:

| | Tasks | Points |
| --- | ---: | ---: |
| **Not the agent's to win** — evidence absent, site broken, or the site refuses the transaction | **6** | 2.6 |
| **Geo/locale-degraded** — the served edition makes a full pass impossible or meaningless | 6 | 2.6 |
| The agent's to win | **92** | **40.4** |

Not winnable: `5d542a7e` (dblp publishes no citation counts, so "most cited" is not on the start
site), `bfa2de15` (United's Shop-by-map renders blank white), `d1970c16` (Macy's Wine Shop:
"Item cannot ship to your state" for Texas, which the task specifies), `e7f6cca9` (Tumblr's
sign-up wall hides every liked post and scrolling reports no more content),
`fa9adb81` (the chart's #1 track has zero reposters — its reposters page is empty),
`aa4b5cb7` (IGN's served edition has no boardgame category in the reviews rail).

Geo-degraded: `11857213` (German storefront, EU 45 ≠ US 10–10.5), `330cd04c` and `690d7b4a`
(craigslist geolocated to Pune; "max 400" becomes ₹400), `b320c68b` (IGN India),
`be9e7dca` (weather.com en-IN has no cold & flu tracker in Health & Activities),
`b3f8bd91` (OhioMeansJobs pinned to State: OH against a New York zip). These are the residual
bias r3 already flagged; some are winnable with more work, none cleanly.

**So the ceiling on this set is ~94%** (124 + 92 of 228), which is not a forecast. A defensible
forecast: capabilities 1–4 plus the verifier are each partial fixes on hard classes. Converting
**40–50% of the 92 addressable tasks** — 37 to 46 tasks, 16 to 20 points — is the realistic
range for a full execution of Waves 1–2 plus Stream 6, i.e. **~70–75%**. Anything above that
needs the geo bias fixed at the harness level and a second pass on the custom-control classes.

## The short list of things the plan does not have

Ordered by points, most valuable first. Everything here is task-agnostic by construction.

| Gap | Points | What it is |
| --- | ---: | --- |
| **Stream 6 verifier** (deferred, not scheduled) | **10.5** (3.9 by verification alone) | Read the current page and check each part of the answer before `done`; reject an answer the page does not support, a "none found" from a lookup that never ran, and a "blocked" claim contradicted by the loaded page |
| **Route proposal from the site's own structure** | 3.5 | 3.1/3.2 remember dead routes; nothing chooses the next one from the site's nav, index, sitemap or archive when search fails |
| **Filter persistence** | 1.8 | Re-check applied requirements against the current page after every step, not only at `done`; re-apply what disappeared; treat a filter dialog's Apply/See-N button as part of applying |
| **Sliders, carousels, canvases, contenteditable** | 2.6 | 2.4 stops at checkboxes and dates; 1.3 stops at native date/time inputs. And 4.1 deletes `drag_element`, the one tool that reaches two of these classes |
| **`extract`'s schema argument** | 1.3 outright + step waste in 6 more | Three runs died on `schema is not valid JSON` / `schema names no fields` after three strikes. Repair or default the schema instead of counting a failure; 85 occurrences across 9 tasks |
| **Non-consent overlays** | ~2.2 of D1 | 2.7 bundles autoconsent; newsletter modals, interstitials, install prompts and sign-in walls are not CMPs |
| **Same-host navigation must never be firewalled** | 0.9 | `bb5d90e6` was refused `ted.com/talks` from `ted.com` as an "unlinked URL"; `157f4a79` was refused shopdisney.com from disney.com. 10.1's `sameBrand` is scoped to secrets, not navigation |
| **Autonomous commit policy** | 0.9 | Two tasks did all the work and then waited forever on a confirmation no one could give. This may be a measurement artifact of the headless harness rather than an agent defect — either way it costs score, and `humanWaitMinutes` expiry turns it into a pause, not an answer |
| **Expand before declaring absence** | part of 2.6 | 3.4 requires two route *kinds*; it does not require expanding a "View More" / collapsed section or paging a date-stepper on the page already open |

## Cross-cutting note, not a capability

Rate-limit events appear in **94 of the 104 failing tasks** (4,788 occurrences) and LLM timeouts
in 15 (108 occurrences); two runs died with a timeout string as their final answer
(`323bd85e`, `3dca7cbe`). Stream 7 is scheduled and does not need re-arguing — but it is the
tax underneath the 39 limit deaths, and 3.9's partial answer is what stops a tax from becoming
a zero.

## Appendix — every failed task by capability

### 1 — Filters/sorts
- `0059adc6` careers.walmart.com (medium, task.fail) — Find support services jobs in Bentonville, in the state of Arkansas.
- `04613880` flightaware.com (medium, task.ok) — Find discussions of the community and open the one with the most repli
- `0b51b4fa` carmax.com (hard, limit_tokens) — Search for a red Toyota Corolla from model years 2018 to 2023 on CarMa
- `271b36ef` bestbuy.com (easy, task.ok) — Browse 8K Samsung TVs that are open box.
- `27fa3ac2` stanford.edu (hard, task.ok) — Browse the class schedule of graduate-level chemistry courses on Monda
- `301f267f` healthline.com (medium, task.ok) — Find healthy savory vegan snack recipes which can be cooked within 5 m
- `330cd04c` craigslist.org (medium, task.ok) — Browse couches for sale, sort by cheapest, and search in titles only.
- `4f903626` justice.gov (easy, limit_steps) — Find press releases by the antitrust division in 2022.
- `512fd4de` github.com (medium, task.fail) — Identify the open issue with the most comments in the first trending o
- `59912927` samsung.com (hard, task.ok) — Look for the most useful reviews of the highest-rated anti-reflective 
- `6174e5dd` recreation.gov (medium, task.ok) — Find a day-use park that offers horseback riding near Nashville.
- `636b07af` jcpenney.com (hard, limit_tokens) — Filter handbags to show evening bags that are gold, made of satin, and
- `64345c36` us-appliance.com (medium, limit_tokens) — Find me the most viewed refrigerator that is 33-36 inches wide, with s
- `690d7b4a` craigslist.org (medium, task.ok) — Browse iPhone X for sale that is in good condition, has a max price of
- `733f1d8b` tourradar.com (medium, limit_steps) — Find the cheapest travel deal or discount to Thailand that lasts more 
- `7562d9b4` usps.com (medium, task.pause) — Find the nearest location to zip code 54620 that offers size 4 P.O. Bo
- `816851ff` jcpenney.com (medium, task.ok) — Show me a list of blue baby boys' pajamas under $40, with 5 star revie
- `96afb3c5` merriam-webster.com (easy, task.ok) — Find the most frequent word that rhymes with "thought" and has three s
- `a13e4231` airbnb.com (hard, task.ok) — Find an Airbnb in Cleveland for three nights. The check-in date is the
- `a69d2934` cookpad.com (medium, task.ok) — Show me recipes for pancakes in Japan without flour.
- `b3f8bd91` ohiomeansjobs.ohio.gov (hard, task.ok) — Find a permanent job in Logistics within 20 miles of New York, zip 110
- `c00437fd` amazon.jobs (medium, limit_steps) — Check the most recent full-time medical health and safety jobs, requir
- `c698ff3f` eventbrite.com (medium, limit_tokens) — Help me find a list of school activity events in New York for this mon
- `c6c9dc60` ikea.com (hard, task.ok) — Add the cheapest black sofa with at least three seats, a leather finis
- `c8c1ff11` 4shared.com (hard, task.ok) — Find the latest Doraemon video in MP4 format that is over 20 minutes l
- `eb2db4b7` akc.org (medium, task.ok) — Find an energetic hairless dog with medium barking.

### 12 — Exact ranges
- `87f4c512` bestbuy.com (medium, task.ok) — View the speakers that are bluetooth and wireless and filter the resul
- `e7301bb6` jcpenney.com (medium, task.ok) — Find boys' shoes priced under $20 with a 5-star average rating.

### 4 — Non-standard controls
- `1ab384fb` phet.colorado.edu (hard, limit_steps) — Show me the result of a proton emission decay for a Beryllium nucleus 
- `1aeca99e` ca.gov (medium, task.fail) — Find full-time legal occupation jobs in San Diego County with a minimu
- `415bf9da` akc.org (medium, limit_steps) — Find the nearest vet within 50 miles of zip 75228.
- `7e6993f2` imgur.com (medium, task.fail) — Create a meme with a frog as the background and leave the only text wi
- `8244409b` doctor.webmd.com (hard, task.ok) — Find the best Audiologist within 50 miles of New York, NY, with a rati
- `824eb7bb` us.speedo.com (hard, limit_steps) — Get the women's black swimsuit, size large, with the lowest price, and
- `a48e2f1e` chess.com (medium, limit_steps) — Pass the first trending chess puzzle.
- `a96fca87` mega.io (easy, task.ok) — View the pricing plan for 'Business'. Specifically, we have 100 users.
- `b3a7da96` akc.org (medium, limit_steps) — Compare the breeds Afghan Hound, Akita and Azawakh.
- `c39d6c24` leagueoflegends.com (hard, limit_steps) — Browse the final skin in the list for the champion Ahri.

### 2 — Covered/hidden/inert clicks
- `07bdc595` us.trip.com (medium, limit_steps) — Select a high speed train ticket with a departure time before 23:00  f
- `0b2623e9` petfinder.com (hard, task.fail) — Find a list of shorthaired dogs available for adoption within 100 mile
- `199be0b5` dillards.com (hard, limit_steps) — My name is Mike. I would like to send Christene (christenson@gmail.com
- `33bd2cdc` raisingcanes.com (hard, task.ok) — Add a Box Combo to my bag with Diet Coke as the drink, and a Kids Comb
- `3ef64f34` youtube.com (hard, task.ok) — Find and open an animal learning course on YouTube Kids for my 6-year-
- `47186fac` parkers.co.uk (easy, limit_tokens) — What is the ownership cost of the first car in the list 'best cars'?
- `47bfe8a7` versus.com (medium, limit_tokens) — Compare the first and second most popular smartphones manufactured by 
- `62c8d970` store.steampowered.com (medium, limit_tokens) — Find the top game listed in the Steam Deck's top-played list over the 
- `853afd53` accuweather.com (easy, limit_steps) — Show me the wind flow map for Belo Horizonte.
- `92160852` ups.com (easy, task.ok) — Find the shipping cost of a Common medium-sized box in flat-rate shipp
- `949dc965` flightaware.com (hard, task.fail) — Find UA or AA flights from London to New York that arrive between 8:00
- `9b5dfe54` ups.com (medium, task.ok) — Find a UPS Access Point near SPRING, TX and services provided by them.
- `b2f4fde2` booking.com (hard, task.fail) — Find the cheapest hotel + flight + car package from New York to San Fr
- `c94551d2` petfinder.com (medium, limit_steps) — Find cats available for adoption within 25 miles of zip code 94587, Yo
- `fc53ddd3` bestbuy.com (hard, limit_tokens) — I want to purchase an open-box Samsung Galaxy S25 Plus in excellent co

### 9 — Autocomplete commit
- `3084bc22` ups.com (medium, task.ok) — Get quotes for a package weighing 10 lbs with dimensions of 2 inches i
- `608c595e` fedex.com/en-us/home.html (medium, limit_steps) — Calculate a FedEx Ground shipping rate for a 3-pound package from zip 
- `9ef1a897` landwatch.com (easy, limit_tokens) — Find Farms land in Wilkes County, NC with the lowest price.
- `c03ee2be` akc.org (hard, task.ok) — Find a dog groomer for nail trimming within 100 miles of zip code 1000

### 10 — Apply/submit and terminal action
- `9d46ccb9` ups.com (medium, task.ok) — Get a quote for the fastest shipping available for 5 lbs with dimensio
- `b7258ee0` traderjoes.com (medium, task.ok) — Find the store location and hours of the closest Trader Joe's to zip c
- `eb323dc5` compass.com (hard, limit_tokens) — Find the cheapest 2 bed and 3+ bath apartment listing for rent in New 

### 6 — Answer verification (primary)
- `01abae96` cboe.com (medium, task.ok) — Show me the code for the company that is the top mover in the Cboe Eur
- `26810ed9` accuweather.com (easy, task.ok) — Show daily weather for New York City.
- `b962927d` bandcamp.com (medium, task.ok) — Find the best-selling vinyl record by an artist from New York City in 
- `c09721cc` recreation.gov (easy, task.ok) — Find the next available date for Albion Basin.
- `f158345f` azure.microsoft.com (hard, task.ok) — Estimate the total cost (with basic support) of using 5 million input 

### 5 — Premature absence/refusal
- `0e42c3a7` google.com/maps (medium, task.ok) — Find a gas station in Manhattan, NY with a rating above 4.0, and sort 
- `28e7574e` ohiomeansjobs.ohio.gov (hard, task.ok) — Get a part-time job within 5 miles of Moscow, Idaho in the accommodati
- `60cbbbd5` bbb.org (medium, task.ok) — Look up if the phone number 555555555 is a scam.
- `9829f308` espn.com (easy, task.ok) — Can you play the recap from the most recent NBA game?
- `a5c87cc1` accuweather.com (hard, task.ok) — Find the SO2 air quality over the past hour for Maine North, County Co
- `c801d1c9` store.steampowered.com (hard, task.ok) — Browse the latest negative reviews from players with over 100 hours of

### 3 — Route finding
- `005be9dd` qatarairways.com (easy, limit_tokens) — Find the weight of baggage allowance for economy class on Qatar Airway
- `3dca7cbe` zara.com/us (easy, task.fail) — Can you show me products under the category path 'zara home' -> 'rug',
- `461ab9b0` nyse.com (easy, limit_tokens) — Find the NYSE Rule 605 Market Center Files data for July 2024.
- `64b76158` healthline.com (medium, limit_steps) — Compare two pescatarian diets for eating healthier.
- `662ae0f2` wanderlog.com (easy, limit_steps) — What is the second stop among the best stops along the road trip from 
- `6b2cfae0` nba.com (medium, limit_tokens) — Find Devin Booker's highest-scoring points per game playoff run.
- `7072d094` americanexpress.com (medium, limit_steps) — Show me the comparison of the first two personal credit cards that do 
- `78baf9db` statista.com (hard, task.ok) — Find the latest available digital trends to market insights in China (
- `ab6ee3b8` apple.com (medium, limit_tokens) — Find the tech specs of the MacBook Pro 16-inch introduced in November 
- `b320c68b` ign.com (medium, task.ok) — Find a walkthrough for the game "The Legend of Zelda: Breath of the Wi
- `b99c0296` berkeley.edu (medium, limit_steps) — Please find graduate-level computer science courses scheduled on Tuesd
- `bbbc243b` nba.com (easy, limit_tokens) — Find out how many assists Chris Paul has been averaging in the current
- `be9e7dca` weather.com (medium, task.ok) — Find out the cold and flu forecast and today's air quality in Champaig
- `ec78d3a6` gov.uk (hard, limit_steps) — What are the benefits and financial support a single person living in 

### 11 — Budget to partial answer
- `323bd85e` amtrak.com (medium, task.fail) — Tell me information about what identification I need to bring on my tr
- `47e314cc` recreation.gov (medium, limit_steps) — Find the park that offers the cheapest paddling permits.
- `dd44c665` spothero.com (hard, limit_steps) — Find parking near the San Francisco Museum of Modern Art for next Sund

### 7 — Result-list reading and extract
- `4464a842` bestbuy.com (hard, limit_tokens) — Check the specifications of the best-selling HP FHD laptop with 16 GB 
- `59b7b990` landwatch.com (medium, limit_tokens) — Get owner-financing homesite land for sale in New Mexico, Luna County,
- `5dec0e66` bestbuy.com (hard, task.ok) — Search for 33 to 49inch Qled gaming monitor with a 240hz refresh rate 
- `63d6866f` us.trip.com (medium, task.fail) — What are the Nearby Attractions from the most popular attraction in Ho
- `d392e154` bestbuy.com (medium, task.ok) — Add a $100 Best Buy gift card for a birthday to my cart.

### 8 — Our own guards
- `11857213` birkenstock.com (medium, task.ok) — Add the most top-selling Birkenstock's men clogs in brown, size 10-10.
- `157f4a79` disney.com (medium, task.ok) — Find the most popular Lilo & Stitch toys that is less than $20.
- `9d09bc94` stubhub.com (medium, task.ok) — Find NHL events occurring in Boston.
- `bb5d90e6` ted.com (hard, task.ok) — Find the most viewed TED talk on the topic of robots that lasts betwee
- `c43a7dcc` healthline.com (medium, task.ok) — Take a newsletter subscription with my email id (buckeye.foobar@gmail.

### — Not the agent to win
- `5d542a7e` dblp.org (medium, limit_tokens) — Find the most cited publication at the 2022 CVPR main conference.
- `aa4b5cb7` ign.com (medium, task.ok) — Find an editor's choice review with a score of 10 in the boardgame cat
- `bfa2de15` united.com (hard, task.ok) — Show me the options for a roundtrip leaving from Las Vegas on flexible
- `d1970c16` macyswineshop.com (hard, task.ok) — I'm 25 and located in Texas. Shop for 2020 made dry red wine made in U
- `e7f6cca9` tumblr.com (easy, task.ok) — Find the posts liked by the user Taylor Swift on Tumblr.
- `fa9adb81` soundcloud.com (medium, task.ok) — Browse a user homepage that reposted the top song from the Top 50 Rock