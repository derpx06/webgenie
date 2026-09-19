# How the best general agent harnesses are built
*Research brief, 2026-09-19. Every claim carries a source URL + date.*

## 1. Agent–Computer Interface design

**Practice:** design the action space for the model, not for a human.

**Mechanism (SWE-agent, arXiv 2405.15793, NeurIPS 2024, May 2024):** four stated principles — simplicity, efficiency, informative feedback, guardrails. Concretely: a file viewer (`open`/`goto`/`scroll_up`/`scroll_down`) showing a fixed 100-line window with line numbers; search (`find_file`/`search_file`/`search_dir`) capped at **50 results** with a summarized count instead of a dump; an `edit <n>:<m>` command that replaces a line range in one action and runs **flake8** (codes F821, F822, F831, E111–E113, E999, E902) *before* applying — a failing edit is rejected, and the agent gets the error type, its proposed snippet, and the original code back.

**Evidence (ablations on SWE-bench Lite, same paper):** window 30 lines → 14.3%, **100 lines → 18.0%**, full file → 12.7%. No `edit` command → 10.3%; `edit` without lint guardrail → 15.0%; with lint → **18.0%**. Summarized search → 18.0% vs iterative search → 12.0%. The interface, not the model, moves 3–8 points.

**Contrast — the shell/code escape hatch.** OpenHands' CodeAct (ICLR 2025; SDK paper arXiv 2511.03690, Nov 2025) refuses a wide bespoke tool menu and gives bash + Python (tmux-backed) + a string-replace file editor + a task tracker + a browser; the CodeAct claim is code actions beat JSON tool calls on 6 of 7 benchmarks. Claude Code sits in the middle: ~13 built-ins (`Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash`, `WebSearch`, `WebFetch`, `ToolSearch`, `Agent`, `Skill`, `AskUserQuestion`, `TaskCreate`/`TaskUpdate`) — https://code.claude.com/docs/en/agent-sdk/agent-loop. Cursor adds a *trained* retrieval tool (`codebase_search`) alongside `grep_search`/`read_file`/`run_terminal_cmd` — its custom embedding model gave **+12.5% QA accuracy and −2.2% dissatisfied follow-ups** (ZenML LLMOps DB, 2026). Aider exposes no tools at all in the classic mode: the "interface" is the *edit format* (see §6).

**Browser mapping:** build `page_find(query, cap=50)`, a bounded viewport over the accessibility tree rather than whole-DOM dumps, and an `act()` that validates the selector/element-id against the current snapshot and *refuses* with "element 47 is not in the current snapshot; last snapshot was 3 actions ago, re-snapshot" — the browser analogue of lint-before-apply.

## 2. The loop in practice

**Mechanism:** evaluate → tool calls → results → repeat until a text-only response; that's the termination condition in Claude Code's SDK, with `maxTurns` (tool-use turns only) and `maxBudgetUsd` as hard caps and typed stop reasons `error_max_turns` / `error_max_budget_usd` (docs, 2026). SWE-agent instead caps by **cost: $4/instance**.

**Evidence on stuck-detection:** SWE-agent reports the shape directly — median *successful* run **$1.21 / 12 steps**; mean *unsuccessful* **$2.52 / 21 steps**; 93% of resolved instances submit before budget exhaustion. Models succeed fast and fail slow, so a step-count trigger is a legitimate stuck signal. Its failure taxonomy over 248 unresolved instances: **52.0% incorrect implementation, 23.4% cascading edit failures**; **51.7% of trajectories contain ≥1 failed edit**, and recovery probability drops from **90.5%** (first edit) to **57.2%** after a single failure — failure is autocorrelated, so the harness must break the cycle rather than let the agent retry.

**Escalation instead of retry:** Amp's Oracle pattern runs a stronger reasoning model (o3/Gemini 2.5 Pro) as a sub-agent the worker (Sonnet) calls *when stuck*, so course-correction happens without polluting the main context (nibzard, 2025). Cursor's cloud agents get GitHub CLI and system diagnostics so they can *report* environmental blockage — missing secret, blocked domain — rather than thrash (cursor.com/blog/cloud-agent-lessons, 2026-06-02).

**Browser mapping:** cap by actions *and* by dollars; treat "two consecutive failed actions on the same element" as a stuck signal that forces a re-snapshot + re-plan, not a third retry. Verification loop: the browser's `npm test` is a post-action assertion ("URL now matches /checkout", "element X contains 'Order confirmed'") the agent must state *before* acting.

## 3. Context management at length

