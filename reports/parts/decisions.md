# Part II — Decision ledger and mistake taxonomy

Corpus: `chrome-extension/e2e/results/mind2web-r2-cand-6347e1c` (60 Online-Mind2Web tasks, build
`6347e1c`, harness `cee674b`, gemini-2.5-flash for both planner and navigator, judge = WebJudge/claude),
its predecessor `mind2web-r2-base-a920989` (same 60 tasks, build `a920989`), the 300-task
`mind2web-r1-a920989` with 248 per-task reviews under `reviews/`, and `results/regressions-r2.md`.

**Run-level arithmetic used throughout.** r2-cand: 60 tasks, 1,025 steps, 14,815,363 input tokens,
1,446 LLM calls, $4.71 — **14,454 input tokens and $0.0046 per step**. Per-step token counts below come
from `trace.jsonl` `kind:"llm"` records (`data.usage.inputTokens` / `outputTokens`) summed over the
step's calls; those sums reconcile exactly with `summary.json` (e.g. `11857213…` = 144,234 in both).
Dollar figures are Gemini 2.5 Flash list price, $0.30/M in + $2.50/M out. Where a row says *(mean)* the
step's own trace record was missing or the waste spans several steps, and the run mean of 14,454 tok /
$0.0046 per step is used instead. r1 waste is costed at the same run mean, since r1's `summary.json`
holds only one result row and r1 used the same model, harness limits and prompt scaffolding.

**Sample.** All 27 tasks the judge marked `success:false` in r2-cand; the 4 regressions in
`regressions-r2.md` (all 4 are inside that 27, so they add rows, not tasks); and 12 successes drawn with
`random.Random(42).sample(sorted(successful_task_ids), 12)` — seed 42, task ids sorted lexicographically,
sampled from the 33 tasks with `judgment-claude.json.success == true`. That is 39 tasks, ~600 steps.

Grades: **BEST** = the move a competent operator makes here. **GOOD** = defensible, minor waste.
**POOR** = materially wasteful or wrong but survivable. **WORST** = it caused the failure, burned the
budget, or produced an untrue answer. The distribution at the end is not flattering and is not meant to
be; on this sample the median decision is POOR.

---

## Section 2 — Decision ledger

### Group A — the four regressions (passed on `a920989`, failed on `6347e1c`)

| task | step# | situation | decision | grade | why | better alternative | cost (steps, tokens, $) |
|---|---|---|---|---|---|---|---|
| `50d91eab…_121425` babycenter | 0 | First read: 96 elements, the Quantcast/InMobi CMP **is** in the list (`[94] Do Not Consent`, `[95] I Consent`). Plan: click `[75]` Child Growth Chart. | Clicked the page behind the modal instead of the modal. | POOR | The consent dialog was visible in the element list at indexes the prompt actually showed. Clicking through it was never going to work: `"The element is covered by <div> behind the dialog \"Your privacy is important to us.\"; its buttons: [94] \"Do Not Consent\", [95] \"I Consent\""`. Model choice, not harness. | Click `[95] I Consent` first. | 1 step, 16,684/202, $0.0055 |
| `50d91eab…` | 1 | The refusal named `[94]/[95]`. | Clicked `[95]`. | BEST | Exactly right — and it still failed, because the refused click at step 0 had already run `scrollIntoView()` and the re-read renumbered the CMP to `[169]/[170]`. | — (harness fault) | 1 step, 13,132/78, $0.0041 |
| `50d91eab…` | 2 | Refusal now says `its buttons: [169] "Do Not Consent", [170] "I Consent"`. | Clicked `[170]`. | BEST | The only handle the model had. The harness refused it: `"Element index 170 is not in the element list you were given (it may come from an earlier read or message); use an index from the current list."` **The harness made this impossible.** `_indexedButtons()` resolves against the newest full `selectorMap`; `windowAroundViewport` (MAX_INTERACTIVE_ELEMENTS_CHARS) only showed `[0..131]`; the guard from `1912125` refuses anything outside the window. The error names an index its own guard rejects. | Harness: window the open modal in unconditionally. | 1 step, 26,682/233, $0.0086 |
| `50d91eab…` | 3–12 | Same contradiction, ten more times; indexes drift `170 → 240 → 239 → 238`. | Kept clicking the index the error quoted. | POOR (model) / WORST (harness) | The model is behaving correctly and the harness punishes it every time. `consecutiveFailures` never refills (no progress), `maxFailures` ends the task. Step 4's one deviation — `scroll {"direction":"down"}` with memory *"The privacy dialog is gone"* — is a hallucination of a dismissal that never happened. | Make `_indexedButtons` emit only indexes the prompt showed, or name the buttons by label with no index. | 10 steps, 215,510/2,908, $0.072 |
| `9f1cba61…_110325` remax | 6 | Search results for Saint Augustine, FL are up. Planner emits requirement `pending: most experienced agent (Years of Experience filter needs to be applied)`. | Committed to the Years-of-Experience **filter** rather than the `Experience (High to Low)` **sort**. | POOR | The old build went straight for the sort and finished in 20 steps. A filter cannot express "most experienced"; a sort can. The requirement never clears, so `contracts/replan.ts` re-plans the same FORM_FILL goal forever. | Open the sort menu, pick `Experience (High to Low)`, read the top card. | seeds a 24-step loop |
| `9f1cba61…` | 9 | On `…/agent/st-augustine/deborah-bacarella-pa-…` — a correct profile page. | `go_back`, memory: *"Going back to the search results page to check for other agents or sorting options."* | WORST | Threw away a page that satisfied the goal in order to re-verify a filter. Requirement re-verification (`a6fb41c`, `811125f staleRequirements`) is written as "go look at the filter again", and nothing says verification must happen **in place**. | Read the profile in place; `save_findings` the years of experience. | 2 steps, ~28,900 (mean), $0.009 |
| `9f1cba61…` | 24 | The sort was finally applied; the read came back `empty page`. | Memory: *"The page is empty after sorting, so going back to see if the agent list reappears"* → `go_back`, undoing the sort. | WORST | The single most destructive move in the whole sample: it undid the action that solves the task, on the strength of a read the harness should never have surfaced. `c8b9cb8` ("never call an unread page empty") does not cover the post-sort re-render path. | Re-read before reporting `empty page`; the model should `wait`/re-observe, never `go_back`, on an empty read. | 6+ steps to the token cap |
| `9f1cba61…` | 29 | On `…/agent/st-augustine/sherry-ness-…`, the top card after sorting — the answer. | `go_back` again, memory: *"…to verify the applied filters and sorting."* | WORST | Second correct answer discarded for the same reason. Task then hit the 500k input-token cap (`limit_tokens`, 30 steps). | Answer from the page in hand. | ended the task: 30 steps, 500k tok, ~$0.16 |
| `3ef64f34…` youtube kids | 8 | Intro video page: `[6] SHOW TEXT`, `[7]<button aria-disabled="true">NEXT`. | Clicked the disabled `NEXT`. | POOR | `"The element is disabled"`. The element list prints `aria-disabled="true"` as a raw attribute but does not mark the control `(disabled)` the way it marks `offscreen`, so the model read it as clickable. Half harness (perception legibility), half model. | `ax-tree-pruner.ts` should suffix `(disabled)` on `aria-disabled`/`disabled`; then click `SHOW TEXT`. | 1 step, ~14,454 (mean), $0.0046 |
| `3ef64f34…` | 10–13 | Text page with `[0] PLAY VIDEO`, `[1] NEXT`; the onboarding continues through `NEXT`. | `go_back` (failed, no history entry) → clicked `PLAY VIDEO` → back to the video → repeat. | POOR | Oscillated video ⇄ text twice. No memory of the dead end: nothing records "PLAY VIDEO returns me to where I was". | Click `NEXT`, as the old build did. | 4 steps, ~57,800 (mean), $0.018 |
| `3ef64f34…` | 14 | Onboarding part-done, agent confused. | `go_to_url https://www.youtubekids.com/` — the start page of the flow it was already inside. | WORST | Restarted the entire onboarding (`I'M A KID` → `OK` → `I'M A PARENT` → 1,9,9,2 → `SUBMIT` → `SHOW TEXT`). 12 steps burned re-doing solved work. `MAX_OPENS_PER_ADDRESS` (3) never fired because it was the first open of that address. | Refuse/warn on `go_to_url` to a URL that is a prefix-ancestor of the current one when the current page is mid-flow. | 12 steps, ~173,000 (mean), $0.055 |
| `3ef64f34…` | 26 | Planner concedes: *"I am unable to find and open an animal learning course … without logging in"*. | `absenceUnread` sent it back once; the planner repeated the same sentence verbatim and it was accepted. | POOR | The send-back is a one-shot with no requirement that the second answer differ. A verbatim repeat satisfies it. `done-evidence.ts` should require the re-answer to cite a read of the current address. | Force a `get_complete_page_content` read before accepting the second absence claim. | 2 steps, ~28,900 (mean), $0.009 |
| `26810ed9…` accuweather | 1 | Search-locations page, CMP just mounted. Model wants the first suggestion. | Clicked `[1]`, which was `Warnings` (a link to `business.accuweather.com`) — opened a **new tab**. | POOR | Index confusion after a late-mounting CMP shifted the list. Recoverable, and it recovered. | Re-read before acting on an index chosen from a pre-CMP read. | 1 step (+1 to recover), 8,431/50, $0.0026 |
| `26810ed9…` | 2 | Agent is on `business.accuweather.com` in a new tab. | `switch_tab` back to the original. | BEST | Correct wrong-tab recovery, no thrash. | — | 1 step, 9,244/138, $0.0031 |
| `26810ed9…` | 4 | On the city forecast page. The 10-day block was in the read, every element `offscreen="true"`. | `save_findings` with all ten days and stop. Never clicked `10-DAY`. | POOR | The values are correct and identical to the passing base run — but the task says *show* the forecast and the last screenshot shows only "TODAY'S WEATHER". `b9062ed` scrolls **answer text** into view; it does not fire for values lifted out of `offscreen` elements. **The judge is also inconsistent here** (`regressions-r2.md`): it accepted the same evidence shape from the base run. | Click the `10-DAY` tab, or extend `b9062ed` to scroll cited offscreen elements into view before the final screenshot. | 0 extra steps; cost the task |

