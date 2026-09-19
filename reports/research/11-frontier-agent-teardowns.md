# Teardowns of the production browser and computer-use agents

Stream 11. How the shipped agents are **built**, not how they score: loop shape, what the model sees, the exact tool list, how completion is checked, how risky actions are confirmed, memory and handoff. Brief 02 already gives the leaderboards and the AgentOccam / Agent-E / WebVoyager numbers; this brief does not repeat them. Brief 07 covers the Magentic-One ledgers and planner splits in depth; here they appear only as a line in the comparison.

**Model scope.** WebGenie has to work with any provider: OpenAI, Anthropic, Gemini, Ollama and others. Gemini on Vertex is only what the benchmark runs on. So every design below is tagged **[trained]** when it depends on the vendor's own RL-trained computer-use model, which will not carry over to an arbitrary model, or **[harness]** when it is harness-side and works with any model that can call tools.

Sources were read on 2026-09-19 unless another date is given. Code came from `raw.githubusercontent.com` or a shallow clone: browser-use at `d8110c5` (2026-09-15), google/computer-use-preview (last commit 2026-07-28), FellouAI/eko (2026-03-03), and Stagehand, Skyvern, autogen and nova-act at `main`.

---

## 1. OpenAI: Operator / CUA → ChatGPT agent → Atlas agent mode

