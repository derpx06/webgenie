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

Next: a live smoke test, then the gate on round 1's failed and mediocre tasks plus a sample of its successes.