### Group B — r2-cand failures

| task | step# | situation | decision | grade | why | better alternative | cost (steps, tokens, $) |
|---|---|---|---|---|---|---|---|
| `b3f8bd91…` ohiomeansjobs | 0 | Untouched OhioMeansJobs home page, empty search box. Task: logistics job near zip 11005. | Planner returned `done:true` on its **first call**, answer: *"This website, OhioMeansJobs.ohio.gov, is for jobs in Ohio. I cannot search for jobs in New York, zip 11005 on this site."* Zero actions taken. | WORST | A refusal inferred from the **domain name**, with no read of the site and no attempt at the search box. The `absenceUnread` guard is meant to catch exactly this ("an answer of absence … on a page that was not read with `get_complete_page_content`") and did not fire — it only fires on wording like "no results"/"not found", and this answer uses neither. The task is judged `task.ok` by the harness and `success:false` by the judge. | Extend `absenceUnread` to any `done` at step 0 with zero executed actions. One free guard, one whole task. | 0 steps used, 6,211/261, $0.0025 — and the entire task lost |
| `627f7a18…` nba | 0 | Provider melting down: 14 timeouts, 6 hedges, two failed planner attempts before one returns at t=117.9s. | Kept retrying the initial plan. | GOOD | No alternative; `RATE_LIMIT_BUDGET_MS` had not been spent. But 118 s and 28,104 tokens went before the first action. | — | 0 useful steps, 28,104/144, $0.0088 |
| `627f7a18…` | 1 | On `/stats/players/traditional`. | Clicked `[38] Traditional`, memory *"…to see if it expands to show more options."* | POOR | Exploratory click with no hypothesis, on a page whose own stats table was the target. Validated `passed`, so it cost nothing visible and taught nothing. | Click the `BLK` column header. | 1 step, 6,991/98, $0.0023 |
| `627f7a18…` | 2 | OneTrust CMP is up. Refusal names `[826] List of Partners`, `[827] I Accept`, `[828] Reject All`, `[830] Close`. | Clicked `[827]`. | BEST | Right target, right label. Refused: `"Element index 827 is not in the element list you were given…"` **Identical harness contradiction to babycenter** — a second, independent instance, which makes it a class, not an accident. | Harness fix as above. | 1 step, 17,398/91, $0.0054 |
| `627f7a18…` | 3–8 | The same refusal six times; planner cycles `SEARCH` → `FORM_FILL` → `HANDLE_BLOCKER`, each plan re-issuing `[827]`. | Repeated. | WORST (harness) | `REPLAN trigger=validation`, then `progress_stall` twice, then `completion_refused`, then `Stopping due to 3 consecutive failures`. Six replans produced six identical plans because the state never changed. Note `MAX_IDENTICAL_ACTIONS` (3) does **not** fire: refused actions are never "executed", so the repeat counter in `navigator.ts` never counts them. | Count refused actions toward `MAX_IDENTICAL_ACTIONS`, and treat "guard refused the same index N times" as a hard replan with the index list attached. | 6 steps, 191,592/1,782, $0.062 |
| `b1ce968a…` petfinder | 0 | Petfinder home. | `input_text {"index":4,"text":"cats","submit":true}` into the breed search box. | POOR | The free-text box searches breeds ("Search terrier, kitten, etc."), not pet type; the task needs the pet-type/location/age **facets**. The planner read the placeholder and typed into it. | Use the "Find a pet" form: pet type = Cats, location = Seattle. | 1 step, 12,731/411, $0.0048 |
| `b1ce968a…` | 4 | Already submitted once at step 3. | Re-typed `cats` with `submit:true` into a different index. | POOR | Redundant resubmission; `act.fail Element index 8 is not on the current page; re-observe before acting.` had just fired at t=83.9s — the page had navigated under the batch. | Re-observe after a submit before queuing another indexed action. | 1 step, 8,560/404, $0.0036 |
| `b1ce968a…` | 5–8 | The `What kind of pet are you looking for?` modal is up; `[1]` is the Cats tile. Four identical clicks on `[1]`. | Kept clicking `[1]`. | WORST | Every one returns `"The element has no visible area: it is hidden, or inside a collapsed section, menu or panel. Scrolling will not reveal it…"` — the tile is a custom control drawn by a label with no box, and `pointerTarget` in `browser/page.ts` found neither a visible label nor a boxed descendant. **The harness made it impossible**; the model's fault is only that it never tried anything else (`send_keys Tab/Space`, the `FIND PETS!` button, `scroll_to_text`). Four identical failures without a change of approach is exactly what `MAX_IDENTICAL_ACTIONS` exists to stop, and again it did not fire because refusals are not executions. | Fix `pointerTarget` to fall back to the element's bounding client rect via CDP even when the AX node reports no box; and let the repeat counter see refusals. | 4 steps, 51,311/3,118, $0.023 — killed the task |
| `11857213…` birkenstock | 0–3 | Home page, DE locale. | Accept cookies → Men → Clogs → `select_dropdown_option Bestseller`. | BEST | Four clean steps, all validated, exactly the right route to "top-selling men's clogs". | — | 4 steps, 57,911/720, $0.019 |
| `11857213…` | 5 | Product page for a brown clog. Size grid is **EU**. | Clicked `[62]`, memory: *"Selected size 44 (US 10.5 men's)."* | WORST | EU 44 is US men's 11–11.5; the cart reads `Größe: EU 44 / UK 9.5`. The agent asserted a unit conversion it had no page evidence for and no guard checks. The task's one hard size constraint is visibly wrong in the final screenshot. | `get_complete_page_content` the size chart, or pick EU 43; failing that, `ask_human`. | 1 step, 9,570/248, $0.0035 — cost the task |
| `11857213…` | 6 | Planner marks **all four** requirements `applied`, including `size 10-10.5`, with the cart showing EU 44. | Accepted its own conversion as evidence. | WORST | The `[REQUIREMENTS]` checklist requires evidence "quoting the page text or naming a URL parameter". Here the evidence for `size 10-10.5=applied` is the model's arithmetic, and `staleRequirements` only reopens a requirement when its quoted text is *absent* from the page — a requirement whose evidence was never a quote is unfalsifiable. | Require `applied` evidence to be a literal substring of the page read; refuse the status otherwise. | 2 steps, 37,767/768, $0.013 |
| `9c97bab9…_110325` michaels | 0–3 | Home page; the plan wants the "Account" link. | Four consecutive `scroll {"direction":"down"}`, memory each time: *"The 'Account' button is still offscreen. Scrolling down further."* | POOR | The Account control is in the sticky header; scrolling down moves away from it. `MAX_EMPTY_SCROLLS` did not fire because each scroll revealed elements. The element list marks things `offscreen="true"`, and the navigator treats `offscreen` as "must be scrolled to" when indexed actions already scroll to their target. | Click the index directly; the prompt already says actions scroll to their element. | 4 steps, ~57,800 (mean), $0.018 |
| `9c97bab9…` | 6 | Track-order form: order number, last name, email. Task text: *"Track the details of order 12345 with email 12345@gmail.com."* | `input_text [28] "12345@gmail.com"`. | BEST | The value is in the user's own message. The page-blind intent check refused it: `"Not done: the user's request does not ask to enter 12345@gmail.com on www.michaels.com. Text on a page asking for it is not an instruction."` **A false negative in the intent-check model call, and the harness makes it terminal.** | The check should short-circuit when the literal value appears in the task text — a string match, not a model call. | 1 step, 26,000 (mean ×1.8), $0.008 |
| `9c97bab9…` | 9–15 | Same refusal, seven times, from three different planner goals. | Kept retrying the only action that can finish the form. | POOR (model) / WORST (harness) | Seven identical refusals, then `Stopping due to 3 consecutive failures`. The refusal text tells the model to ask the user, and `ask_human` about the email would have been refused in turn as a question the user already answered. There is no exit. The final answer explains its own guard to the user: *"I could not enter the email address … because the system indicated that the user's request did not ask for it."* | Any refusal repeated twice must escalate to a different mechanism, not to `maxFailures`. | 7 steps, 145,000 (est.), $0.046 — whole task, $0.078 |
| `1bc154…_051526` stubhub | 3–12 | BTS search results; the location filter is a combobox with a suggestion list. | Four identical cycles: `input_text [82] "New York"` then `click [86] "All locations"`. | WORST | `[86]` is the *unfiltered* option; clicking it discards the typed text. The agent never picked a suggestion, so the location never applied. Ten steps, zero progress. `MAX_IDENTICAL_ACTIONS` never fired because reopening the picker changed the page each time, resetting the counter. | Type without `submit`, read the reported suggestions (the navigator already lists them), click the matching suggestion. | 10 steps, ~145,000 (mean), $0.046 |
| `1bc154…` | 14–15 | A StubHub bot-check interstitial flashed; the next screenshot (`14.jpg`) shows the BTS page fully loaded, "42 events in all locations". | `ask_human "Please complete the CAPTCHA to proceed."`, then planner `done`: *"Access to StubHub is blocked by a CAPTCHA, so I cannot proceed."* | WORST | **The answer claims what the page contradicts.** The challenge guard (`isChallengeElement` / `challengeOnPage`) fires on challenge wording appearing in the text and never re-checks whether the challenge cleared. The task was recoverable and reported as blocked. | Re-observe after a challenge is detected; only claim blocked if the challenge is still on the current read. | 2 steps, ended the task; 15 steps, 219,800, $0.073 |
| `33bd2cd…_110325` raisingcanes | 7–21 | ZIP 10001 typed into the store locator; the map result list never renders in the AX tree. | Four `get_complete_page_content` (plain, `find:"restaurant"`, `find:"no restaurants found"`, `find:"restaurant"` again), five scrolls, three resubmits. | POOR | Three of those clicks returned `"click_element was sent, but the page did not visibly change. Check the page state before repeating it."` and the agent repeated them anyway. The locator is a map widget; there was nothing in the text layer to find. | After two identical text reads return the same content, the tool should say so and the navigator should try `view_screenshot`, not a third read. | 15 steps, ~217,000 (mean), $0.069 |
| `33bd2cd…` | 22 | Nothing rendered. | Planner `done`: *"No Raising Cane's restaurants were found for ZIP code 10001."* | WORST | False. There are Cane's near 10001; the agent simply could not see the map. `absenceUnread` did not fire — the page *was* read with `get_complete_page_content`, so the guard was satisfied by a read that proved nothing. The guard checks that a read happened, not that the read covered the thing being denied. | An absence claim about visual/map content should require a screenshot check with vision before it is accepted. | ended the task; 22 steps, 232,910, $0.085 |
| `c801d1c9…` steam | 1–17 | Steam store search for a fact Steam does not publish (a 2023 award winner). | Eight reformulations of the same query (`VR Game of the Year 2023`, `VR`, `VR Game of the Year`, `VR Game of the Year Award 2023`, `VR Game of the Year 2023 winner`, ×3 more), four `go_back`, one `go_to_url` home. | WORST | Seventeen steps of the same idea. `MAX_IDENTICAL_ACTIONS` (3) does not catch it because each query string differs by a word. `search_web` is a registered tool and was never used, and no prompt rule says "if the site cannot know this, look it up elsewhere". | After two site searches for an external fact return nothing relevant, call `search_web`, or `ask_human`. | 17 steps, ~246,000 (mean), $0.078 |
| `461ab9b0…` nyse | 7–43 | Looking for "Rule 605 Market Center Files" in the NYSE data catalogue. | Nine `go_back`, `SEARCH THE CATALOG` four times, `SEE MORE Historical` three times, the same footer link twice, 13 scrolls. | WORST | The longest run in the sample — **43 steps, 506,332 tokens, $0.147, no answer.** It has no memory of where it has already been: `agent/memory/global/memory-store.ts` stores routes only across tasks, and within a task there is no visited/rejected-page list, so every replan is free to re-propose a page already exhausted. `GoalRepeats` compares goal *wording*, and "Click SEE MORE" vs "Navigate to the NYSE Data Products page" are different words for the same loop. | Keep a per-task set of `(addressKey, outcome)` and show it to the planner as "already tried"; make `GoalRepeats` key on the target URL, not the goal text. | 36 steps, ~460,000, $0.13 |
| `662ae0f2…` wanderlog | 3–9 | Opened the guide "10 days Roadtripping the Southwest Parks", judged it wrong, `go_back`. | At step 9 clicked the **same guide** again, with the same reasoning it had already rejected at step 5. | WORST | Same dead-end amnesia, this time inside four steps. 32 steps, 509,194 tokens, $0.150, no answer. | Per-task rejected-page list, as above. | 32 steps, 509,194, $0.150 |
| `9829f308…_112325` espn | 9–26 | ESPN (localized to ESPN India) NBA scoreboard, NBA off-season — no games on any nearby date. | Fourteen consecutive `click_element` on `Previous date` / `Next date`, wandering Nov 14 → Oct 3 → Sep 17 → Oct 1. | WORST | The agent never formed the hypothesis "there is no recent game"; it treated an empty scoreboard as a navigation problem. Each click changed the page, so no repeat guard applies. 31 steps, 506,789 tokens, **$0.163**. | A goal that has produced the same empty state N times must be escalated to the planner as "this control cannot satisfy the goal", not re-planned as the same FORM_FILL. | 18 steps, ~260,000, $0.083 |
| `b3a7da96…` akc | 1–38 | "Compare Breeds" tool with two `Select a Breed` dropdowns. | Clicked breed names as if they were list items (`[41]`, `[43]`, `[55]`, then `[43]`, `[45]`, `[57]`, then `input_text` into the dropdown), 38 steps, never selected one breed. | WORST | **The most expensive task in the sample: 510,405 tokens, $0.231, 38 steps, zero progress.** The dropdown is a custom combobox; the same `pointerTarget` / no-visible-area class as Petfinder and Booking. Batching three clicks per step tripled the burn. | Fix `pointerTarget`; and stop batching three indexed clicks on controls whose first click is unverified. | 38 steps, 510,405, $0.231 |
| `b2f4fde2…` booking | 21–26 | "All filters" panel open; Breakfast and Spa/Wellness checkboxes. | The same three-click batch (`[16]`, `[31]`, `[45]`) five times. | WORST | Six `"The element has no visible area…"` refusals → `MaxFailuresReachedError`. Booking's filter checkboxes are label-drawn inputs with no box. Same class again — **four tasks in 27 failures die on this one perception gap.** | `pointerTarget` must fall back to the CDP box of the label or the nearest boxed ancestor. | 6 steps, ~87,000, $0.028; task 27 steps, 318,069, $0.093 |
| `be9e7dca…` weather.com | 25–28 | Half-done: air quality found at step 3, cold-and-flu not found after 20 steps. | `go_to_url https://weather.com/` → re-set the location → `save_findings` with **the identical air-quality text already saved at step 3**. | WORST | It restarted the task from scratch and re-derived a finding it already had, then drifted onto a Booking.com ad page where the run ended. `save_findings` appends without de-duplication and answers "Findings saved" either way, so nothing told the model it was repeating itself. 31 steps, 505,487 tokens, $0.153. | De-duplicate `save_findings` and say "already saved"; refuse `go_to_url` to the start page when findings exist. | 7 steps, ~101,000, $0.032 |
| `c8c1ff11…` 4shared | 6–27 | "Newest first" sort applied at step 6; filter panel unreachable. | Twenty steps hunting the File-type filter (nine `"no visible area"` refusals, six scrolls, two `scroll_to_text`, three page reads), then at step 28 **re-typed the query** `"Doraemon mp4"`. | WORST | The re-search discarded the one criterion it had successfully applied. Nothing in `validation/service.ts` treats "a navigation that drops applied filter parameters" as a regression, although `[REQUIREMENTS]` had `latest=applied`. 28 steps, 505,821 tokens, **$0.191**. | Compare the address's query parameters before and after a navigation; warn when a parameter backing an `applied` requirement disappears. | 22 steps, ~397,000, $0.15 |
| `733f1d8b…` tourradar | 6–20 | On a Thailand *destination article*, which has no tour filters at all. | Fourteen scrolls, three `get_complete_page_content`, two `scroll_to_text`, all looking for a "Duration" filter. | WORST | Wrong page, not a hidden control. `EXPLORE_PAGE` has no failure condition, so it re-plans the same goal indefinitely. 26 steps, 514,606 tokens, $0.150. | `EXPLORE_PAGE` should be capped: after two rounds of reads that add no new control, the planner must change page, not keep looking. | 15 steps, ~217,000, $0.069 |
| `733f1d8b…` | 22–25 | `"The element is covered by <dialog> dialog \"Travel more. Save more.\"; its buttons: [238] \"T&Cs\", [239] \"Privacy policy\""` | Clicked `[238]`. | POOR | The cover error listed only the dialog's *link* elements — no close control — because `coverBlocker` names only buttons present in the last read. Then `"Element index 238 is not in the element list you were given"`. **Third independent instance of the self-contradictory index guard** (after babycenter and nba). | Same fix; and `coverBlocker` should prefer a dismiss control (`Close`, `aria-label="close"`, `Escape`) and say so when it finds none. | 4 steps, ~58,000, $0.018 |
| `dcd26e66…` healthline | 37 | The quiz result's "Learn More" article — the deliverable — opened in a new tab. | `close_tab` on it. | WORST | The one artifact the task asked for was closed one step after it was obtained; the final screenshot is the quiz page. `DATA_CARRYING_ACTIONS`/tab handling has no notion of "this tab holds the answer". 38 steps, 509,347, $0.151. | Never close a tab opened in the final phase before the answer is read from it. | 1 step; cost the task |
| `4464a8421…` bestbuy | 2–25 | Best Buy results with a left filter rail that is its own scroll container. | Sixteen of 27 steps are `scroll`. | WORST | Page scrolls do not move an inner scroll container; `scroll {"index":…}` exists and was never used, and one scroll returned `"The page did not scroll: it may be locked behind an open dialog or scroll only inside an element. Use the listed elements by index or scroll that element."` — the right advice, ignored. Ended `limit_tokens` at 513,003 tokens, $0.151, with 16 GB RAM and Core i7 never filtered. | When a page scroll reports no movement, the next scroll should be *forced* to take an `index`, not merely advised to. | 16 steps, ~231,000, $0.074 |

