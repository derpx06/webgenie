# Perception, observation shape and grounding

Stream 1 research brief, 19 Sep 2026. It builds on `02-browser-agents-sota.md`, which already covers AgentOccam's
observation ablation, Region4Web/PageDigest, Agent-E's distillations, SeeAct's headline gap, Stagehand/Skyvern token
sizes and the SoM critique. Those are cited here, not repeated. This brief adds the controlled comparisons 02 lacks,
the grounding-model landscape, how the leading harnesses handle hard widgets **at the code level** (browser-use
`d8110c5`, 15 Sep 2026; Playwright `main` and Stagehand's Chrome extension package `main`, both read 19 Sep 2026;
Chromium's own agent perception proto), and a set of changes mapped to our extractor.

**Scope set by the user during this work:** WebGenie must be model- and provider-agnostic (OpenAI, Anthropic, Gemini,
Ollama and text-only models). The main observation has to be text that works with every model. Vision and coordinate
grounding are optional paths, gated by `LlmCapabilities.vision` (`packages/storage/lib/settings/llmCapabilities.ts`, which
already sets `vision: false` for Ollama, DeepSeek, Llama and unknown OpenAI-compatible providers), and each needs a text
fallback. Every grounding technique below says whether it needs a specially trained model.

**What our own traces show** (verified in `chrome-extension/e2e/results/mind2web-r{1,3}-*` for this brief):

- `a6f0434c` (both runs): the state listed a native `<input type=date>` as its user-agent shadow segments,
  `[56]<input role="spinbutton" aria-label="Month" value="9" …>09 />`, `[57] Day`, `[58] Year`, and not the input itself.
  The DOM node behind `[56]` is a `<span>`, so `input_text` failed 3 times in r3 and 3 times in r1 with *"A \<span\> does
  not accept text"*. `toNativeInputValue` in `page.ts` would have set the date directly, but only when the target is the
  `<input>`.
- `0b51b4fa`: the filter panel opened at step 2, and what followed was page scrolls (up and down) and page reads
  (analysis-2 counts 11 blind scrolls). The panel's own scroll container never appeared in the state, so there was no
  index to pass to `scroll`.
- `11857213`: *"The element has no visible area"* twice, then *"covered by \<span\> 'Größe'"*: the size list sat inside a
  scrollable dialog.

---

## 1. AX tree vs DOM vs screenshot vs hybrid

**Practice.** Almost every production harness reads a text tree first (the AX tree, or a DOM distilled with AX roles)
and treats pixels as a secondary channel. The exceptions are screenshot-native agents built on a trained
computer-use model (Operator, Claude and Gemini computer use).

**Mechanism.** The AX tree is compact and semantic. Chrome has already computed roles, names, states and relations,
and it flattens open and closed shadow roots. What it lacks: layout, stacking, scroll containers, non-semantic click
targets, canvas content, and anything the author left unlabelled. A DOM or HTML dump keeps layout cues (CSS,
z-index) but costs about 8× the tokens. A screenshot holds everything visible, but only for a model that can ground
on pixels.

**Evidence (controlled comparisons).**

| Study | Setup | Result |
|---|---|---|
| VisualWebArena, [arXiv 2401.13649](https://arxiv.org/html/2401.13649) (Jan 2024) | GPT-4/4V, same tasks | a11y text only **7.25%** → +captions 12.75% → +screenshot 15.05% → +SoM **16.37%**; humans 88.7%. Visual tasks, so text-only is the floor |
| WebVoyager, [arXiv 2401.13919](https://arxiv.org/html/2401.13919) (ACL 2024) | GPT-4V, 15 live sites | text-only (a11y) **40.1%** vs screenshot+SoM **59.1%**. Smallest gain on text-dense sites (Allrecipes 53.3, Booking 43.2). Failures: navigation stuck 44.4%, **visual grounding 24.8%**, hallucination 21.8% |
| WorkArena, [arXiv 2403.07718v5](https://arxiv.org/html/2403.07718v5) (Jul 2024) | BrowserGym ablation | adding screenshots + SoM to GPT-4o gave "very minor" gains. `filter_visible` (viewport only) hurt GPT-3.5 on MiniWoB 41.3→38.1. Coordinate features hurt GPT-4o on WorkArena 45.5→41.2. Authors: *"more is not always better … seemingly harmless features actually degrade performance"* |
| **Read More, Think More**, [arXiv 2604.01535](https://arxiv.org/html/2604.01535) (NEC, 2 Apr 2026) | WorkArena L1 only, HTML vs a11y | strong models gain with HTML: GPT-5.1-high 55.8→**73.3 (+17.5pp)**, Sonnet 4.6 52.4→67.0, **Gemini 2.5 Flash (16k thinking) 45.5→56.7 (+11.2)**. Weak models lose: GPT-OSS-20B 46.4→27.6 (−18.8), GPT-OSS-120B −7.9, Qwen3-VL-235B −5.2. Cost: a11y ≈ **6.7k** tokens/step, HTML ≈ **56.7k**. *Mechanism:* strong models used CSS/z-index to avoid "intercepted" (covered-element) errors, while weak models hallucinated IDs in long inputs |
| Online-Mind2Web, [arXiv 2504.01382](https://arxiv.org/html/2504.01382) (Apr 2025) | 6 agents, live | Operator (screenshots) 61.3, Claude CU 3.7 56.3, SeeAct 30.7, Browser Use 30.0, Agent-E 28.0. Authors attribute the spread to model and architecture, **not observation modality** |
| UGround, [arXiv 2410.05243](https://arxiv.org/html/2410.05243) (v3 Jun 2025) | vision-only + trained grounder | Multimodal-Mind2Web element accuracy **46.8** vs 42.3 for HTML "choice". *"vision-only GUI agents can achieve comparable and often better performance"*. Needs the UGround model |
| Mind2Web, [arXiv 2306.06070](https://arxiv.org/html/2306.06070) (2023) | HTML pruning | cleaning cut elements **1,135→580** while keeping **94.7%** target recall. A small ranker's recall@50 was 88.9/85.3/85.7%, so candidate pruning loses 5–15% of targets |
| Element ordering, [arXiv 2409.12089](https://arxiv.org/html/2409.12089) (CMU, Oct 2024) | same elements, different order | VisualWebArena text: DOM pre-order **64.0 / 74.1** (Gemini-1.5 / GPT-4V) → random **37.0 / 37.0**. *"Removing ordering information harms performance more than removing any other attribute"* |

**Where each fails.**

- **AX only:** unlabelled or non-semantic controls (div+listener, delegated React handlers), scroll containers, layout
  and occlusion, canvas and maps, and virtualized content that is not rendered.
- **HTML:** about 8× the tokens. It hurts weaker and local models (−5 to −19pp above), which matters directly for our
  Ollama users.
- **Screenshot:** needs a vision model that can ground. Small targets fail (see §2). Offscreen content is invisible.
  Text-dense pages gain nothing.
- **Hybrid** (AX text plus optional vision) is the consensus. The Read More result suggests the cheapest win is to add
  the **layout cues HTML carried** (covered, clipped, scrollable) to the AX lines, rather than switching format.

## 2. Grounding

**Practice.** Three families:

1. **Index or ref grounding.** The model picks an ID from the text list (Playwright MCP, browser-use, us). It works
   with every model.
2. **Set-of-Marks.** IDs are drawn on the screenshot. It works with any vision-language model (VLM).
3. **Coordinate grounding.** The model outputs pixels. This needs a model trained for it (UI-TARS, OS-Atlas, UGround,
   Gemini/Claude/OpenAI computer-use models).

**Evidence.**

- **SeeAct**, [arXiv 2401.01614](https://arxiv.org/html/2401.01614) (Jan 2024), gap to oracle grounding on
  Mind2Web: textual choices lose 22.8/32.3/20.1pp (task/website/domain), image annotation (SoM) loses 41.6/51.1/38.4,
  element attributes lose 45.8/52.9/43.1. SoM errors: **54% visual hallucination** (the model invents a label that
  isn't drawn), **46% label↔box mis-association** on dense pages. Text choices won because they carry HTML text.
- **OmniParser**, [arXiv 2408.00203](https://arxiv.org/html/2408.00203): GPT-4V on ScreenSpot **16.2% → 73.0%**
  once a fine-tuned YOLOv8 detector plus a BLIP-2 icon captioner parse the screen. Failure modes: repeated identical
  icons, coarse OCR boxes on links, context-blind captions ("three dots" read as "loading"). **Needs two trained models.**
- **UGround 73.3%** ScreenSpot. **OS-Atlas-7B 82.5%** ScreenSpot vs GPT-4o 62.9%
  ([arXiv 2410.23218](https://arxiv.org/html/2410.23218)), coordinates normalised to [0,1000]. **UI-TARS 38.1** on
  ScreenSpot-Pro, screenshot-only, relative coordinates ([arXiv 2501.12326](https://arxiv.org/html/2501.12326)). **All
  of these are trained models.**
- **ScreenSpot-Pro**, [arXiv 2504.07981](https://arxiv.org/html/2504.07981): on high-resolution screens, targets fill
  **0.07%** of the image (vs 2.01% in ScreenSpot). GPT-4o scores **0.8%**; the best specialist scores 18.9%. Iterative
  **crop-and-zoom (ScreenSeekeR) lifts OS-Atlas 18.9 → 48.1%**. Accuracy falls steadily as targets shrink.
- **Gemini computer use** ([blog](https://blog.google/technology/google-deepmind/gemini-computer-use-model/),
  7 Oct 2025; [docs](https://ai.google.dev/gemini-api/docs/computer-use), read Sep 2026): screenshot plus action history
  in, coordinates out on a **0–999 normalised grid**, 1440×900 recommended. It supports custom functions and
  `excluded_predefined_functions`. The launch post claims the Online-Mind2Web lead at about 70% accuracy and ~225 s
  latency. General Gemini models also return `box_2d [ymin,xmin,ymax,xmax]` normalised to 0–1000
  ([image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)). **Provider-specific.**

**Provider matrix.**

| Technique | Trained model needed? | Text-only models? |
|---|---|---|
| Index / ref from AX text (current) | no | yes |
| SoM screenshot + index | no, but any VLM (SeeAct: 54% hallucinated labels) | no, falls back to text |
| Region crop + SoM (our `view_screenshot` region, `d6ccaf8`) | no | no, falls back to text |
| Coordinate click from screenshot | **yes** (UI-TARS / OS-Atlas / UGround / Gemini-CU / Claude-CU / OpenAI-CUA) | no |
| OmniParser-style screen parsing | **yes** (detector + captioner) | output is text, but the parser is a model |

**When vision earns its cost:**

- Canvas and map content, which has no AX nodes.
- Icon-only controls with no accessible name.
- Visual attributes such as colour swatches, ratings drawn as images, and chart values.
- Verifying a visual state.

Even then, crop to the region: ScreenSpot-Pro shows both accuracy and cost improve when the target is larger in frame.
It does not earn its cost as the default observation. WorkArena found "very minor" gains, and SeeAct's SoM gap is
twice the text-choice gap.

## 3. Hard widgets: how the best harnesses detect and expose them

| Widget | Best-practice exposure | Mechanism (all CDP-reachable unless noted) |
|---|---|---|
| **Non-semantic click targets** | Chrome's own agent perception (`AnnotatedPageContent`, [Chromium proto](https://source.chromium.org/chromium/chromium/src/+/main:components/optimization_guide/proto/features/common_quality_data.proto)) lists **16 `ClickabilityReason`s**: native control, click handler, key handlers, editable, **`cursor: pointer`**, clickable ARIA role, `aria-haspopup`, `aria-expanded` true/false, **tabindex**, autocomplete, mouse click and hover handlers, **`:hover` rule**, aria toggle, aria selectable. Disabled is detected via `disabled`, `aria-disabled` and **`cursor: not-allowed`**. Playwright's AI snapshot renders **`[cursor=pointer]`** on ref'd nodes ([ariaSnapshot.ts](https://github.com/microsoft/playwright/blob/main/packages/injected/src/ariaSnapshot.ts)). browser-use's `ClickableElementDetector` gets JS listeners through `Runtime.evaluate` with `includeCommandLineAPI`, reads AX props (focusable/editable/settable/checked/expanded/…) and uses `cursor: pointer` as the final fallback ([clickable_elements.py](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/clickable_elements.py)) | Listener checks alone miss framework-delegated handlers. React 17+ *"will attach them to the root DOM container"* ([React 17 post](https://legacy.reactjs.org/blog/2020/10/20/react-v17.html)), so a React `onClick` div shows no listener of its own. The computed `cursor` style from `DOMSnapshot.captureSnapshot` is the signal that survives delegation |
| **Inner scroll containers** | Stagehand (its **Chrome extension** package) marks AX nodes as `scrollable, div` from **`DOM.Node.isScrollable`** returned by `DOM.getDocument({depth:-1,pierce:true})` ([domTree.ts](https://github.com/browserbase/stagehand/blob/main/packages/extension/understudy/a11y/snapshot/domTree.ts), [a11yTree.ts](https://github.com/browserbase/stagehand/blob/main/packages/extension/understudy/a11y/snapshot/a11yTree.ts)). browser-use computes `scrollRects.height > clientRects.height + 1` **and** overflow `auto/scroll/overlay`, prints `\|scroll element\|<div … /> (0.0 pages above, 2.3 pages below)`, and shows only the outermost of nested scrollers. Chrome's `ScrollerInfo` carries scrolling bounds, visible area and user-scrollable x/y | `DOM.Node.isScrollable` and the `DOM.scrollableFlagUpdated` event are `@experimental` in our pinned `devtools-protocol@0.0.1521046`. `DOMSnapshot.captureSnapshot({includeDOMRects:true})` returns `scrollRects`/`clientRects` in **the call we already make** |
| **Occlusion** | browser-use: `includePaintOrder:true`, then walk nodes from top paint order down, keeping a rectangle union per document. A node fully inside the union is dropped; layers with a transparent background or opacity < 0.8 do not occlude (their own comment: *"highly vibes based number"*) ([paint_order.py](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/paint_order.py)). Playwright gives a ref only when the box is visible **and** `receivesPointerEvents` (a hit test). Chrome APC has `visible_bounding_box` (after ancestor clipping) and `document_scoped_z_order` | `DOMSnapshot` `paintOrders` plus `background-color`/`opacity` computed styles, no injection. Or **`DOM.getNodeForLocation({x,y,ignorePointerEventsNone})`**, a CDP hit test that returns `backendNodeId` and `frameId` |
| **"No visible area"** (clipped inside a collapsed panel) | Chrome APC: an empty `visible_bounding_box` means clipped by scrollers, ancestors or the viewport, and an empty `outer_bounding_box` means *"not hit-testable, even once scrolled onscreen"* | Intersect the node's box with the `clientRects` of ancestors that clip (overflow ≠ visible). Needs the overflow styles in the snapshot |
| **Native date/time** | browser-use deliberately does **not** expose the segments: *"They confuse the model (seeing 'Day, Month, Year' suggests DD.MM.YYYY format) … HTML5 date/time inputs ALWAYS require ISO format"* ([serializer.py](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/serializer.py) `_add_compound_components`). Ranges get `(role=slider,min=…,max=…)`, number inputs get increment/decrement, and selects get count plus the first 4 options | Our failure `a6f0434c` (above) is exactly the case they avoid |
| **Custom date pickers / cascaders** | CI4A ([arXiv 2601.14790](https://arxiv.org/html/2601.14790v1)) exposes `setValue("2025-12-31")`: WebArena **86.3%** vs AgentOccam 70.3%, steps 10.7→4.5. **It requires instrumenting the site's component library.** | Not available to us generically. The transferable part is typing into the text input behind the picker and verifying the value |
| **Sliders** | `role=slider` with `aria-valuenow/min/max/valuetext` (Playwright, browser-use). Custom sliders with no role appear only through cursor (`grab`, `ew-resize`, `pointer`) or pointer listeners | Our `949dc965` state showed an arrival-time slider as two generic spans |
| **Comboboxes / autocomplete** | Agent-E's change observation: *"a popup has appeared with following elements"* ([arXiv 2407.13032](https://arxiv.org/html/2407.13032v1)). Playwright shows `[expanded]`. Popups are usually portalled to the end of `<body>`, far from their field in document order | AX relations `controls`, `owns` and `activedescendant` are in CDP's `AXPropertyName`. We drop them today (`nodeAttributes` keeps scalar values only). This is our "wrong target" class, 11%, 4 of 7 cases being an uncommitted autocomplete |
| **Virtualized lists / infinite scroll** | Only rendered rows exist in the DOM and the AX tree. ARIA carries totals in `aria-rowcount`/`aria-rowindex` and `aria-setsize`/`aria-posinset` ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#aria-rowcount)) | CDP's `AXPropertyName` has **no** setsize, posinset or rowcount, so read them as DOM attributes through `DOMSnapshot` |
| **Shadow DOM** | The AX tree flattens open **and closed** roots for free. browser-use prints `\|SHADOW(open)\|`. Stagehand *injects a helper* for closed-root selectors | We already get this through the AX tree plus `DOMDebugger.getEventListeners({pierce:true})` |
| **Cross-origin iframes** | Playwright refs `f1e12`. browser-use: `cross_origin_iframes` off by default, `max_iframes=100`, depth 5, ≥10 px. Stagehand walks OOPIFs depth-first and stitches them by iframe XPath | We already read each frame through its own session and stitch via `DOM.getFrameOwner` |
| **Canvas / maps** | Nothing in the AX tree or DOM. Only vision helps | Gate on `vision`, otherwise report "canvas region, content not readable" |
| **ARIA misuse** | Playwright AI mode uses visibility `'ariaOrVisible'`: a node that is **visible but `aria-hidden`** is still shown and ref'd | We drop everything `aria-hidden` (`hiddenByAria`), which also hides wrongly hidden live controls. CDP's AX `ignoredReasons` separates `ariaHiddenElement` from `activeModalDialog` and `inertElement` |

## 4. Observation shape

**Hierarchy, order and text.**

- DOM order is the most important attribute (random order: 64→37%, §1).
- AgentOccam's gains came from merging static text with the controls inside it (02).
- HtmlRAG ([arXiv 2411.02959](https://arxiv.org/html/2411.02959), Feb 2025) found structure beats flat text and
  markdown as a reading format (Llama-3.1-70B, ASQA Hit@1: HTML 68.5 / plain 59.75 / markdown 56.0).
- Chrome's own agent turns its tree into markdown with `{#ID}` node references (per
  [dejan.ai's teardown](https://dejan.ai/blog/chrome-context-gemini/)).
- Our indented, tag-like lines with `# heading` levels are already in this family.

**Viewport-first vs whole document.**

- WorkArena: viewport-only filtering hurt a weak model (41.3→38.1).
- browser-use keeps elements within **±1000 px** of the viewport (`viewport_threshold=1000`) and reports "pages
  above/below" for each scroll container.
- Ours keeps the whole list up to 26k characters, windowed around the viewport, and always keeps dialog controls. That
  is sound. Plan item 1.5 (viewport-first + `find_control`) should be gated, since the only controlled evidence says
  cutting to the viewport can hurt.

**Diffs between steps.**

- Read More, Think More: **diff-based history matched full history (+3.0pp each) at 13.7k vs 39.0k input tokens**
  (GPT-5.1, 9-step history), using a character-level diff.
- Agent-E reports changes in words.
- Playwright's `findNewNode` picks the largest role+name pair that is new since the last snapshot.
- browser-use and our own code mark `*[i]` for new elements.
- "Signal-Driven Observation" ([arXiv 2606.06708](https://arxiv.org/html/2606.06708), Aug 2026) argues for re-reading
  only on URL change, new ARIA widgets, failures or mutations, but *"does not include experiments"*.

**Stable references.**

- Playwright stores `_ariaRef` on the element and **reuses the same ref while role and name are unchanged**.
  Otherwise it mints a new `e<N>`.
- Only visible, pointer-receiving nodes get refs, and iframe refs are prefixed (`f1e12`).
- A stale ref fails loudly: *"Ref … not found in the current page snapshot. Try capturing new snapshot."*
- We renumber 0..n-1 on every read. The plan counts **97 stale-index blocked steps**.
- The current Playwright MCP exposes `--snapshot-mode full|none`, plus `depth`, `target` and `boxes` on
  `browser_snapshot` ([README](https://github.com/microsoft/playwright-mcp)). I found no incremental mode in the
  current README or `tab.ts`.

## 5. Main-content extraction for reading tasks

**Practice.** Readability- or Trafilatura-style extraction to markdown (Jina Reader, browser-use
`markdown_extractor.py`, our `read_page` `mode:'main'`).

**Evidence.**

- **WCXB** ([arXiv 2605.21097](https://arxiv.org/pdf/2605.21097), 21 May 2026): 2,008 pages across 7 page types.
  - On **articles every system scores F1 ≥ 0.871**. On other types, *"no system exceeds F1 = 0.80 on forums, 0.72 on
    collections, or 0.68 on products."*
  - Overall F1: Readability **0.674**, Trafilatura 0.791, rs-trafilatura 0.859.
  - Product content often lives in **JSON-LD**, which extractors never see. Single-node extraction of a listing
    *"captures one"* card.
  - Agent tasks are mostly products, collections and listings, so exactly the weak types.
- **HtmlRAG**: markdown from Markdownify or Jina Reader scored *below* plain text on QA (ASQA 56.0 vs 59.75), and
  cleaned HTML scored best (68.5). Conversion loses structure the model uses.
- Trafilatura's own evaluation ([docs](https://trafilatura.readthedocs.io/en/latest/evaluation.html)) reports
  Readability with the best median and Trafilatura with the best mean on article corpora.
- **No controlled study of extraction's effect on web-agent answer accuracy was found.** Our strongest number is local:
  one-shot reading removes **624 steps / 8.68M tokens** in the corpus, and `read_page` never failed (443 calls).
- Our `extractReadBlocks` (`browser/dom/read-page.ts`) uses a `main`/`[role=main]`/`article` landmark when it has ≥200
  characters, otherwise Readability paragraph scoring. It skips `SCRIPT`, so JSON-LD is dropped, and `main` is the
  default.

---

## What this means for WebGenie

All changes below are task- and site-agnostic, run over CDP in the background worker (no perception script), and
produce text any model can use. They are ordered by expected value against the 25% missing-perception class. Most
reuse the **single `DOMSnapshot.captureSnapshot` call we already make** in `readLayouts`, by adding computed styles
and flags. That means no extra round trip.

| # | Change (where) | Mechanism | Failure class | Expected effect | Ships on |
|---|---|---|---|---|---|
| **P1** | **Collapse native date/time/month/week inputs to one element**, as native `<select>` already is (`buildDomState` in `ax-tree-extractor.ts`). When the layout tag is `input` with a date-family `type`, index the host, show `type`, value (ISO) and `format="YYYY-MM-DD"`, and **do not index** the user-agent spinbutton children | browser-use's rule. `inputTextNode` already sets date values directly | missing perception, wrong target (`a6f0434c`: 6 failed `input_text`, task lost in both runs) | removes a whole failure mode on any date field | unit tests (`buildDomState` fixture of a date input's AX nodes) |
| **P2** | **Surface scroll containers** (`readLayouts` + `documentLayout`): pass `includeDOMRects:true` and add `overflow-x`, `overflow-y` to `SNAPSHOT_STYLES`. Mark a node scrollable when `scrollRect > clientRect + 1` and overflow is `auto/scroll/overlay`. **Give a non-interactive scroller an index** so `scroll {index}` can target it. Render `\|scroll\|<div …> (1.8 screens below)` (views.ts), outermost scroller only. `DOM.Node.isScrollable` is the experimental alternative | browser-use / Stagehand / Chrome `ScrollerInfo` | missing perception (`0b51b4fa` 11 blind scrolls, `11857213`). Scroll is 18.7% of actions with 73.8% exact repeats | fewer page scrolls when content sits in a panel. Implements plan 1.3 and 1.4 | tests for detection. **Gate** for prompt effect |
| **P3** | **Cursor as a clickability signal**: add `cursor` to `SNAPSHOT_STYLES` and treat `pointer`, `grab`, `move`, `*-resize` as a `pageTarget` in `buildDomState`, keeping the existing leaf-most and ≤ 50%-viewport rules. Add `keydown/keyup` to `POINTER_EVENTS`. Treat `cursor: not-allowed` as disabled | Chrome APC reasons 3/5/10, Playwright `[cursor=pointer]`, browser-use fallback. Survives React root delegation | missing perception (`949dc965` slider as two generic spans) | exposes delegated-handler controls. Risk: a longer list, so measure the element count | tests. **Gate** (list length vs accuracy) |
| **P4** | **Mark occlusion at read time, don't drop**: `includePaintOrder:true` plus `background-color`, `opacity`. For indexed nodes **in the viewport**, compute coverage by higher paint orders per document with a rectangle union (browser-use's algorithm). Mark `[12]~` ("covered by <name of layer>") and list the covering layer's buttons at the top | Read More's HTML gain came from avoiding "intercepted" errors. This is that cue at almost no token cost | guard refusal "covered": the single largest guard class, 146 blocked steps | fewer blocked clicks, and the model closes the overlay first | tests (pure function over a snapshot fixture). **Gate** |
| **P5** | **Visible box after clipping**: intersect each indexed box with the `clientRects` of ancestors that clip (overflow ≠ visible). An empty visible box means the element is inside a closed or clipped panel: mark it (e.g. `hidden="in closed panel"`) instead of offering it as clickable | Chrome APC `visible_bounding_box` / `outer_bounding_box` | "no visible area" (93 blocked steps), `11857213` | turns a failed click into a correct "open the panel" step | tests |
| **P6** | **Combobox → popup linkage**: keep AX `controls`/`owns`/`activedescendant` relations (resolve `relatedNodes[].backendDOMNodeId`). Serialize the controlled listbox's options **right after** their field (`↳ options for [7]: …`), and show `active="…"` | Agent-E change observation. Fixes portalled popups sitting far away in document order | wrong target (11%, 4 of 7 an uncommitted autocomplete) | the model sees which suggestion belongs to which field | tests. **Gate** |
| **P7** | **Virtualized totals**: add `aria-rowcount`, `aria-setsize`, `aria-posinset`, `aria-colcount` to `SNAPSHOT_ATTRIBUTES` and render `rows 1–20 of 500` on the grid or list line | ARIA spec. CDP AX lacks these properties | missing perception, premature absence answers (planner class) | the model knows that more exists than the rendered rows | tests |
| **P8** | **Visible-but-`aria-hidden` interactive nodes**: keep pointer targets whose `ignoredReasons` is `ariaHidden*` when the frame has no `activeModalDialog` or `inert*` reason | Playwright `ariaOrVisible` | missing perception (ARIA misuse) | small. Check the agent's own overlay stays excluded (it is aria-hidden by design) | tests |
| **P9** | **Stable indexes within a task**: keep a `(frameKey, backendNodeId) → index` map across reads. Reuse the index while role and name are unchanged, and mint new ones above the high-water mark | Playwright `_ariaRef` | stale index (97 blocked steps) | fewer stale-index refusals, and easier diffs | **Gate**: touches replay, memory routes and `resolveByIdentity` |
| **P10** | **Verbal change summary** after an action (reuse `newElements` in `prompts/base.ts`), e.g. "A listbox with 8 options appeared under [12]" or "dialog 'Filters' opened". **Diff-based history** for the planner's older steps | Agent-E. Read More: same accuracy at 35% of history tokens | dynamic widgets, cap relief | fewer blind re-reads | **Gate** |
| **P11** | **Reading on non-article pages** (`read-page.ts`): when `main` holds < ~40% of `full` text, or the root is a listing of repeated link cards, return `full` with boilerplate compaction. Append a compact **JSON-LD** summary (`Product/Offer/Event/Recipe` name, price, availability, rating), which is text the page already publishes | WCXB: products ≤ 0.68 F1, collections ≤ 0.72, JSON-LD invisible | premature and absence answers, "answered from a snippet" | answers on product and listing pages where `main` cut the content | tests, plus `e2e/read-bench.mjs`. **Gate** |
| **P12** | **Capability-gated vision, text-first**: keep `view_screenshot` region crops (`d6ccaf8`, the ScreenSeekeR effect) and SoM labels only for elements inside the crop. Trigger when: a canvas or large laid-out box has no AX children; unnamed icon controls; the task asks about visual attributes. `vision:false` gets a text fallback ("canvas region at …, content not readable; use read_page or eval_js"). **No coordinate-click tool by default.** If added, only for models flagged as trained for grounding (Gemini/Claude computer use) | SeeAct, ScreenSpot-Pro, provider matrix (§2) | canvas and visual tasks | covers the residual that text cannot, without taxing text-only models | tests for gating. **Gate** for triggers |

**Do not change the base format to HTML.** Read More's gains came with **8.4× tokens**, cost weaker models up to
18.8pp, and came from one benchmark. P2, P4 and P5 carry the same layout cues (scrollable, covered, clipped) as a few
characters per line.

**Measurement.** Before and after P1–P5, count on the 60-task gate set: the missing-perception first divergences
(16 today), blocked steps by guard class (covered 146, invisible 93, stale 97), scroll share (18.7%), and median
element-list characters. Accuracy has to hold or rise (pinned rule: accuracy before tokens).

## What not to copy

- **browser-use's name heuristics** (`class`/`id`/`data-*` containing "search", "magnify", "glass" ⇒ interactive; any
  10–50 px element with a `class` or `aria-label` ⇒ interactive). These are keyword and size guesses that index
  decoration. P3 uses cursor, listener and AX signals instead.
- **Dropping occluded elements** (browser-use paint-order filter, Playwright hiding non-pointer nodes). A covered
  control is often the one the task needs after the overlay closes, and a translucent modal fools the
  opacity/background thresholds. Mark it, don't drop it (P4).
- **Trained grounding models as a dependency** (UI-TARS, OS-Atlas, UGround, OmniParser's YOLO + BLIP-2). They need
  hosting or weights in the extension, break the "provider is the only outside dependency" rule, and do nothing for
  text-only models.
- **Gemini computer use as the main loop.** It is provider-specific, screenshot-only (loses offscreen and AX
  semantics), and relies on normalised coordinate grounding the other providers do not share.
- **Full HTML observation.** See above: 56.7k vs 6.7k tokens, and it hurts weaker models.
- **Full-page SoM as the default.** SeeAct: 54% of SoM errors are invented labels. WebVoyager's gain is smallest on
  text-dense sites.
- **CI4A component interfaces.** They need the site's component library instrumented.
- **Stagehand's injected closed-shadow helper and XPath addressing.** The AX tree and `backendNodeId` already cover
  closed roots without injection or brittle paths.
- **t-SNE or raster reordering.** DOM order beat both (§1).
- **Readability `main` as the only reading mode.** It is excellent on articles and weak on the page types agents
  visit (WCXB).

## Could not reach / not verified

- `chromedevtools.github.io/devtools-protocol/tot/{DOM,DOMSnapshot}` returned redirect stubs. I used the pinned
  `node_modules/.pnpm/devtools-protocol@0.0.1521046/.../protocol.d.ts` instead (`isScrollable`, `getNodeForLocation`,
  `paintOrders`, `scrollRects`/`clientRects`, `isClickable`, `AXPropertyName` all confirmed there).
- ACM DL (Bevendorff et al. 2023, extraction comparison) returned HTTP 403. The trafilatura evaluation page was seen
  only as a search snippet, not read in full.
- WorkArena's abstract page had no numbers. I used arXiv HTML v5.
- Playwright MCP incremental snapshots: I could not confirm such a mode ever shipped. The current README and `tab.ts`
  have only `full|none`.
- Stagehand's `observe()` docs do not describe the representation. Mechanisms came from its extension-package source.
- Chrome's `AnnotatedPageContent` is Chromium-internal, not a CDP domain, so an extension cannot call it. Fields come
  from the proto on `main`. The markdown `{#ID}` format comes from a third-party teardown (dejan.ai).
- The browser-use paint-order speed and accuracy numbers: only PR #5159's description was found, with no measurements.
- No controlled study measured main-content extraction's effect on web-agent answer accuracy.
- The search classifier was unavailable once. The retry succeeded.
