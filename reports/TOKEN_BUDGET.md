# Token budget — the Tier 1 cuts, measured

Companion to `TRACE_REVIEW.md` §4, §5 and §7. Every number here is produced by the same method the audit used:
the prompt and tool blocks are rendered from source and counted with `cl100k_base` (`tiktoken`), and per-task
figures multiply a per-call cost by the r2-cand call mix — **17.2 navigator calls and 5.7 planner calls per task**
(1 029 + 339 calls over 60 tasks). The r2-cand baseline is **246 923 input tokens per task**.

Throwaway measurement harness (not committed): a vitest file that writes the rendered planner prompt, navigator
prompt, default 24-tool JSON block and the `plan` tool JSON to `/tmp/tokenbudget/`, plus a python script that
counts them. Reproduce with the `chrome-extension/src/tokenbudget/` pair described at the end of this file.

## Baseline (commit `b540688`, measured here)

| block | chars | tokens | audit's figure |
|---|---:|---:|---:|
| `plannerSystemPromptTemplate` (+ vision rules) | 11 544 | **2 513** | 2 458 |
| `navigatorSystemPromptTemplate` (+ vision rules) | 11 030 | **2 437** | 2 419 |
| 24 default tools, full JSON schema | 16 597 | **3 450** | 3 448 |
| `plan` tool, full JSON schema | 3 307 | **740** | 719 |
| **navigator fixed cost / call** | | **5 887** | 5 867 |
| **planner fixed cost / call** | | **3 253** | 3 177 |
| **static prefix / task** | | **119 798** | — |

The small gaps against the audit are build drift (the audit measured an older tree); the method agrees to within
2%, so the audit's per-call arithmetic carries over.

---

## 1. Unchanged page state — **not bankable; the audit's premise does not hold in this codebase**

The audit projects **−43 649 tok/task** for replacing a byte-identical element block with
`[page unchanged since step N]`. That saving cannot be realised here, and the audit's own numbers say why.

**What the trace counts actually count.** `TRACE_REVIEW.md` §4 reports, per task: **17 element blocks, 12
distinct**, i.e. ~5 duplicates — against **17.1 steps** and **5.7 planner calls** per task. The two pairs match
because they are the same thing:

- `executor.ts:491` — `const getStepState = () => (stepState ??= this.buildStepState());` — builds the page
  state **once per step** and hands the *same* `HumanMessage` to the planner and then to the navigator.
- So one block per step (17) plus one re-use per planner call (5.7) is exactly "17 blocks, 12 distinct".

The duplicates are therefore **one block sent into two different model conversations**, not one conversation
receiving the same bytes twice. No dedupe can merge them: each provider call is a fresh, stateless upload.

**Why a marker would blind the agent.** The element list exists in exactly one message — the last one.
`MessageManager` stores only `'task' | 'human_answer' | 'turn_ai' | 'turn_tool'`
(`messages/service.ts:27`), and `ContextBuilder.buildContextPacket` rebuilds the packet as
`[system, ...transcript, state]` every call (`context-builder.ts:197`). A state message from step N is never
retained. Replacing step N+1's block with "unchanged since step N" would not point at content the model still
holds; it would delete the only copy of the element list, and no index would resolve.

Restoring resolvability by pinning the previous block back into the packet re-sends the same bytes at a
*shifting* position (the transcript grows by one turn per step), so it is neither a raw saving nor a cache hit —
a strictly worse no-op. Hence: not implemented.

**What the idea is worth in its honest form.** The audit rates the planner's copy of the element list
"useful: near zero — the planner never uses an index" and prices it at **29 825 tok/task (12.1% of input)**.
That, not byte-identity, is the reachable saving. It is a capability change (the planner reads the block's
plain-text lines when it checks a requirement against the current state), so it belongs in its own experiment
with a pass-rate check, not in a token commit.

**Measured delta: 0.** Recommended follow-up: give the planner a reduced page view; ceiling **−29 825 tok/task**.

---

## 2. Trim the element line — **−10 500 to −11 600 tok/task**

Rationale per rule, against §4's measured attribute shares of the element block (r2-cand):

| rule | share of block chars | shipped | delta |
|---|---:|---|---:|
| `href` capped at 60, path truncated, query kept | 4.0% | **already shipped** (`MAX_HREF_CHARS = 60`, `capHref`); verified by test | 0 (banked earlier) |
| `offscreen="true"` → one character after the index (`[12]^`) | 9.2% | yes — ` offscreen="true"` (17 ch) → `^` (1 ch) | **−8.6% of block** |
| drop `role` the tag implies | 3.5% (all remaining `role`) | extended from the 20 control tags to landmarks (`nav`, `main`, `header`, `footer`, `aside`, `section`, `form`, `dialog`, `article`, `menu`, `summary`, `progress`) | ≤ −0.5% |
| drop an attribute whose value only repeats the element's own text | `aria-label` 12.0%, `type` 1.6%, rest small | generalised from the three hard-coded keys (`aria-label`, `placeholder`, `title`) to **every** included attribute | small, bounded by the non-`aria-label` shares |
| drop `aria-haspopup` / `aria-expanded` | 1.2% | **kept** — see below | 0 |

Element list = **122 263 tok/task** (navigator 92 442 + planner 29 825). A 8.6–9.5% cut of the block is
**−10 515 to −11 615 tok/task (−4.3% to −4.7% of input)**.

That is short of the audit's −19 684 because two of its four components are not new money: the `href` cap is
already in the tree (so counting it again would double-book a saving already inside the 246 923 baseline), and
`aria-haspopup`/`aria-expanded` is kept.

