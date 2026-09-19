# Harness practice: what primary sources actually report

> Could not reach / partial:** `openai.com/business/guides-and-resources/...` returned HTTP 403 (I read the CDN PDF directly instead, pages 10–24, and quote from it). `opentelemetry.io/docs/specs/semconv/gen-ai/` is now a redirect stub; the successor repo `github.com/open-telemetry/semantic-conventions-genai` returned only repo metadata, so OTel attribute names below come from vendor implementation docs, not the spec text — treat as second-hand. AgentOccam's branch/prune details come from the PDF via search snippet, not the abstract.


## 1. The agent loop

**Practice: default to the simplest loop; add structure only when measurement forces it.**
Mechanism: Anthropic's taxonomy separates *workflows* ("LLMs and tools orchestrated through predefined code paths") from *agents* ("LLMs dynamically direct their own processes"), and lists five composable workflow patterns — prompt chaining, routing, parallelisation (sectioning/voting), orchestrator-workers, evaluator-optimizer — before the autonomous loop. Agents are for "open-ended problems where it's difficult or impossible to predict the required number of steps."
Source: Erik Schluntz & Barry Zhang, Anthropic, 19 Dec 2024 — https://www.anthropic.com/engineering/building-effective-agents
Applies: your browser agent is *not* open-ended. Navigate→find→act→verify is a routable shape. A router that picks a fixed sub-workflow for known task classes attacks the 57.8% wasted-step figure directly, because wasted steps are mostly the model re-deriving a plan it has already derived.

**Practice: make the run loop's exit conditions explicit and enumerable.**
Mechanism: OpenAI defines a "run" as "a loop that lets agents operate until an exit condition is reached. Common exit conditions include tool calls, a certain structured output, errors, or reaching a maximum number of turns." In the Agents SDK the loop ends on a final-output tool or a no-tool-call response.
Source: *A Practical Guide to Building Agents*, OpenAI, 2025, pp.14–15 — https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
Applies: a `finish(answer, evidence)` final-output tool makes completion an *action* with arguments you can validate, rather than the model trailing off.

**Practice: code-as-action where the action space composes.**
Mechanism: CodeAct uses executable Python as the unified action space; the interpreter composes tools, loops, and conditionals in one action instead of one JSON call per step.
Evidence: "up to 20% higher success rate" over JSON/text actions, with fewer interaction turns; ICML 2024. Xingyao Wang et al., 1 Feb 2024 — https://arxiv.org/abs/2402.01030
Anthropic's MCP variant reports the same shape at production scale: exposing servers as a code API on a filesystem with progressive disclosure took one workflow from ~150,000 tokens to ~2,000 — a "98.7%" saving. Adam Jones & Conor Kelly, 4 Nov 2025 — https://www.anthropic.com/engineering/code-execution-with-mcp
Applies hardest to you. Your 49.5% element-list spend exists because the DOM crosses the context boundary. A `page.query(selector_or_text)` executed in the page, returning only matches, keeps the DOM out of context entirely.