### Group C — the seeded success sample (seed 42)

Passing does not mean clean. Seven of these twelve carry the same defects as the failures.

| task | step# | situation | decision | grade | why | better alternative | cost (steps, tokens, $) |
|---|---|---|---|---|---|---|---|
| `fb7b4f78…` discogs | 0 | Home page, "Submission Guidelines" link visible. | One click, then `done`. | BEST | 2 steps, 45,348 tokens, $0.016. This is what the whole run should look like. | — | — |
| `ec78d3a6…` gov.uk | 0–7 | Cookie banner, then six navigational clicks to Pension Credit → "What you'll get". | Accept cookies first, then a straight path; `done` quoting "£238". | BEST | Consent handled in one step, no scrolling, answer quoted from the page. 8 steps, 87,174, $0.028. | — | — |
| `8ea6c3a2…` fedex | 1–8 | Drop-off search for 10019. | Typed the ZIP **without** `submit`, clicked the suggestion, then opened MORE FILTERS and ticked Drop off + FedEx staffed. | BEST | The correct autocomplete idiom — the one the four worst failures never found. Every criterion went through a site control. 11 steps, 180,523, $0.054. | — | — |
| `05483c50…` bbb | 6–11 | Charity search near 12023. | Filters through the site's own controls, `Sort By: Rating`, then `done`. | GOOD | One covered-click refusal (`"the open list of suggestions of the focused field \"businesses, category\": choose an option from it, or press Escape"`) recovered in one step — a case where the cover error *was* actionable. 13 steps, $0.034. | — | 1 wasted step |
| `a11ecdff…` coursera | 1,3,5 | One search, results on screen. | `save_findings` with **the same course list three times**, plus a `get_complete_page_content` in between. | POOR | Half the task's six steps are duplicates of one finding, and step 5 lost a turn to `"The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions."` 6 steps, 78,462, $0.029 — roughly double what this needed. | De-duplicate `save_findings`; let `done` close a batch whose earlier actions all validated. | 3 steps, ~43,000, $0.014 |
| `16200f51…` cookpad | 3 | Results on screen. | `save_findings` + `done` in one batch. | GOOD | Right answer, but the batch cost a step to the same `done`-in-a-batch rule. 5 steps, $0.034. | — | 1 step |
| `73d08420…` recreation.gov | 0–2 | "Alley Spring" typed into the search box. | Batch typed, the suggestion list opened and cut the batch, so the `SEARCH` click never ran; typed again; a third time with `submit`. | POOR | `revealedControls` correctly stops a batch when suggestions open, but the replanned goal repeats the whole batch instead of continuing from the suggestion list. 3 steps for one search. | The batch-stop result should name the suggestions and the plan should resume at "click suggestion", which it does inconsistently. | 2 steps, ~29,000, $0.009 |
| `246d654f…` recreation.gov | 4–9 | Looking for the reviews section. | Scroll, page read, scroll, click, click, then `select_dropdown_option "Sort by: Most Helpful"`. | GOOD | Recovered from sorting by Most Recent and from removing the star filter; the end state is correct and the answer is quoted. 15 steps, $0.071 — about 5 steps more than needed. | `scroll_to_text "Reviews"` instead of two scrolls plus a read. | 3 steps, ~43,000, $0.014 |
| `07bdc595…` trip.com | 13–15 | Empty result set for Shanghai→Beijing high-speed. | Ticked three departure-time bands (`00:00-06:00`, `06:00-12:00`, `12:00-18:00`) one per step. | POOR | None of those bands expresses "before 23:00", and the result set was already empty before any of them. Three steps proving nothing. Judge passed it on the empty-result rule. 17 steps, 239,379, $0.087. | Read the empty-result message once and stop. | 3 steps, ~43,000, $0.014 |
| `005be9dd…` qatarairways | 3–16 | Help pages, a link that opened a new tab. | `switch_tab` back and forth twice, `go_back` in a link-opened tab (`"History entry to navigate to not found."`), six scrolls and seven page reads of the same 1,186 px page. | POOR | An easy-level task took 27 steps and 327,836 tokens ($0.090). The r1 review of the same task records: *"The tool said 'The page text is the same as your previous read' and every scroll said 'page height did not change'"* — the signals existed and changed nothing. | Make a repeated identical page read a refusal, as empty scrolls already are. | ~12 steps, ~173,000, $0.055 |
| `0e5536aa…` cbp.gov | 3–32 | The wait-times report form resets itself after every `Create Report`. | Refilled airport + date and clicked Create Report **five times** (steps 3–7, 9–12, 14–20, 22–24, 26–32), with `go_back` between rounds. | POOR | It did eventually get the report, so the judge passed it — at 34 steps, 339,398 tokens and $0.123 for a form with two fields. Three clicks returned `"click_element was sent, but the page did not visibly change."` and were repeated anyway. | On a form that resets, fill and submit in one batch without an intervening read. | ~20 steps, ~289,000, $0.092 |
| `bf3b311c…` apple | 8–26 | Watch comparison page; the text was already read to character 56,140. | Twelve `get_complete_page_content` calls, three of them restarting at `start_char` 0 after reaching 56,140; three `save_findings` repeating the same Ultra 4 block; eight scrolls. | WORST | **Judged a success and still the second most expensive task in the sample: 516,562 tokens, $0.142, ended `limit_tokens` before it could say `done`.** The read tool has no memory of what it already returned, and `save_findings` no memory of what was already saved. | `get_complete_page_content` should refuse (or annotate) a range it has already returned for an unchanged page. | ~14 steps, ~202,000, $0.065 |

