# r4 failure classification — first divergence

Run `chrome-extension/e2e/results/mind2web-r4-2953c78` (build 88fff5b, gemini-2.5-flash planner+navigator,
`maxSteps 50 / maxMs 2 400 000 / maxInputTokens 500 000`). 300 task folders.

**Scope.** `judgment-claude.json.success == false` and `result.json.outcome` not in
`{site_blocked, site_down, provider_down, harness_error}` → **111 tasks** (task.ok 61, limit_steps 21,
limit_tokens 18, task.fail 10, task.pause 1). Of the 300: 178 `task.ok`, 124 judged success, 64 `site_blocked`,
1 `site_down` (the last 65 carry no judgment). Every one of the 111 timelines was read end to end; each task
got exactly one class, at the **first** step from which success was no longer reachable.

Commands (scope, aggregation, signal counts):

```bash
cd chrome-extension/e2e/results/mind2web-r4-2953c78
# scope: success==false, outcome not site/provider/harness
python3 -c 'import json,os;print(sum(1 for d in os.listdir(".") if os.path.isdir(d) and not d.startswith(".")
 and not json.load(open(d+"/judgment-claude.json")).get("success")
 and json.load(open(d+"/result.json"))["outcome"] not in ("site_blocked","site_down","provider_down","harness_error")))'
grep -c 'is covered by' */timeline.txt            # our cover guard
grep -l 'no visible area' */timeline.txt | wc -l  # our visibility guard
grep -c 'did not visibly change' */timeline.txt   # action no-ops
grep -c '429' */timeline.txt                      # Vertex rate limits
python3 -c '...'  # medians per class from result.json steps + metrics.tokens.input
```

## 1. Classes

Tokens = median `metrics.tokens.input` (cumulative, incl. cached).

| class | n | share | med steps | med tokens | examples |
| --- | ---: | ---: | ---: | ---: | --- |
| wrong target | 26 | 23.4% | 24 | 297k | `9b5dfe54…`, `c03ee2be…`, `271b36ef…` |
| planner error | 21 | 18.9% | 33 | 374k | `b320c68b…`, `a5c87cc1…`, `c00437fd…` |
| missing perception | 14 | 12.6% | 37 | 658k | `0b51b4fa…`, `47bfe8a7…`, `fc53ddd3…_070826` |
| action did not take effect | 13 | 11.7% | 50 | 563k | `a96fca87…`, `b3f8bd91…`, `415bf9da…` |
| site behaviour | 10 | 9.0% | 6 | 90k | `6ebde509…`, `180ed2ec…`, `690d7b4a…` |
| wrong route | 10 | 9.0% | 37 | 587k | `b99c02965…`, `6b2cfae0…`, `ab6ee3b8…` |
| guard refused legal action | 9 | 8.1% | 27 | 438k | `dd44c665…_110325`, `824eb7bb…_070826`, `b2f4fde2…` |
| answer wrong or unbacked | 5 | 4.5% | 21 | 316k | `96afb3c5…`, `9d46ccb9…`, `c09721cc…` |
| tool contract | 2 | 1.8% | 18 | 288k | `0059adc6…`, `63d6866f…` |
| budget | 1 | 0.9% | 50 | 434k | `c39d6c24…` |

`tool contract` is the one class added: `extract` refused a semantically valid schema on its own input contract.
Site behaviour is by far the cheapest failure (median 6 steps): the run dies early and honestly.

## 2. The three largest classes

**wrong target (26).** Right page, wrong control. Three recurring shapes.
*Criterion into the search box instead of the facet*: `271b36ef` types the words "open box" into Best Buy's
search — `input_text {"index":3,"text":"<23 characters>","submit":true}` — and never touches the Condition
facet; `6174e5dd` types "horseback riding" into recreation.gov's **location** box; `78baf9db…_051526` pastes
the whole request into Statista free text.
*Autocomplete never committed*: `c03ee2be` — `input_text {"index":8,"text":"<13 characters>"}` into AKC's
combobox with no suggestion click, so the search runs unfiltered; `3084bc22` fills both UPS ZIPs via
`fill_form` without committing, and UPS resolves them to **Chilean** postal codes; `9ef1a897` leaves
"Active Filters = 'Farms and Ranches' only, 28 140 nationwide listings".
*Range set wrong*: `87f4c512` ticks $25-$49.99 only and drops sub-$25 speakers; `e7301bb6…_110325` leaves the
$15-$19 band unticked; `eb323dc5…_110325` sets Beds to `"2"` which the site reads as "2 - No Max".
The validator says `passed` in every one of these — the click landed, it just landed on the wrong control.

**planner error (21).** The planner has no memory of what already failed and no floor under "it does not exist".
*Dead route re-issued*: `b320c68b` re-submits the identical IGN query five times after the page returned only
"Did you mean"; `662ae0f2` "re-issued the identical 48-character search that had just failed"; `733f1d8b`
re-clicks the element that redirects to blocked OAuth — `Not opened: https://accounts.google.com/v3/signin/identifier`;
`c00437fd` re-clicks the same chip index and toggles its own filter back off for dozens of steps;
`c698ff3f…_121425` presses `go_back {} (3191ms)` straight after each submitted search, discarding its results.
*Premature "none exist"*: one `find_in_page` miss is taken as proof — `a5c87cc1` ends on
`done {... "I could not find the SO2 air quality for Maine North, County Cork"}` without clicking "View More";
`0e42c3a7`: "No gas stations in Manhattan, NY with a rating strictly above 4.0 were found" after one scroll of
four results; `9829f308…_112325` declares no NBA recaps exist without stepping the date back; `28e7574e`
accepts the navigator's "the current website … is specific to Ohio" at step 0 and never opens the job search.

