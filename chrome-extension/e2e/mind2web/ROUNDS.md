# Online-Mind2Web improvement rounds

A running record of each benchmark round for WebGenie: the build it ran, the fixes it tested, what the logs showed and what
was kept. It exists so every change to the agent is tracked against measured results, and nothing that worked before is
allowed to break.

## Method

- **Run.** `overnight.sh` runs the tasks over parallel workers on a saved build (`E2E_DIST=e2e/builds/<commit>`). Every
  result records its build, the provider's numbers and complete logs; `verify.mjs` checks the folder end to end.
- **Judge.** `judge.mjs` re-implements WebJudge with gemini-2.5-pro. Scores are indicative only, since the leaderboard
  uses o4-mini.
- **Analyze.** `analyze.mjs` writes `analysis.md`: causes, and every task that did not succeed with its logs.
- **Fix.** Only general, task-agnostic changes, each with unit tests. Nothing names a site or a task.
- **Gate.** A fix round re-runs the failed and mediocre tasks plus a sample of earlier successes, and `compare.mjs`
  checks it against the baseline task by task. A fix is kept when judged successes rise and no earlier success turns into
  a failure beyond run-to-run noise; otherwise it is reverted.
- **Limits.** Diagnostic rounds allow 50 steps, 500k input tokens and 2400 s per task. The final measurement restores
  the benchmark constraints.
- **Unmeasurable tasks.** A site that refuses this network (`site_blocked`) or is down (`site_down`) is left out of
  every score.
- **Traces as feedback.** After a round, every task's trace is reviewed, successes included: how it could have been
  more accurate, taken fewer steps or tokens, or been faster. The general lessons become the next round's fixes.
- **Traces kept.** Each round folder is also compressed into `e2e/archive/<round>.tar.gz` (not in git).

## Round 0: build 4b544a6 (partial, 101 of 300 tasks)

Folder `e2e/results/mind2web-p5-20260915`. The run was interrupted several times for harness fixes and memory, and
stopped at 101 final tasks. Outcomes: task.ok 60, site_blocked 19, limit_steps 11, task.fail 8, limit_tokens 3.

What the logs showed:
- **Scroll loops.** 4 of 5 early step-limit endings scrolled 8–21 times for a filter or checkbox that was already in
  the element list, marked offscreen, or sat inside a collapsed section.
- **Hidden custom checkboxes.** Clicks on them were refused as having "no visible area", and the message's "off the
  page" sent the model scrolling.
- **Honest reports of blocks.** 7 of 23 judged successes were the agent reporting access denied, a bot check or a
  country block. The harness now records these as `site_blocked`.
- **Premature ends.** Criteria typed into a search box instead of applied as filters (judged a failure), "not found"
  said before the results were read, and answers read from page text but never shown on screen.
- **Provider.** About half of all model calls were rate-limited when five workers ran together.

Agent fixes built into round 1:
- `e3ef191`: a covered or hidden target, or a site connection error, costs half a failure.
- `c31c134`: pointer actions aim at the visible label of a hidden checkbox; listed offscreen elements are used by index;
  a note appears from the fourth scroll in a row.
- `9dbff4f`: a covering layer is quoted by its rendered text, not its CSS.
- `0c70e74`: the scroll-run note points to collapsed filter sections.

## Round 1: build a920989 (all 300 tasks)

Folder `e2e/results/mind2web-r1-a920989`. Started 2026-09-16 19:30 UTC with 5 workers; limits 50 steps, 500k tokens,
2400 s. This is the single-build baseline for the rounds that follow. On the 101 tasks it shares with round 0, it also
measures the four fixes above.

Results: pending.

Measured on round 1's first 600 model calls:
- Navigator page state: 16k characters on average, 109 elements, 73 of them offscreen. `offscreen="true"` takes 7.7% of
  the state.
- Model calls: 9.6k input tokens each, 31% cached; 194 output tokens, 156 of them reasoning; 9.9 s per call.
- The planner makes 180 calls to the navigator's 420.

## Round 2 candidate: build b9062ed

These fixes come from round 0's logs and a survey of leading web agents (browser-use, the Online-Mind2Web paper and
its judge rules, AgentOccam, Agent-E, WILBUR). Unit tests: 311 pass.

- **Scrolls report what they revealed** (`706c8fa`, `db6b46a`).
  - A page scroll says how many new elements it revealed.
  - After six page scrolls that revealed nothing new, further page scrolls are refused, with pointers to offscreen
    elements, collapsed sections, `find` and `scroll_to_text`.
  - On a long page whose element list is windowed, a scroll is never counted as empty.
- **Control summary and filter rules** (`c7ee27f`).
  - A summary above the element list names collapsed sections and counts form controls.
  - Navigator and planner rules: criteria go through the site's filter and sort controls, not only the search box, and
    the page must show them applied.
