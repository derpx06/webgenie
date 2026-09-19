# Robustness on real sites, and answer quality

Stream 12 of the research extension. Research done 2026-09-19. This brief adds to briefs 01–06 and `reports/TRACE_REVIEW.md` and does not repeat them. Brief 02 already covers de-anchored judging (false positives 0.719 → 0.012), WebJudge, Mind2Web 2 rubric trees and the AgentOccam ablations. Brief 01 covers Huang et al. on self-correction. Brief 03 covers FActScore and DeepResearch Bench FACT.

**Scope rule used throughout:** WebGenie must work with any model and any provider (OpenAI, Anthropic, Gemini, Ollama and others). So every recommendation here is one of two things:
- **deterministic harness code**, or
- **a plain model call** made through the existing `invokeTools` path, which also works when tools are rendered into the prompt instead of called natively. Nothing depends on vision, long context, a provider's own grounding or one model family's tool features.

Source quality:
- Numbers from the Operator system card, the Claude in Chrome post, the Public Suffix List, the Related Website Sets list, `tldts` and `autoconsent` I read or measured myself.
- The other paper numbers were read through fetched summaries of arXiv HTML pages. Check them against the paper's own table before quoting them externally.

---

## 1. Failure taxonomies on live benchmarks: which classes dominate, and what fixed them