**missing perception (14).** The control is on the page and the state never makes it usable. Two signatures:
the element is listed but zero-area — `The element has no visible area: it is hidden, or inside a collapsed
section` (`62c8d970`'s Steam review filter, `199be0b5…_070826`'s eGift carousel, `fc53ddd3…_070826`'s Best Buy
tiles for all 41 steps) — or it is absent entirely, so the agent falls back to blind probing:
`find_in_page {"query":"Color"} … not_applicable` (`0b51b4fa`, 28 steps of scrolling), `find_in_page
{"query":"Compare+"}` (`47bfe8a7`, the fixed "2 items selected / Compare" bar), `Option "Permanent" not found.
Available options: "Retired"` (`1aeca99e`, a dropdown whose option list never arrived). This class is the most
expensive: 37 median steps, 658k median input tokens.

## 3. Ran out of budget: on track vs lost

39 tasks ended at a limit (21 `limit_steps` at exactly 50, 18 `limit_tokens`). By the judge's reasoning:
**11 were still on track, 28 were lost/looping.** On-track examples: `59b7b990`, `62c8d970`, `dd44c665…_110325`,
`4464a842`, `608c5952`, `c698ff3f…_121425`, `eb323dc5…_110325`, `c39d6c24`, `ec78d3a6`, `47e314cc`, `b3a7da96`.
Only one of the 39 is a pure `budget` first divergence (`c39d6c24`: advancing a skins carousel one arrow click
at a time with a `save_findings` between). The rest of the lost 28 diverged early: action did not take effect 7,
planner error 7, wrong route 6, missing perception 6, guard 1, wrong target 1. Raising the caps would buy back
at most the 11, and realistically the 1.

## 4. Harness / measurement artefacts

1. **The browser geolocates to India.** 9 of the 111 carry geo-localised content the Mind2Web rubric cannot
   accept: `'Pune, MH'` as the committed location (`0b2623e9…_070826`), `₹999` Disney pricing
   (`157f4a79…_070826`), `"price free ₨ – ₨ apply"` on craigslist, `₹8,300+` on Airbnb, a `₹439,622.60` quote
   (`a96fca87`), "IGN **India**" (`b320c68b`, `aa4b5cb7`), `9080268 Santiago … Chile` from a US ZIP
   (`3084bc22`), craigslist redirected to Pune with a "400" ceiling read as ₹400 (`690d7b4a`). `result.json`
   sets `lang en-US` and `timeZone America/New_York` but nothing pins the exit IP, so the site serves a
   different page than the task was written against. This is the single largest non-agent distortion.
2. **`maxInputTokens` counts uncached input.** For all 18 `limit_tokens` tasks `tokens.input - tokens.cached`
   lands in 500 382–512 358 against the 500 000 cap, while `tokens.input` itself reads 553k–758k. Any report
   quoting `tokens.input` against the cap is off by the cache share (~25%).
3. **Vertex rate limiting is pervasive but never the first divergence.** 3 275 rate-limit events over 98 of the
   111 tasks, 143 min of backoff plus 66 min of pacing against 759 min of wall clock (~28%). It inflates
   `seconds` everywhere and is the reason several runs read as slow; no run's divergence step is a 429.
4. **`extract`'s schema contract rejects valid intent** (2 tasks, both ending in `MaxFailuresReachedError`):
   a CSS selector with escaped single quotes gives `schema is not valid JSON (Bad escaped character at
   position 115)`; an array-of-strings gives `schema names no fields`. The model's intent was answerable both
   times. This is our tool, not the site.
5. **Validation false-positives.** In `a96fca87`, `b3f8bd91` and `415bf9da` the divergence step reads
   `validated input_text: passed` / `validated click_element: passed` while the widget did nothing — a typed
   value left its slider at 3 TB, a radius select never opened (`Option "50 miles" not found after opening the
   dropdown` 20 steps later). `ActionResult.validated` confirms dispatch, not effect.
6. **Our own guards break 9 runs** (`guard refused legal action`) — 158 `is covered by` refusals over 40 of the
   111, plus `no visible area` refusals on controls inside open panels (19 of the 111), plus one URL-provenance refusal of
   `https://www.ted.com/talks` and one of `https://www.shopdisney.com`. Context: the cover guard also fires in
   32 of the 124 judged successes, so it is usually recoverable; it is the first divergence only when the
   refused control is the only route.
7. **Site blocking is not concentrated in the excluded 64.** 10 of the 111 in-scope failures are bot checks,
   blank renders or DNS timeouts that the harness did not label `site_blocked`; all 7 tasks the judge marked
   `blocked: true` fall in exactly this class. Failures are spread over 80 distinct sites (max 7, bestbuy.com),
   so nothing here is one site's fault.