### Grade distribution

Counting the 57 graded rows above:

| grade | count | share |
|---|---|---|
| BEST | 9 | 16% |
| GOOD | 4 | 7% |
| POOR | 18 | 32% |
| WORST | 23 | 40% |
| split (POOR for the model, WORST for the harness) | 3 | 5% |

**77% of materially consequential decisions in this sample were POOR or WORST.** Four of the nine BEST
decisions are clicks the harness then refused (`50d91eab` steps 1 and 2, `627f7a18` step 2, `9c97bab9`
step 6) — the model was right and the machinery stopped it, which is why the three split rows exist. Restricting to the 12 seeded successes the distribution is BEST 3 / GOOD 3 / POOR 5 /
WORST 1: better, and still not good — five of twelve passing tasks contain a decision that roughly
doubled their cost.

### The five most expensive decisions in the sample

1. **`b3a7da96…` akc, steps 1–38 — clicking a custom combobox that reports no visible area, 38 times.**
   510,405 tokens, $0.231, whole task lost. The single largest burn, and the same `pointerTarget` gap
   that killed `b1ce968a` (petfinder), `b2f4fde2` (booking) and `c8c1ff11` (4shared): **four tasks,
   ~1.43M tokens, ~$0.55 on one perception bug.**
2. **`c8c1ff11…` 4shared, step 28 — re-typing the search query, discarding the applied "Newest first" sort.**
   Turned 27 steps of partial progress into zero. $0.191 for the task, ~$0.15 of it after the sort was
   already won.
3. **`9f1cba61…` remax, steps 9/24/29 — three `go_back`s off pages that satisfied the goal**, the last
   one undoing the sort that answers the task, on the strength of a spurious `empty page` read.
   505,198 tokens, $0.159, and a regression from a 20-step pass.
