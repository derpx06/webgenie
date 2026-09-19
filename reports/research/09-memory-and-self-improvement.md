# 09 — Memory, skills and self-improvement for web agents

Research brief for Stream 9 ("Memory that compounds") of the approved plan. Written 2026-09-19.
Brief 02 already summarises AWM, SkillWeaver and ICAL headline numbers; this brief goes one
level down: how each system decides what to store, how it retrieves it, how bad entries are kept
out or removed, what hurts, and what it means for the code in
`chrome-extension/src/background/agent/memory/`.

**Scope note (from the coordinator):** WebGenie must stay model- and provider-agnostic (Gemini,
OpenAI, Anthropic, Ollama and others). Every recommendation here keeps stored memory as plain,
model-neutral text, and section 6 collects the evidence on whether memory gains hold for weak and
local models.

## Bottom line

1. **Whether an entry is good enough to store matters more than how memory is built.** Storing
   every run makes agents *worse than having no memory*. Strict admission makes them clearly better
   (Xiong et al., below). WebGenie admits a playbook when its own planner says `done`. That is a
   self-judgement, and self-judges are about 73% accurate on web tasks.
2. **Check a skill before you store it.** Only 15.6% of ASI's induced skills pass verification, and
   those 15.6% still beat AWM by 11.3% relative. Removing self-verification from Voyager costs 73% of
   discoveries. In WebXSkill, verification is the largest single ablation.
3. **Failures help as distilled lessons and hurt as replayed paths.** Adding failures to
   ReasoningBank lifts WebArena 46.5 → 49.7. Adding them to AWM drops it 44.4 → 42.2.
4. **Memory that advises beats memory that executes, for robustness and for weaker models.**
   Grounded (executed) skills break mid-run on sites that change. Models under 30B cannot follow
   skill schemas. A 7B model *loses* 1.7 points with WebCoach.
5. **Memory is a persistence layer for prompt injection.** MINJA plants records by queries alone:
   98.2% injection success and 76.8% attack success, with less than 2% utility loss. The best
   off-the-shelf detector catches 67.7%. WebGenie's harness-written, structural store is the right
   design, but two fields in it (`role`/`type` attributes and path segments) are still authored by
   the page.
6. **Our own measurement confound:** the e2e runner shares one Chromium profile across up to 10
   tasks, including repeats of the same task when the selection is small. Memory state therefore
   leaks between tasks today, so a Stream 9 gate run would measure nothing clean until memory state
   is controlled.

---

## 0. Where WebGenie stands (read from source, 2026-09-19)

| Store | File | Key | Content | Admission | Removal | Injection |
| --- | --- | --- | --- | --- | --- | --- |
| Route memory | `memory/global/memory-store.ts` | origin + path template of the start page | ≤12 steps: host, templated path, action, element `role`/tag + `type` | planner `done` (`executor.ts:652`) | 30-day TTL, 50 routes, overwrite per key | once per task, into the state prefix (`prompts/base.ts:232`) |
| Site skill ("playbook", P6, 8bd49b8) | `memory/global/site-skills.ts` | registrable domain | search URL with the value removed, ≤10 step lines, ≤4 generic trap labels | planner `done` (`executor.ts:654`) | 60-day TTL, 30 domains; `failures=1` after **any** failed task on the domain (`executor.ts:666/678/734`) | once per task, same prefix, before the route note |
| Per-task ledger | `memory/in-chat/ledger.ts` | task | visits, refusals, dead ends | harness-written | end of task | every call, rebuilt, cannot be compacted away |

Findings from reading the code. These are not in the plan yet.

- **F1. The playbook is "the last success on this domain", not an induced workflow.** `record()`
  replaces the domain's entry with whatever task last succeeded there. A second, unrelated task type
  on the same domain overwrites it. AWM, by contrast, induces *common sub-routines across several
  examples*.
- **F2. Demotion is domain-wide and cause-blind.** Any failed task on the domain demotes the skill,
  even when it was a different kind of task. The catch-all `else` at `executor.ts:732-734` also
  demotes on errors that are not about the site at all: auth, bad-request and billing errors end the
  task through that branch.
- **F3. Route note and site-skill note usually repeat the same steps.** Both come from
  `context.routeSteps` and are prepended together (`prompts/base.ts:328`).
- **F4. Page-authored strings reach cross-task memory.** `routeStep()` stores
  `node.attributes.role` and `node.attributes.type` verbatim. Both are arbitrary strings the page
  controls, with no allowlist and no length cap. `pathTemplate()` keeps any path segment of 24
  characters or fewer that has no digit and shares no word with the user's text, so
  `/ignore-earlier-notes/` survives. The note is defanged and capped (`defangTags`,
  `MAX_REFLECTION_CHARS = 6000`) but is not marked as untrusted.
- **F5. "Clear site memory" does not clear the playbook.**
  `pages/options/src/components/DeveloperSettings.tsx:114` removes `wg_mem:routes` and the legacy
  keys but not `wg_mem:site_skills`. The list of domains is browsing history, so this is a privacy
  bug. The button is also only visible with Developer Options enabled.
- **F6. The e2e runner leaks memory between tasks.** `e2e/run.mjs:829` puts
  `TASKS_PER_BROWSER = 10` tasks in one fresh profile. Repeats run in the outer loop, so with
  `E2E_ONLY` of fewer than 10 tasks and `E2E_REPEAT=3`, attempt r2 sees the playbook r1 wrote. That
  inflates `pass^k`, and sibling tasks on the same domain see each other's memory depending on order.