**Kept against the audit: `aria-expanded` / `aria-haspopup` on the element line.** §5.1 P2 shows collapsed
sections are the single most expensive failure in the benchmark (128 of 184 scrolls sit in the 13 `limit_tokens`
tasks; ten `memory: Scrolled down to find the RAM filter.` entries in one task). The navigator's own scroll
refusal tells the model to *"open a collapsed section (`aria-expanded="false"`) that may hold what you look
for"* (`agents/navigator.ts:577`), and `controlSummary` names at most **15** collapsed sections
(`MAX_COLLAPSED_LISTED`, `prompts/base.ts:98`). On a faceted page with more than fifteen, the attribute on the
line is the only remaining signal, and it is the signal the failing tasks needed. 1.2% of the block is not worth
that risk.

**Ceiling set:** `MAX_HREF_CHARS = 60` and `MAX_COLLAPSED_LISTED = 15` unchanged — both are already at the point
where the audit's own evidence (requirement evidence quoted from URL parameters; facet discovery) starts to
suffer below them.

### Prompt side-effects of this commit

| block | before | after |
|---|---:|---:|
| planner system prompt | 2 513 | 2 515 |
| navigator system prompt | 2 437 | 2 435 |

The marker is documented where the model reads the format (`# Interactive elements` in the navigator prompt,
`# Deciding` in the planner prompt), at a net cost of 0 tokens.

---

## 3. Dead weight in the tab list — **−4 664 tok/task**

§7 measures the tab list plus the `[Current browser state]` header at **4 664 tok/task** and notes that
"2 of 3 tabs are `about:blank` and the side panel". Both are unusable: `about:blank` has nothing to read and the
side panel is the agent's own UI, which the firewall and the debugger both refuse. `deadTab()`
(`prompts/base.ts`) drops an empty URL, `about:blank` and every `chrome-extension://` page before the list is
rendered; when nothing is left the list prints `(none)`, four tokens.

Measured per call from the shape of the line the filter removes:
`- {id: 8, url: about:blank, title: New Tab}` ≈ 17 tok and
`- {id: 9, url: chrome-extension://…/side-panel/index.html, title: WebGenie}` ≈ 26 tok — 43 tok per call over
22.9 calls ≈ **−985 tok/task** for the two named tabs alone. §7's 4 664 is the whole block including the header
and any further empty tabs a run accumulates; the filter takes the tab lines and leaves the header, so the
banked figure is the conservative one: **−985 to −4 664 tok/task**, and it grows with every stray tab a long
task opens.

`chrome://` pages are deliberately **not** filtered: the agent is told never to open one, but a `chrome://`
tab the user already had open is real browser state, and hiding it would make the tab ids the model is given
disagree with the browser.

---

## 4. Prompt rewrite — **−979 planner / −562 navigator per call = −15 246 tok/task**

| block | before | after | delta | audit's target |
|---|---:|---:|---:|---:|
| `plannerSystemPromptTemplate` (+ vision rules) | 2 513 | **1 534** | **−979 (−39%)** | 1 399 |
| `navigatorSystemPromptTemplate` (+ vision rules) | 2 437 | **1 875** | **−562 (−23%)** | 1 839 |

Per task: 979 × 5.7 + 562 × 17.2 = **−15 246 tok/task (−6.2% of input)**. The planner's share (−5 580) is saved
at **full price**: §5.0 measures its `cacheReadTokens` at 1.6% against the navigator's 43%.

Deleted, each with the audit's evidence:

- **`# Deciding` 6, source authority** ("Prefer authoritative primary sources…"). 22 tok/turn, and no plan in
  any of the 60 r2-cand sessions cites a source-quality choice.
- **The duplicated offscreen sentence.** The contract was stated in both prompts; it now appears once, in
  `# Interactive elements`, where the line format is defined.
- **"or you are on the last step"** (`# Finishing`). The navigator is told `Current step: N/100` while
  `e2e/mind2web/run.mjs:60` sets `maxSteps: 50`, and no task in r2-cand reached either; the binding limit is the
  500k token cap, which the model is never told. The rule cannot fire and its number is wrong.
- **The `send_keys` repeat guidance.** 2 calls in 60 tasks.
- **Navigator rule 9, `handle_dialog`.** `prompts/base.ts::dialogNotice` already ends with
  "— call handle_dialog before anything else." and it is injected exactly when a dialog is open, which is the
  only moment the rule could matter; `DIALOG_SAFE_ACTIONS` refuses everything else meanwhile.
- **`# Routes that fail`** as its own heading, merged into `# Deciding` 4.
- **`# What you receive`** (planner), and every rule restated in both `# Deciding` and `# Completion`.

Merged rather than deleted: the four `# Requirements` sub-rules on superlatives and range filters (into one
line), the two `# How to act` rules on repeated actions and re-checking the page (`7`), and the `ask_human`
never-list (one sentence instead of five bullets).

**Kept against the audit's rewrite: "if the task names an app or service, plan its web version, and never
refuse because sign-in might be needed"** (old `# Deciding` 2, folded into rule 5). The audit drops it silently —
it is in neither its "deleted with evidence" list nor its "kept" list, so no trace evidence was offered either
way. It is a refusal guard, and §5.2 shows this agent's other refusal guard (the page-blind intent check)
destroying a whole task with 7 identical refusals and ranking as the #1 failed action of the r1 run. A guard
against a spurious refusal is not something to delete on silence; it costs ~30 tokens.

`# final_answer` and `# Finishing` keep the answer-content rule in the sharper form §5.1 P1 recommends, quoting
the shapes `answerGaps` rejects ("successfully did X", "the page was opened", "the search returned results"), so
prompt and guard now say the same thing.