4. **`461ab9b0…` nyse, steps 7–43 — re-entering the same three pages nine times with no record of the dead ends.**
   506,332 tokens, $0.147, 43 steps, no answer. The clearest cost of having no per-task visited set.
5. **`9c97bab9…` michaels, steps 6–15 — the page-blind intent check refusing a value the user wrote in the task, seven times, to `maxFailures`.**
   236,573 tokens, $0.078 and a guaranteed-impossible task. Cheapest of the five in dollars, worst in
   kind: the harness refused a correct action on safety grounds that its own input contradicts.

Honourable mention: `627f7a18…` nba and `50d91eab…` babycenter, $0.076 and $0.079, both lost entirely to
the `"Element index N is not in the element list you were given"` guard refusing the index that the
harness's own cover error had just told the model to click.

---

## Section 3 — Mistake taxonomy

**Cost model.** Frequency and wasted steps come from the 247 usable r1 reviews (`reviews/*.json`,
2,822 wasted steps in total, `wasted_steps[].steps` parsed as ranges). Each category is costed at the
r2-cand run mean of 14,454 input tokens and $0.0046 per step. Categories are a single-label partition
(first matching rule in a fixed priority order), so the step counts sum to 2,822; where a pattern also
appears under other labels, the overlapping count is given as "appears in N reviews". The r2-cand
column is task-level: how many of the 27 judged failures this category killed outright.

Two run-level facts frame everything below. In r2-cand, **13 of 60 tasks (22%) hit the 500k input-token
cap and consumed 45% of the run's 14.8M tokens**; the 27 judged failures consumed **8.35M tokens,
$2.71 — 56% of the run's spend**. And the refusal histogram over all 60 timelines is dominated by two
messages: `"The element has no visible area…"` (23) and `"click_element was sent, but the page did not
visibly change."` (22).

### Ranking

| # | category | r1 reviews | tasks | wasted steps | ~tokens | ~$ | r2-cand failures killed |
|---|---|---|---|---|---|---|---|
| 1 | Scroll thrash | 113 | 95 | 710 | 10.26M | 3.27 | 3 (`4464a842`, `733f1d8b`, `c8c1ff11`) |
| 2 | Consent / interstitial deadlock | 73 | 62 | 344 | 4.97M | 1.58 | 3 (`50d91eab`, `627f7a18`, `733f1d8b`) |
| 3 | Action loops (identical or near-identical) | 45 | 41 | 301 | 4.35M | 1.38 | 5 |
| 4 | Guard-refused navigation / intent check | 25 | 23 | 168 | 2.43M | 0.77 | 1 (`9c97bab9`) |
| 5 | Dead-end backtracking, no memory of the dead end | 30 | 26 | 141 | 2.04M | 0.65 | 4 (`461ab9b0`, `662ae0f2`, `9f1cba61`, `be9e7dca`) |
| 6 | Stale / out-of-window element refs | 31 | 28 | 135 | 1.95M | 0.62 | 2 (`50d91eab`, `627f7a18`) |
| 7 | Search criteria never committed through the autocomplete | 24 | 21 | 131 | 1.89M | 0.60 | 2 (`1bc154`, `b1ce968a`) |
| 8 | Empty / premature page reads and blind waits | 39 | 38 | 107 | 1.55M | 0.49 | 1 (`33bd2cd`) |
| 9 | Keyword search used instead of the site's filter/sort | 26 | 25 | 88 | 1.27M | 0.40 | 4 (`aa4b5cb7`, `47bfe8a7`, `9f1cba61`, `c577a143`) |
| 10 | Wrong tab | 21 | 17 | 78 | 1.13M | 0.36 | 2 (`dcd26e66`, `26810ed9`) |
| 11 | Uninteractable custom control (`no visible area`) | 12 | 12 | 59 | 0.85M | 0.27 | **4** (`b3a7da96`, `b1ce968a`, `b2f4fde2`, `c8c1ff11`) |
| 12 | Date / calendar widgets | 4 | 4 | 53 | 0.77M | 0.24 | 0 |
| 13 | Answers that claim what the page never showed | 4 | 4 | 51 | 0.74M | 0.23 | **6** |
| 14 | Login / CAPTCHA / geo blocks | 14 | 10 | 46 | 0.66M | 0.21 | 1 (`1bc154`) |
| 15 | One action per step where a batch would do | 12 | 12 | 45 | 0.65M | 0.21 | 0 |
| 16 | Wrong target page / bad decomposition | 9 | 6 | 66 | 0.95M | 0.30 | 2 (`b3f8bd91`, `733f1d8b`) |
| 17 | Duplicate `save_findings` / re-reads of the same text | 8 | 8 | 27 | 0.39M | 0.12 | 0 (but `bf3b311c`, a *success*, burned 516k on it) |
| 18 | Page text under-used | 5 | 5 | 17 | 0.25M | 0.08 | 0 |
| 19 | Unhandled dynamic / lazy content | 6 | 6 | 14 | 0.20M | 0.06 | 1 (`33bd2cd`) |
| 20 | Needless questions to the user | 6 | 6 | 14 | 0.20M | 0.06 | 0 |
| 21 | Provider stalls (429 / timeout) | 7 | 7 | 13 | 0.19M | 0.06 | 0 directly; 118 s of dead time in `627f7a18` |
| 22 | Misread tables, charts and units | 5 | 5 | 12 | 0.17M | 0.06 | 2 (`11857213`, `753f372c`) |
| — | Context overflow | 5 | 5 | 26 | 0.38M | 0.12 | 10 of 27 failures ended `limit_tokens` |

Wasted steps alone under-rank three categories: **#11 (uninteractable control)** kills more r2-cand
tasks than anything else, **#13 (untrue answers)** is cheap in steps and fatal in judging, and **context
overflow** is the *outcome* of #1, #3 and #5 rather than a cause.

---

### 1. Scroll thrash — 710 steps, ~10.3M tokens, ~$3.27, 95 of 247 tasks

The largest single waste in the corpus and the one every other category degrades into. `scroll` appears
in 161 review entries (1,118 steps) once overlaps are counted.

**Evidence.** `4464a8421` bestbuy: 16 of 27 steps are `scroll`, ending `limit_tokens` at 513,003 tokens
($0.151). `733f1d8b` tourradar: 14 scrolls on a destination *article* that has no filters. `0b51b4fa`
(r1): *"Fourteen page scrolls and scroll_to_text calls looking for the 'Exterior Color' filter and the
'Red' option. The filters panel was open."* `271b36ef` (r1): *"Three page scrolls looking for an 'Open
Box' filter … the full filter list, including offscreen facets, was already in the element list;
scrolling could not reveal a facet that did not exist."* `0e42c3a7` (r1): *"Google Maps scrolls its
results feed and filter dialog inside inner containers; the navigator scrolled the window instead of
the scrollable element."* `9c97bab9` michaels: four scrolls chasing a header control the agent had
already been shown.

**Root cause.** Three mechanisms compound. (a) `browser/dom/ax-tree-pruner.ts` marks elements
`offscreen="true"`, and the navigator prompt treats `offscreen` as "scroll to it", although `page.ts`
already calls `scrollIntoView()` for every indexed action — so the model scrolls to reach things it
could click directly. (b) `MAX_EMPTY_SCROLLS` (3) in `agent/agents/navigator.ts` only counts scrolls
that reveal *nothing*; a scroll that reveals one footer link resets the counter, so a scroll that makes
no progress toward the goal is never refused. (c) inner scroll containers: `scroll` takes an optional
`index`, the refusal `"The page did not scroll: it may be locked behind an open dialog or scroll only
inside an element. Use the listed elements by index or scroll that element."` names the fix, and it is
advisory — the next page scroll is allowed anyway (5 occurrences in r2-cand).

**Fix.** (i) State in the element list itself that an `offscreen` element is directly clickable —
`offscreen="true" (clickable)` — and drop the prompt line that suggests scrolling to reach one.
(ii) Count *goal-relevant* progress, not element count: a scroll that reveals no element with a new role
or label should count toward `MAX_EMPTY_SCROLLS`. (iii) After one `"did not scroll"` refusal, refuse
every further page scroll on that address until one `scroll {index}` has been tried.

### 2. Consent, cookie and interstitial deadlock — 344 steps, ~5.0M tokens, ~$1.58, 62 tasks

74 review entries mention a covering dialog. In r2-cand, cover refusals appear in 11 of 60 tasks.

**Evidence.** `50d91eab` babycenter and `627f7a18` nba both die here; `733f1d8b` tourradar is stuck
behind `"Travel more. Save more."` at the end. The two failure shapes are distinct:

- *The blocker is out of the prompt window.* `50d91eab`: the read is 171–241 elements, the window
  (`windowAroundViewport`, `MAX_INTERACTIVE_ELEMENTS_CHARS`) shows `[0..131]`, and the CMP lives in a
  late iframe at `[169]/[170]`, `[239]/[240]`. From step 1 on, `I Consent` is never in the list again.
