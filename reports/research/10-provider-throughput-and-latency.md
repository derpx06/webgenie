# Provider throughput, latency and cost engineering

Stream 10 of the harness research. Scope: how a client-only agent (MV3 service worker, no proxy)
should pace, retry, hedge, time out, cache and budget its reasoning across **any** model provider.
Vertex/Gemini is covered in depth because the benchmark runs on it. OpenAI, Anthropic, the Gemini API
and local models (Ollama) are covered as peer cases. Accessed 2026-09-19 unless marked otherwise.
Builds on `03-evaluation-and-token-economics.md` (caching mechanics) and `analysis-3-latency.md`
(wall-clock budget) without repeating them.

## 0. New measurements from our own traces (read these first)

These come from `chrome-extension/e2e/results/mind2web-r2-cand-6347e1c` (1 worker) and
`mind2web-r3-3fdf2fa` (3 workers). Every number below is from `result.json` and `trace.jsonl`.

| Finding | Number | Why it matters |
| --- | --- | --- |
| Vertex sent **no retry hint** on any 429 | `hinted:false` on **3,064 of 3,064** rate-limit records in r3 | A limiter driven only by `Retry-After`/`RetryInfo` gets nothing from Vertex. It has to learn from the 429s themselves. |
| r3's three workers used **three different regions** | europe-west1, europe-north1, us-east1 (`harness.location`) | `analysis-3` says "3 workers on one Vertex quota". That is only true of the org-level tier. The regional capacity was not shared. |
| One worker alone still got 429s | r2-cand, 1 worker, europe-west1: **0.27 rate limits per call** | Most contention comes from outside our own traffic (shared capacity). |
| Our own rate still matters | chance that a *first attempt* gets a 429, by that worker's first attempts in the previous 60 s: **0.09–0.13 at 0–3/min → 0.19–0.25 at 8–11/min → 0.29–0.30 at ≥12/min** (all four worker-regions) | Pacing helps, but the ~10% floor at almost no load is not ours to remove. |
| Retrying at once after a 429 mostly fails | chance the next retry also gets a 429: **71% (after 1–2 s), 73% (3–6 s), 45% (9–18 s), 6% (15–30 s)**, from 1,243 → 877 → 639 → 285 → 16 attempts | Capacity shortfalls last tens of seconds. The first two retries are mostly wasted requests. |
| Timeouts cluster by region and hour | r3: **us-east1 162 timed-out calls vs 13 and 11** in the EU regions. Two bursts: 49 at 14:00 UTC (3 tasks) and 40 at 19:00 UTC (7 tasks) | Timeouts are regional incidents, not random noise. A hedge or retry to the *same* endpoint is correlated with the failure. |
| Our token use is far below Google's published tier | ≈247k input tokens per task over ≈307 s mean ≈ **48k TPM per worker** (≈145k TPM for 3). Flash Standard PayGo Tier 1 = **2,000,000 TPM** | We are at 2–7% of the org-level baseline. The 429s are not a quota we exceed. |

**A correction to `analysis-3`.** Its claim is that "the limit is RPM, not TPM", based on 429 count per
task correlating 0.91 with calls per task. That correlation is exactly what a **constant chance of failure
per call** produces, so it does not show that a requests-per-minute limit exists. Google now says Standard
PayGo has "no separate requests-per-minute (RPM) limit for each tier" (§1). The better reading of the
data: shared regional capacity (a floor we cannot remove) plus sensitivity to our own **bursts**. Google
tells customers explicitly to avoid "sharp, second-level spikes". The pacing gain (Stream 7.1) is real
but smaller than its −46 to −103 s ceiling. The endpoint lever (§1, change A) is the bigger one and has
not been tried.

---

## 1. Provider quota models

### Vertex AI (Gemini Enterprise Agent Platform)

*Sources: Standard PayGo https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dynamic-shared-quota (last updated 2026-09-17); Error 429 https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deploy/error-code-429 (2026-09-16); Locations https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations (2026-09-18); Priority PayGo https://docs.cloud.google.com/vertex-ai/generative-ai/docs/priority-paygo (2026-09-17); Flex PayGo https://docs.cloud.google.com/vertex-ai/generative-ai/docs/flex-paygo (2026-09-17); pricing https://cloud.google.com/vertex-ai/generative-ai/pricing.*