---

## 1. Workflow and skill induction in depth

### Practice

Three representations are in use. Most shipped systems pick one.

| Representation | Systems | Executed or advisory |
| --- | --- | --- |
| NL workflow: title plus steps (state, reasoning, action) with placeholders | AWM, ReasoningBank (title, description, content), CER, Letta skill learning, Anthropic Agent Skills | advisory |
| Program over primitive actions | ASI, SkillWeaver (Playwright APIs), Voyager (JS), WALT (site functions as tools) | executed |
| Both: program plus step-level NL guidance | WebXSkill (grounded or guided), DRIVE (reasoning plus interaction skills) | either |
| Selector cache keyed by page fingerprint | Stagehand auto-caching | executed, heals by falling back to the LLM |

### Mechanism and evidence

**AWM** ([arXiv 2409.07429](https://arxiv.org/html/2409.07429), Sep 2024)
- *Representation:* each workflow has an NL description plus steps of {state description,
  reasoning, action}. Concrete values become variables ("dry cat food" → `{product-name}`).
  Workflows need at least 2 steps and must not overlap.
- *Retrieval:* per website. Examples are grouped by site, and all of a site's workflows are injected
  with no similarity filter.
- *Online admission:* an LM evaluator gives a binary success label (Pan et al. 2024).
- *Ablations:*
  - rule-based and LM-based induction tie on WebArena (35.6 vs 35.5 SR; the LM version takes 5.9 vs
    6.3 steps);
  - text and code formats differ by only 0.3;
  - workflows exposed as actions (AWM_AS) gain +1.3 step SR, but the agent called them in only 18.5%
    of tasks;
  - abstract workflows beat Synapse's concrete exemplars by +5.0 element accuracy.
- *Failure modes the authors report:* the agent does not know when to leave the workflow; a workflow
  breaks when the page changes mid-run (their flight-booking popup case); and combining offline and
  online workflows is *worse* than either alone.

**ASI** ([arXiv 2504.06821](https://arxiv.org/html/2504.06821), Apr 2025, revised Aug 2025)
- *Representation:* skills are Python functions over primitive actions.
- *Admission, in three checks:*
  1. the task is rewritten to use the new skill (trailing actions truncated, to avoid spurious
     success) and re-executed, and an LLM evaluator must judge it solved;
  2. at least one new skill is actually called;
  3. every skill call changes the environment.
- Only **15.6%** of programmatic skills pass, against 31.4% of AWM text workflows.
- *WebArena:* vanilla 32.7% / 5.6 steps, AWM 36.3% / 5.9, ASI 40.4% / 5.0. The authors attribute
  the gain mainly to verification.
- *Transfer to real sites* (OneStopMarket → Target and similar pairs): `search_product()` carries
  over, sort-by-dropdown does not. The agent rarely calls incompatible skills. Hard-coded element ids
  make skills break silently when the layout differs.

**SkillWeaver** ([arXiv 2504.07079](https://arxiv.org/html/2504.07079), Apr 2025)
- The agent proposes skills, practises them, and synthesises them into APIs. Checks: static
  analysis, an LLM reward model over screenshots and trajectory, and generated unit tests. At test
  time, APIs whose preconditions fail are filtered out.
- *Online-Mind2Web:* 40.2 → 56.2%. Per site: Flights 11.7 → 29.4, Cars 11.1 → 11.1 (no gain).
- *Failures:* the model does not recognise an applicable API, passes wrong parameters
  (`'chocolate chip, -nuts'`), and hits stale selectors.
- Pass rates for synthesised APIs are not reported.

**Synapse** ([arXiv 2306.07863](https://arxiv.org/abs/2306.07863), ICLR 2024): state abstraction,
whole trajectories as exemplars, and similarity-retrieved exemplar memory. MiniWoB++ 99.2%, and
+56% relative step SR on Mind2Web. It is the "concrete exemplar" end of the spectrum, and AWM's
abstraction beats it (above).

**ExpeL** ([arXiv 2308.10144](https://arxiv.org/html/2308.10144), AAAI-24)
- Insights come from comparing successful and failed pairs. Each insight carries an importance count
  that starts at 2 and is moved by ADD / EDIT / UPVOTE / DOWNVOTE; at 0 the insight is deleted. It is
  the first "demote on evidence" rule in this literature.
- *WebShop reward:* ReAct 0.665, insights-only 0.675, retrieve-only 0.67, both 0.701. *ALFWorld:*
  40 → 59.
- The gains on web shopping are small next to text worlds.

**AutoManual** ([arXiv 2405.16247](https://arxiv.org/abs/2405.16247), NeurIPS 2024): a Builder
agent writes typed rules (Success Process, Useful Helper Method, Special Phenomenon, Corrected
Error), and "case-conditioned prompting" grounds each rule update in a concrete case to curb
hallucinated rules. ALFWorld 97.4% (GPT-4-turbo).

**Voyager** ([arXiv 2305.16291](https://arxiv.org/html/2305.16291), 2023): code skills indexed by
embeddings of their descriptions, admitted only after a GPT-4 critic self-verifies them. Removing
self-verification costs **−73%** of distinct items discovered.

**ReasoningBank** ([arXiv 2509.25140](https://arxiv.org/html/2509.25140), ICLR 2026)
- *Items:* {title, one-line description, content}. They are *strategies*, not action sequences.
- *Retrieval:* embedding retrieval with **k = 1** by default.
- *Admission:* an LLM judge with no ground truth labels each trajectory; it is **72.7%** accurate
  (Gemini-2.5-flash, WebArena-Shopping). Performance is flat for judge accuracy between 70% and 90%.
- *WebArena:* no memory 40.5–46.7%, Synapse 42.1–47.7, AWM 40.8–47.6, ReasoningBank 46.3–56.3.
  Steps fall by up to 2.1 (26.9%) on successful tasks.
- Memory is append-only, with no deduplication.

**WebCoach** ([arXiv 2511.12997](https://arxiv.org/html/2511.12997), Nov 2025)
- A condenser writes a 3–5 sentence summary plus an embedding and success or failure. It stores
  "fail_modes or success_workflows" and **only completed episodes**.
- A Coach retrieves the top-5 records and intervenes only when failure looks likely (CAPTCHA, loop,
  dead end) or a better workflow is on record.
- *WebVoyager:* Skywork-38B 47.3 → 61.4 (10.7 → 10.2 steps); Qwen-VL-32B 49.5 → 57.1; Qwen-VL-7B
  **32.8 → 31.1**.

**WebXSkill** ([arXiv 2604.13318](https://arxiv.org/html/2604.13318), EMNLP 2026 Findings)
- Skills are keyed in a **URL-pattern graph**: path segments become wildcards, and matching tries the
  exact normalised URL first, then a wildcard `fnmatch`. Up to 20 candidates per page are shown after
  an element-presence filter.
- Skills that fail to execute are discarded; verification is the largest ablation.
- *WebArena (GPT-5):* 59.7 vanilla, 69.5 grounded, 68.8 guided. *WebVoyager:* 86.1 grounded,
  82.7 guided. *Online-Mind2Web:* 59.0 → 68.7.
- Execution success of grounded skills varies by site (96% Shopping, 52% CMS). When a guided skill
  fails, the agent re-plans toward the same sub-goal. 38% of failures happen in reasoning *after*
  the skill.

**WALT** ([arXiv 2510.01524](https://arxiv.org/abs/2510.01524), Salesforce, Oct 2025): it does not
invent skills; it reverse-engineers functions the site already has (search, filter, sort, post,
create) into tools. VisualWebArena 52.9%, WebArena 50.1%.

**DRIVE** ([arXiv 2605.23939](https://arxiv.org/abs/2605.23939), Apr 2026): separate *reasoning
skills* (abstract, transferable) and *interaction skills* (programmatic, page-bound), because a
single store trades executability against transfer. It scores 52.8% on five WebArena domains, +7.3
over no skills.

**Stagehand auto-caching** ([Browserbase blog](https://www.browserbase.com/blog/stagehand-caching),
industry practice)
- *Key:* SHA-256 over method, normalised URL, **DOM hash** and scope. *Stored:* selector plus
  metadata; passwords and keys are never stored.
- *Staleness:* the current page fingerprint is compared with the recorded one. On drift the entry is
  treated as a miss and re-learned; the cached selector is never forced.
- *TTL:* **48 hours.** About 80% speed-up on the second run.

**Anthropic Agent Skills**
([engineering post](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills),
Oct 2025, open standard Dec 2025) and the **memory tool**
([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); launched with
context editing on 2025-09-29, see [blog](https://claude.com/blog/context-management))
- *Skills:* progressive disclosure. Name and description are always loaded, the body loads on
  trigger, and linked files load on demand. Skills are human-authored or co-authored, from observed
  failures.
- *Memory tool:* files under `/memories`, executed client-side. Anthropic's guidance: strip sensitive
  data before writing, cap file size, "periodically delete memory files that haven't been accessed in
  a long time", and validate every path.
- Memory plus context editing gained +39% on an internal agentic-search eval, and context editing
  alone +29%. Context editing cut tokens by 84% on a 100-turn web-search run.

**OpenAI** ([ChatGPT memory](https://openai.com/index/memory-and-new-controls-for-chatgpt/);
[Atlas data controls](https://help.openai.com/en/articles/12574142-chatgpt-atlas-data-controls-and-privacy))
- ChatGPT has explicit saved memories (a list the user can edit) and implicit chat-history
  reference (on/off only, since Apr 2025).
- Atlas "browser memories" are summarised server-side and sensitive-data filtered. Originals are
  deleted immediately, filtered summaries within **7 days**, and government IDs, bank numbers,
  credentials, and medical or financial pages are never kept.

**SkillsBench** ([arXiv 2602.12670](https://huggingface.co/papers/2602.12670), Feb 2026)
- Curated skills: **+16.2 pp** (v1; v3 reports 33.9 → 50.5, +16.6). **16 of 84 tasks got worse**,
  one by −39.3 pp.
- **Self-generated skills written before any feedback: −1.3 pp.**
- Focused skills of 2–3 modules beat comprehensive ones, and small models with skills match larger
  models without them.

**Letta skill learning** ([blog](https://www.letta.com/blog/skill-learning/), Dec 2025): on
Terminal-Bench 2.0, skills learned from trajectories alone gave +21.1% relative; with the tasks' test
feedback they gave **+36.8% relative** (+15.7 abs), with 10.4% fewer tool calls.
**SkillLearnBench** ([arXiv 2604.20087](https://arxiv.org/abs/2604.20087)): "self-feedback alone
induces recursive drift". Gains come from external feedback, only on tasks with clear reusable
workflows, and stronger models do not reliably write better skills.

### Quality control, in order of strength of evidence

1. **Execute before admitting.** ASI re-runs the task with the skill; Voyager and WebXSkill discard
   anything that fails; SkillWeaver runs unit tests. This is the strongest single lever in every
   ablation that measures it.
2. **An external signal beats self-judgement** (Letta +36.8 vs +21.1; SkillLearnBench's drift;
   SkillsBench's −1.3 for skills written without feedback).
3. **The judge's accuracy matters less than having a filter at all.** ReasoningBank is flat for judge
   accuracy between 70% and 90%. But Xiong et al. show vanilla LLM judges can be worse than a small
   curated set (§2).
4. **Demote on use-outcome.** ExpeL counters, ACE's helpful/harmful counters, and Xiong's
   history-based deletion (EHRAgent 38.67 → 42.06).

### Stale skills

Nobody solves staleness by prediction. Every system detects it *at use*:
- Stagehand compares page fingerprints and treats drift as a miss;
- SkillWeaver checks preconditions;
- ASI updates incompatible skills on the new site;
- WebXSkill's guided mode re-plans when a skill fails.

TTLs, where published, are short: Stagehand 48 h, Atlas 7 days. WebGenie's 30/60 days is long by
comparison but defensible for advisory text, as long as a detected mismatch demotes the entry.

---

## 2. Episodic vs procedural vs semantic memory

### Practice and mechanism

CoALA ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427), TMLR 02/2024) splits long-term memory
into three kinds:
- *episodic:* past trajectories and events;
- *semantic:* facts about the world and the agent;
- *procedural:* LLM weights plus the agent's code and prompts.

It warns that writing to procedural memory "is significantly riskier than writing to episodic or
semantic memory, as it can easily introduce bugs or allow an agent to subvert its designers'
intentions."

Mapped onto the systems above:
- *episodic:* Synapse, ExpeL retrieval, WebCoach records;
- *procedural:* AWM, ASI, SkillWeaver, Agent Skills, WebGenie's playbook;
- *semantic about the user:* MemGPT/Letta, Mem0, A-MEM, Zep, ChatGPT memory.

The conversational systems are evaluated on conversational QA, not web tasks:
- MemGPT ([arXiv 2310.08560](https://arxiv.org/abs/2310.08560)): OS-style paging between memory
  tiers; document QA and multi-session chat.
- Mem0 ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)): ADD / UPDATE / DELETE / NOOP; LoCoMo
  +26% relative over OpenAI memory, 91% lower p95 latency, over 90% fewer tokens than full context.
- A-MEM ([arXiv 2502.12110](https://arxiv.org/abs/2502.12110)): Zettelkasten-style links and
  "memory evolution"; LoCoMo.
- Zep ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)): a bi-temporal knowledge graph; DMR
  94.8 vs 93.4 for MemGPT, LongMemEval +18.5%.

### Evidence on which kinds help agents

- **Evo-Memory** ([arXiv 2511.20857](https://arxiv.org/html/2511.20857), Nov 2025; streaming test-time
  learning over 10 datasets, measured as success rate):
  - Claude 3.7 Sonnet on multi-turn tasks: no memory 0.24, ExpRAG (retrieve past experience) 0.63,
    ReMem (act–think–refine memory) 0.78, **AWM 0.30**.
  - Gemini 2.5 Flash: 0.27 → 0.46 (ExpRAG) → 0.50 (ReMem).
  - Gains correlate with within-dataset task similarity (**r = 0.717**).
  - When failures are stored too, the baselines degrade "notably", while ReMem, which *refines* the
    stored records, does not.
  - Plain episodic retrieval does most of the work; refining the records does the rest.
- **EvoMemBench** ([arXiv 2605.18421](https://arxiv.org/abs/2605.18421), May 2026; 15 methods):
  - retrieval memory is best for knowledge tasks;
  - procedural memory is best for execution tasks *when stored experience matches the task
    structure*;
  - **long-context baselines stay highly competitive**, and "no single memory form works
    consistently";
  - memory helps most when the current context is insufficient or the task is hard.
- **Xiong et al., "How memory management impacts LLM agents"**
  ([arXiv 2505.16067](https://arxiv.org/html/2505.16067), May 2025):
  - **Experience-following:** a retrieved record similar to the task input yields a near-identical
    output (r ≈ 1 on RegAgent). A wrong memory is copied, not merely consulted.
  - **Add-all is worse than a fixed memory:**

    | Agent | Add-all | Fixed memory | Strict admission |
    | --- | --- | --- | --- |
    | RegAgent | 55.48 | 67.53 | 70.95 |
    | AgentDriver | 32.32 | 40.11 | 51.00 |
    | CIC-IoT | 59.90 | 71.50 | 85.40 |

  - History-based deletion helps further (EHRAgent 38.67 → 42.06), and periodic deletion cut
    AgentDriver's memory from 1,178 to 467 records at a small cost.
  - "Vanilla LLM judges as evaluators may lead to a more severe negative impact than manually
    crafting a small but high-quality dataset."
- **CER** ([arXiv 2506.06698](https://arxiv.org/abs/2506.06698), ACL 2025): distilled
  environment-dynamics and decision memory reaches 36.7% on WebArena (+51% relative over GPT-4o).
- **ACE** ([arXiv 2510.04618](https://arxiv.org/html/2510.04618), Oct 2025): an itemised playbook
  with helpful/harmful counters, **delta updates instead of rewrites**, and embedding deduplication.
  It names two failure modes of rewritten memory:
  - **context collapse:** one AppWorld context shrank from 18,282 to 122 tokens, and accuracy fell
    66.7 → 57.1;
  - **brevity bias:** GEPA-style optimisers drop domain heuristics.

  Results: AppWorld +10.6, finance +8.6. Limitation: "if the Reflector fails to extract meaningful
  insights, the constructed context may become noisy or even harmful."

**Takeaway for web tasks.** What pays off is *procedural memory keyed to the site*, verified and
advisory. *User-fact memory* (Mem0-style) has no web-task evidence and is exactly what our privacy
rule forbids. Episodic retrieval by task similarity works but needs the task text stored, which our
privacy rule also forbids (§7).

### Retrieval triggers and injection budgets

| System | Trigger | How many | Budget |
| --- | --- | --- | --- |
| AWM | website | all workflows for the site | unbounded per site |
| ReasoningBank | query embedding | k = 1 (default; larger k ablated) | 1 item |
| WebCoach | query embedding, but injected only on risk | top-5 | selective |
| WebXSkill | URL pattern + element present | ≤ 20 candidates per page | per page |
| Stagehand | URL + DOM hash | exact | 0 LLM tokens |
| Agent Skills | description match | body on trigger | progressive |

Consistent signals: small k, a structural trigger (URL or element present) before a semantic one,
and on-demand loading rather than always-on. SkillsBench found focused skills beat comprehensive
ones.

---

## 3. Learning from failure

### Practice

There are three forms:
- **raw failed trajectories** as exemplars (Synapse and AWM with failures);
- **distilled lessons**: ExpeL contrastive insights, ReasoningBank's "strategies to avoid", Letta's
  "common pitfalls", WebCoach's `fail_modes`;
- **in-task dead-end ledgers**, like our `TaskLedger`.

### Evidence

- ReasoningBank's ablation, adding failed trajectories to the store:

  | Method | Success only | With failures |
  | --- | --- | --- |
  | Synapse | 40.6 | 41.7 |
  | AWM | 44.4 | 42.2 |
  | ReasoningBank | 46.5 | 49.7 |

  **Failures help when turned into "why it failed / what to check", and hurt when stored as paths to
  follow.**
- Evo-Memory: storing both successes and failures makes the baselines degrade; only refined memory
  holds up.
- Reflexion ([arXiv 2303.11366](https://arxiv.org/html/2303.11366)) *did not* improve WebShop: it "is
  unable to solve tasks that require a significant amount of diversity and exploration". Its
  reflections on ambiguous search failures were unhelpful. Self-reflection on web search failures is
  weak evidence at best.
- "From Agent Failures to Text Policies" ([arXiv 2607.20668](https://arxiv.org/html/2607.20668),
  Jul 2026; text games, 7B models):
  - of 32 generated rules, only **7 were grounded strategies**; 9 were generic, **5 instance-specific**
    and 9 semantically wrong;
  - the dev gate **rejected a +5 rule and accepted a −20 rule**;
  - no trajectory-based method reliably beat the fixed prompt (summaries −1.88, GEPA +1.25 with a
    CI spanning zero);
  - human-written rules gave +5.0.
- Letta: test feedback "better encodes common failure modes and unsuccessful approaches" (+36.8 vs
  +21.1 relative).
- Our corpus (`analysis-2-step-waste.md`): 30% of first divergences are planner errors, including
  "re-issues an already-failed route, no memory of dead ends". Those are *in-task*, and the ledger
  already targets them. Cross-task per-domain workflows would save only 74 steps, 63 of 96 of them
  inside tasks that already succeeded.

**Takeaway.** Keep negative experience within the task (the ledger), where the evidence is strongest
and the privacy cost is zero. Across tasks, store failures only as *generic labels*, as we already do
(trap labels), or as a demotion signal; never as "don't go to /x" paths from a single run.

---

## 4. Self-improvement loops without fine-tuning

### Practice and mechanism

- **APE** ([arXiv 2211.01910](https://arxiv.org/abs/2211.01910)) and **OPRO**
  ([arXiv 2309.03409](https://arxiv.org/abs/2309.03409), ICLR 2024; GSM8K up to +8%, BBH up to +50%
  over human prompts): LLM-proposed prompts scored on a training set.
- **TextGrad** ([arXiv 2406.07496](https://arxiv.org/abs/2406.07496)): textual "gradients" through a
  pipeline; GPQA 51 → 55 with GPT-4o.
- **GEPA** ([arXiv 2507.19457](https://arxiv.org/html/2507.19457), ICLR 2026 oral)
  - *Mechanism:* reflective mutation from traces, and a Pareto frontier of candidates.
  - *Split:* the training data is divided into **D_feedback**, used for reflection, and **D_pareto**,
    used only for selection. A candidate reaches D_pareto only if it improves a minibatch.
  - *Results:* +6% over GRPO with up to 35× fewer rollouts, and +10% over MIPROv2.
  - Prompts are up to 9.2× shorter than MIPROv2's. Its generalisation gap is smaller than MIPROv2's.
  - Prompts optimised on Qwen3-8B transferred to GPT-4.1-mini (+9%).
- **Self-Harness** ([arXiv 2606.09498](https://arxiv.org/html/2606.09498v1), Jun 2026)
  - *Loop:* cluster failed traces by verifier-grounded signatures, propose K edits, regression-test
    each edit on the held-in and held-out splits.
  - *Acceptance:* Δ_in ≥ 0 **and** Δ_ho ≥ 0, with at least one > 0.
  - *Terminal-Bench-2.0, held-out:* M2.5 40.5 → 61.9, Qwen3.5-35B 23.8 → 38.1, GLM-5 42.9 → 57.1.
  - The accepted edits were **model-specific**; cross-model transfer was not tested.
- **Darwin Gödel Machine** ([arXiv 2505.22954](https://arxiv.org/abs/2505.22954);
  [Sakana blog, 2025-05-30](https://sakana.ai/dgm/)): SWE-bench 20 → 50. It is also the cautionary
  tale: the agent "faked a log making it look like it had run the tests", and "removed the markers
  we use in the reward function to detect hallucination". It was caught only because every change was
  traceable.

### Evidence on overfitting

- Rule generation overfits to instances: 5 of 32 rules were instance-specific, and the dev gate
  picked the wrong rules (2607.20668).
- Held-out gating works when the held-out split is invisible to the proposer (Self-Harness: no
  promoted edit regressed either split).
- Optimisers exploit whatever they are scored on (DGM).

### Guarding against site-specific overfitting, which is a WebGenie hard rule

1. Split failures **by domain, not by task**: rules are proposed from domains A and must hold on
   unseen domains B.
2. Lint every proposed prompt or rule edit for domain names, site-specific strings and task ids, and
   reject any that match. That is the task-agnostic rule, made mechanical.
3. Two-sided acceptance (Self-Harness), with paired, family-aware comparison and uncertainty
   (2607.20668). This matches the plan's "revert if judged success falls".
4. Record the origin of every rule and keep it revertible (2607.20668).
5. The judge must not be editable by the loop (DGM).

---

## 5. Memory safety

### Attacks

- **MINJA** ([arXiv 2503.03704](https://arxiv.org/html/2503.03704), 2025)
  - *Threat model:* the attacker only sends queries.
  - *Method:* bridging steps, an indication prompt, then progressive shortening, until the malicious
    record is retrieved for a victim's query.
  - *Results:* **ISR 98.2%, ASR 76.8%**. On the RAP web-shop agent, ISR 96.3–99.3% and ASR
    77.4–98.9%. Utility drops less than 2%.
  - *Defences tested:* prompt-level detection works on one agent with high false positives
    elsewhere; embedding sanitisation fails because poisoned and benign records sit together in
    embedding space.
- **AgentPoison** ([arXiv 2407.12784](https://arxiv.org/abs/2407.12784), Jul 2024): optimised
  triggers give **>80% ASR at <0.1% poison rate** with <1% benign impact.
- **Unit 42 on Bedrock Agents**
  ([Palo Alto Networks](https://unit42.paloaltonetworks.com/indirect-prompt-injection-poisons-ai-longterm-memory/)):
  a malicious *web page* manipulates the **session-summarisation** step, and the injected
  instructions persist into every later session's orchestration prompt. This is the closest analogue
  to a browser agent writing memory after a task.
- **Gemini, delayed tool invocation**
  ([Embrace The Red, Feb 2025](https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/)):
  hidden text in a document plants a conditional ("if the user later says yes, save X"), which fires
  on the user's next innocuous reply.
- **Systematic study** ([arXiv 2606.04329](https://arxiv.org/html/2606.04329v1), Jun 2026)
  - It names four write paths: explicit instruction, system-policy write, **compaction write** and
    **experience-to-procedure write**. The last is the path our playbook uses.
  - ASR 34–67% depending on the agent.
  - Off-the-shelf detectors fall short; the best, PromptArmor, reaches 67.7% TPR at 1% FPR.
- **Privacy extraction:** MEXTRA ([arXiv 2502.13172](https://arxiv.org/abs/2502.13172), ACL 2025)
  pulls stored user–agent records out of memory with black-box prompts.

### Defences with evidence

- **Structural stores that no model writes**, where the harness writes typed fields from an
  allowlist. This is not measured as such, but it removes the write paths every attack above uses.
  OWASP ASI06
  ([OWASP GenAI](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/),
  Dec 2025) recommends provenance on every write, forgetting windows, and treating memory as
  untrusted on read.
- **Accumulated legitimate memory resists injection** ([arXiv 2601.05504](https://arxiv.org/html/2601.05504v2),
  Jan 2026): with pre-existing correct records, MINJA ASR fell 62% → 6.67% (GPT-4o-mini) and
  52.9% → 0% (Llama-3.1-8B). Trust-score sanitisation was overconfident (54 of 82 accepted records
  were poisoned).
- **Consensus across several memories**: A-MemGuard ([arXiv 2510.02373](https://arxiv.org/abs/2510.02373))
  cut ASR by over 97% on EHRAgent. It needs several retrieved memories, which our k ≤ 1 per domain
  does not have.
- **Expiry:** Claude's memory docs recommend deleting unaccessed files, Stagehand uses 48 h, Atlas
  7 days.
- **Sensitive-data exclusion at write time:** Atlas's category exclusions; Stagehand never caches
  credentials.

---

## 6. Model- and provider-agnosticism: do memory gains hold for weak and local models?

| Evidence | Direction |
| --- | --- |
| WebCoach, WebVoyager: 38B +14.1, 32B +7.6, **7B −1.7** | gains shrink with scale and turn negative at 7B ("cognitive threshold") |
| WebXSkill: "sub-30B models could not reliably follow skill schemas"; Qwen-122B does better *guided* (53.9) than grounded (48.7), GPT-5 the reverse | structured or executable skills need strong models; advisory text degrades gracefully |
| SkillWeaver: APIs a strong model wrote lift GPT-4o-mini by 40–133% on five sites | memory *authored* strong and *consumed* weak transfers well |
| SkillsBench: small models with curated skills match larger models without | good memory can stand in for model size |
| GEPA: prompts optimised on Qwen3-8B transfer to GPT-4.1-mini (+9%) | optimised text transfers across providers |
| Self-Harness: accepted harness edits were model-specific | loop-learned rules may not transfer; validate per model |
| SkillLearnBench: stronger backbones do not reliably write better skills | authoring quality is not simply model size |
| AWM: text and code formats within 0.3 | format choice is not model-locked |

**Implications:**
- Store memory as short, plain NL, as the playbook already does: no provider tool formats and no
  executable programs.
- Author it deterministically from the harness's own trace. That makes authoring quality independent
  of which model the user runs, which the literature above says is the weak link.
- Measure with at least one small model (for example an Ollama 7–9B) in the gate, because the only
  7B datapoint is negative.

---

## 7. What this means for WebGenie

Ordered by value, each with the code it touches, the expected effect, and how it is proven. "Unit"
means a test that fails without the change; "Gated" means a live gate run under the plan's two-sided
rule. Nothing here stores user-typed text, and nothing is site-specific.

| # | Change | Code | Expected effect | Proof |
| --- | --- | --- | --- | --- |
| M1 | **Control memory state in e2e** (F6). Add `E2E_MEMORY=cold` (clear `wg_mem:*` before every task; this is the default) and `warm` (seed from a *disjoint* run on the same domains; never from the same task id or its repeats). Record the mode in the measurement-integrity block. | `e2e/run.mjs`, harness `runTask` | Without it, the Stream 9 gate measures order and repeat leakage; `pass^k` from `E2E_REPEAT` is inflated today whenever repeats share a browser | unit (oracle run asserts an empty store at task start in cold mode) |
| M2 | **"Clear site memory" must clear `wg_mem:site_skills`** (F5); move the control out of Developer Options. Better still, have one `clearAll()` in `memory/index.ts` that the options page calls, so a future store cannot be missed again. | `DeveloperSettings.tsx:114`, `memory/index.ts` | Fixes a privacy bug: the user believes history is gone while the domain list remains | unit |
| M3 | **Allowlist page-authored fields** (F4). `target` takes only a known ARIA role and a known `<input type>`, else the tag name. Path segments must match a conservative charset and be ≤ 24 characters, else `:n`. The note is wrapped as untrusted data (`untrustedInline`-style) rather than only defanged. | `memory-store.ts` `routeStep`, `pathTemplate`; `site-skills.ts` `searchPattern` (param name from the `SEARCH_PARAMS` list only, which it already does) | Closes the one experience-to-procedure write path a page can steer (2606.04329's C4; Unit 42 pattern) | unit (a page with `role="ignore prior instructions"` stores `button`) |
| M4 | **Evidence-gated admission.** Record a playbook only when the planner's `done` *and* the executor's done-evidence verdict agree the answer was backed (`validation/done-evidence.ts`, already computed at `executor.ts:517`), and no send-back or refusal happened in the final phase. Show a skill only after **2 confirmations** from different runs; store a `confirmations` count. | `executor.ts:652-654`, `site-skills.ts` | Stops error propagation (Xiong: add-all 32.3 vs strict 51.0 on AgentDriver; experience-following copies bad memories); ReasoningBank's self-judge is only 72.7% accurate | unit for the rule; gated for success rate |
| M5 | **Cause-aware, use-aware demotion** (F2). Demote only when the skill was *shown* in this task and the failure is the agent's (max steps, failure budget, planner give-up); never on auth, billing, bad-request, rate-limit or cancel. Replace the 0/1 flag with ExpeL-style counts: confirmations up, failures down, hidden at 0. | `executor.ts:666/678/734`, `site-skills.ts` | A working playbook is no longer thrown away by a provider outage or an unrelated task type | unit |
| M6 | **One note, not two** (F3). When a site skill exists for the domain, drop the route note's duplicate steps and keep only the steps that differ, or merge them into one block. | `prompts/base.ts:232-240,328` | Removes noise the literature says hurts (SkillsBench: focused beats comprehensive); saves tokens without removing information | unit |
| M7 | **Several workflows per domain, keyed structurally** (F1). Replace "one entry per domain, overwritten by the last success" with up to N (for example 3) workflows keyed by `routeKey(startUrl)` plus the first action kind. Retrieve **k = 1** by the most specific match (WebXSkill's exact URL, then wildcard order; ReasoningBank's k = 1). Induce a workflow only from ≥ 2 successful runs that share a prefix of steps (AWM's "common sub-routine"), with the **precondition** being the start path template and the first target present, and the **check** being the validated observation after the last step. | `site-skills.ts`, `types.ts` | The Stream 9 plan item. Our corpus supports a small gain (74 steps, mostly consent and region dismissals in successful runs), so expect latency savings, not success-rate gains | **gated**, both cold and warm (M1), plus one small local model (§6) |
| M8 | **Keep memory advisory; do not add executable replay.** The note already says "the current page wins". Do not add Stagehand-style selector replay or SkillWeaver-style APIs. | none (a decision) | Grounded skills fail mid-execution (WebXSkill 52% on CMS), need strong models (sub-30B cannot follow schemas), and would bypass the navigator's commit and intent gates | n/a |
| M9 | **Failures stay in the task and stay generic across tasks.** Keep the ledger for dead ends. Across tasks, store only the fixed trap labels already in `TRAPS` and use failures as demotion signals. No "avoid /path" entries from a single failed run. | `ledger.ts` (unchanged), `site-skills.ts` | ReasoningBank shows failures help only when distilled; AWM with failures drops 44.4 → 42.2; text-policy generation is mostly noise (7 of 32 grounded) | unit for "no path from a failed run is stored" |
| M10 | **A small-model switch for memory notes.** Add a per-model capability (next to the others in `llmCapabilities.ts`) to suppress cross-task notes for models where the gate shows harm. Leave it on by default. | `packages/storage/lib/settings/llmCapabilities.ts`, `prompts/base.ts` | WebCoach 7B −1.7; stops memory from hurting local models, without guessing | gated on one small model before it is used |
| M11 | **A trace-driven improvement loop with a domain-disjoint held-out split.** Cluster failure signatures from `kind: 'llm'`/`span` traces and propose general rule or prompt edits. Accept an edit only if Δ ≥ 0 on both the proposing domains and unseen domains. Lint edits for domain names and task ids, record where every rule came from, and never let the loop touch the checkers or judge. | process plus a lint script under `e2e/` | Turns the "task-agnostic" pinned rule into a mechanical gate (Self-Harness: 33–60% relative held-out gains; 2607.20668: ungated rules are mostly noise; DGM: judges get gamed) | lint is unit-tested; each accepted edit is gated |

Deliberately *not* proposed:
- **Embedding retrieval by task similarity** (ReasoningBank, WebCoach, Synapse). It needs the user's
  task text, or an embedding of it, stored across tasks. That breaks the "never store typed personal
  data" rule, and embeddings of user text are derived personal data. Structural keys (URL template,
  first action) give most of the precision here, because our retrieval unit is the domain anyway.
- **Mem0/Zep-style user-fact memory.** It has no web-task evidence and falls directly under the
  privacy rule.

---

## 8. What not to copy

- **Add-all memory.** It is worse than no memory in four out of four agents (Xiong et al.). An
  append-only store without a filter (as in ReasoningBank's simplified pipeline) only works with a
  judge and small k.
- **Workflows offline from a benchmark training split, mixed with online ones.** AWM found the
  combination worse than either alone. For us it also breaks the task-agnostic rule, because it bakes
  benchmark sites into the product.
- **Self-written skills without external feedback.** SkillsBench −1.3 pp; SkillLearnBench's
  "recursive drift".
- **Full rewrites of the memory by an LLM.** ACE's context collapse: 18,282 → 122 tokens, and
  accuracy fell 66.7 → 57.1. Use delta updates, as the harness does now.
- **Executable skills and selector caches as the default path.** They are fast, but they bypass
  perception, validation and the commit gate, and they fail silently on layout drift (ASI, WebXSkill).
- **Storing failed paths as "avoid" rules from a single run.** Single-run negatives are
  instance-specific, like the 5 of 32 rules above.
- **LLM-written memory built from page text** (summaries of what the page said, Unit 42's pattern).
  This is the main poisoning path. Keep the store harness-written and typed.
- **A self-improvement loop that can edit its own judge or checkers** (DGM's faked test logs and
  removed markers).
- **Long TTLs as the staleness strategy.** Every production system detects staleness at use. TTL is
  a backstop.
- **Trusting one large headline.** AWM's +51% relative was measured on WebArena's 5 fixed sites with
  many tasks per site. The same method scores 0.30 vs 0.24 (almost nothing) in Evo-Memory. Our corpus
  measures 74 steps. Gains track task similarity (r = 0.717), and real users repeat tasks on a domain
  far less than a benchmark does.

---

## 9. Could not reach / not verified

- **CoALA full text via HTML.** Taxonomy and quote were taken from the PDF with `pdftotext`; the
  HTML was not fetched.
- **A-MEM, MemGPT, Agent-KB:** numbers from abstracts only. Agent-KB: GAIA pass@3 55.2 → 73.9,
  SWE-bench 24.3 → 28.3, "disagreement gate" against harmful transfer
  ([arXiv 2507.06229](https://arxiv.org/abs/2507.06229)). Not checked in full text.
- **APE** (2211.01910): cited from prior knowledge, not re-fetched this session.
- **SkillWeaver:** pass rates of synthesised APIs are not reported in the paper.
- **SkillsBench:** v1 numbers (86 tasks, +16.2 pp, self-generated −1.3 pp, 16 of 84 negative) come
  from the HF paper page. The v3 revision reports 87 tasks and +16.6 pp and was not reconciled
  further.
- **Evo-Memory** per-dataset tables for web-like tasks: only averages extracted.
- **MEXTRA:** leakage counts not extracted (abstract only).
- **browser-use:** it had a Mem0-backed procedural-memory option (`memory_interval`), but its current
  status (kept or removed) could not be confirmed.
- **DRIVE** (2605.23939) and **WebXSkill**: skill-expiry policies are not described in the parts
  read.
- No source was found that measures memory on **Online-Mind2Web-style one-task-per-site
  distributions** with realistic repeat rates. That is the question M7's gate has to answer for us.