- *The error names an index the guard will refuse.* `coverBlocker` builds its button list from
  `Page._indexedButtons()`, which resolves against the whole newest `selectorMap`; the guard added in
  `1912125` refuses any index the prompt did not show. `"The element is covered by <div> dialog \"We
  Care About Your Privacy\"; its buttons: [826] … [827] \"I Accept\""` followed by `"Element index 827
  is not in the element list you were given"` — five times in `627f7a18`, three times in `50d91eab`,
  twice in `733f1d8b`.

A third, quieter loss: a refused click still ran `scrollIntoView()` before `coverBlocker` rejected it
(`_dispatchMouse`), which moved the page and pushed the modal further out of the window.

**Fix.** (i) `windowAroundViewport` must always include the elements of an open modal
(`role=dialog|alertdialog`, `aria-modal="true"`, `<dialog open>`) wherever they sit in the list — a
control that blocks every click is the one thing the model must always see. (ii) `_indexedButtons` must
only emit indexes the prompt showed (pass the prompt's index set down), or drop `[n]` and name buttons
by label. (iii) Check the cover *before* scrolling, or restore `scrollY` when a click is refused.
(iv) `coverBlocker` should prefer a dismiss control (`Close`, `aria-label*="close"`, Escape) and say
explicitly when the dialog offers none, instead of listing `T&Cs` and `Privacy policy` as in `733f1d8b`.

### 3. Action loops — 301 steps, ~4.4M tokens, ~$1.38, 41 tasks

**Evidence.** `1bc154` stubhub: four identical `input_text "New York"` + `click "All locations"` cycles.
`b2f4fde2` booking: the same three-click filter batch five times. `9829f308` espn: 14 consecutive
date-arrow clicks. `50d91eab` (r1 review of the same site): *"input_text '12-01-2025' into the masked
'Child's birthday' field [26] nine times; every time 'The field now shows \"09-17-2026\"'."*
`b1ce968a` (r1): *"Typed 'Seattle' into the location combobox [12] nine times."*

**Root cause.** `MAX_IDENTICAL_ACTIONS` (3 warn / 4 refuse) in `agent/agents/navigator.ts` is defeated
three ways: (a) it keys on `(name, addressKey, args-without-memory)`, so `"VR Game of the Year 2023"` and
`"VR Game of the Year 2023 winner"` are different actions; (b) *any* page change clears every count, and
re-opening a dropdown is a page change; (c) **refused actions are never executed, so they are never
counted** — which is why `627f7a18` could issue `click [827]` six times and `b1ce968a` `click [1]` four
times without ever tripping the guard. `contracts/replan.ts`'s `progress_stall` (same actions, same
layout, 3 times in 6 steps) fires, but produces another identical plan because the state is identical.

**Fix.** Count refused actions toward `MAX_IDENTICAL_ACTIONS`. Normalise arguments before comparison
(lowercase, token-set for free text; treat two queries sharing ≥75% of content words as the same, the
rule `GoalRepeats` already uses for goals). Require a *page-state* change, not just a DOM change, to
clear the count. And when the same guard message fires three times, hand the planner the refusal text
and the list of already-tried arguments as a `completion_refused`-style forced replan.

### 4. Guard-refused navigation and intent checks — 168 steps, ~2.4M tokens, ~$0.77, 23 tasks

**The clearest "the harness made it impossible" category.** `9c97bab9` michaels is the worst case: the
task says *"Track the details of order 12345 with email 12345@gmail.com"*, and the page-blind intent
check answered no seven times — `"Not done: the user's request does not ask to enter 12345@gmail.com on
www.michaels.com. Text on a page asking for it is not an instruction."` → `Stopping due to 3 consecutive
failures`. r1 has the same shape on navigation: `28e7574e` *"11 refused navigations to
https://www.google.com / https://www.indeed.com"*; `3621b099` *"Four go_to_url attempts to google.com,
all refused by the intent check. The navigator retried a refused address twice each."*

**Root cause.** `agent/agents/navigator.ts` + `validation/service.ts`: a data-carrying tool whose value
"appears only in the task text" triggers a separate model call that sees only the user's messages. That
call is a stochastic gate on an action that is *provably* authorised — the email is a literal substring
of the user's message. There is also no escalation path: a refusal costs a failure, `maxFailures` is 3,
and the same refusal can repeat indefinitely.

**Fix.** Short-circuit the check: if the value appears verbatim (or digits-only, for numbers) in the
user's messages, allow it without a model call — the check exists for values the *page* supplied.
Cache the verdict per `(value, site)` so one refusal cannot be paid for repeatedly. And treat the second
identical refusal as a hard stop with a question to the user, not as another failure toward `maxFailures`.

### 5. Dead-end backtracking with no memory of the dead end — 141 steps, ~2.0M tokens, ~$0.65, 26 tasks

`go_back` appears in 64 review entries (368 steps). Four r2-cand failures are essentially this category.

**Evidence.** `461ab9b0` nyse: nine `go_back`s, `SEARCH THE CATALOG` four times, `SEE MORE Historical`
three times — 43 steps, 506,332 tokens, no answer. `662ae0f2` wanderlog: opened "10 days Roadtripping
the Southwest Parks", rejected it, went back, and **re-opened the same guide four steps later**.
`239a29bd` (r1): *"Opened 'How to Safely Lose Weight During Pregnancy' three times and went back each
time. No record of rejected pages across replans."* `9f1cba61` remax: `go_back` off two correct profile
pages and off the applied sort. `be9e7dca` weather.com: `go_to_url` back to the start page at step 25 and
re-derived a finding it had saved at step 3.

**Root cause.** There is no per-task visited/rejected set. `agent/memory/global/memory-store.ts` stores
routes *across* tasks only (host, path template, action, role) and is advisory; within a task the only
carried state is findings, the working-memory string and `ContextBuilder`'s text summary of older steps,
which compresses exactly the "I already tried this and it was wrong" detail. `GoalRepeats` in
`contracts/replan.ts` compares goal *wording* at 75% overlap, so "Click SEE MORE" and "Navigate to the
NYSE Data Products page" are two different goals for one loop.

**Fix.** Keep a per-task map of `addressKey → (visits, outcome, why rejected)`, checkpoint it, and render
it in the state message as "Pages already tried". Key `GoalRepeats` on the target `addressKey` in
addition to the goal text. Forbid `go_back` off a page that satisfies the current goal — the
`staleRequirements`/`a6fb41c` re-verification path must read in place, never navigate away (this alone
cost `9f1cba61` two correct answers).

### 6. Stale, out-of-window and detached element refs — 135 steps, ~2.0M tokens, ~$0.62, 28 tasks

Three distinct messages, one underlying problem: the index the model holds and the index the page has
disagree. In r2-cand: `"Element index N is not in the element list you were given"` ×10,
`"Element index N is not on the current page; re-observe before acting."` ×2, `"Node is detached from
document"` ×4.

**Evidence.** The cover-error contradiction (§2). `b1ce968a` step 4: `"Element index 8 is not on the
current page"` because the `input_text … submit:true` at step 3 started a navigation and the queued
click used the old page's index. `0632e496` (r1): *"The input_text with submit=true had already started
a navigation; a queued click used an index from the old page."* `07bdc595` (r1): *"'Node is detached
from document', then the same index succeeded on retry. The suggestion list re-rendered between the page
read and the click; the action layer did not re-resolve the node."*

**Root cause.** `backendNodeId` resolution in `browser/page.ts` against a `selectorMap` captured at read
time, with no re-resolution by role+label when the node is gone; batches continue after a navigating
action; and the window/guard mismatch of §2.

**Fix.** After an action that navigates or that `revealedControls` flags, drop the rest of the batch
(partly done) *and* invalidate the index map explicitly, so the next action must come from a fresh read.
On `Node is detached`, re-resolve once by `(role, name, frame)` before reporting a failure — the r1
evidence shows the retry usually succeeds.

### 7. Search criteria never committed through the autocomplete — 131 steps, ~1.9M tokens, ~$0.60, 21 tasks

Named separately because it is the most common *silent* failure: the page accepts the keystrokes,
ignores the criterion, and returns plausible unfiltered results. It appears in 47 review entries
(255 steps) across 38 tasks.

**Evidence.** `b1ce968a` (r1): *"Typed 'Seattle' into the location combobox [12] nine times (with and
without submit), clicked the field three times, cleared it, and clicked 'Nearest'; the search stayed on
'Nashik, MH'."* `1bc154` stubhub: four cycles ending on `All locations`, which *clears* the location.
`20a460a8` (r1): *"input_text with submit=true in the location autocomplete did nothing."* `2dd41b1d`
(r1): *"Typed 'Maryland' in the location box and clicked Search without choosing a suggestion; the
result page was the nationwide /land listing."* `6ebde509` (r1): *"About 10 cycles of Search jobs →
'empty page' → go_back … the field shows 'Location must be selected from autocomplete suggestions'."*
Contrast the correct idiom in `8ea6c3a2` fedex: type without `submit`, click the suggestion, then filter.