- **Standard PayGo is tiered by what the organisation spent in the last 30 days.** Baseline throughput is
  in TPM at org level, per model. Flash and Flash-Lite: Tier 1 ($10–250) **2M TPM**, Tier 2 4M, Tier 3
  10M, Tier 4 (>$50k) 50M. Pro: 0.5M / 1M / 2M / 10M. The docs say there is "no separate requests-per-minute
  (RPM) limit for each tier". Traffic may burst above the baseline "on a best-effort basis".
  "The throughput limits are based on requests sent to the global endpoint."
- **What a 429 means**: "it doesn't indicate that you've hit a fixed quota. It indicates temporary high
  contention for a specific shared resource." Google's advice, in order: exponential backoff, **use the
  global endpoint**, which "dynamically routes your requests to the region with the most available
  capacity", and **smooth traffic**: "Avoid sending requests in sharp, second-level spikes … High and
  instantaneous traffic can lead to throttling even if your average per-minute usage is below your limit."
  There are also **acceleration limits**: "ramp up your traffic gradually."
- **The global endpoint**: host `aiplatform.googleapis.com`, path `locations/global`. It "can improve
  overall availability while reducing resource exhausted (429) errors". It gives no data residency ("you
  can't control or know which region your ML processing requests are sent to"). Context caching supports
  it, but not with CMEK. Our installed `@langchain/google-common@0.2.18` already maps `location: "global"`
  to that host (`dist/connection.js:160`).
- **Priority PayGo**: send header `X-Vertex-AI-LLM-Shared-Request-Type: priority`, and also
  `X-Vertex-AI-LLM-Request-Type: shared` for priority only. It works on the global and `us`/`eu`
  multi-region endpoints and **not on regional endpoints**. Supported models include
  `gemini-2.5-flash`. The org baseline is 50M TPM for Flash, available with no ramp-up. When there is
  no spare capacity, excess traffic is **downgraded to Standard rather than rejected**. The response field
  `usageMetadata.trafficType` shows which one served the request (`ON_DEMAND_PRIORITY` or `ON_DEMAND`).
  Price for 2.5 Flash: **$0.54 input / $4.50 output per 1M tokens, 1.8× Standard** ($0.30 / $2.50);
  cached input $0.054 vs $0.03.
- **Flex PayGo** (Preview): **50% off**, global endpoint only, "longer expected latency" and "higher
  throttling", timeouts up to 30 min. The model list is 3.x only; the pricing page lists 2.5 Flash
  Flex/Batch at $0.15 / $1.25. Not suitable for an interactive agent.
- **Provisioned Throughput**: reserved GSUs, bought by subscription. Below the purchased amount, would-be
  429s come back as 5xx and count toward the SLA. It needs a commitment, so it is not a client-side lever.

### Gemini API (ai.google.dev, API-key provider)
*https://ai.google.dev/gemini-api/docs/rate-limits (last updated 2026-09-02).* Limits are fixed
**RPM, TPM (input) and RPD per project, not per key**. RPD resets at midnight Pacific. Tiers are gated by
spend over rolling 10-minute windows (Tier 1 $10, Tier 2 $50, Tier 3 $200 per 10 min). Over the limit
you get `429 RESOURCE_EXHAUSTED`. Unlike Vertex DSQ, this is a real per-project counter, so a client-side
bucket tuned to the published RPM is accurate here. Our `retryDelayHint` already parses the
`retryDelay: "Ns"` found in Google error bodies. *Could not verify in the docs this session that
RetryInfo is always present.*

### OpenAI
*https://developers.openai.com/api/docs/guides/rate-limits.* Limits are RPM, RPD, TPM, TPD and IPM.
Headers on **every** response: `x-ratelimit-limit-requests|tokens`, `x-ratelimit-remaining-requests|tokens`,
`x-ratelimit-reset-requests|tokens`, project-level token headers, and `Retry-After` on 429. Two rules
matter for a client limiter:
1. TPM usage is "calculated as the maximum of `max_tokens` and the estimated number of tokens", so a
   large `max_tokens` uses up headroom.
