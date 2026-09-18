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