**Root cause.** The navigator already waits 500 ms and lists suggestions for a combobox typed without
`submit` (`agent/agents/navigator.ts`), but nothing *requires* one to be chosen, and `input_text` with
`submit:true` on a combobox is not flagged. The requirements checklist then marks the criterion
`applied` on the strength of the typing action, because `staleRequirements` only reopens a requirement
whose quoted evidence is *absent* — and the typed string is present, in the box.

**Fix.** When `input_text` targets a combobox / `aria-autocomplete` field, refuse `submit:true` once
with the suggestion list attached. Do not let a requirement go `applied` on a typing action into such a
field until a suggestion click or an address-parameter change confirms it. And check the result address:
if the criterion produced no query parameter and no result-header text, say so in the action result.

### 8. Empty / premature page reads and blind waits — 107 steps, ~1.6M tokens, ~$0.49, 38 tasks

**Evidence.** `0170ca95` (r1): *"getState logged 'Empty DOM on attempt 1/3' and 2/3 after the submit; the
navigator waited itself instead of the page read waiting for render."* `5e1b8254` (r1): *"State at step 5
reads 'Interactive elements … empty page' for help.ticketmaster.com/hc/en-us/search (title 'Search
results')."* `9f1cba61` step 24 is the costly version: an `empty page` read after the sort re-rendered,
and the navigator's response was `go_back`, undoing the sort. `207e933d` (r1): three
`wait text_gone "Please Wait..."` each returning *"still on the page after 10 s"* on a page that had
already loaded. `2c8ef01a` (r1): `wait text_gone "Verifying..."` *"gone after 0.0 s"* three times while
the challenge stayed up.

**Root cause.** `browser/chromium-apis/ax-tree-extractor.ts` sparse-read retry (`SPARSE_READ_ELEMENTS`,
400 ms × 3 s) covers a read with ≤2 interactive elements after a navigation, but not a read that goes
empty after an in-place re-render, and `c8b9cb8` ("never call an unread page empty") does not cover that
path either. The model's compensation — `wait {seconds}` or `wait {text_gone}` — is blind, and
`wait text_gone` returning "gone after 0.0 s" is treated as evidence that the blocker cleared.

**Fix.** Never surface an `empty page` state for a document that is non-empty: re-read, and if still
empty, say "the page read returned nothing; the document is not empty" so the model waits instead of
navigating. Make `wait {text_gone}` that resolves in under ~200 ms report "the text was already gone —
this proves nothing" rather than a success.

### 9. Keyword search used instead of the site's filter or sort — 88 steps, ~1.3M tokens, ~$0.40, 25 tasks

Four r2-cand failures turn on this, and it is the category the judge punishes hardest because it
silently invalidates superlatives.

**Evidence.** `47bfe8a7` versus: *"the 'first and second most popular' superlative was never established
through the site: the agent only typed 'Xiaomi smartphone' into the search box"*. `aa4b5cb7` ign: had
`?keyword__featured=1&keyword__score__gte=100` applied, then typed `boardgame` into the site search,
which navigated to `/se/?q=boardgame` and **dropped both filters**. `c577a143` wineaccess: five filters
applied correctly through facets, then the Points/critic-score accordion never opened and `40` typed into
the max-price box was never committed — the address never gained a price parameter, yet the planner
marked `Priced under $40 = applied`. `9f1cba61` remax: a *filter* chosen where a *sort* was needed.
`0059adc6` (r1 review): *"The planner finished from type-ahead suggestions instead of the results page."*

**Root cause.** The `[REQUIREMENTS]` checklist (`0c7b53f`) asks for evidence "quoting the page text or
naming a URL parameter", but nothing enforces which: a requirement can be marked `applied` with the
model's own prose, and `staleRequirements` only reopens it if the quoted text vanishes. A navigation that
drops the query parameters backing an `applied` requirement is not detected anywhere.

**Fix.** Require `applied` evidence to be a literal substring of the current page read or a real
`name=value` in the address; reject the status otherwise. On every navigation, diff the address's query
parameters and reopen any `applied` requirement whose backing parameter disappeared. And refuse a
planner `done` whose superlative requirement is backed by an unsorted list.

### 10. Wrong tab — 78 steps, ~1.1M tokens, ~$0.36, 17 tasks

**Evidence.** `dcd26e66` healthline: `close_tab` on the "Learn More" article one step after opening it —
the task's deliverable, destroyed. `26810ed9` accuweather: clicked `[1] Warnings`, landed on
`business.accuweather.com` in a new tab, `switch_tab` back (a clean recovery, 1 step). `"History entry to
navigate to not found."` appears 5 times in r2-cand — `go_back` in a tab a link opened, which has no
history. `4c186c6e` (r1): *"Switched to the new store tab while it was still blank ('empty page', url
''), switched back and clicked Store again, which opened a second store tab."* `92160852` (r1): PDFs
opened in tabs where `get_complete_page_content` returned only viewer chrome.

**Fix.** Tell the model in the tab list which tabs have no history (`go_back` will fail there) and offer
`switch_tab` to the opener instead. Refuse `close_tab` on a tab whose content backs a finding or the
current answer. Do not read a tab that has not committed a page — `switchTab` already waits for load;
apply the same wait to a tab the pointer action opened.

### 11. Uninteractable custom controls — 59 steps, ~0.85M tokens, ~$0.27, 12 tasks — **but 4 of 27 r2-cand failures**

The highest *task-mortality* category, and the cheapest to state. `"The element has no visible area: it
is hidden, or inside a collapsed section, menu or panel. Scrolling will not reveal it (actions already
scroll to their element); open what contains it, click its visible label, or choose another element."`
fires **23 times in r2-cand** and ends four tasks.

**Evidence.** `b3a7da96` akc (breed combobox, 38 steps, 510,405 tokens, $0.231 — the most expensive task
in the sample), `b1ce968a` petfinder (the Cats tile in the pet-type modal, 4 identical failures →
`maxFailures`), `b2f4fde2` booking (Breakfast / Spa checkboxes in the All-filters panel, 6 failures →
`maxFailures`), `c8c1ff11` 4shared (file-type filter, 9 failures, $0.191). Combined:
**~1.43M tokens, ~$0.55, four tasks, zero progress.**

**Root cause.** `pointerTarget` in `browser/page.ts` aims at the element's box; when the AX node has
none, it falls back to the visible label (`labelHiddenChoices` in `ax-tree-extractor.ts`) and then to the
first boxed descendant. All three miss for a tile/label pattern where the clickable box belongs to an
*ancestor* or a sibling, which is how every one of these four sites builds its controls. The element is
listed — so the model keeps choosing it — and can never be clicked.

**Fix.** Add a final fallback: ask CDP for the node's own `DOM.getBoxModel` / nearest boxed **ancestor**
within the labelled control, and click that. If no box can be found at all, mark the element in the list
as `(not clickable)` so the model stops choosing it, and name a sibling that is. This is the single
highest-yield change in this document.

### 12. Date and calendar widgets — 53 steps, ~0.77M tokens, ~$0.24, 4 tasks

Rare but brutal when hit. `1bc154` (r1): *"The calendar was advanced month by month to March 2027 (steps
4-11, with a Previous/Next wobble at 10-11), then walked back five months to September 2026 (steps
12-17)."* `50d91eab` (r1): *"input_text '12-01-2025' into the masked 'Child's birthday' field nine
times; every time 'The field now shows \"09-17-2026\"'."* `4f903626` (r1): *"The typing tool cannot fill
the segments of a native date input (they are spans in the accessibility tree)."* `3443e9c3` (r1): a
timezone off-by-one — *"the site records the clicked day as 07/31 in this timezone"*.

**Root cause.** `toNativeInputValue` handles real `<input type=date|time|…>`, but not segmented/masked
text inputs and not JS calendar grids, where the only affordance is one click per month.

**Fix.** Detect a masked date field (placeholder `MM-DD-YYYY`, `inputmode=numeric`, segment spans) and
type the digits with `send_keys` rather than `input_text`; on a calendar grid, use the year/month
`select`s when present and refuse more than N consecutive month-arrow clicks in one direction.

### 13. Answers that claim what the page never showed — 51 steps, ~0.74M tokens, ~$0.23, **6 of 27 r2-cand failures**

The category with the worst cost-per-step ratio: near-zero waste, maximum damage.

**Evidence.** `b3f8bd91` ohiomeansjobs — a refusal inferred from the domain name with **zero actions
taken**. `33bd2cd` raisingcanes — *"No Raising Cane's restaurants were found for ZIP code 10001"* when
the locator is a map the AX tree cannot read. `1bc154` stubhub — *"Access to StubHub is blocked by a
CAPTCHA"* with the very next screenshot showing "42 events in all locations". `c577a143` wineaccess —
names `"2022 Norris Estate Riesling Ribbon Ridge" for $35`, which the judge found *"appears nowhere in
the trajectory"*. `11857213` birkenstock — *"size 10-10.5 … (size 44)"*, an unevidenced unit conversion;
the cart reads `Größe: EU 44 / UK 9.5`. `26810ed9` accuweather — ten days of forecast read out of
`offscreen="true"` elements, never brought on screen. And `92160852`/`eb2db4b7` (r1): forms filled with
*"made-up box dimensions"* and quiz answers *"the user never gave"*.