2. "Unsuccessful requests contribute to your per-minute limit, so continuously resending a request won't
   work."

### Anthropic
*https://platform.claude.com/docs/en/api/rate-limits.* Limits are RPM, ITPM and OTPM per model class,
enforced with a **token bucket** that refills continuously. "60 RPM might be enforced as 1 request per
second", so bursts trigger 429s. Acceleration limits apply. Headers: `retry-after` ("Earlier retries will
fail") and `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}`,
with reset times in RFC 3339.
- **Cache reads do not count toward ITPM** on most models: "With a 2,000,000 ITPM limit and an 80% cache
  hit rate, you could effectively process 10,000,000 total input tokens per minute".
- `max_tokens` does **not** count toward OTPM, which is the opposite of OpenAI.
- A spend-cap 429 carries **no** `retry-after` and `error.details.error_code: enforced_spend_limit_reached`.
  It must end the task, not retry.

### Local (Ollama)
*https://docs.ollama.com/faq.*
- A model stays loaded for **5 min** by default; `keep_alive` changes this.
- `OLLAMA_NUM_PARALLEL` defaults to **1**, so requests to one model queue behind each other.
  `OLLAMA_MAX_QUEUE` is 512, after which the server returns **503**.
- The default context is 4,096 tokens. `helper.ts` already sets `numCtx: 64000`.
- There is no rate limit, so throughput is the local GPU.

### Provider-neutral summary

| Signal | Vertex DSQ | Gemini API | OpenAI | Anthropic | Ollama |
| --- | --- | --- | --- | --- | --- |
| Limit type | shared capacity + org TPM tier | per-project RPM/TPM/RPD | RPM/TPM (+max_tokens) | token bucket RPM/ITPM/OTPM | GPU queue |
| Retry hint on 429 | **none (0/3,064)** | `retryDelay` in body | `Retry-After` | `retry-after` | none (503) |
| Remaining-capacity headers | none | none | `x-ratelimit-*` | `anthropic-ratelimit-*` | none |
| Failed requests cost quota | effectively (feed contention) | yes | **yes (documented)** | counted in bucket | queue slot |
| Endpoint choice | regional / multi-region / **global** | one | one | `inference_geo` shares one pool | one |

---

## 2. Client-side rate limiting done right

- **Jittered backoff.** *AWS Architecture Blog, "Exponential Backoff and Jitter", 2015-03-04,
  https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/.* Four variants were tested
  with 100 contending clients: none, Full (`rand(0, min(cap, base·2^n))`), Equal (`half + rand(half)`)
  and Decorrelated. Jitter cut total calls "by more than half" compared with no jitter. **Full Jitter**
  gave the best completion time, and Equal was "significantly slower". `rateLimitDelayMs` in `base.ts`
  is **Equal jitter** (`ceiling/2 + random·ceiling/2`).
- **Google's own recipe.** *Cloud blog, 2024-11-22,
  https://cloud.google.com/blog/products/ai-machine-learning/learn-how-to-handle-429-resource-exhaustion-errors-in-your-llms.*
  `wait_random_exponential(multiplier=1, max=60)` (full jitter, 60 s cap), plus model/provider fallback and
  circuit breaking. On the old fixed quota, 4 of 5 attempts failed with no retry and 5 of 5 succeeded with it.
- **Retry budgets.** *Google SRE book, "Handling Overload", https://sre.google/sre-book/handling-overload/.*
  - At most **3 attempts** per request: "If a request has already landed on overloaded tasks three times …
    the whole datacenter is likely overloaded".
  - Per client, retry only while retries/requests **< 10%**.
  - **Client-side adaptive throttling**: reject locally with probability `max(0, (requests − K·accepts)/(requests+1))`,
    with **K = 2**.
  
  *gRPC A6, https://github.com/grpc/proposal/blob/master/A6-client-retries.md:* a token count starts at
  `maxTokens`; −1 on each failure, +`tokenRatio` on each success. At or below `maxTokens/2`, **no retries
  and no hedges**. A server pushback value (`grpc-retry-pushback-ms`) overrides the client's backoff.
