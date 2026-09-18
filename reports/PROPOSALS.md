# Proposals

Changes the task spec did not list, derived from the trace review. Each one names the
problem it came from, what it would gain, what it risks, and how it gets measured. The
spec's own items (`read_page`, `extract`, diff observations, stable refs, the orchestration
layer, the research agent) are not repeated here; they are accepted and scheduled.

Status: **accepted** items are scheduled into Phase B/C/D; **rejected** ones say why.

---

## P1 — Send the element list as a diff against the previous step, not a marker (accepted)

**Problem.** The element list is 49.5% of all input, 122,263 tokens per task. 51.5% of its
lines are carried over verbatim from the previous call, and the repeat factor is 1.45. The
model acts on 0.38% of its characters.

**Change.** Beyond the spec's "`[page unchanged]`" case: when the page *did* change, send
only the changed lines — `+` added, `-` removed, `~` changed attributes — with the unchanged
remainder addressed by a stable section id the model can expand with `read_page(section=)`.
A full listing is sent on navigation, on the first step at an address, and on explicit
request.

**Gain.** Measured upper bound if perfect: −63k tok/task. Realistic: −40k (−16%).

**Risk.** The model loses the ability to scan the whole page cheaply, and may expand more
often than it needs. Mitigation: the section outline always ships whole (it is small), and
the expansion tool is one call.

**Measurement.** Tokens per successful task and success rate on the 60-task gate set;
count of `read_page(section=)` calls as the offsetting cost.

---

## P2 — Kill the element list as the default perception (accepted, staged)

**Problem.** The list exists to give the model clickable indexes. It costs 122k tokens per
task to deliver roughly nine useful lines.

**Change.** Default perception becomes: the page's **outline** (headings and landmarks,
~40 lines), the **interactive controls in the viewport** (not the document), and the
**main content as markdown** when the task is a reading task. The full indexed list becomes
a tool (`list_controls(scope)`), not a standing cost.

**Gain.** Estimated −60% to −70% of the element-list spend; it is the single biggest line
in the budget.

**Risk.** Real. Many tasks depend on an off-viewport control the model currently sees for
free. Mitigation: `find_control(description)` returns the matching controls with refs from
the whole document; staged behind P1 so the gate can attribute a regression to the right
change.

**Measurement.** Gate set, judged identically, before and after; per-task count of
`find_control` and `list_controls` calls; failure taxonomy re-run to see whether
"could not find the control" rises.

---

## P3 — A visited-and-dead-end ledger the model cannot lose (accepted)

**Problem.** 442 wasted steps across the reviewed tasks are loops and re-visits: one task
opened the same three pages nine times. Findings are prose and are truncated at 1,500
chars; the transcript's older turns are summarized away.

**Change.** A structured per-task ledger, written by the harness and not by the model:
every URL visited with the outcome ("nothing matched", "sorted, 27 results"), every action
refused and why, every dead end with its reason. It is injected in a fixed, compact block
and it survives compaction by construction. The model can annotate it but not delete it.

**Gain.** Removes the repeat-visit class of loops (est. −25k tok/task, −2 steps).

**Risk.** Another standing block in the prompt; must stay under ~400 tokens, which means
aggressive collapsing of near-identical entries.

**Measurement.** Repeat-action rate (36.7% today), repeat-visit count per task.

---

## P4 — Merge the three pointer tools and delete two more (accepted)

**Problem.** The tool block is 3,448 tokens on every one of 22.8 calls. `click_element`,
`hover_element` and `right_click_element` differ by one enum value. `scroll_to_text`
duplicates `find_in_page`'s job. `drag_element` and `upload_file` appear in a handful of
traces out of ~1,000 tasks.

**Change.** `click(ref, button="left"|"right", hover_only=false)`; `scroll_to_text` folded
into `find_in_page`; `drag_element` and `upload_file` moved behind a capability flag that
is off unless the task or the site skill asks for them.

**Gain.** −700 tokens per call, ≈ −16k tok/task, and a smaller decision surface.

**Risk.** A merged tool's description must stay clear enough that the model does not
right-click by accident. Tests pin the schema and the defaults.

**Measurement.** Tool-block token count (measured today: 3,448); per-tool call counts
before and after; any rise in wrong-button actions in the traces.

---

## P5 — The harness, not the model, handles consent and cookie walls (accepted)

**Problem.** Consent-modal deadlock is the second most expensive failure: 344 wasted steps,
$1.58, and it ends tasks outright. The model burns steps clicking a dialog it cannot see
properly, and the dialog's controls sit outside the element window.

**Change.** On page settle, the harness detects a modal/consent layer (role, aria-modal,
scroll-lock, known CMP containers) and either dismisses it under a policy the user sets
(accept-necessary by default) or surfaces it as a first-class observation with its buttons
already in the window. This is deterministic code, not a model decision.