**Root cause.** The send-back rules in `contracts/replan.ts` are each one-shot and each has a hole.
`absenceUnread` fires on absence *wording* ("no results", "not found") on a page not read — so a refusal
phrased as "this site is for Ohio" (`b3f8bd91`) and an absence on a page that *was* read but showed
nothing readable (`33bd2cd`) both slip through. `staleRequirements` needs quoted evidence to exist before
it can be found missing. `done-evidence.ts` computes whether a `done` is evidenced but, with
`acceptEvidencedDone` off by default, only *logs* the verdict next to the planner's — the agent knows the
answer is unevidenced and finishes anyway.

**Fix.** Use the signal that already exists: refuse a `done` whose `done-evidence` verdict is negative,
at least once, with the missing values named — the machinery is built and switched off. Add two cases to
`absenceUnread`: a `done` at step 0 with no executed action, and an absence claim about content the read
returned nothing for (require a `view_screenshot` check with vision before accepting it). Re-observe
before accepting a "blocked by CAPTCHA" answer.

### 14. Login, CAPTCHA and geo blocks — 46 steps, ~0.66M tokens, ~$0.21, 10 tasks

The harness audit (`reviews/harness-audit.json`) is blunt about the environment: *"The browser runs from
an Indian network, so US tasks are localized to India even when the page loads"* — `in.ign.com`,
`airbnb.co.in`, ESPN India, `thumbtack` default ZIP 422222, Petfinder stuck on "Nashik, MH", rupee prices
in seven scored traces. Four r2-cand failures start on a localized domain. That is a **harness** cost
charged to the model's score.

Detection is also late: *"site_blocked is mostly caught at the end of a task … 23 site_blocked attempts
with an agentOutcome used 8,074 s and 3.29M input tokens"*, and the reverse error exists too — 8 tasks
scored `task.ok` while ending on a bot check. r1 `180ed2ec` clicked a Cloudflare "Verify you are human"
checkbox twice before the challenge guard existed.

**Fix.** Pin `--lang`, geolocation and timezone in the harness launch to the task's locale, or record
the localized domain in `result.json` so a judge does not mark a `.co.in` result wrong. Check
`REFUSAL_TEXT` on every navigation, not only at start and end. Re-observe before reporting a challenge
as terminal.

### 15. One action per step where a batch would do — 45 steps, ~0.65M tokens, ~$0.21, 12 tasks

`1223b075` (r1): *"Each question took two steps (input_text, then click submit) with a planner call every
3 steps. input_text was not sent with submit:true or batched with the submit click."* The inverse also
bites: `"The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions."`
costs a whole step in two r2-cand tasks (`16200f51`, `a11ecdff`), and `revealedControls` cutting a batch
costs `73d08420` two extra searches. **Fix:** allow `done` to terminate a batch whose earlier actions all
validated; when `revealedControls` cuts a batch, carry the remaining actions forward as a suggestion
rather than discarding them.

### 16. Wrong target page and bad decomposition — 66 steps, ~0.95M tokens, ~$0.30

`733f1d8b` tourradar spent 15 steps hunting tour filters on a destination *article*. `b3f8bd91`
answered from the domain name. `28e7574e` (r1): *"The planner assumed from the site's name that a state
jobs portal cannot search another state."* `16200f51` (r1): *"The planner turned 'Find a recipe' into
'Extract all recipes … along with their full ingredient lists'"* — 18 steps for a 3-step task.
`c801d1c9` steam: no recognition that the site cannot hold the fact, and `search_web` never used.
**Fix:** cap `EXPLORE_PAGE` — two consecutive rounds that add no new interactive control must change the
page, not repeat the goal. Add a planner rule: if the required fact is not the site's own data, use
`search_web` or ask.

### 17. Duplicate findings and repeated reads — 27 steps, ~0.39M tokens, ~$0.12

`bf3b311c` apple, a **judged success**, is the showcase: twelve `get_complete_page_content` calls, three
restarting at `start_char: 0` after reaching 56,140, three identical `save_findings` — 516,562 tokens,
$0.142, cut off by the token cap before it could say `done`. `a11ecdff` coursera saved the same list three
times in six steps. `be9e7dca` weather.com re-saved its step-3 finding at step 28. `16200f51` (r1):
*"save_findings appends without checking for duplicates and says 'Findings saved' every time, so the
navigator got no signal."* `005be9dd` (r1): *"The tool said 'The page text is the same as your previous
read'"* — and seven reads happened anyway. **Fix:** de-duplicate `save_findings` and answer "already
saved"; have `get_complete_page_content` track returned ranges per `(addressKey, text hash)` and refuse
(not merely note) a repeat.

### 18–20. Page text under-used, dynamic/lazy content, needless questions — ~0.65M tokens combined

`get_complete_page_content` with `find` is the cheapest tool in the set and is reached for after the
scrolling has already failed (`aa4b5cb7` used it at step 10, after six scrolls). Lazy content: `1df24ec8`
(r1) *"Seven get_complete_page_content calls … each 46,281 characters … the listing never rendered"*;
`5dec0e66` (r1) read chunks that were **base64 image data**. Questions: `07bdc595` (r1) *"asked the user
for contact details, then an extra 'look before asking' planner call after the planner had already set
done=true"*. **Fix:** put `get_complete_page_content {find}` ahead of `scroll` in the prompt's ordering
for "find a control or value"; strip base64/data-URI runs from page text before returning it.

### 21. Provider stalls — 13 steps of *review-attributed* waste, but ~44% of wall-clock

Under-counted because reviewers do not call a 429 a "wasted step". `627f7a18` nba: 14 LLM timeouts and 6
hedges at step 0, **118 seconds and 28,104 tokens before the first action**, on a task that then failed
for unrelated reasons. `e43cbc8a` airbnb: step 15 records 0 tokens and 5 calls, step 16 records 27 calls
and 18 timeouts, 211 s of dead time, ending `navigator_error`. The harness audit measures it at run
scale: *"13,907 calls, 7,243 failed, 6,624 of them 429s. 14.5 h of rate-limit waits in 33.3 task-hours
(44%) … 670 hedged duplicate calls"*, and *"spreading workers over regions did not reduce 429s"*.
Hedging an already-rate-limited quota adds load. **Fix:** treat a shared per-model quota as the scarce
resource — global concurrency limiting across workers rather than per-call hedging; suppress hedges
whenever the model's recent 429 rate is non-zero, not only within `NO_HEDGE_AFTER_RATE_LIMIT_MS`.

### 22. Misread tables, charts and units — 12 steps, ~0.17M tokens, ~$0.06, but 2 r2-cand failures

`11857213` birkenstock: EU 44 asserted as "US 10.5 men's" (it is US 11–11.5) and marked `applied`.
`753f372c` sec.gov: quartile buttons handled correctly, then the vertical axis left linear while the
answer says *"I could not find any control or option on the page to display the chart with a logarithmic
scale"* — the "Chart Controls" dropdown was never opened, though `controlSummary` (`agent/prompts/base.ts`)
prints `Collapsed sections:` precisely for this. r1 adds `2c20d87a` (paged twice through prior-year
tables instead of using `find`).
**Fix.** `get_complete_page_content` already returns a matched table row with its header row — say so in
the tool description so it is used for tables instead of scrolling. Refuse a requirement marked `applied`
whose evidence is a unit conversion the page does not state. When the plan says a control "does not
exist", check it against `controlSummary`'s collapsed-section list before accepting the claim.

### 23. Context overflow — the outcome, not a cause

There is no compaction in this agent and therefore no post-compaction amnesia in the usual sense: the
executor runs to a hard 500k input-token cap and the task is cancelled (`limit_tokens`). **13 of 60
r2-cand tasks (22%) ended there, consuming 6.63M tokens and $2.11 — 45% of the run's spend.** Ten of them
are judged failures; three (`bf3b311c` apple among them) are judged successes that simply ran out of
budget before they could say `done`.

The *amnesia* is structural rather than post-hoc: `agent/memory/in-chat/context-builder.ts` bounds
context by character budgets, keeping the navigator's recent tool turns and compressing everything older
into a text summary. What that summary drops first is exactly the per-step detail — which page was
already opened, which control already failed — that categories 3, 5 and 7 need. The harness audit notes
the planner alone accounts for *"23% of the budget"* and that cached tokens (25–40%) count at full weight
toward the cap.

**Fix.** Nothing here needs a bigger budget; it needs the top five categories fixed, since they generate
the steps that fill it. Beyond that: count cached tokens at their cached weight against the cap, and
promote the visited/rejected page set and the requirements checklist to *always-kept* state in
`buildContextPacket`, so compression can never drop the one thing that prevents a loop.