- **Adaptive concurrency.** *Netflix concurrency-limits,
  https://github.com/Netflix/concurrency-limits.* Limit = RPS × latency (Little's law).
  - `AIMDLimit`: backoff ratio **0.9** on a drop (an error, or RTT above a **5 s** timeout); +1 when
    in-flight ≥ limit/2; min 20, max 200.
  - `Gradient2Limit`: `gradient = max(0.5, min(1, tolerance·longRtt/shortRtt))`,
    `newLimit = gradient·limit + queueSize`, smoothing 0.2, tolerance 1.5, queueSize 4, long window 600.
  
  **The RTT-gradient family does not fit LLM calls**: our latency tracks *output* length (ρ 0.45–0.65), so
  a long answer would read as congestion. Use AIMD with the **429 as the drop signal**.
- **Hedged requests.** *Dean & Barroso, "The Tail at Scale", CACM 2013,
  https://www.barroso.org/publications/TheTailAtScale.pdf.* Send the second request only after the
  **95th-percentile expected latency**, which "limits the additional load to approximately 5%".
  BigTable example: a hedge after 10 ms cut p99.9 from **1,800 ms to 74 ms with 2% more requests**.
  The caveat that matters to us: the technique "is effective only when the phenomena that causes
  variability does not tend to simultaneously affect multiple request replicas." Our timeouts cluster
  by region and hour (§0), which is exactly that correlated case. A hedge to the **same** regional
  endpoint during a us-east1 incident cannot escape it. Our measured hedge rate, 289 of 9,060 requests
  = 3.2%, is inside the paper's ~5% band. The problem is where the hedge goes and when, not how often.

---

## 3. Latency levers for agent loops