| Source | What dominates | Measured fix |
|---|---|---|
| **Online-Mind2Web**, "An Illusion of Progress?" ([arXiv 2504.01382](https://arxiv.org/abs/2504.01382), v4 8 Oct 2025, COLM 2025) | Operator's failures: **Filter & Sorting 57.7%** ("applying incorrect filters or sorting options, or failing to apply them when required"), Navigation 19.6%, the rest incomplete steps and misunderstanding. A typical error is a misapplied range (2001–2012 applied when 2004–2012 was asked). Other agents "rely excessively on keyword-based search", issuing "a single, loosely structured query" for a task with several constraints. Failed tasks take ~2× the steps, "primarily due to repeated actions or unexpected pop-up windows". | The benchmark's own judge rubric fails search-instead-of-filter: "Certain key points or requirements should be applied by the filter. Otherwise, a search with all requirements as input will be deemed a failure." Ranges must match exactly; superlatives (cheapest, newest) must use the site's sort. |
| Same paper, dataset hygiene | **47% of 650 original Mind2Web tasks** were invalid or outdated (ambiguous wording, site changes, CAPTCHA). CAPTCHA and "strong bot protection" sites were **removed before evaluation**. | Blocked sites are excluded, not scored as failures. |
| **WebArena** ([arXiv 2307.13854](https://arxiv.org/abs/2307.13854), v4 Apr 2024) | When told it may answer "N/A" for impossible tasks, GPT-4 **called 54.9% of feasible tasks impossible**. Other classes: observation bias (latches onto the first related piece of information without verifying it), repeating the same command until the step limit, and 100% consistency on only 4 of 61 templates. | Removing the N/A hint gave the published 14.41%. The lesson is that early infeasibility is the model's cheapest exit. |
| **WebArena Verified** (ServiceNow, [GitHub](https://github.com/ServiceNow/webarena-verified), NeurIPS 2025 SEA workshop, released 4 Dec 2025) | All 812 tasks audited; misaligned evaluators repaired and ambiguous instructions clarified. | Type-aware normalisation of answers, a structured JSON answer with explicit status codes, and backend state checks: **~11% fewer false negatives**. The hard-subset size differs between versions (137 vs 258 tasks). |
| **AssistantBench** ([arXiv 2407.15711](https://arxiv.org/abs/2407.15711), Oct 2024) | Web agent SeePlanAct: **11.1% accuracy at a 35.9% answer rate, 30.9% precision**. Its errors: navigation 36.7%, grounding 23.3%, wrong answer 20.0%. Closed-book guessing reaches 22.2% accuracy but only 24.8% precision; 85% of its wrong answers are hallucinated. | Adding a planning step (SeeAct → SPA): **4.1% → 11.1%**. Falling back to guessing (ensemble) raised accuracy to 25.2% and *lowered* precision. Answer rate and precision trade off, so abstaining is worth something. |
| **BrowseComp** ([arXiv 2504.12516](https://arxiv.org/abs/2504.12516), 16 Apr 2025) | Browsing makes calibration worse: GPT-4o with browsing has **82% calibration error**, Deep Research **91%** (accuracy 51.5%). | Voting over 64 attempts: **+15–25%**; best-of-N was best. The model can often recognise the right answer while being badly calibrated about its own. |
| **WebVoyager** ([arXiv 2401.13919](https://arxiv.org/abs/2401.13919)) | Of 300 sampled failures: Navigation stuck **44.4%** (mostly running out of the 15-step budget while browsing other results instead of fixing an earlier action), visual grounding 24.8%, **hallucination 21.8%**, prompt misalignment 9.0%. | Screenshots: 40.1% → 59.1%. |
| **WebCanvas / Mind2Web-Live** ([arXiv 2406.12373](https://arxiv.org/abs/2406.12373)) | Confusing similar elements, **premature termination after intermediate steps**, information lost when parsing complex element relationships. 96 of 780 tasks broke through site changes within the maintenance window. | Human-labelled intermediate rewards raised GPT-4 to 52.3% completion. **Self-generated rewards did not help.** |
| **REAL** ([arXiv 2504.11543](https://arxiv.org/abs/2504.11543), Apr 2025) | "Inadequate failure recognition": the agent does not check that every part of the task is done. Also dead ends with no instinct to backtrack. | — (best result 41.07%) |
| **WebGames** ([arXiv 2502.18356](https://arxiv.org/abs/2502.18356), Feb 2025) | Humans 95.7% vs best agent 41.2%. Agents fail on slider drags, timing, hover state, key combinations, canvas, nested iframes and **"Popup Chaos"**. | — |
| **BearCubs** ([arXiv 2503.07919](https://arxiv.org/abs/2503.07919), v3 Jul 2025; 2505.07672 is the wrong ID) | Humans 84.7%, ChatGPT Agent 65.8%, Deep Research 36.0%, Operator 23.4%. **37.5% of Deep Research's correct answers rest on unreliable or no sources**; it sometimes finds the specified source and then ignores it. "Agents succeed quickly and fail slowly." | — |
| **MAST**, "Why do multi-agent LLM systems fail?" ([arXiv 2503.13657](https://arxiv.org/abs/2503.13657), v3 Oct 2025) | Three categories: system design 43.9% (step repetition 15.7%, unaware of termination conditions 12.4%, disobeys task spec 11.8%), inter-agent misalignment 32.1% (reasoning–action mismatch 13.2%, **fails to ask for clarification 6.8%**), **task verification 24.0%** (premature termination 6.2%, no or incomplete verification 8.2%, **incorrect verification 9.1%**). Human κ 0.88. | ChatDev: a high-level objective verification step **+15.6%**; a clearer role spec +9.4%. |
| **Magentic-One** ([arXiv 2411.04468](https://arxiv.org/abs/2411.04468), Nov 2024) | Error codes from 200 logs, most frequent first: persistent inefficient actions, **insufficient verification steps**, underused resources, inefficient navigation. | Removing the Orchestrator's ledgers cost **−31%** on GAIA. |
| **TheAgentCompany** ([arXiv 2412.14161](https://arxiv.org/abs/2412.14161)) | Stuck on a closable welcome popup; "self-deception" (invents fake shortcuts, such as renaming another user to the target's name). | — |
| **WebChoreArena** ([arXiv 2506.01952](https://arxiv.org/abs/2506.01952), Jun 2025) | GPT-5 48.3% vs humans ~50.2%. Classes: counting errors, answering after incomplete exploration, and **"forgot to apply filters or sorting"**. | — |
| **BrowserArena** ([arXiv 2510.02418](https://arxiv.org/abs/2510.02418), 7 Oct 2025) | Three recurring failures: **CAPTCHA, closing pop-up or consent banners, navigating by URL instead of searching**. Consent banners on 80 BBC tasks: detected 0–100% depending on the model, but **closed only 4.65–17.81%**. DeepSeek-R1 **claimed it had closed the banner in 53.75% of tasks without ever detecting one**. CAPTCHA/verification was 6.9% of 218 step-level failures. When blocked, o4-mini routed around through Google, direct links, the Internet Archive and a public proxy; Claude 3.7 switched sites in 60%. | None tested. |
| **WAREX** ([arXiv 2510.03285](https://arxiv.org/abs/2510.03285), Sep 2025) | Injected network errors: success **−70% WebArena, −95% WebVoyager**; agents "immediately call the task infeasible". Server errors (408/429/5xx): −57%. GPT-4o **clicked malicious popups 97.3%** of the time. | A "refresh on error" prompt: 3.7% → 7.1% (network errors) and 5.3% → 9.0% (server errors), still far below baseline. |
| **When Web Agents Finish but Still Fail** ([arXiv 2606.20724](https://arxiv.org/abs/2606.20724), v2 29 Jun 2026) | Of imperfect episodes: near-duplicate search loops 25–42%; **premature termination on a partial answer 14–39%**; **"synthesis collapse"** (evidence retrieved, then flattened to defaults or "not found") 7–22%. | A bigger budget did not help premature termination. GRPO training lifted completion from 50.7% to 96.0% while binary accuracy stayed ~33%: **agents learn to finish confidently without solving more.** |

**What recurs.** Four classes dominate across these sources.
1. **False or premature completion:** WebArena's 54.9% false infeasibility; MAST verification at 24%; WAREX; R1's 53.75% false banner claims; synthesis collapse.
2. **Constraints not applied through filters:** 57.7% of Operator's failures; WebChoreArena.
3. **Loops:** WebVoyager 44.4%; MAST step repetition 15.7%.
4. **Popups and consent handled badly:** BrowserArena, WebGames, TheAgentCompany.

All four match our own table (planner error 30%, wrong target 11%, consent 344 steps). The measured fixes are external checks (a verification step +15.6%, ledgers −31% when removed, voting +15–25%). Self-generated rewards did not help (WebCanvas).

---

## 2. Form interaction robustness

**Actionability before dispatch.** Playwright ([playwright.dev/docs/actionability](https://playwright.dev/docs/actionability), current) waits for up to five checks and retries until they pass: **Visible, Stable, Receives Events, Enabled, Editable**.
- **Stable** = "maintained the same bounding box for at least two consecutive animation frames".
- **Receives Events** = the element is the hit target at the action point.
- **Visible** = a non-empty box and not `visibility:hidden`; `opacity:0` still counts as visible.
- Which actions check what: click and check run all five; `fill`/`clear` skip Stable and Receives Events; `press`, `focus`, `dispatchEvent` and `setInputFiles` run none.

Our `coverBlocker` (`browser/page.ts`) already does Receives Events (hit-test at the centre plus four inner points) and Enabled. There is **no Stable check** and no **Editable** check (`readonly`, `aria-readonly`) before typing.

**Autocomplete and typeahead.**
- **WAI-ARIA combobox pattern** (read from [w3c/aria-practices](https://github.com/w3c/aria-practices) source; w3.org was blocked):
  - `aria-autocomplete` is `none`, `list` or `both`; `aria-expanded` is true while the popup shows; focus stays on the input, with `aria-activedescendant` pointing at the highlighted option.
  - **Enter commits only when an option is active**: it "accepts the focused option … closing the popup, placing the accepted value in the combobox".
  - So a committed value is observable in the accessibility tree: `aria-expanded` goes false, `aria-activedescendant` clears, and the input value equals the option text.
- **Browser Use** (`browser_use/tools/service.py`, main, read today):
  - `_is_autocomplete_field` is true for any of: `role=combobox`; any `aria-autocomplete` other than `none`; a **`list` attribute (datalist)**; `aria-haspopup` together with `aria-controls` or `aria-owns`.
  - For those fields it waits 0.4 s and tells the model "wait for suggestions … click the correct suggestion instead of pressing Enter".
  - `input` **reads the value back** and warns when "the field's actual value … differs from typed text … page may have reformatted or autocompleted your input".
- **Agent-E** ([arXiv 2407.13032](https://arxiv.org/abs/2407.13032); repo EmergenceAI/Agent-E):
  - **Change observation:** after click and typing it runs a MutationObserver for 100 ms. If nodes appeared, it returns "new elements have appeared in view … the action is not yet executed and needs further interaction".
  - Its motivating example is exactly our failure: an airport field whose dropdown opens, where "the interaction is not yet complete, but the agent may assume it is".
  - It knew it had failed in more than 52% of its failed tasks.
  - Its own lessons include "assuming search functionalities are perfect and every search result will completely satisfy the search requirements".
- **Skyvern** changelogs:
  - Undated (likely Sep 2024): a cheaper model rewrites the typed text as the dynamic dropdown changes, cutting cost more than 6× for that field type.
  - August changelog, posted 10 Sep 2026: comboboxes, typeaheads and shadow-DOM selects "commit in one action", and "dropdown and custom-select fills verify that the value committed instead of reporting a false success".
- **Stagehand** issue #823: `act` on a native `<select>` failed with a click; it needs `selectOption`.

**Date pickers.**
- **Native `<input type=date>`:** MDN says the value "is always formatted yyyy-mm-dd" whatever the displayed locale format. Set it directly; never open the calendar.
- **APG date-picker dialog:** once a date is chosen, the button is renamed "Change Date, DATE_STRING" and the chosen cell carries `aria-selected=true`. Both are commit signals.
- **WILBUR** ([arXiv 2404.05902](https://arxiv.org/abs/2404.05902), Apr 2024): date selectors were "a large source of errors" on Google Flights and Booking; it recommends built-in functions for common complex widgets.
- **Agent-E** failed when a date reset because of a wrong format and did not notice.
- **Our own review** found that a date picker converting to UTC shifted the date by one day from a UTC+ timezone.

**Filters vs search.** Section 1 gives the strongest evidence: Operator 57.7%, WebJudge's rubric, and WebChoreArena's "forgot to apply filters or sorting". We already refuse search-only evidence once (`searchOnlyEvidence`). The published rubric adds two things we do not check:
- **exact range match:** a filter of 2001–2012 is not a filter of 2004–2012;
- **superlatives must be satisfied by a sort control.**

---

## 3. Consent walls, popups, bot detection, geo

**Detection standards.**
- **IAB TCF v2.2 CMP API** ([IAB GitHub, CMP API v2](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework)):
  - Call shape: `__tcfapi(command, 2, cb)` with `ping` and `addEventListener`.
  - `displayStatus` is `visible`, `hidden` or `disabled`.
  - `eventStatus` values: `tcloaded` (a stored choice exists, no UI), `cmpuishown` (the UI surfaced), `useractioncomplete`.
  - A `__tcfapiLocator` iframe marks the CMP for nested frames.
- **GPP** `__gpp('ping')` returns `cmpDisplayStatus`.
- What this gives us: from the page's main world, "a consent banner is showing" and "it was resolved" become a **deterministic signal**, with no text scraping. It only covers IAB-registered CMPs.

**Bundlable rule sets.**
- **DuckDuckGo autoconsent**, measured today from npm `@duckduckgo/autoconsent` 16.40.0 (MPL-2.0, last push 16 Sep 2026):
  - **843 rules** in `rules/rules.json` (380 JSON rule files plus 13 class-based CMPs: OneTrust, Cookiebot, Sourcepoint, TrustArc, consentmanager, …).
  - A **heuristic mode** that regex-matches popup text in several languages and classifies buttons as reject, tier 1 or tier 2. Its source warns that broader patterns such as "cookie settings" "cause too many false positives".
  - Each rule has `detectCmp` / `detectPopup` / `optOut` / `optIn` / `test`, pierces open shadow DOM and same-origin frames, and has `autoAction: 'optOut' | 'optIn'`, `prehideTimeout 2000`, `detectRetries 20`.
  - Messages: `popupFound`, `optOutResult`, `autoconsentDone`, `report`.
  - Size: compact rules **276 KB (56 KB gzipped)**, engine **~142 KB**.
  - It is built to run as an **MV3 content script plus background**, and ships a reference MV3 extension and a Puppeteer integration (`docs/puppeteer.md`).
- **Consent-O-Matic** ([cavi-au](https://github.com/cavi-au/Consent-O-Matic), MIT): more than 200 CMPs; `presentMatcher` and `showingMatcher`, then HIDE_CMP → OPEN_OPTIONS → DO_CONSENT → SAVE_CONSENT.
- **EasyList Cookie List** (CC BY 3.0 / GPLv3, modified 2026-09-19): ~22.8k cosmetic hide rules. It **hides the banner without answering it**, so a dialog that blocks scrolling can stay stuck.
- **"I Still Don't Care About Cookies"** (GPLv3 fork): tries a recognised reject button first, falls back to accept, and otherwise hides.

**How common and how costly banners are.**
- Rasaii et al., "Exploring the Cookieverse" ([arXiv 2302.05353](https://arxiv.org/abs/2302.05353), PAM 2023): banners are **56% more prevalent from inside the EU**. BannerClick detects them at 99% accuracy, accepts at 97% and rejects at 87%. After "accept", sites send 5.5× more third-party cookies.
- Cookie walls: 0.6% of 45k sites, but 8.5% of the German top 1k (IMC 2023).
- Nouwens et al. (CHI 2020): only **11.8%** of CMPs met minimal legal requirements.
- Priv-Accept ([arXiv 2109.00395](https://arxiv.org/abs/2109.00395)): after accepting, up to +70 trackers and pages load 2–3× slower.
- Implication: accepting on the user's behalf is not neutral. It changes their privacy state and slows the page.

**Bot detection and geo.**
- **Benchmarks exclude blocked sites.** Online-Mind2Web dropped CAPTCHA and bot-protected sites up front; our harness already marks them `site_down` or `site_blocked`.
- **Browser Use stealth benchmark** (browser-use.com, 21 Mar 2026): 71 protected sites, with pass rates from **40% to 81%** across cloud-browser vendors. Mostly irrelevant to us: we run in the user's real Chrome with their real fingerprint.
- **Cloudflare Web Bot Auth** ("Forget IPs", 15 May 2025; "Signed agents", 28 Aug 2025):
  - RFC 9421 HTTP Message Signatures with an Ed25519 key, `Signature-Agent` pointing at a key directory.
  - Launch partners include ChatGPT agent and Browserbase. Cloudflare published a Chrome-extension signer that uses `webRequest.onBeforeSendHeaders`.
  - It is the legitimate way for an agent to identify itself. It needs registration and a key, and per-request signing is awkward in MV3 (declarativeNetRequest cannot compute a signature).
- **CDP `Emulation.setTimezoneOverride` / `setLocaleOverride` / `setGeolocationOverride`** exist but **do not change the IP address**, so server-side geo blocks stay. Using them to match the *user's* real locale, or one the user asks for, is legitimate. Using them to get round a site's geo restriction or bot defence is evasion.

---

## 4. Answer quality and completeness

**Automatic attribution checking is ~80% accurate and misses fine detail.**
- **ALCE** ([arXiv 2305.14627](https://arxiv.org/abs/2305.14627), May 2023):
  - About **50% of ChatGPT and GPT-4 answers on ELI5 are not fully supported** by their own citations.
  - On list-style questions (QAMPARI), citation recall is only 20–26%.
  - The NLI checker agrees with humans **85.1%** on recall and 77.6% on precision.
- **AttrScore** ([arXiv 2305.06311](https://arxiv.org/abs/2305.06311)):
  - GPT-4 85.1% accurate, but only **45% F1 on contradictions**.
  - Top error: missing fine detail such as numbers and dates (30.6%).
- **AttributionBench** ([arXiv 2402.15089](https://arxiv.org/abs/2402.15089), ACL Findings 2024):
  - Best models reach ~78–82 macro-F1.
  - **66% of errors are missed fine detail**; 26.8% come from the checker seeing a snippet while the human saw the whole page.

For us, both points argue for **deterministic value matching** (exact numbers, dates and quoted strings against the page), which `unbackedValues` already does. A model check, if we add one, should get **the whole region, not a snippet**.

**Decompose, then verify each part independently of the draft.**
- **Self-Ask** ([arXiv 2210.03350](https://arxiv.org/abs/2210.03350)): the "compositionality gap" (every sub-answer known, the composite wrong) stays **~40% from 1B to 175B parameters**.
- **τ-bench** ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045)): **partial resolution of multi-request tasks is 19%** of GPT-4o retail failures.
- **Chain-of-Verification** ([arXiv 2309.11495](https://arxiv.org/abs/2309.11495)), Llama 65B:
  - List precision 0.17 → 0.29 (verification answered jointly with the draft) → **0.36 (in separate calls)**.
  - Biography FactScore 55.9 → 63.7 when each check is answered on its own (factored) → 71.4 with a revision step.
  - Single-fact verification questions are answered correctly ~70% of the time.
  - **Yes/no verification questions do worse**: the model "tends to agree with facts in a yes/no question format whether they are right or wrong".
- **RARR** ([arXiv 2210.08726](https://arxiv.org/abs/2210.08726)): research-then-revise raises attribution from 35.4 to 43.4 on NQ and keeps 90–96% of the original meaning.

**Which verifiers help.**
- **External feedback is what makes critique work.**
  - CRITIC ([arXiv 2305.11738](https://arxiv.org/abs/2305.11738)): AmbigNQ exact match 36.0 → 62.0 *with tools*; without tools, F1 moves +2.7 / −0.6 / −0.5.
  - SCORE ([arXiv 2404.17140](https://arxiv.org/abs/2404.17140)): self-correction is "bottlenecked by the verifier rather than the refiner".
  - Kamoi et al. ([arXiv 2406.01297](https://arxiv.org/abs/2406.01297)): no successful self-correction from prompted feedback outside narrow domains.
- **LLM judges of web trajectories are ~70% precise.** AgentRewardBench ([arXiv 2504.08942](https://arxiv.org/abs/2504.08942), 1,302 trajectories):
  - Best judges: GPT-4o 69.8% precision / 83.1% recall; Claude 3.7 68.8 / 81.6.
  - **Rule-based checks: 83.8% precision / 55.9% recall.**
  - Named judge failures: accepting the agent's reasoning without checking the screen, and **being misled by the agent's claim that it finished**.
- **Ensembles and averaging raise precision.** CUARewardBench ([arXiv 2510.18596](https://arxiv.org/abs/2510.18596)): best single outcome judge 76.8% → ensemble 89.8%. Koh et al. tree search ([arXiv 2407.01476](https://arxiv.org/abs/2407.01476)): averaging 20 samples moved success 28.5 → 37.0; the method does not apply to irreversible actions.
- **Web-specific verifiers:**
  - Web-Shepherd ([arXiv 2505.15277](https://arxiv.org/abs/2505.15277)): a checklist-trained step judge, **+10.9 points** on WebArena-lite at a tenth of the verifier cost.
  - Reflexion ([arXiv 2303.11366](https://arxiv.org/abs/2303.11366)) did **not** improve WebShop.
- **Most errors come from missing evidence, not from reasoning.** BrowseComp-Plus ([arXiv 2508.06600](https://arxiv.org/abs/2508.06600)): GPT-5 evidence recall is only 51–62%; given every relevant document, gpt-4.1 reaches 93.5%.
- **Mind2Web 2** ([arXiv 2506.21506](https://arxiv.org/abs/2506.21506)):
  - Incompleteness (fewer items than asked, or "couldn't find") is the largest agent–human gap.
  - Most systems show a hallucination rate of at least 50%.

**Ambiguity and clarification: when asking helps.**
- **Look first, then ask.** Ambig-SWE ([arXiv 2502.13069](https://arxiv.org/abs/2502.13069)):
  - Interaction improves underspecified tasks **by up to 74%**.
  - Models do not ask unless prompted.
  - Claude Sonnet 4 reached the same information with **50% fewer questions by exploring first**.
- **Ask only when the ambiguity changes the answer.**
  - Clarify When Necessary ([arXiv 2311.09469](https://arxiv.org/abs/2311.09469)): on truly ambiguous QA, GPT-3 goes 51.8 → 61.8, but many ambiguous inputs have one dominant reading. Asking on only 10% of inputs, chosen by simulating what the user might mean, **doubles the gain of asking at random**.
  - CLAMBER ([arXiv 2405.12063](https://arxiv.org/abs/2405.12063)): ChatGPT detects ambiguity at **54.25% accuracy** (near chance).
  - Ask-when-Needed ([arXiv 2409.00557](https://arxiv.org/abs/2409.00557)): LLMs "tend to arbitrarily generate the missed argument". A prompt raises appropriate asking from 0.52 to 0.90, but task completion only 0.34 → 0.36.
- **Confirm at the irreversible boundary.**
  - Operator system card (below): confirmations removed **~90% of the risk** of model mistakes.
  - τ²-bench ([arXiv 2506.07982](https://arxiv.org/abs/2506.07982)): when the user has to act, performance **drops 18–25%**. Every hand-off costs success.
- **Low-quality questions have a cost.** Zou et al. (IPM 2022) found low-quality clarifying questions "do disturb users". I found **no published numbers on over-confirmation in browser agents**.

---

## 5. Guards that do not refuse legal actions

Measured in our runs:
- 9% of first divergences are our own guard refusing a legal action.
- The URL guard fired 51 times; **4 of those ended a task on a legitimate same-brand domain**.
- `9c97bab9` (michaels): the task literally contains the email address. The page-blind intent check refused seven times, and three consecutive failures ended the task.
- Each refusal costs ~17 s.

What production systems report:
- **Measure the gate on benign traffic, not only on attacks.** Operator system card ([cdn.openai.com/operator_system_card.pdf](https://cdn.openai.com/operator_system_card.pdf), 23 Jan 2025, read in full):
  - Without mitigations, the model made **13 errors on 100 representative tasks, 5 of them irreversible**.
  - Confirmation recall **92%** on 607 tasks in 20 risky-action categories; confirmations "reduced the risk by approximately 90%".
  - Injection monitor: **99% recall / 90% precision** on 77 attacks, and it flagged **46 of 13,704 benign screens (0.34%)**. Recall went 79% → 99% after one day of updates.
  - The **ChatGPT agent** card (Jul 2025) reports confirmation recall of 91.0% overall and 100% on financial transactions.
- **Scope by site.** Claude in Chrome ([claude.com/blog/claude-for-chrome](https://claude.com/blog/claude-for-chrome), 25 Aug 2025, updated 18 Dec 2025):
  - The user grants **site-level permissions**; confirmations only for high-risk actions (publishing, purchasing, sharing personal data); some site categories blocked.
  - Injection success **23.6% → 11.2%**; browser-specific attacks 35.7% → 0%.
- **Filtering defences kill utility in open-ended tasks.** AgentDyn ([arXiv 2602.03117](https://arxiv.org/html/2602.03117), v3 7 May 2026), GPT-4o:
  - No defence: 53.3% utility / 37.8% attack success.
  - CaMeL: 0% utility; ProtectAI detector: 0%; PIGuard: 10%; Progent: 6.7%; PromptGuard2: 60% with no attack but 20.8% under attack.
  - The detectors cannot "distinguish helpful instructions from malicious injections". Our page-blind "did the user ask?" model call belongs to this family, so it must be the last resort, not the default path.
- **Report completion under policy next to completion.** ST-WebAgentBench ([arXiv 2410.06703](https://arxiv.org/abs/2410.06703), ICLR 2026): three agents' completion-under-policy is **below two-thirds of their nominal completion**. A guard that raises that number by lowering completion is not a win.
- **Over-refusal grows with safety tuning.** OR-Bench ([arXiv 2405.20947](https://arxiv.org/abs/2405.20947), ICML 2025) tested 32 models on 80k seemingly toxic but benign prompts and found a trade-off between rejecting harmful prompts and over-refusing. The coefficient is in the paper body, which I did not retrieve.

**Site identity: use the real registrable domain.**
- The Public Suffix List ([publicsuffix.org/learn](https://publicsuffix.org/learn/)) exists because "there was and remains no algorithmic method" to find the registrable domain. Measured today: **10,324 rules, 334 KB raw, ~91 KB gzipped**. `tldts` (MIT, v7.4.13) bundles it at **128 KB minified / 47 KB gzipped**.
- Chrome's **Related Website Sets** (brand groupings) were **retired on 17 Oct 2025** ([Privacy Sandbox update](https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies)); the repository was archived 24 Nov 2025. The final list holds **70 sets: 180 associated, 16 service and 54 ccTLD domains** (measured from `related_website_sets.JSON`). That is too small to serve as a brand allow-list.
- **Our `sameSite` heuristic is wrong in both directions.** I ran it on test hosts:
  - `alice.github.io` vs `bob.github.io`, `x.blogspot.com` vs `y.blogspot.com` and `a.vercel.app` vs `b.vercel.app` all return **true**. These are different owners.
  - `shop.michaels.com` vs `www.michaels.ca` returns **false**. This is the same brand.
  - `sameSite` also decides where a user's password placeholder may be typed (`navigator.ts`), so the first error is a **security bug**, not only a false refusal.

---

## What this means for WebGenie

Every item below is task-agnostic and provider-agnostic. "Tests" means it ships on unit tests and measured counts. "Gated" means it needs a live gate run under plan decision D4.

| # | Change | Where | Evidence | Expected effect | Ships |
|---|---|---|---|---|---|
| **R1** | **Replace the `sameSite` guess with the Public Suffix List** (`tldts`, 47 KB gzipped, MIT). Keep a *separate*, looser `sameBrand(a, b)` (same registrable label under a different public suffix, e.g. `michaels.com` ↔ `michaels.ca`). `sameBrand` only picks the softer navigation question and **never widens where a secret may be typed**. | `validation/service.ts` `sameSite`; callers in `agents/navigator.ts` (secret placeholders, the `open-site` question) | §5 host tests; PSL | Closes the github.io/vercel.app secret-leak path; recovers the same-brand refusals (4 task deaths) | tests: a table of PSL edge cases, including private suffixes and ccTLD brands |
| **R2** | **Skip the page-blind intent check when provenance is deterministic.** Allow without a model call when the value is verbatim (digits-only for numbers) in the user's messages **and** the current site is the task's start site or a site the task names (by PSL site or brand label). Keep the model check for everything else. A **second identical refusal becomes one `ask_human`**, not another step toward `maxFailures`; the verdict is cached per (value, site) (`intentDecisions` already keys it). | `navigator.ts` `DATA_CARRYING_ACTIONS` block and `userAsked` | AgentDyn (detectors cost utility); `9c97bab9` | Removes the michaels-class deaths and one ~17 s round trip per legitimate entry; keeps protection against page-supplied destinations | tests |
| **R3** | **Log every guard verdict as a trace span and compute each guard's benign false-refusal rate** from passing traces, like Operator's 46/13,704. Report completion-under-policy next to completion. | `trace.ts` records; e2e summary | Operator card; ST-WebAgentBench | Turns "9% of failures are guards" into per-guard precision we can tune | tests (the numbers come from the next run) |
| **R4** | **Deterministic consent handling.** Bundle `@duckduckgo/autoconsent` (MPL-2.0, 843 rules, heuristic mode) in the existing content script (`pages/content`, which already runs with `all_frames` and `<all_urls>`), with **`autoAction: 'optOut'`** because this is the user's own browser (the Cookieverse and Priv-Accept costs of accepting). Wait for `autoconsentDone`/`popupFound` (bounded ~2 s) before the first page read on a new document. If no rule matched, call `__tcfapi('ping')` / `__gpp('ping')` from the main world; when `displayStatus`/`cmpDisplayStatus` is `visible`, put "a consent dialog is open (IAB CMP)" at the top of the page state together with the dialog's controls (TRACE_REVIEW fix (i) already keeps them in the window). Offer it as a setting that is on by default; the human-in-the-loop policy says a cookie banner is not a question for the user. | `pages/content`; `browser/page.ts` state build; `prompts/base.ts` window | Consent deadlock 344 steps / 4.97M tokens / 62 tasks; BrowserArena closure only 4.65–17.81% by models; R1's false "closed it" claims | Most of class #2 gone with zero model steps; fewer "covered" refusals (146) | tests (fixture pages with OneTrust, Cookiebot and TCF stubs) plus one e2e fixture; its effect on success is part of the Wave-2 gate |
| **R5** | **Commit check for autocomplete fields.** (a) Widen `offersSuggestions` to Browser Use's rule (`list` attribute, `aria-autocomplete` other than `none`, `aria-haspopup` with `aria-controls`/`aria-owns`). (b) After typing into such a field, record it as *uncommitted* until a suggestion click, or until the tree shows `aria-expanded=false` with the value equal to an option's text, or the address gains a parameter. (c) Refuse `submit:true` on an uncommitted field once, attaching the suggestions. (d) Do not let a requirement go `applied` on a typing action alone. (e) Read the value back after every `input_text` and report a difference ("the field now holds X", as Browser Use does). | `navigator.ts` ~L1025–1075; `done-evidence.ts` `mergeRequirements` | APG commit semantics; Agent-E change observation; TRACE_REVIEW #7 (131 steps, 47 entries, 38 tasks) | Attacks the most common *silent* wrong-target failure (11% of first divergences) | tests |
| **R6** | **Actionability additions.** A Stable check: compare two `getBoundingClientRect` reads one `requestAnimationFrame` apart before dispatch, and refuse with "the element is still moving" rather than clicking a stale point. An Editable check (`readonly`, `aria-readonly`) before typing. For `input[type=date]`, set `yyyy-mm-dd` directly and fire `input`/`change` instead of typing locale text. | `browser/page.ts` `_dispatchMouse`, typing path | Playwright; MDN; WILBUR; Agent-E's date reset | Fewer no-op clicks (99) and wasted date-widget steps (class #12, 53 steps) | tests |
| **R7** | **Evidence for filters that match exactly.** When a requirement names a range or a superlative (cheapest, newest, highest-rated, most-reviewed), its `applied` evidence must name the bound values themselves, or a sort control or sort URL parameter. It extends `searchOnlyEvidence` with one more deterministic pattern, refused once. | `done-evidence.ts`, `executor.ts` `checkTaskCompletion` | Online-Mind2Web 57.7% and its judge rubric; WebChoreArena | The 11% wrong-target class and filters applied with the wrong bounds | tests |
| **R8** | **Blocked and error pages decided deterministically, mid-task.** Run `challengeOnPage` and the refusal wording on *every* navigation, not only at the start and end. Before accepting a "blocked by CAPTCHA" answer, re-read the page (the `1bc154` StubHub case). On `net::ERR_*`, 5xx or 429 error pages, **reload once before the model sees the page** (WAREX: agents otherwise declare the task infeasible). Never use timezone, locale or geolocation emulation to get past a site. In the **e2e harness only**, set timezone and locale to the task's region and record the region served in `result.json`. | `navigator.ts` L1077; `browser/context.ts` navigation; `chrome-extension/e2e` launcher | WAREX; TRACE_REVIEW #14 (8,074 s on already-blocked sites; 8 tasks scored ok on a bot check) | Stops runs that are already blocked; ends false "blocked" answers; stops the harness penalising the model for geo | tests; the harness change needs no gate |
| **R9** *(Stream 6, research only)* | **Where an answer value came from.** Extend `unbackedValues` so that a value found **only** inside `role=option/listbox/menu` subtrees, only on a search-engine results page (`duckduckgo.com`, `google.com/search`, the `search_web` hosts), or only on a read marked `unreadable` does not count as backed. Refuse once with "open the item's own page and read the value there". Deterministic. | `done-evidence.ts` `evidenceHaystack` (filter by the node's ancestors' roles and the page host) | The three recurring causes of our 52 bad answers; BearCubs (37.5% of correct answers poorly sourced); BrowseComp-Plus (evidence recall is what fails) | The dropdown and snippet answer classes; about one extra step per affected task | tests |
| **R10** *(Stream 6)* | **Treat each part of the question as a requirement.** Turn `askedParts(task)` (already deterministic) into requirements the planner must close with evidence, so a multi-part answer cannot finish while a part is still pending. That reuses the existing pending-requirement refusal instead of adding a judge. | `done-evidence.ts` `askedParts`; the planner's requirements | Self-Ask ~40% compositionality gap; τ-bench 19% partial resolution; REAL | Partial answers | tests |
| **R11** *(Stream 6)* | **Factored, de-anchored check, if one is added at all.** For each part, one plain model call gets the **task part plus the text of the evidence page region**, not the agent's answer or narrative, and asks an **open** question ("what is the price shown?", never "is $35 correct?"). The harness then compares values deterministically. It is a one-time send-back, never a veto, because a single judge is ~70% precise. Take a majority of 3 only if the gate shows a gain. Plain text in and a one-field tool out, so it runs through `invokeTools`' prompt fallback on any provider. | new helper next to `done-evidence.ts`; `executor.ts` | CoVe (factored beats joint; yes/no questions agree with whatever is asked); AgentRewardBench (judges misled by claims of completion); CUARewardBench ensembles | Wrong-value answers; costs about 1 call per part | **gated** |
| **R12** | **Clarification policy for the prompts.** Explore before asking. Ask only when the readings would lead to different actions *and* the page cannot settle it. Ask at most once per ambiguity, offering 3–5 concrete options. Confirmations stay only at the irreversible commit boundary, as now. | `prompts/templates/` planner and navigator | Ambig-SWE (−50% questions by exploring first); Clarify When Necessary; τ²-bench (−18–25% when the user must act); Operator (~90% of risk removed by commit confirmations) | Trace class #20 (needless questions) without losing commit safety | tests (template snapshot); watched in the next gate |

Priority by measured cost in our corpus: **R4** (344 steps), then **R5** (131–255 steps, silent wrong answers), then **R1+R2** (4 deaths plus a security fix), then **R8**, **R7** and **R6**. R9–R11 wait for Stream 6.

## What not to copy

- **Model-driven banner clicking as the primary consent strategy.** BrowserArena measured 4.65–17.81% closure, and one model claimed success on banners it never saw. Use rules plus deterministic detection; the model handles only what is left.
- **Accept-all consent** ("I don't care about cookies" falls back to accept). This is the user's real browser: accepting adds trackers (+70) and slows pages 2–3×. Opt out, or leave the banner to the model when no reject exists.
- **Hide-only cosmetic lists** (EasyList Cookie). They hide the banner without answering it, which leaves scroll-locked pages broken and confuses the element list.
- **Stealth, proxies or locale spoofing to get past bot checks or geo blocks** (BrowserArena's o4-mini routed through a public proxy and the Internet Archive; the stealth-browser vendors). It is evasion, it breaks site terms, and in the user's own browser it is unnecessary. Stop, say so, and let the user decide.
- **Closed-book fallback answers** (AssistantBench's ensemble). They raise accuracy while lowering precision. An honest "the page does not show it" beats a guess.
- **Joint or yes/no self-verification and Reflexion-style self-critique.** Joint verification copies the draft's errors (CoVe); yes/no questions get agreement; Reflexion failed on WebShop; self-generated rewards did not help WebCanvas.
- **Filtering-classifier injection defences on the action path** (PIGuard, ProtectAI, CaMeL-style static plans). AgentDyn measured 0–10% utility on open-ended tasks.
- **Related Website Sets as a brand allow-list.** It is retired and covers 70 sets.
- **Web Bot Auth request signing, for now.** It is legitimate, but it needs registration and per-request signing that MV3 cannot do cleanly. Revisit if major sites start requiring it.

## Could not reach

- `openai.com/index/operator-system-card/` (403; read the PDF instead). `openai.com/index/browsecomp/` (403; arXiv used).
- `developer.chrome.com` Related Website Sets docs (blocked; used the GitHub repo and the Privacy Sandbox post).
- `w3.org` APG pages (blocked; read the source from `w3c/aria-practices` on GitHub).
- OpenReview pages for WebArena Verified (browser check), so I have no count of changed tasks.
- The OR-Bench body (correlation coefficient not retrieved).
- The Playwright `fill` vs `pressSequentially` page, the Skyvern "6×" changelog date, the ChatGPT-agent help article body (snippet only), and autoconsent success rates (none published that I found).
- Not fetched: AIS (2112.12870), Self-Refine, Verify-and-Edit, AmbigQA, the Agent-E paper's failure section beyond the repo and summary, and per-system attribution-error percentages from Mind2Web 2 (they are in figures).