**Architecture.** CUA is a single loop: screenshot in, one raw mouse or keyboard action out. It is GPT-4o vision plus reasoning trained with RL **[trained]** ([Operator system card, 2025-01-23](https://cdn.openai.com/operator_system_card.pdf), §1). ChatGPT agent (2025-07-17) is "a new agentic model in the same family as OpenAI o3" that chooses among a **visual browser, a text browser, a terminal and Connectors** ([ChatGPT agent system card](https://cdn.openai.com/pdf/839e66fc-602c-48bf-81d3-b21eacc3459d/chatgpt_agent_system_card.pdf) p.3). The routing between the text browser and the visual browser is learned inside one policy; there is no separate planner. Operator was shut down on 2025-08-31 after ChatGPT agent shipped ([Wikipedia: OpenAI Operator](https://en.wikipedia.org/wiki/OpenAI_Operator)).

**Observation.** CUA sees screenshots only. Atlas agent mode, which runs in the user's own browser, **reads pages through ARIA roles and labels**. OpenAI tells site owners to add "descriptive roles, labels, and states to interactive elements" ([Simon Willison on the Atlas launch, 2025-10-21](https://simonwillison.net/2025/Oct/21/introducing-chatgpt-atlas/)).

**Action space.** The API `computer` tool has 9 actions: `click, double_click, drag, move, scroll, keypress, type, wait, screenshot` ([OpenAI computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)).

**Safety and confirmations.**
- Confirmation before any "action that affects the state of the world". Operator's recall on this was **92%** over 607 tasks in 20 categories, and confirmations "reduced the risk by approximately 90%" (Operator card §4.3). ChatGPT agent: confirmation recall **91.0%**, and critical-action recall **100% / 99.9% / 100%** for permission edits, high-stakes messages and financial transactions (agent card Table 13).
- Proactive refusal of banking-style tasks (recall 94%).
- **Watch mode**: on sensitive sites such as email or banking, execution pauses when the user goes inactive or leaves the tab (Operator §4.5; agent §3.1.2.4).
- Prompt-injection susceptibility went from **62%** with no mitigation, to **47%** with prompting only, to **23%** after training. On top of that sits an **out-of-model monitor** that pauses the run: **99% recall, 90% precision**, with **46 of 13,704** benign screens falsely flagged. After one red-team session its recall went from 79% to 99% "in just one day" (Operator §4.6).
- ChatGPT agent ignores **99.5%** of synthetic text-browser injections and 95% of visual-browser ones. Memory is disabled at launch to cut off exfiltration, and the terminal is limited to GET requests (agent card §3.1.2).
- Atlas agent mode cannot run code, download files or install extensions, cannot use saved passwords or autofill, and offers a **logged-out mode** (Willison). OpenAI hardens Atlas with an **RL-trained automated attacker** that tests candidate injections against a simulated victim before committing to them ([OpenAI, Dec 2025](https://openai.com/index/hardening-atlas-against-prompt-injection/); returned 403 to me, content from search snippets).

**Numbers.** CUA scored OSWorld **38.1%**, WebArena **58.1%**, WebVoyager **87%** ([openai.com/index/computer-using-agent](https://openai.com/index/computer-using-agent/), Jan 2025; the page returned 403, so the figures come from search snippets and the Operator card §5). Operator scored **61.3%** on the Online-Mind2Web official leaderboard (human judge) but only **44.3%** under Browserbase's harness ([Gemini 2.5 CU model card](https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-2-5-Computer-Use-Model-Card.pdf), 2025-10-07). The ChatGPT agent launch post reports WebArena **65.4%** and BrowseComp **68.9%** (secondary coverage; openai.com returned 403).

---

## 2. Google: Project Mariner and the Gemini Computer Use model

**Mariner** (2024-12-11) was **an experimental Chrome extension**: it "can only type, scroll or click in the active tab", it asks before purchases, and it reasons over "pixels and web elements like text, code, images and forms". It reached **83.5% on WebVoyager "as a single agent setup"** ([DeepMind on X](https://x.com/GoogleDeepMind/status/1866911079194038368); [MediaPost 2024-12-16](https://www.mediapost.com/publications/article/401869/google-tests-project-mariner-an-ai-agent-that-can.html)). It later moved to cloud VMs, running up to 10 parallel tasks, and added **Teach & Repeat**: record a workflow once, replay it ([allaboutai summary](https://www.allaboutai.com/ai-agents/project-mariner/), secondary).

**Gemini 2.5 Computer Use** (2025-10-07) is Gemini 2.5 Pro post-trained for UI control **[trained]**. Its input is text plus a screenshot plus the recent action history; its output is a single function call (model card).

- **Legacy action set** (13 actions; used by `gemini-2.5-computer-use-preview-10-2025`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`): `open_web_browser, click_at, hover_at, type_text_at, scroll_document, scroll_at, wait_5_seconds, go_back, go_forward, search, navigate, key_combination, drag_and_drop` ([google/computer-use-preview agent.py](https://raw.githubusercontent.com/google/computer-use-preview/main/agent.py)).
- **Current action set** (20 actions, gemini-3.5-flash and later) is **lower-level**: `click, double_click, triple_click, middle_click, right_click, mouse_down, mouse_up, move, type, drag_and_drop, wait, press_key, key_down, key_up, hotkey, take_screenshot, scroll, go_back, navigate, go_forward`.
- Coordinates are normalised to **0–999**. The recommended screen is 1440×900. Environments are `BROWSER`, `MOBILE` and `DESKTOP` ([Gemini API computer-use docs](https://ai.google.dev/gemini-api/docs/computer-use)).
- `excluded_predefined_functions` drops built-in actions and custom `function_declarations` add your own.
- The reference loop keeps screenshots in only the **3 most recent turns** (`MAX_RECENT_TURN_WITH_SCREENSHOTS = 3`).
- **Safety**: an "out-of-model, inference-time safety service that assesses each action … before it's executed" ([Google blog 2025-10-07](https://blog.google/technology/google-deepmind/gemini-computer-use-model/)). It returns `safety_decision: require_confirmation` with an explanation. The client must ask the user and send back `safety_acknowledgement`, and the terms prohibit bypassing this. The categories are payments, health and financial records, sending communications, and modifying files (model card).

**Numbers** (model card Table 1):

| Benchmark / judge | Gemini 2.5 CU | Claude Sonnet 4.5 | Claude Sonnet 4 | OpenAI CUA |
|---|---|---|---|---|
| Online-Mind2Web, official leaderboard | 69.0% | — | — | 61.3% |
| Online-Mind2Web, Browserbase harness | 65.7% | 55.0% | 61.0% | 44.3% |
| WebVoyager, official leaderboard | 88.9% | — | — | 87.0% |
| WebVoyager, Browserbase harness | 79.9% | 71.4% | 69.4% | 61.0% |
| AndroidWorld, measured by DeepMind | 69.7% | 56.0% | 62.1% | — |

The same model scores **3–9 points lower** under a third party's harness. Google also says "computer use evaluations are sensitive to the agent's environment and system instructions."

---

## 3. Anthropic: computer use, the browser toolset, Claude in Chrome

**Computer use** (`computer_toolset_20260801`, 17 members) **[trained]**: `screenshot, zoom, left/right/middle/double/triple_click, left_click_drag, mouse_move, left_mouse_down/up, cursor_position, scroll, type, key, hold_key, wait`. Coordinates are screenshot pixels ([platform docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool)). The loop rules and the guidance that carry over:
- Batched calls run **in order and stop at the first failure**; every skipped call gets `"Not executed: an earlier computer action in this turn failed."`
- "End batches with screenshot", put instruction text before images, and keep **≤20 images** in a request.
- Classifiers scan tool results for injections and "steer Claude to verify with you".

**Browser toolset** (`browser_toolset_20260801`, 31 members, runs client-side) is the directly relevant one. It is Anthropic's own *browser-native* design, and it is structurally close to WebGenie's ([platform docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)):
- **Reading**:
  - `read_page` returns the accessibility tree as `button "Search" [ref_2]`. Options: `filter` (`interactive`, or `all` to include off-viewport elements), `depth` (default 15), and `ref` to scope to a subtree. Output is capped at 50,000 characters, with a note telling the model to narrow the read when capped.
  - `find(query)` is **natural-language element search that returns refs**.
  - `get_page_text` returns the main article text.
- **Acting**:
  - The pointer tools take `target: {type:"ref"} | {type:"coordinate"}`, so one tool accepts either form.
  - `form_input(target, value)` **sets a control's value directly** (string, number or boolean), so one verb covers text boxes, selects and checkboxes.
  - `navigate(url | "back" | "forward" | "reload")` folds the history actions into navigation.
- **Stale refs** fail loudly: `"ref_3 is stale or not found on the current page. Re-read the page to get fresh references."`
- **Tabs**: every successful result carries a structured `browser_state` block with the **full tab inventory** (never a delta) plus `state_changes`.
- **Off by default**: `javascript_exec`, `file_upload`, `read_console`, `read_network`. The `navigate` handler must reject any scheme other than http/https.

**Claude in Chrome** (pilot 2025-08-25; Max 2025-11-24; Pro/Team/Enterprise 2025-12-18) ([claude.com blog](https://claude.com/blog/claude-for-chrome)):
- **Safety**: per-site permissions, confirmations before publishing, purchases and sharing personal data, and financial, adult and pirated-content categories blocked.
- **Injection results**: attack success went **23.6% → 11.2%**, and browser-specific attacks (hidden DOM fields, URL or tab-title injection) went **35.7% → 0%**, over 123 cases. By 2025-11-24, Opus 4.5 reached **~1%** against an adaptive best-of-N attacker making 100 attempts per environment ([Anthropic, prompt-injection defenses](https://www.anthropic.com/news/prompt-injection-defenses)). The defence has three layers: RL training, classifiers and red-teaming.
- **Internals** (community reverse-engineering of v1.0.56, [sshh12 gist, 2026-03-01](https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b); lower trust):
  - Tools are `computer, navigate, read_page, form_input, find, get_page_text, javascript_tool, tabs_*, read_console_messages, read_network_requests, upload_image, file_upload, gif_creator, update_plan, shortcuts_*`.
  - Refs live in `window.__claudeElementMap`, and `<select>` options are listed inside the tree with their selected state.
  - There are three permission modes: `ask` per new domain, `follow_a_plan` (an `update_plan` approval grants that plan's domains) and skip-all.
- In Claude Code, a login page or CAPTCHA makes it "pause and ask you to handle it manually" ([Claude Code docs: Chrome](https://code.claude.com/docs/en/chrome)).

---

## 4. Perplexity Comet

There is no public architecture document. Brave's disclosure (2025-08-20) showed that Comet "feeds a part of the webpage directly to its LLM without distinguishing between the user's instructions and untrusted content". The proof of concept went from a hidden Reddit spoiler to reading an OTP in Gmail and exfiltrating it ([Brave blog](https://brave.com/blog/comet-prompt-injection/)). Brave's fixes: separate trusted from untrusted content, an alignment check of each action against the user request, confirmation for sensitive actions, and an isolated agent mode.

Perplexity's answer is **BrowseSafe**, a fine-tuned Qwen3-30B that scans **raw HTML** for injections before the assistant runs, published with a 14,719-example benchmark covering 11 attack types, 9 injection strategies and 3 styles ([arXiv 2511.20597](https://arxiv.org/html/2511.20597)). The Comet security blog posts at perplexity.ai returned 403.

---

## 5. Browser Use (open source; read from the code)

**Loop** **[harness]**: one agent with no separate planner. The model returns JSON with `thinking, evaluation_previous_goal, memory, next_goal, current_plan_item, plan_update, action:[…]` and up to `max_actions_per_step=5` actions (`agent/views.py`). A page change skips the remaining actions. Navigating actions are marked `terminates_sequence` and must come last. `flash_mode` drops the evaluation and next-goal fields and thinking for weaker or faster models, and there are separate prompt files for no-thinking and flash variants (`agent/system_prompts/`).

**Observation.**
- An indexed DOM tree as `[33]<div />` with children indented by tabs. `*[` marks elements that are new since the last step.
- `|SCROLL|` and `|SHADOW(open)|` prefixes mark scroll containers and shadow roots.
- By default only viewport elements are listed. The screenshot carries bounding boxes and is "GROUND TRUTH" when present.
- Serialiser passes (`dom/serializer/`): paint-order occlusion filtering, bounding-box containment pruning, compound-control enrichment (select options inlined), and model indexes that stay stable per `backendNodeId`.

**Tools (24)**: `search, navigate, go_back, wait, click (index or coordinates), input, upload_file, switch, close, extract, search_page, find_elements, scroll, send_keys, find_text, screenshot, save_as_pdf, dropdown_options, select_dropdown, write_file, replace_file, read_file, evaluate, done` (`tools/service.py`).
- `search_page` (text or regex) and `find_elements` (CSS selector) are described as "free and instant". `extract` is marked "expensive … DO NOT query the same page with the same extract query multiple times".
- `evaluate` is where hover, drag and custom widgets go.
- `done` has `success` plus `text` plus `files_to_display` and must be called alone.

**Verification and budget.**
- The prompt's `<pre_done_verification>` has six steps: re-list every requirement, count items, confirm each submit on the page, require every value to appear verbatim in tool output, treat a blocker as `success=false`, and when uncertain set `success=false`.
- "When you reach 75% of your step budget … shift strategy … consolidate", and estimate per-item cost for large tasks.
- `use_judge=True` runs a post-hoc trace judge (`agent/judge.py`) whose rules include "concludes impossible and truly impossible: false".

**Loop control.**
- `ActionLoopDetector` works over a 20-action window and hashes *normalised* actions: a click is hashed by element type and text, ignoring the index; a navigate by domain; a search by sorted tokens. It sends escalating soft nudges at **5, 8 and 12** repeats, plus a page-stagnation nudge after 5 unchanged fingerprints.
- `planning_replan_on_stall=3`.
- `MessageCompactionSettings`: summarise every 25 steps or past about 40k characters, keeping the last 6 items and a 6k-character summary.

**Memory**: a per-task file system with `todo.md` and `results.md`, and "DO NOT use the file system if the task is less than 10 steps".

**Numbers.**
- WebVoyager **89.1%** on 586 of 643 tasks (55 outdated tasks removed), GPT-4o, with a custom judge that allowed "unknown" and had manual review of failures ([2024-12-15 report](https://browser-use.com/posts/sota-technical-report)).
- Online-Mind2Web **97.0%** (291/300, "bu-max", [2026-03-25](https://browser-use.com/posts/online-mind2web-benchmark)), judged by an **agentic judge built on the Claude Agent SDK**. The gain came from turning the harness into a **coding agent that parses HTML with Python**, found by a 20-cycle Claude Code "auto-research" loop that used train/validation splits. The per-task results are public ([repo](https://github.com/browser-use/online-mind2web)).

---

## 6. Stagehand / Browserbase

- **Primitives** **[harness]**: `act(instruction)`, `extract(schema)` and `observe()`. An *inner* LLM resolves a natural-language instruction against the accessibility tree, and `executionModel` can be a cheaper model.
- **Agent modes** ([docs v3 agent.mdx](https://raw.githubusercontent.com/browserbase/stagehand/main/packages/docs/v3/basics/agent.mdx)):
  - `dom` "works with any model". Tools: `act, fillForm, ariaTree, extract, goto, scroll, keys, navback, screenshot, think, wait, search` (12).
  - `hybrid` adds `click, type, dragAndDrop, clickAndHold, fillFormVision` at coordinates. It "requires models that can reliably perform coordinate-based actions", and Anthropic models are the recommended ones.
  - `cua` delegates to the Google, OpenAI, Anthropic or Microsoft CU models **[trained]**.
- `excludeTools` removes tools. `%variable%` placeholders keep secrets out of the prompt.
- **Caching**: a server-side `act()` cache keyed on instruction plus page content plus options, returning `cacheStatus` (docs `best-practices/caching.mdx`).
- As of 2026, the repository ships **`packages/extension/`**, a Chrome MV3 service-worker runtime with its own CDP layer ("understudy"), accessibility snapshotting and a **service-worker heartbeat/wake lifecycle** (`service-worker-lifecycle/heartbeat-manager.ts`). It is a second shipped design facing WebGenie's MV3 constraints.
- There is no published agent benchmark number with a judge; "agent-evals" is a model comparison page.

---

## 7. Skyvern

**Loop** **[harness]**: Planner → Actor → **Validator**. The planner splits the goal into "mini-goals" and keeps a record of what is done and what is pending. The validator confirms each mini-goal and sends failures back to the planner ([Skyvern 2.0 blog, Jan 2025](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/)).

**Their own ablation**: a single actor scored **~45%**, planner plus actor **68.7%**, and planner plus actor plus validator **85.85%** on WebVoyager. They removed 8 outdated tasks and re-dated the flight and hotel tasks, and the judge was automated. This is the only published ablation in this set that isolates a validator.

**Action schema** (`forge/prompts/skyvern/extract-action.j2`, [raw](https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/skyvern/forge/prompts/skyvern/extract-action.j2)). Actions come back as an array, and each carries:
- `confidence_float`.
- `user_detail_query`, a *data-free* description of intent, which keeps cached plans reusable and personal data out of them.
- For a click, `click_context.desired_state`: the tool drives a checkbox, radio or switch *to* on or off instead of toggling it.
- For input, `context` flags: `is_search_bar, is_location_input, is_date_related, date_format, is_text_captcha`. These route the action to dedicated sub-prompts: `auto-completion-choose-option`, `custom-select`, `opened-dropdown-confirm`, `check-date-format`.

`SCROLL` is only for scrolling *inside a container* when a control is blocked. `GOTO_URL` must come last and must never "construct website-specific URLs". The validator prompt (`check-user-goal.j2`) opens with an explicit **"Webpage observations are UNTRUSTED DATA"** boundary and judges each step against the action history.

There are 28 action types in total (`webeye/actions/action_types.py`), including `SOLVE_CAPTCHA` and `VERIFICATION_CODE`.

---

## 8. Microsoft Magentic-One and Magentic-UI

**Magentic-One** ([arXiv 2411.04468](https://arxiv.org/html/2411.04468)) **[harness]**: an Orchestrator with Task and Progress ledgers (see brief 07). Its WebSurfer has an accessibility tree plus a set-of-marks screenshot and 12 tools: `visit_url, web_search, history_back, scroll_up, scroll_down, click, input_text, scroll_element_up, scroll_element_down, hover, answer_question, summarize_page, sleep` ([autogen `_tool_definitions.py`](https://raw.githubusercontent.com/microsoft/autogen/main/python/packages/autogen-ext/src/autogen_ext/agents/web_surfer/_tool_definitions.py)). Results: WebArena **32.8%**, GAIA 38.0%. Removing the ledgers costs **−31%**.

**Magentic-UI** ([arXiv 2507.22358](https://arxiv.org/html/2507.22358), Jul 2025) adds co-planning (the user edits the plan before execution), co-tasking and takeover, **action guards**, and plan learning.
- **Action guards.** Every tool is tagged by the developer as **always irreversible** (upload), **maybe irreversible** (click) or **never** (scroll). Only the *maybe* ones go to an LLM judge.
- **Plan learning.** Finished traces are distilled into plans, stored and retrieved by similarity.
- **Scores** (o4-mini): WebVoyager 82.2%, GAIA 42.5%, AssistantBench 27.6%. On 162 GAIA validation tasks, autonomous 30.3% rose to **51.9%** with a side-information simulated user.
- **Red team.** With the mitigations on, no attack scenario succeeded. With them off, injections exfiltrated SSH keys and even made the agent auto-approve itself through its own UI.

---

## 9. Amazon Nova Act

**[trained]**: a custom vision model driven through `act()` and `act_get(schema)` calls written into Python ([aws/nova-act README](https://raw.githubusercontent.com/aws/nova-act/main/README.md)).

- **Reliability.** The model "works most reliably when the task can be accomplished in **fewer than 30 steps**". Off-track runs are fixed by "break the task up into stages and connect these in code". Extraction goes in a separate `act_get` with a schema, "even just a bool".
- **Human in the loop.** `approve` gets a screenshot for a yes/no or multi-choice decision; `ui_takeover` hands a live browser to a person, for example for a CAPTCHA.
- **Secrets.** Passwords are typed through Playwright (`page.keyboard.type(getpass())`) so they never reach the model, with a warning that screenshots still capture whatever is on screen.
- **Guardrails.** `state_guardrail` is a URL allow or block callback run after every observation. File access uses allow-listed paths for `file://` and uploads.
- **Numbers.** 90%+ reliability "on early enterprise customer use cases" (GA 2025-12-02, [AWS](https://aws.amazon.com/about-aws/whats-new/2025/12/build-automate-production-ui-workflows-nova-act)). ScreenSpot Web Text 0.939 (launch coverage). Nothing on an open end-to-end benchmark.

---

## 10. Manus

**Architecture** **[harness]**: a general agent with a VM sandbox and browser tools. The design lessons come from [Ji, "Context Engineering for AI Agents", 2025-07-18](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus):
- **KV-cache hit rate is "the single most important metric".** The input:output ratio is about **100:1**, and cached tokens cost 10× less. Keep the prefix stable (no timestamps), keep the context append-only, and serialise deterministically.
- **"Mask, don't remove".** Never add or remove tools mid-run: it breaks the cache and confuses the model when history mentions a tool that is gone. Constrain the choice by logit masking or response prefill, and give related tools a shared prefix (`browser_`, `shell_`) so a whole group can be enforced.
- **The file system is the context.** Compression is always *restorable*: drop a page's content but keep its URL.
- **Recite the plan.** About **50 tool calls per task**, so a `todo.md` rewritten every step keeps the goal inside the recent attention span.
- **Keep failed actions and their errors in context. Don't few-shot yourself into repetition.**

There is no public benchmark with a judge. The GAIA claims are self-reported.

---

## 11. Simular Agent S2 / S3

**S2** ([arXiv 2504.00906](https://arxiv.org/abs/2504.00906), 2025-04-01) is screenshot-only. It combines "Mixture-of-Grounding" (routing to specialist grounding experts) with proactive hierarchical planning. Only relative gains over Claude CU and UI-TARS appear in the abstract.

**S3** ([arXiv 2510.02250 v2](https://arxiv.org/html/2510.02250), 2026-02-03) **drops the manager/worker hierarchy for a flat policy** that "can replan at any time", and adds a **coding agent inside the GUI action space**.
- **Scores.** OSWorld **62.6%** single-rollout with GPT-5, against S2's 48.8%. **72.6%** with **Behavior Best-of-N**: 10 rollouts and a judge that compares *behaviour narratives*, meaning facts extracted from before/after screenshots and zoomed crops, in one multiple-choice call.
- **Ablation.** Behaviour narratives score 60.2%, against 56.0% for screenshots only and 55.0% for trajectory summaries.

---

## 12. H Company Surfer-H + Holo1

Surfer-H ([arXiv 2506.02865](https://arxiv.org/html/2506.02865v1), 2025-06) has three modules in sequence: **policy, localizer and validator**. It is screenshot-only ("does not require the DOM or the accessibility tree") **[trained]** for the Holo1 weights.

- **Actions**: click or type at a target, scroll up or down, wait, refresh, go to URL, go back, answer.
- **Memory**: past actions, recent screenshots and a **notes** field.
- **Validator**: when the policy answers, the validator approves it or writes feedback into the notepad and browsing continues.
- **Budget and judge**: 30 steps. Judged by a majority of 3 GPT-4o samples.

| Configuration | @1 attempt | @10 attempts | Cost / task |
|---|---|---|---|
| Holo1-7B policy + GPT-4o validator | **69.6%** | **92.2%** | $0.13 |
| GPT-4.1 policy | 75.4% | 92.0% | $0.54 |
| All Holo1-7B, validator included | 55.4% | 80.4% | $0.06 |

Swapping the GPT-4o validator for Holo1-7B costs **12 points**: "validation is harder than policy making or localization."

---

## 13. Opera Neon, Fellou, Genspark

- **Opera Neon** (shipped 2025-09-30): "Neon Do" plans in the cloud but **executes locally in the browser, so cookies and sessions never leave the device**. Work is grouped into "Tasks" workspaces ([Opera press](https://press.opera.com/2025/09/30/opera-neon-ai-agentic-browser-release/)). No tool list or numbers are published.
- **Fellou**: runs the agent in a background "Shadow Workspace" window. Its open-source Eko framework has a browser agent with **13 tools**: `navigate_to, current_page, go_back, input_text, click_element, scroll_mouse_wheel, hover_to_element, extract_page_content, get_select_options, select_option, get_all_tabs, switch_tab, wait`. Observation is an indexed DOM tree (`build-dom-tree.ts`, browser-use lineage) plus a labelled screenshot ([eko `browser-labels.ts`](https://raw.githubusercontent.com/FellouAI/eko/main/packages/eko-core/src/agent/browser/browser-labels.ts)).
- **Genspark**: "Mixture-of-Agents" routing across many LLMs and 80+ tools, with a reflection step. GAIA 87.8% is self-reported ([eesel summary](https://www.eesel.ai/blog/genspark-ai), secondary). Nothing technical is published.

---

## Comparison table

| System | Observation | Actions | Planner? | Verifier? | Memory | Confirmation design | Best number (judge) |
|---|---|---|---|---|---|---|---|
| OpenAI CUA/Operator | screenshot | 9 | no (single policy) | no | none (memory off in agent) | trained ask (recall 92%) + PI monitor (99%/90%) + watch mode | O-M2W 61.3% (human, official); 44.3% (Browserbase) |
| ChatGPT agent / Atlas | screenshot (visual) + text browser; Atlas: ARIA | 9 + text browser + terminal | no | no | off | critical recall 99.9–100%; logged-out mode; no code/downloads | WebArena 65.4% (self) |
| Gemini 2.5 CU / Mariner | screenshot (+ page elements in Mariner) | 13 → 20 | no | no | Teach & Repeat (Mariner) | per-step out-of-model safety service → `require_confirmation` | O-M2W 69.0% official / 65.7% Browserbase; WebVoyager 88.9% |
| Anthropic browser toolset / Claude in Chrome | AX tree + refs; screenshot/zoom on demand | 31 (4 off by default) | optional `update_plan` | no | none | per-site permission; confirm publish/purchase/PII; injection classifiers | ASR ~1% (internal adaptive attacker) |
| Browser Use | indexed DOM + optional screenshot | 24 | in-loop `plan_update` | pre-done checklist + optional judge | files, todo.md, compaction | none built in; sensitive-data placeholders | O-M2W 97.0% (own agentic judge); WebVoyager 89.1% (own judge, 586 tasks) |
| Stagehand | AX tree (dom) / + coordinates (hybrid) | 12 (dom), 17 (hybrid) | no | no | action cache | `%var%` secrets | none with a judge |
| Skyvern 2.0 | screenshot + element tree | 28 types | yes (mini-goals) | **yes** (per mini-goal) | workflow scripts | untrusted-data boundary in prompts | WebVoyager 85.85% (auto judge, 8 tasks removed) |
| Magentic-One / UI | AX tree + SoM | 12 | orchestrator + ledgers | ledger "satisfied?" | saved plans (UI) | 3-tier irreversibility + LLM judge for "maybe" | WebArena 32.8%; WebVoyager 82.2% (UI) |
| Nova Act | screenshot | undisclosed | code is the planner | schema'd `act_get` | none | HITL approve/takeover; URL guardrail callback | "90%+ enterprise" (internal) |
| Manus | VM browser + shell | ~dozens, prefixed | todo.md recitation | no | file system | — | self-reported GAIA |
| Agent S3 | screenshot | GUI + code agent | flat (hierarchy dropped) | bBoN judge across rollouts | — | — | OSWorld 62.6% @1, 72.6% @10 |
| Surfer-H | screenshot | 8 | no | **yes** (answer validator) | notes | — | WebVoyager 69.6% @1, 92.2% @10 (GPT-4o ×3) |
| Eko / Fellou | indexed DOM + labelled screenshot | 13 | workflow planner | no | — | — | none |

---

## Synthesis

**Choices that recur among the systems with the best independently judged numbers.**

1. **An external check of the answer against fresh page state.** Skyvern's validator was worth **+17 points** (68.7 → 85.85). Surfer-H's validator quality alone was worth **12 points**. Magentic-One lost **31%** without its ledgers, and Agent S3's comparative judge added **+10 points** over its rollouts. None of these is self-critique of the model's own reasoning. Each re-reads the environment, and the literature says only a check with external feedback helps.
2. **Browser-native products converge on the accessibility tree with refs, and a screenshot only on demand.** This covers Anthropic's browser toolset, Claude in Chrome, Atlas reading ARIA, Magentic's WebSurfer, and browser-use, Stagehand and Eko on a DOM variant of the same idea. Screenshot-only designs belong exclusively to vendors who **trained** the model for it: CUA, Gemini CU, Claude computer use, Holo1 and Nova Act. Stagehand says outright that coordinate tools need a coordinate-capable model. **This design transfers across providers; the pixel design does not.**
3. **A small core vocabulary with the rare tools off by default.** Vocabularies are 9, 12, 13 and 13 tools. The larger ones either group pointer primitives (Anthropic's 31) or carry file tools (browser-use's 24). Anthropic ships `javascript_exec`, `file_upload`, console and network **disabled by default**.
4. **Batched actions that halt on failure or page change**, with an explicit "Not executed" result for each skipped call (Anthropic, browser-use, Skyvern).
5. **References that fail loudly and tell the model to re-read** (Anthropic's stale-ref error; browser-use's per-`backendNodeId` stable indexes).
6. **Commits are confirmed by a layer outside the model's own choice**: OpenAI's monitor, Google's per-step service, Anthropic's classifiers, Magentic-UI's per-tool irreversibility tiers, Nova Act's URL callback. In every case the model-level "ask" is backed by a deterministic or separate check.
7. **Secrets never reach the model**: Nova Act types them through Playwright, Stagehand uses `%var%`, and browser-use uses sensitive-data placeholders.
8. **The plan is recited inside the loop**: Manus's todo.md, browser-use's plan and todo, Claude in Chrome's `update_plan`, Magentic's ledgers.
9. **Harness-side loop detection with soft, escalating nudges** on *normalised* action hashes, plus page stagnation (browser-use; Magentic's stall counter).

**Choices that are idiosyncratic or do not transfer.**
- **Multi-rollout headline numbers** (Surfer-H @10, Agent S3 bBoN @10). They need resettable sandboxes. On a user's logged-in tab, a second rollout re-submits the form.
- **Pixel action spaces.** They are moving *lower-level* (Gemini went from 13 semantic to 20 primitive actions) precisely because the model is trained for them. DOM harnesses move the other way, towards higher-level verbs: `fillForm`, `form_input`, `extract`, `find`.
- **An inner LLM per action** (Stagehand's `act`).
- **Mixture-of-models routing** (Genspark).
- **Auto-solving CAPTCHAs in the cloud** (browser-use, Skyvern).
- **Self-built judges behind the top numbers.** browser-use's 97% uses its own agentic judge, and its 89.1% was measured on 586 tasks. Skyvern removed tasks. The same Gemini model loses 3–9 points in someone else's harness.

---

## What this means for WebGenie

Constraints: the extension works with any provider, accuracy comes before tokens, fixes stay task-agnostic, and only risky changes get a gate run. **Tests** means the change ships on unit tests and measured counts. **Gated** means a live gate run first. Code paths are under `chrome-extension/src/background/agent/`.

### A. The tool set (plan Stream 4): the cross-system evidence for ~17 tools

`actions/schemas.ts` has 37 core schemas plus 10 `manage_*`, registered in `actions/builder.ts::buildDefaultActions`.

| Keep / merge into | Absorbs | Evidence from the teardowns | Ships |
|---|---|---|---|
| `go_to_url{url, new_tab?}` | `open_tab` | Anthropic `navigate`; Skyvern NEW_TAB is a URL action | tests |
| `go_back` | `go_forward` (0 calls) | Anthropic folds back/forward/reload into `navigate("back")`. Optional second step: fold `go_back` into `go_to_url` too | tests |
| `search_web` | — | Gemini legacy `search`, browser-use `search`, Magentic `web_search` | — |
| `click_element{index}` | `hover_element`, `right_click_element`, `drag_element` (0 calls) | browser-use sends hover and drag through `evaluate`; the rare pointer verbs live in Anthropic's primitives, not in DOM tool sets | tests |
| **`input_text` → "set this control's value"** | **`select_dropdown_option`** | Anthropic `form_input(value)`, Claude in Chrome, Skyvern `SELECT_OPTION` + `desired_state`, browser-use and Eko `select_*`. **Every system treats choosing an option as setting a value, not as a click.** | **gated, as an arm of plan 4.2** (see below) |
| `fill_form` | — | Stagehand `fillForm`, Skyvern batch form-fill | — |
| `send_keys` | — | universal | — |
| `scroll{index?, direction, text?}` | `scroll_to_text` | Magentic `scroll_element_*`; Skyvern scrolls a container only; Anthropic scroll takes a target | tests (plan 1.3/4.1) |
| `read_page` | `get_complete_page_content` | Anthropic `get_page_text` + `read_page(filter, depth, ref)`, 50k cap with "narrow the read" | tests (delete the deprecated alias; `LEGACY_ACTIONS` in `navigator/replay.ts`) |
| `find_in_page` | — | Anthropic `find` returns **refs**; browser-use `search_page` is "free and instant" | tests |
| `extract` | — | Stagehand `extract`, browser-use `extract` | — |
| `wait_for{text? , ms?}` | `wait` | Stagehand `wait` "for time or condition" | tests |
| `switch_tab{tab_id, action}` | `close_tab` | Anthropic `switch_tab`/`close_tab`; the tab list is already in state | tests |
| `view_screenshot{region?}` | — | Anthropic `zoom`; kept behind `useVision` | — |
| `ask_human`, `done`, `save_findings` | `notes`, `todo_list` (→ per-call `memory` + planner) | browser-use's per-step `memory` field; Manus's recitation is one channel, not three | **gated**: `notes`/`todo_list`/`assert` shipped in `8bd49b8` and have never run (plan §"The model ignores the new tools") |
| **Off by default**, capability flag at task start (plan 4.3/4.4) | `eval_js`, `sniff_api`, `fetch_json`, `download`, `read_file`, `upload_file`, `manage_*` | Anthropic ships `javascript_exec`/`file_upload`/`read_console`/`read_network` disabled; Atlas has no code or downloads | tests |

**Plan 4.2, with a correction from this evidence.** The plan merges `select_dropdown_option` into the *click* verb. No shipped system does that. Anthropic, Claude in Chrome, Skyvern, browser-use and Eko all model it as **setting a value**. A native `<select>` cannot be opened reliably by a CDP click in any case, and our census shows 15 tasks trying both verbs on the same element. Recommendation: run 4.2's gate with **two arms**. Arm (a) is merge-into-click, as planned. Arm (b) is merge-into-`input_text`, where a `<select>`, checkbox or radio target sets the value. Both arms keep the "Option X not found. Available: …" reply. Arm (b) also takes Skyvern's **`desired_state`** for toggles, so clicking an already-checked box is a validated no-op instead of an un-check. That toggle part is tests-only, and belongs in `actions/handlers/` and `validation/service.ts`.

**Keep the tool array fixed for the whole run** (plan 4.4). Manus's "mask, don't remove" is the reason. Do the capability selection once, before the first call, so the Gemini and Anthropic prefix caches hold. This bears directly on plan 8.1–8.2, the 3% planner cache hit. Tests.

**Model-agnostic check.** Everything in the table is **[harness]**. For providers with weak native tool calling (Ollama, small local models), browser-use shows the pattern already present in `agents/base.ts`: one JSON action list in the prompt. The fewer tools in that list, the fewer schema errors the fallback path has to repair. Add a test to `actions/__tests__/tools.test.ts` asserting the **default** tool count (flags off) stays ≤ 18, so the vocabulary cannot creep back.

### B. Harness changes beyond the tool list

1. **The stale-index error names the fix.** Adopt Anthropic's wording on a stale or invalid index: "[n] is stale or not on the current page; the element list below is current." The result then carries the fresh candidates, which is plan 2.1. Add this to the validate-before-dispatch path in `validation/service.ts` and cover it with unit tests.
2. **Loop detection on normalised actions.** Hash a click by role plus name rather than index, a navigate by host plus path template, and a search by sorted tokens, then nudge at 5/8/12 plus page stagnation, as browser-use does. WebGenie's `GoalRepeats` works on planner *goals*. This works on navigator *actions*, and it catches the 94 of 157 identical retries (plan 2.2) even when the index changes. Tests.
3. **An explicit irreversibility tier on every tool.** Give each schema in `schemas.ts` static metadata, `irreversible: 'always' | 'maybe' | 'never'` (Magentic-UI). Derive `COMMIT_DECIDING_TOOLS` and `MUTATING_ACTIONS` from it, and make `tools.test.ts` fail when a new tool has no tier. The page-blind intent check stays the judge for "maybe". This is a contract test, and it stops a future tool from slipping past `commitTarget()`. Tests.
4. **Autocomplete and date inputs get deterministic follow-through** (the 11% wrong-target class). Skyvern classifies each input (`is_search_bar`, `is_date_related`, `date_format`) and runs dedicated sub-steps. browser-use's prompt says to type, *wait* for the suggestions and click one. A navigator prompt rule already exists and did not prevent these failures (brief 07 §0). The harness version: after `input_text` into a `role=combobox` or an `aria-autocomplete` field, `interaction` handlers wait for the listbox and return the suggestion texts, with indexes, *inside the action result*, and `submit:true` is refused while a listbox is open and nothing was chosen. Tests for the mechanism; **gated** for the refusal rule.
5. **A budget-aware consolidation rule** (the 44 cap deaths). browser-use's "at 75% of your step budget … shift strategy, consolidate partial results" maps onto our token cap. At 75% of the cap, the planner packet (`ContextBuilder`) states the budget and requires either a narrowed plan or `done(success=false)` with the findings so far. A partial answer scores 0 under the judge, so this may not raise the pass rate; it turns silent deaths into reported partial results and shortens the tail. **Gated**, reporting partial-answer rate and pass rate side by side, per the accuracy-first rule.
6. **Screenshot retention.** Keep images only in the last N turns (Gemini's reference agent uses 3, Anthropic says ≤20). Check that `MessageManager` drops old `view_screenshot` images and keeps a text receipt (plan 8.4). Tests.
7. **The validator is the most-replicated win in this set** (Skyvern +17, Surfer-H +12, Magentic −31% without it). Stream 6 is deferred by user decision. Keep it deferred, but note that 6.2, the de-anchored verifier that reads fresh page state, has the strongest cross-system support of any deferred item. Prefer a verifier that sees the *current page* over one that sees the agent's reasoning. Skyvern's `check-user-goal.j2` is a model of that.
8. **A compact navigator prompt for weak models.** browser-use keeps separate `flash` and `no_thinking` prompts. Add a flag in `llmCapabilities.ts` that selects a shorter navigator template (fewer rules, same tools) for small local models. **Gated**, on a local model arm, because it changes model-facing text.

### C. What WebGenie already matches (do not rebuild)

These all have direct counterparts in shipped systems, so they are not gaps:
- Accessibility-tree perception with element indexes over CDP (Anthropic browser toolset, Atlas).
- Batch halting when the page changes (browser-use, Anthropic).
- `{{secret_N}}` placeholders (Nova Act, Stagehand).
- Commit confirmation through the `commits` field (the ChatGPT agent critical-action class).
- Page-blind intent checks (Brave's "alignment check").
- The `nano_*` untrusted-data delimiters (Skyvern's `UNTRUSTED_WEB_PAGE_DATA`).
- Checkpoint and resume plus `ask_human` (Nova Act `approve`/`ui_takeover`, Operator takeover).
- `*[` marks for new elements (browser-use).

---

## What not to copy

- **Pixel-coordinate action spaces as the primary interface** (CUA, Gemini CU, Claude CU, Holo1, Nova Act). They depend on the vendor's trained model. Stagehand documents that hybrid mode needs "models that can reliably perform coordinate-based actions". WebGenie must serve Ollama and friends, so keep coordinates, if at all, as a fallback for canvas and custom widgets behind `useVision`.
- **Adopting Gemini's predefined action set because the benchmark runs Gemini.** It is also changing under us: 13 semantic actions became 20 primitive ones between model generations.
- **Best-of-N rollouts and pass@10 numbers** (Surfer-H 69.6 → 92.2; Agent S3 62.6 → 72.6). A logged-in user tab cannot be reset.
- **An inner LLM call per action** (Stagehand `act`). Our 429s track *request count* (ρ 0.91), so this doubles the scarcest resource.
- **Logit masking and response prefill** (Manus). They need control over decoding that most providers do not expose. Take only the half that transfers: a fixed tool array and shared name prefixes.
- **An orchestrator with separate agents for plain browsing** (Magentic-One WebArena 32.8%, below single-policy systems). Its value is the ledger, which brief 07 covers, not the agent count.
- **Cloud CAPTCHA solving and "stealth" infrastructure** (browser-use, Skyvern `SOLVE_CAPTCHA`). It conflicts with the human-in-the-loop policy and the site's terms, and it is not in the extension.
- **Custom-judge headline numbers as targets**: browser-use 97% (own agentic judge), 89.1% (586 tasks); Skyvern 85.85% (tasks removed); Mariner 83.5% (no judge stated). Gemini CU drops 3–9 points in Browserbase's harness. Compare only on our own calibrated judge (plan Stream 11).
- **browser-use's "open a new tab for research" rule.** Our census has 1 `open_tab` call in 10,446, and tabs add state the navigator must track.

---

## Could not reach

- **openai.com** (403 to both WebFetch and curl): the CUA page, "Introducing ChatGPT agent", "Hardening Atlas against prompt injection". The CUA and ChatGPT-agent benchmark numbers above come from search snippets and the Gemini model card. The safety numbers come from the two system-card PDFs on cdn.openai.com, which I read in full.
- **OpenAI computer-use guide**: the current version no longer documents `pending_safety_checks`, so the older safety-check categories are not verified here.
- **perplexity.ai hub** (403): "Mitigating prompt injection in Comet" and "How we built security into Comet". Comet's design is inferred from Brave's disclosure and the BrowseSafe paper.
- **anthropic.com** (domain verification failed): the prompt-injection-defenses page came through on retry, and the Claude-for-Chrome post through its claude.com redirect.
- **labs.amazon.science** and **cloud.google.com** (domain verification failed): the Nova Act launch science post and the Vertex computer-use page. I used the nova-act README and the Gemini API docs instead.
- **deepmind.google/models/project-mariner**: returned no Mariner content. Mariner details come from DeepMind's X post and press coverage.
- **Magentic-UI WebSurfer tool definitions**: the file path in the repository was empty, so I used Magentic-One's autogen definitions.
- **Agent S2**: abstract only, with relative gains; I did not reach the full paper's tables.
- **Genspark, Opera Neon**: no technical documentation is published, only press and reviews.
- **Claude in Chrome's own system prompt and tool schemas**: Anthropic has not published them. Only community reverse-engineering (marked lower trust) and the official `browser_toolset_20260801` docs were available.