- **Repo map instead of files.** Aider parses every file with tree-sitter into an AST, builds a graph where files are nodes and edges are symbol dependencies, runs personalized-PageRank-style ranking, and renders only the top signatures within `--map-tokens`, **default 1,024 tokens**; it expands when no files are in chat (aider.chat/2023/10/22/repomap.html, 2023-10-22; aider.chat/docs/repomap.html).
- **Compaction.** Claude Code: 200k window, **~13,000-token auto-compact buffer**, plus microcompaction (offload bulky tool results early) and manual `/compact` with preservation instructions; `compact_boundary` is emitted in the stream (code.claude.com/docs/en/context-window, 2026). Codex CLI uses a token threshold (`model_auto_compact_token_limit`, **180k–244k** by model) and retains ~**20k tokens** of recent user messages. OpenCode protects the **last 40k tokens** of tool output and prunes outputs >20k beyond that. Amp ships **no** auto-compaction — manual handoff only, on the explicit philosophy "keep threads short" (badlogic gist, comparative, 2026).
- **File-backed memory + sub-agents.** Anthropic's context-engineering post (anthropic.com/engineering/effective-context-engineering-for-ai-agents, 2025) prescribes NOTES.md/to-do files and sub-agents that return a **1,000–2,000 token** distilled summary; just-in-time retrieval (keep file paths/queries, load on demand) over pre-loading. Claude Code's `Explore` subagent runs read-only on a Haiku-class model with a fresh window.
- **Documented post-compaction failure mode:** "Compaction replaces older messages with a summary, so specific instructions from early in the conversation may not be preserved" — the docs' own fix is to put persistent rules in CLAUDE.md, which is re-injected every request. The comparative gist adds: "quality degrades with multiple compactions (cumulative information loss)."

**Browser mapping:** a "site map" is the direct analogue of the repo map — cached per-origin outline of URLs, form fields and landmark roles, budgeted to ~1k tokens, refreshed on navigation. Never keep raw DOM in history: keep `{url, snapshot_id, action, outcome}` and re-fetch. Put the task contract in a re-injected file, not the first user message.

## 4. Tools: what good sets look like

**Numbers:** Anthropic's *Writing effective tools for AI agents* (anthropic.com/engineering/writing-tools-for-agents, Sep 2025): human-written Slack/Asana tools ~**60%** eval accuracy vs Claude-optimized ~**85%**; Claude Code truncates tool responses at **25,000 tokens** by default; a concise Slack response was **72 vs 206 tokens** (~65% saving); tools should be namespaced (`asana_search` vs `asana_projects_search`) and the choice tested empirically; error messages should teach the correct input shape, not emit tracebacks; build **20+ multi-call eval tasks** and measure runtime, call count, tokens, error rate alongside accuracy.

**Tool count vs reliability:** 50+ MCP tools ≈ **72K tokens** of schema before work starts; Claude Code now defers MCP schemas by default (~**120 tokens** for names only) with `ToolSearch` loading on demand, and `ENABLE_TOOL_SEARCH=auto` loads upfront only if schemas fit in **10%** of the window. Anthropic's rule: if a human engineer can't pick the right tool, don't expect the agent to.

**Browser mapping:** the strongest published datapoint is directly on-topic — Browser Use replaced **12 tools with one `browser_exec`** and mean token use fell **60% (Opus 4.8) / 66% (Kimi K3)** at 18/18 success (browser-use.com/posts/bitter-lesson-browser-agents, 2026-09-15). Target ~6–10 tools plus one JS/CDP escape hatch.

## 5. Determinism, sandboxing, safety

- **Codex CLI** (learn.chatgpt.com/docs/agent-approvals-security, 2026): Seatbelt on macOS, `bwrap`+seccomp on Linux; modes `read-only` / `workspace-write` (default) / `danger-full-access`; approval policies `on-request` (default) / `never`; **network off by default**, allowlist-first when on, "deny always wins over allow", private-IP and DNS-rebinding blocks; prompt injection listed as an explicit residual risk.
- **Claude Code** (code.claude.com/docs/en/permissions, 2026): rules evaluated **deny → ask → allow**, first match wins, specificity irrelevant; a *bare* deny name removes the tool from context entirely; a built-in read-only bash allowlist (`ls cat echo pwd head tail grep find wc which diff stat du cd`, read-only `git`) never prompts; redirect and `tee` targets are checked against `Edit` rules. Crucially the docs admit the limit: a Bash rule "isn't a security boundary around the program" — `Bash(rm *)` misses `/bin/rm` and `bash -c 'rm …'` — so OS sandboxing is required for real enforcement. Modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `auto` (classifier), `bypassPermissions` (containers only, blocked as root).
- **OpenHands SDK** (arXiv 2511.03690): a `SecurityAnalyzer` scores each action low/medium/high/unknown, a `ConfirmationPolicy` decides approval, and the agent parks in `WAITING_FOR_CONFIRMATION`; runtimes are Docker / Kubernetes / bare CLI; automatic secrets masking.
- **Cursor cloud** runs one VM per agent with hibernation, checkpoint/restore/fork, secret redaction and network policy — "enterprise IT for agents" (2026-06-02).