**Gain.** Up to 344 steps and four task failures in the reviewed set.

**Risk.** Dismissing a dialog the user wanted to answer. Mitigation: the policy is explicit,
the action is recorded in the trace, and anything that looks transactional (payment, account)
is never auto-dismissed.

**Measurement.** Consent-deadlock category count in the taxonomy re-run.

---

## P6 — Per-domain skills learned automatically from successful runs (accepted)

**Problem.** The agent re-derives the same site knowledge every run: where the search box
is, that the filters live behind "More filters", that results need "Apply".

**Change.** The spec asks for `skills/` playbooks; the proposal is that they are **written
by the harness after a successful run**, not hand-authored: the successful action path,
the selectors that worked, the traps hit (a consent wall, a login gate), stored per domain
and injected only when that domain is the start page.

**Gain.** Compounding: the second run of a site should be materially shorter. Estimated
−30% steps on a repeat visit, to be measured rather than assumed.

**Risk.** A stale skill that sends the agent to a control the site moved. Mitigation: skills
carry a last-verified date and are demoted on first failure.

**Measurement.** Same task run twice: steps and tokens on run 2 versus run 1.

---

## P7 — Stop paying for rejected uploads (accepted)

**Problem.** 617 failed calls per run upload 20.0M prompt characters that are rejected
before inference, and 545 of those are HTTP 429. The hedged duplicate adds another 13,107
tokens per task that the current accounting does not even show.

**Change.** One shared limiter across workers with a token-bucket per model; no hedge while
a 429 is recent (already landed) and none above ~10k input tokens; exponential backoff keyed
on the model, not the call.

**Gain.** Removes most of the 15.7% of wall clock spent on failed calls, and −13k tok/task.

**Risk.** Lower throughput when the quota is actually free. Mitigation: the limiter adapts
upward on sustained success.

**Measurement.** Failed-call count and `backoffMs` per run; wall clock per task.

---

## P8 — Make the answer contract checkable (accepted, partly landed)

**Problem.** 22% of finished tasks produce a non-answer, and in 15 of 22 sampled tasks the
planner's final answer is byte-identical to the navigator's provisional text — the planner
is rubber-stamping. The prompt rules for this were ignored until they became code.

**Change.** Extend the landed `answerGaps` check: the final answer must name every value
the task asked for, and the planner must either quote the page evidence for each or mark it
explicitly unavailable. If the planner's text equals the navigator's, that is not a plan —
re-ask once with the gap named.

**Gain.** Directly attacks the largest answer-quality category.

**Risk.** An extra planner call on tasks that were already fine. Measured today: the check
would fire on 9.6% of answers.

**Measurement.** The answer-quality classifier re-run on the next round.

---

## P9 — Record every run as a replayable fixture (accepted)

**Problem.** Every experiment costs live sites, live quota and hours. Two of the four rounds
were partly wasted on provider outages and network drops.

**Change.** Record request/response pairs per run (page fetches and model calls) into a
fixture bundle; `replay(runId)` re-runs the agent against it offline and free. This makes
prompt and parsing changes testable in seconds, and makes a regression reproducible.

**Gain.** Turns most of the iteration loop from hours into seconds.

**Risk.** Fixture drift: a replay proves the code path, not that the site still behaves so.
Mitigation: replays are for regression, live runs for measurement.

**Measurement.** Time to run the gate set offline; number of live rounds needed per change.

---

## P10 — Report the harness's own contribution to every score (accepted)

**Problem.** Four tasks in one round were judged on Indian versions of US sites because of
where the browser sits; blocked sites were detected only at the end, after 8,074 seconds of
work; a fifth of tasks died on a budget that was counting cache re-reads.

**Change.** Every run publishes a "measurement integrity" block next to the score: tasks
excluded and why, tasks whose served region differed from the intended locale, tasks ended
by a harness limit rather than by the agent, and the share of wall clock lost to the
provider. A score without that block is not publishable.

**Gain.** Credibility. It also stops harness bugs from being read as agent regressions,
which has already happened twice in this project.

**Risk.** None beyond the work.

**Measurement.** The block exists and is populated automatically in `analysis.md`.

---

## Rejected

- **Batching more actions per step.** The model already emits 1.04 actions per call against
  a limit of 5; the ceiling is not the constraint, so raising it buys nothing.
- **Cutting screenshots.** 0.35% of input. Not worth a single line of code.
- **A cheaper model for the navigator.** Tempting at 14.5 calls per task, but the navigator
  is where the recoveries happen; the cheap-model win belongs on extraction and
  classification, where the output is checkable. Revisit only with a measured A/B.
- **Compressing the transcript with a model summarizer every N steps.** The transcript is
  not the problem: the element list is. A summarizer would add calls to save tokens that
  P1 and P2 remove outright.