- **Output tokens are the latency.** In round 1, **156 of 194 output tokens per call were reasoning**
  (`ROUNDS.md`), and latency tracks output (ρ 0.45–0.65) but not input (ρ ≈ 0.1). The thinking budget is
  therefore the largest per-call latency lever. It is also an accuracy lever.
  - *Vertex thinking docs, https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking:*
    2.5 Flash `thinking_budget` ranges from 1 to 24,576. The default is "Auto (up to 8,192 tokens)" and
    −1 means dynamic. **0 turns it off** on Flash and Flash-Lite. 2.5 Pro cannot turn it off (minimum 128).
    It is a *soft* limit.
  - **Gemini 3+ uses `thinking_level`** (MINIMAL / LOW / MEDIUM / HIGH; the default varies by model, e.g.
    3.5 Flash = MEDIUM and 3 Flash preview = HIGH). "If you specify both thinking_level and
    thinking_budget … the model returns an error". Using `thinking_level` on 2.5 also errors. MINIMAL
    "still requires thought signatures", so a missing signature returns a 400.
  - Thinking tokens are billed as output: "Pricing is based on the full thought tokens … despite only the
    summary being output" (https://ai.google.dev/gemini-api/docs/thinking, 2026-09-17).
  - Published results show accuracy rising with budget on 2.5 Flash (Gemini 2.5 report,
    https://arxiv.org/abs/2507.06261). I found **no published web-agent measurement** of budget against
    success rate, so this is ours to measure.
- **OpenAI** (https://developers.openai.com/api/docs/guides/reasoning): `reasoning.effort` takes
  none, minimal, low, medium, high, xhigh or max, depending on the model (gpt-5.5 defaults to medium).
  With tool calling, "pass back all reasoning items … since the last user message", via `encrypted_content`
  or `previous_response_id`.
- **Anthropic** (https://platform.claude.com/docs/en/build-with-claude/extended-thinking):
  - `budget_tokens` (minimum **1,024**) is deprecated on 4.6 and **rejected with a 400 on 4.7 and later**.
    Current models use `thinking: {type: "adaptive"}` plus `output_config.effort`.
  - **Changing the budget or effort invalidates the message-level cache**. In the documented example,
    1,370 cached tokens were rewritten after a budget change. So effort must be fixed per role for a
    whole task.
- **Streaming and early parsing.** A single tool call per step cannot start acting before the model
  finishes, because the arguments come last. What streaming does buy is **time-to-first-token**. It
  separates "queued or stuck" (no bytes) from "generating slowly" (bytes flowing). We cannot tell those
  apart today: 166 calls sat for the full 25 s. Vertex `streamGenerateContent` is in the installed
  adapter (`connection.js:349`).
- **Parallel and speculative work.**
  - LLMCompiler (https://arxiv.org/abs/2312.04511, ICML 2024): up to **3.7× latency, 6.7× cost,
    ~9% accuracy** compared with ReAct, for independent tool calls.
  - Speculative Actions (https://arxiv.org/abs/2510.04371, Oct 2025): up to **55%** next-action
    prediction accuracy gives up to **20%** latency reduction, at the cost of extra model calls.
- **Cascades and routing.**
  - FrugalGPT (https://arxiv.org/abs/2305.05176): matches GPT-4 at **up to 98% lower cost**, or +4%
    accuracy at the same cost.
  - RouteLLM is already in `03` (~35% saving at <2% loss).
  - Both need **more requests per answer** on escalation (see "What not to copy").

---

## 4. Caching (verified 2026-09-19)

*Vertex context-cache overview https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview (2026-09-17); create https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-create (2026-09-16); use https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-use (2026-09-16); Gemini API https://ai.google.dev/gemini-api/docs/caching (2026-09-02).*

- **Implicit** caching is on by default. Cached tokens are **90% off**, with no storage charge. The docs
  give only two tips: "Place large and common contents at the beginning", and "Send requests with a
  similar prefix in a short amount of time". Hits appear in `cachedContentTokenCount`, which our adapter
  maps to `cache_read`.
- **Minimums, "for implicit and explicit caching"**:
  - Gemini 2 family: **2,048**.
  - Gemini 3 family: **4,096**.
  - 3.0 Flash Preview, 3.1 Pro Preview, 3.7 Flash and 3.8 Flash: **6,144** (implicit only).

  The Gemini API page lists 2.5 Flash/Pro at 2,048 and 3.5 to 3.8 Flash at 4,096.
- **Explicit `cachedContents`**:
  - The discount is 90% on 2.5+ (75% on 2.0).
  - Default TTL is 60 min, the minimum is 1 min, and there is **no maximum**.
  - The cache is **stored in the region where it was created**, and the global endpoint is supported.
  - A request that uses a cache **must not** also send `system_instruction`, `tools` or `tool_config`.
    Those have to live *inside* the cache.
  - The installed adapter passes `cachedContent` through (`utils/gemini.js:1443`).
  - Storage is billed per token-hour. I could not extract the 2.5 Flash rate this session. At the
    secondary ~$1 per M-token-hour cited in `03`, a 2k-token cache costs **≈ $0.002 per hour**,
    which is negligible.
- **This contradicts `TOKEN_BUDGET.md` option 1.** The overview's limits table puts the same **2,048
  minimum on explicit caches**. A planner prefix of 1,913 tokens therefore cannot be cached explicitly
  either, unless the cached **system + tools** content reaches 2,048. The 1,913 figure may or may not
  include the planner's tool schema, and that has to be measured. Two more facts argue against the
  threshold being the whole story:
  - Before the prompt rewrite the planner prefix was 3,177 tokens and it *still* cached only 1.6%
    (`TOKEN_BUDGET.md` §5.0 and the line 230 note).
  - Implicit hits are "best effort" by design.
  
  The honest next step is a **deterministic probe**: two identical planner requests a few seconds apart
  on the same endpoint, reading `cachedContentTokenCount` on the second. Do this before building any
  explicit-cache machinery.
- **OpenAI** (https://developers.openai.com/api/docs/guides/prompt-caching):
  - Caching is automatic from **1,024** tokens and needs the whole rendered prefix to match, including
    tools, schemas and images.
  - Retention is 5–10 min idle (up to 1 h) in memory, or "extended" up to 24 h.
  - On pre-5.6 models `prompt_cache_key` steers routing: "aim for about 15 requests per minute … using
    each key". On GPT-5.6+ reads cost 0.1× and writes 1.25×.
  - `@langchain/openai@0.6.16` supports `promptCacheKey`.
- **Anthropic** (https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
  - "**No automatic caching occurs without `cache_control`**".
  - A single **top-level `cache_control: {type: "ephemeral"}`** moves the breakpoint forward
    automatically. Explicit breakpoints allow at most 4.
  - Minimum is 512 to 4,096 tokens depending on the model. TTL is 5 min (default) or 1 h (2× write price).
  - **WebGenie sends no `cache_control` anywhere** (`helper.ts:332-344`). Every Anthropic user pays full
    input price on every call and spends ITPM on every token.
  - `@langchain/anthropic@0.3.33` exposes `invocationKwargs`, which is how to pass the top-level field.
- **Ollama**: no API-level cache. The KV cache is reused within a loaded model's slot, so the cheap
  levers are `keep_alive` (avoid reloads) and a **stable `num_ctx`** across roles (a change forces a
  reload; the comment in `helper.ts` already records this).

---

## 5. Timeouts and failure handling

- **Timeouts from measured distributions.** The Tail at Scale uses p95 for the hedge point. Our
  capability comment says the timeout is "about 1.5 × the observed p99". Measured p99 is 18.5 s for the
  navigator and 23.1 s for the planner, which supports ~25–28 s as a *total* limit. The 12 s cut in
  Stream 7.2 would abandon the slowest 2–3% of good calls. Because timeouts cluster in regional
  incidents (§0), a shorter timeout **plus retrying on a different endpoint** beats either change alone.
  A **time-to-first-token** limit (streaming) is the more exact tool.
- **Cancellation.** The LangChain adapters accept `AbortSignal`, and `invokeHedged` already aborts the
  loser. The Tail at Scale notes that aggressive hedging "requires faster cancellation". An aborted HTTP
  request may still be generated and billed by the provider.
- **Idempotency.** A model call is idempotent: it has no side effects and a duplicate costs only money
  and quota. That is why hedging and retrying are safe at the model layer. Idempotency keys belong on
  the *actions* (Stream 10.1), not on LLM calls.
- **Errors that must not retry**: Anthropic spend-cap 429 (`enforced_spend_limit_reached`, no
  `retry-after`), OpenAI quota/billing 429s (`insufficient_quota`), and Vertex auth. `base.ts` already
  ends the task on billing/quota. Check that `isRateLimitError` does not catch the Anthropic spend-cap
  429, because it has type `rate_limit_error`.

---

## What this means for WebGenie

Rule for every item: it lives in `packages/storage/lib/settings/llmCapabilities.ts` (declared per
provider and model) and in `agent/helper.ts` or `agent/agents/base.ts` (read generically). Nothing
goes in the executor, the prompts or site logic. No provider's numbers are hard-coded into shared code;
shared code reads them from capabilities or learns them from responses.

**Proposed capability fields** (extensions of `LlmCapabilities`):

```ts
rateLimitSignals: 'headers' | 'body-hint' | 'none';     // openai/anthropic | gemini api | vertex, ollama
endpoints?: string[];                                    // e.g. vertex: ['global', <regional>]; empty = one endpoint
hedge: 'off' | 'auto';                                   // off for single-queue local servers
promptCache: 'implicit' | 'top-level-marker' | 'resource' | 'none';
minCacheTokens?: number;                                 // from the provider doc, per model
reasoning: 'none' | 'openai_effort' | 'gemini_budget' | 'gemini_level' | 'anthropic_adaptive' | 'anthropic_budget';
```

| # | Change (where) | Expected effect, from our numbers | Risk | Ships |
| --- | --- | --- | --- | --- |
| **A** | **Endpoint as a capability; Vertex defaults to `location: global`**, with regional as a user choice for data residency (`helper.ts` VertexAI branch; `endpoints` in capabilities) | Addresses both of Google's two named causes. Ceiling: rate-limit wait of **52–86 s/task** (per-region, r2/r3) plus us-east1's timeouts, **162 × 25 s ≈ 41 s/task** on that worker. No measured saving yet | Implicit-cache hit rate under global routing is **unknown**, and the navigator's 98% could drop. Global gives no data residency | **Gated**: same 60 tasks, 1 worker, regional vs global, compare `provider.rateLimitWaitMs`, timeouts and `cache_read` share |
| **B** | **Retry on a different endpoint** after a 429 or timeout when `endpoints.length > 1`; otherwise the current backoff (`invokeLLM`) | Same-endpoint retries fail **71% / 73%** at attempts 1–2. Moving them to a decorrelated pool targets the ~30 s mean chain | An explicit cache is regional, so an explicit-cache request cannot fail over without re-creating the cache (implicit is fine) | Unit-tested (endpoint rotation); gated with A |
| **C** | **Adaptive limiter per (provider, endpoint, model)**, replacing the model-name `cooldownUntil` key. AIMD on permitted starts per minute with 429 as the drop signal, plus SRE throttling (K=2). Seeded from `x-ratelimit-*` / `anthropic-ratelimit-*` when `rateLimitSignals: 'headers'` (read via a `fetch` wrapper passed to the SDK clients), learned from 429s for `none` | First-attempt 429 rises from **0.09–0.13 → 0.29** as own rate goes from <4 to ≥12 fresh req/min. Smoothing bursts targets that gap: roughly **−10 to −25 s/task** after paying some pacing wait, well below 7.1's −46 to −103 s ceiling (see §0) | Over-throttling adds wait. The ~10% floor is exogenous and pacing cannot remove it | Unit-tested (fake clock); gated run to size it |
| **D** | **Honour server hints generically**: read `Retry-After` / `retry-after` from `error.headers` and `error.response.headers`, not just the message text (`retryDelayHint`). Don't retry spend-cap 429s | Vertex gives no hints, so ~0 on the benchmark. Real for OpenAI and Anthropic users, where retrying early "will fail" and failed requests use up quota | Low | Unit-tested |
| **E** | **Full jitter** instead of Equal jitter in `rateLimitDelayMs`, same cap | AWS: best completion time of the jittered variants. Small here, because one client barely contends with itself | Low | Unit-tested |
| **F** | **Hedging as a capability**: `off` for Ollama (NUM_PARALLEL=1 means the duplicate queues behind the original, and hedging at 10 s currently fires under Ollama's 90 s timeout) and for slow thinkers until their p95 is known. Otherwise hedge at the model's **observed p95** (≈5% load) to an **alternate endpoint** when one exists. Suppress while the gRPC-style retry token count is ≤ half (this generalises `NO_HEDGE_AFTER_RATE_LIMIT_MS`) | Vertex: the **2.48 s/task** loser overhead and part of the +1.26 req/task. Ollama: removes self-inflicted queueing on every call slower than 10 s | Low | Unit-tested |
| **G** | **Per-model online latency tracker** (EWMA p95/p99 in memory, per worker) feeding hedge point and timeout = clamp(1.5 × p99, floor, capability ceiling). Add a **time-to-first-token timeout** where the adapter can stream | Timeouts cost **18.2 s/task**. A TTFT abort at ~8–10 s on a stalled call, followed by a retry on another endpoint, recovers most of that without abandoning slow-but-alive calls | Streaming changes the tool-call parsing path in LangChain | Tracker unit-tested; streaming/TTFT **gated** |
| **H** | **Caching by capability**. Anthropic: top-level `cache_control` via `invocationKwargs` (today **0%**). OpenAI: stable `promptCacheKey` per task and role. Gemini: first run the **deterministic probe** (§4). Build explicit `cachedContents` for the planner only if system + tools ≥ `minCacheTokens` and the probe shows implicit is missing | Anthropic: input cost on cached prefix → 0.1×, and cached tokens stop counting toward ITPM. Gemini planner: ≤ −12.7k billed-equivalent tok/task (`TOKEN_BUDGET.md`), **only if** the prefix is above 2,048 | Anthropic: a 5-min TTL write costs 1.25×, so it pays off from the second call. Never pad a prompt to reach a minimum without a measured gain | Unit-tested request shape; probe is a one-off script |
| **I** | **Reasoning control per role, fixed for a task**. Add `gemini_level` (Gemini 3+ must get `thinking_level`, not `thinkingBudget`; sending both errors), `anthropic_adaptive` (4.7+ rejects `budget_tokens`), `openai_effort` as now. Test `includeThoughts: false`: the adapter sets it to true whenever budget ≠ 0 (`utils/gemini.js:1296`), which returns summaries we don't use | Reasoning is **80%** of output tokens, and output drives latency. A lower navigator budget is the biggest per-call speed lever. Size unknown | **Accuracy risk**, which is why the pinned rule applies: never ship on assumption | **Gated** on the gate set, planner and navigator separately; report success and seconds on both sides |
| **J** | **Opt-in Priority tier** for Vertex (header), shown to the user with its price, never on by default | Downgrades instead of rejecting when capacity is short. Could remove much of the 29.7% backoff share | **+80% price** on 2.5 Flash. Global/multi-region only | Gated A/B, then offered as a setting; the user decides cost against speed |

What is already right and should stay: `maxRetries: 0` in every adapter (a single retry layer avoids
retry amplification), the shared per-model cooldown (which should become per endpoint as in C), the
3-minute `RATE_LIMIT_BUDGET_MS` followed by a resumable pause, and hedge suppression after a 429.

**Order**: D, E, F (unit-tested, low risk) → the caching probe → A+B as one gated run → C sized on
the result → G → I and J as separate gated experiments.

## What not to copy

- **Cascades, routers and speculative actions (FrugalGPT, RouteLLM escalation, Speculative Actions).**
  Their savings are in *price*. Each escalation or speculation adds requests, and our wall-clock problem
  is request-driven contention. Speculative *browser* actions also have side effects that a model call
  does not.
- **More workers or parallel model calls to "go faster".** 1 → 3 workers cost +15 s/task on matched
  tasks, and the first-attempt 429 rate rises with our own request rate.
- **Netflix Gradient/Vegas (RTT-based) limits.** LLM RTT is set by output length, not queueing. Use
  429s as the loss signal.
- **Shrinking prompts to buy quota.** Tokens per call ↔ 429s per call correlate at 0.02, and every
  provider's minimum-cache threshold punishes prompts cut too small (the planner case).
- **Hedging to the same endpoint during an incident.** The Tail at Scale's own caveat, and our timeouts
  cluster by region and hour.
- **Flex PayGo or batch for the loop.** It advertises longer latency and heavier throttling. It fits
  offline judging (`judge.mjs`), not the agent.
- **A cross-worker limiter in the product.** One extension is one client. Only the benchmark harness has
  several workers, so fix that in `overnight.sh` (one endpoint per worker, or global), not in the
  extension.
- **Changing thinking budget or effort mid-task** on Anthropic, or any setting that renders into the
  prefix. It invalidates the cache.

## Could not reach

- CACM "The Tail at Scale" returned 403. I used the author's PDF at barroso.org instead.
- The AWS Builders' Library timeouts/retries article redirected to builder.aws.com and returned no body.
  Its percentile-timeout guidance is not cited.
- Vertex "Retry strategy" page (`/docs/retry-strategy`): URL moved; not found.
- Vertex pricing: extracted Standard, Priority and Flex rates for 2.5 Flash, but **not the context-cache
  storage rate** (page truncated).
- Gemini API rate-limit page: the per-model RPM/TPM tables and whether `RetryInfo` is always present
  were not in the fetched content.
- The Netflix README gave no AIMD defaults; I took them from `AIMDLimit.java` and `Gradient2Limit.java`.
- No published measurement of thinking budget vs **web-agent** success rate was found. Item I has to
  produce it.