- **Checked state on labels** (`d0739cd`): a custom checkbox or radio shows its checked state on its label.
- **Requirements checklist** (`0c7b53f`).
  - The planner keeps a checklist of the task's requirements with the evidence for each.
  - A done is refused while a requirement is still pending; after two refusals it is accepted, and the answer names
    what was not applied.
  - Superlatives use the site's sort; a range must match the request, or the answer names the closest option used.
- **Absence answers** (`e40566c`): an answer that something does not exist, given before the page was read, is sent
  back once to read it.
- **Answer on screen** (`b9062ed`): the answer's value is scrolled into view before the task finishes.

A live smoke test on b9062ed (Discogs, 2 steps, task.ok) showed the planner filling `requirements: []` for a task
without criteria, with no re-asks.

## Round 2 candidate: build 56a108c (b9062ed plus set C)

Evidence from round 1's first 45 tasks (build a920989):
- **Scroll loops.** Still behind 5 of 10 tasks that did not finish (10–17 scrolls each); b9062ed targets these.
- **Other repeated actions.**
  - One site redirected its home page elsewhere from this network, and the agent opened the home page 14 times: the
    result never said where it landed.
  - The address guard refused another page of that same site (its standings page), because its question asked whether
    the request needed exactly that address.
  - Also: `go_back` 11 times, `switch_tab` back and forth.
- **Questions.** 7 of 45 tasks asked the user something. Five were bot checks (allowed by the policy). Two were useless
  offers to try another approach.

Fixes:
- **Redirect note** (`6dcc698`): navigation results say where a redirect landed.
- **Same-site addresses** (`39d06be`).
  - Another page of the current site gets a same-site question from the page-blind check: is it a reasonable step, and
    not something the user did not ask for.
  - An address that embeds another address keeps the strict question.
- **Repeated actions** (`19ab8f4`): the same action on the same page gets a firmer note at 3, 5 and 8 repeats; the
  fourth open of one address is refused.
- **Retry questions** (`ffe68da`, `56a108c`): a question that only offers to retry is sent back to the agent to decide.
  A question about money, an account or personal data is always put to the user.

Unit tests: 320 pass.

## Trace review of round 1 (57 tasks, successes included)

Three reviewers read every round 1 trace that ran the agent, and wrote `reviews/<task_id>.json` per task: answer
assessment, wasted steps, a better strategy, root cause, and improvements not yet covered.

Problems, by tasks affected:
1. **Pages read too early** (about 16): an "empty page" right after loading, a new tab read before it loaded, a click
   that opened a tab reported as no change.
2. **Form batches cut short** (17 of 19 in one batch): after typing, incidental new elements stopped the rest of the
   batch.
3. **Bot walls and CAPTCHAs** (about 9): the agent clicked challenge widgets and repeated the question; the harness
   counted such endings as task.ok.
4. **Clicks** (about 9): vague "covered by `<div>`" errors; clicks that only changed the URL fragment or opened a popup
   counted as passed.
5. **Failed routes** (about 8): the planner repeated a dead-end goal until the token cap.
6. **Autocomplete fields** (about 8): Enter pressed without choosing a suggestion; suggestions never reported.
7. **Filters not in effect at the end** (about 9): undone by `go_back`, a popup instead of a sort, a pre-checked filter
   left on.
8. **Wrong answers from the right page** (3): table values without their headers; "page reached" given instead of the
   data.
9. **Bugs and waste:**
   - `wait` for text to go away matches substrings;
   - native selects are listed option by option;
   - skip links are listed;
   - native date inputs are typed segment by segment;
   - the same question is asked twice;
   - the navigator acted without a plan after the first planner call timed out;
   - the planner re-plans every 3 steps even when every step passes.

Environment:
- This network is in India. Several US sites serve regional pages (nfl.com/international, in.ign.com, Amazon without
  prices), which some tasks cannot overcome. This is recorded as a limitation, not an agent failure.
- The judge is heavily rate-limited, with over 200 retries a pass.

Harness change: CAPTCHA and "unusual traffic" pages of the task's own site now count as `site_blocked` where a task
ends.

## Fix set D (in progress)

Three change sets, each assigned its own files:
- **Perception** (page loading):
  - wait for a page to load before reporting it empty, and for new tabs;
  - name what covers a target;
  - one line for a native select;
  - no skip links;
  - date inputs set directly.
- **Navigator:**
  - a batch continues unless menus, dialogs or new fields appear;
  - honest click outcomes;
  - autocomplete suggestions reported, with a rule to pick one;
  - bot-wall widgets are never clicked, and the user is asked once;
  - whole-text `wait`;
  - no repeated questions.
- **Planner:**
  - a memory of failed routes that forces a new route, then a finish;
  - the first planner call retried;
  - find returns whole table rows with headers;
  - applied filters re-checked against the current page before done;
  - a bot-wall rule;
  - no interval re-plan while every step passes.

Order: gate build 56a108c (sets A, B, C) against round 1 first, then gate set D on its own build. Memory does not allow a sixth browser
next to round 1's five.