**Browser mapping:** mode ladder maps cleanly — read-only browsing / same-origin interaction / cross-origin+auth. Gate on *semantics* not string matching: classify the pending action (does it submit payment, delete, email, change permissions?) before it fires, the way OpenHands scores risk. Origin allowlist = network allowlist, deny-wins.

## 6. What the teams say they got wrong

- **Anthropic, 2026-04-23 postmortem** (anthropic.com/engineering/april-23-postmortem): three *harness-layer* changes, no model change, degraded Claude Code for six weeks. (a) default reasoning effort `high`→`medium` on Mar 4 for UI latency, reverted Apr 7; (b) a `clear_thinking_20251015` / `keep:1` caching bug on Mar 26 that cleared thinking **every turn** for the rest of the session, cascading cache misses — fixed v2.1.101; (c) a system-prompt line "keep text between tool calls to ≤25 words" added Apr 16, measured **3% eval drop** on two models, reverted v2.1.116 Apr 20. Stated fixes: ablations + soak periods + gradual rollout for any intelligence-affecting prompt change, and more internal staff on the exact public build.
- **Aider, 2023-12-21** (aider.chat/2023/12/21/unified-diffs.html): GPT-4 Turbo wrote "…add logic here…" placeholders. Switching the *edit format* to unified diffs took an 89-task refactor benchmark from **20% → 61%**, lazy comments on 12 tasks → 4. Same model; the output format was the bug.
- **Cognition**: "Don't Build Multi-Agents" (2025-06-12) — share full traces, not messages; parallel subagents make conflicting implicit decisions — then shipped Devin managing Devins / Fusion by Mar 2026. Read as: fan-out is a context-economics workaround, correct only when subtasks are genuinely read-only/independent.
- **Cursor**: work-stealing scheduler stalled at **90% reliability**; moved to Temporal (**50M+ actions/day, 7M+ workflows**). And the anti-pattern they name: hardcoding the harness to validate every agent action — expose tools and information, let the agent choose. Also: incomplete dev environments cause *subtle degradation*, not crashes.
- **Browser Use**: their own extraction layer was the bottleneck — "a cookie button can be right there on the screen and missing from the state we send" (shadow DOM, iframes, AXTree gaps).

**Repeating failure modes across harnesses:** (1) a failed edit/action poisons the rest of the run; (2) output *format* dominates model quality; (3) harness-layer changes silently cost several eval points and nobody notices for weeks; (4) lossy compaction drops the original instructions; (5) a partial view of the environment is worse than a slow full one.

---

## Five ideas worth stealing for a browser harness

1. **Validate-before-apply with a teaching error.** SWE-agent's lint gate bought +3.0 pts and is the single cheapest win: reject an action whose target element isn't in the current snapshot, and return the stale id, the current candidates, and the fix.
2. **Bounded, summarized observations.** 100-line window > full file (18.0% vs 12.7%); search capped at 50. Apply to AXTree slices and `page_find` results; hard-cap tool output (Claude Code uses 25,000 tokens).
3. **A site map, Aider-style.** Per-origin cached outline of routes/forms/landmarks in a ~1k-token budget, ranked by reference frequency — structural awareness without paying for the DOM.
4. **Sub-agent search returning 1–2k-token summaries.** Read-only, cheap model, fresh window; only the distillate re-enters the main context. Directly reuses Anthropic's published sizing.
5. **Risk-scored approval gates, OS-enforced.** OpenHands' analyzer + `WAITING_FOR_CONFIRMATION`, plus Codex's network-off-by-default allowlist. Classify the action's *effect*, and remember Claude Code's own warning that pattern rules are not a security boundary.

## Three that do not transfer

1. **Unified diffs / lint-as-guardrail literally.** There's no `patch` or flake8 for a live page; the DOM is not text the agent authors. The transferable part is *pre-application validation*, not the diff format.
2. **`bash` as the universal escape hatch.** OpenHands' "no tool ceiling" relies on a disposable container with a filesystem. A browser session carries the user's live cookies and auth; an unbounded `page.evaluate()` is a one-shot account-compromise primitive, so the escape hatch needs the same risk classifier as everything else.
3. **Aggressive compaction as the default long-run strategy.** Coding agents can recover from lossy compaction by re-reading files — the repo is durable ground truth. A web session's state is ephemeral and often non-idempotent (a submitted form can't be re-read). Prefer Amp's stance: short, focused threads with explicit handoff, plus durable file-backed task state.

---

**Could not reach:** `arxiv.org/abs/2405.15793` returned abstract-only and the PDF came back as unparseable binary — the numbers above come from the HTML v2 rendering (`arxiv.org/html/2405.15793v2`), which I did reach. No first-party Sourcegraph/Amp engineering post on tool design was findable; Amp claims are sourced to the nibzard writeup and the comparative compaction gist, and should be treated as second-hand. Devin/Cognition's Fusion architecture is sourced to a Cognition X post + blog index rather than a fetched design doc.

**Word count:** ~1,720 (body, excluding this note).