**Practice: graph/state-machine loops for durability, not for cleverness.**
Mechanism: LangGraph positions itself as "an orchestration framework… with a series of agent abstractions built on top," arguing the hard part is "making sure the LLM has the appropriate context at each step" — and that abstractions which hide the prompt get in the way. Persistence gives fault tolerance, time-travel and human-in-the-loop.
Source: Harrison Chase, 20 Apr 2025 — https://www.langchain.com/blog/how-to-think-about-agent-frameworks
Caveat from the same ecosystem: resume re-runs the node, not the next line — replay is a re-run of the tail, so nodes must be idempotent (https://docs.langchain.com/oss/python/langgraph/durable-execution).

**Measured head-to-head on browser tasks:** AgentOccam (Ke Yang et al., Amazon, ICLR 2025, arXiv 17 Oct 2024 — https://arxiv.org/abs/2410.13825) beat WebArena SOTA by **+9.8 absolute points (+29.4%)** and beat a plain web agent by **+26.6 points (+161%)** with *no* in-context examples, no new agent roles, no online feedback and no search — purely by pruning the observation space and aligning the action space. This is the single most transferable result for you.

## 2. Tool design

**Practice: the ceiling is tool *similarity*, not tool count.**
Evidence: "The issue isn't solely the number of tools, but their similarity or overlap. Some implementations successfully manage more than 15 well-defined, distinct tools while others struggle with fewer than 10 overlapping tools." OpenAI guide, p.16. Splitting agents is the recommended remedy *only after* better names, parameters and descriptions fail.
Accuracy evidence beyond tokens: Repantis et al. (Meta), *How Many Tools Should an LLM Agent See?*, arXiv:2605.24660, 23 May 2026 — https://arxiv.org/html/2605.24660v1. On BFCL (370 tools) an adaptive-depth selector reached 90.3% coverage while presenting **7.4 tools on average**; downstream, Claude Sonnet's tool-choice accuracy was **93.1% with short adaptive lists vs 87.1% with fixed K=5**. Shorter lists improve *choice*, not just cost.

**Practice: consolidate multi-call sequences into one high-level tool; shape results by default.**
Mechanism: replace `list_users`+`list_events`+`create_event` with `schedule_event`; give tools a `response_format` enum. Anthropic measured a "detailed" Slack response at **206 tokens** vs "concise" at **72** (~⅓). Claude Code caps tool responses at **25,000 tokens** by default, with pagination/filtering/truncation. Namespacing choice (prefix vs suffix) had "non-trivial effects."
Source: Ken Aizawa et al., Anthropic, 11 Sep 2025 — https://www.anthropic.com/engineering/writing-tools-for-agents

**Practice: errors are prompts.** Same source contrasts opaque tracebacks with errors that name "specific and actionable improvements." Anthropic's ACI guidance adds poka-yoke argument design and notes: "we actually spent more time optimizing our tools than the overall prompt" for their SWE-bench agent.
Applies: your 36.7% repeated-action rate is a symptom of tool results that don't say *what changed*. A click returning `{ok: true}` teaches nothing; returning `{url_changed: false, dom_delta: 0, hint: "no state change — element may be disabled"}` makes repetition irrational.

**Practice: never mutate the tool array mid-run.** Manus masks logits with a context-aware state machine rather than removing tools, because removal invalidates the KV cache and confuses the model (Yichao 'Peak' Ji, 18 Jul 2025 — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus).

## 3. Context engineering

**Practice: budget for attention, not just for the window.**
Mechanism: "context rot" — recall degrades as tokens grow, because transformer attention is an n² budget. Remedies named: compaction (summarise and reinitialise), tool-result clearing as the "lightest touch," structured note-taking to a file, sub-agent isolation returning **1,000–2,000 token** summaries, and just-in-time retrieval (Claude Code loads CLAUDE.md upfront, then uses glob/grep at runtime rather than pre-loading).
Source: Rajasekaran, Dixon, Ryan & Hadfield, Anthropic, 29 Sep 2025 — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

**Practice: cache-stable prefix; append-only suffix.** Manus reports KV-cache hit rate is "the single most important metric for a production-stage AI agent," an average input:output ratio of **100:1**, and a **10×** price gap ($0.30 vs $3.00/MTok cached vs uncached on Claude Sonnet then). Also: recitation — rewriting a `todo.md` each turn to pull the goal into recent attention, on tasks averaging **~50 tool calls**.
Applies: your 41.2% re-sent prompt/schema spend is the *good* kind of waste if and only if it is byte-identical and cached. If any per-step value (timestamp, step counter, current URL) sits above the tool definitions, you are paying 10× for it. Fix ordering before you fix size.

**Practice: dead ends must survive.** Manus's "keep the wrong stuff in": preserve failed actions and error traces, because "error recovery is one of the clearest indicators of true agentic behaviour." This directly contradicts naive compaction. Compact *receipts* of failure (`tried selector X → not found`), never delete them — otherwise the agent re-tries them, which is exactly your 36.7%.

## 4. Multi-agent vs single-agent

**For:** Anthropic's research system (Hadfield, Zhang, Lien, Scholz, Fox, Ford, 13 Jun 2025 — https://www.anthropic.com/engineering/multi-agent-research-system) used orchestrator-worker and beat single-agent Opus by **90.2%** on an internal research eval. Costs: agents use **~4×** chat tokens, multi-agent **~15×**; token usage alone explains **80%** of performance variance. Their own scope statement: good for breadth-first parallel search, bad for "domains requiring shared context across agents… (e.g., most coding tasks)."

**Against:** Walden Yan, Cognition, 12 Jun 2025 — https://cognition.com/blog/dont-build-multi-agents. Two principles: (1) share full agent traces, not individual messages; (2) "actions carry implicit decisions, and conflicting decisions carry bad results." Their long-horizon answer is a dedicated compression LLM, not parallelism. They note Claude Code's subagents answer questions only and never run in parallel.

**Reconciliation:** both agree. Parallelism pays when subtasks are read-only and independent; it fails when subtasks make mutually-visible decisions. Browser automation is stateful and shared-session — one DOM, one cookie jar. Two agents clicking the same page is the Mario/Flappy-Bird failure with a live side effect. OpenAI's guide agrees on ordering: "maximize a single agent's capabilities first" (p.16).

## 5. Verification and self-checking

**Practice: external feedback, not introspection.** Huang, Chen, Mishra, Zheng, Yu, Song & Zhou (Google DeepMind), arXiv:2310.01798, 3 Oct 2023 — LLMs "struggle to self-correct their responses without external feedback, and at times, their performance even degrades after self-correction." Asking your agent "are you done?" is measurably worse than useless.

**Practice: evidence-gated completion via the environment.** Anthropic's long-running-agent harness (Justin Young et al., 26 Nov 2025 — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) gates on a `feature_list.json` of 200+ features marked passing/failing, plus browser automation (Puppeteer MCP) to verify end-to-end — noting Claude "did well at verifying features end-to-end once explicitly prompted to use browser automation tools," and that it *missed* bugs it literally could not observe (browser-native alert modals). Verification quality is bounded by observation coverage.

**Practice: LLM-as-judge for offline grading only.** Zheng et al., NeurIPS 2023 D&B, arXiv:2306.05685 — GPT-4 judges reach ">80% agreement" with humans, the same level as human-human, but carry position, verbosity and self-enhancement bias. Anthropic's research system used a single-prompt rubric (factual accuracy, citation correctness, completeness, source quality, tool efficiency, 0.0–1.0) and still insisted human testing catches what automation misses.

## 6. Budgets, reliability, observability

- **Budgets:** max-turns is a first-class exit condition (OpenAI guide p.14). Anthropic's research lead agent embeds "scaling rules correlating effort to complexity" in the prompt — the budget is *told* to the model, not just enforced around it.
- **Checkpoint/resume:** Anthropic report checkpointing "prevents expensive full restarts after failures," plus rainbow deployments to avoid killing in-flight agents. LangGraph checkpointers give the same at framework level, with the idempotency caveat above.
- **Tracing:** Anthropic trace decision patterns *without* reading conversation contents. OpenTelemetry GenAI conventions (now at https://github.com/open-telemetry/semantic-conventions-genai) define `invoke_agent` → `chat` → `execute_tool` span trees with `gen_ai.operation.name`, `gen_ai.usage.input_tokens`/`output_tokens`, `gen_ai.request.model`, `gen_ai.provider.name`, and token/duration histograms; most agent-level conventions remain **experimental** — attribute list here is from vendor docs (https://www.datadoghq.com/blog/llm-otel-semantic-convention/, https://opentelemetry.io/blog/2026/genai-observability/), not the spec text I could retrieve.

---

## Five to adopt first

1. **Move the element list out of context (CodeAct-style query tool).** Kills the 49.5% at source; 20% success-rate headroom (CodeAct) and 98.7% token evidence (Anthropic MCP) both point here.
2. **Prune the observation like AgentOccam.** Its +161% over plain web agents came from nothing but observation/action-space discipline — the cheapest measured win available to a browser agent.
3. **Reorder the prompt for cache stability before shrinking it.** 41.2% re-sent tokens at cached rates is a 10× cheaper problem than at uncached rates (Manus).
4. **State-delta tool results plus teaching errors.** Directly targets 36.7% repeats; Anthropic's tool-writing guidance, and Manus's "keep the wrong stuff in" so failures stay visible as receipts.
5. **`finish(answer, evidence)` gated on a machine check** (URL/DOM assertion), never on self-assessment — per Huang et al. and the feature_list.json pattern.

## Three to reject

1. **Parallel multi-agent browsing.** One shared mutable DOM; Cognition's implicit-decision conflict plus Anthropic's own "not for shared-context domains." 15× tokens for a negative.
2. **A self-critique step in the loop.** Measurably degrades performance without external feedback (arXiv:2310.01798). Spend the tokens on a real DOM assertion.
3. **Dynamic tool registration per page type.** Cache-invalidating and confusing; mask/ignore instead (Manus), and the tool-count evidence says similarity, not count, is the constraint — 15 distinct tools is fine (OpenAI guide, p.16).

**Sources:** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) · [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) · [OpenAI practical guide (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) · [How to think about agent frameworks](https://www.langchain.com/blog/how-to-think-about-agent-frameworks) · [LangGraph durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution) · [Manus context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) · [CodeAct](https://arxiv.org/abs/2402.01030) · [AgentOccam](https://arxiv.org/abs/2410.13825) · [LLMs Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798) · [LLM-as-a-Judge](https://arxiv.org/abs/2306.05685) · [How Many Tools Should an LLM Agent See?](https://arxiv.org/html/2605.24660v1) · [OTel GenAI semconv repo](https://github.com/open-telemetry/semantic-conventions-genai) · [OTel GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/) · [Datadog GenAI semconv](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
