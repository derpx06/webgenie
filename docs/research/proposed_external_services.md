# WebGenie Proposed External Services Integration Blueprint

This document details the external SaaS APIs, cloud platforms, and developer services that can be integrated into the WebGenie extension to upgrade its reliability, bypassing capabilities, scraping efficiency, and observability.

---

## 1. Cloud Browser Hosting & Sandbox (Browserbase / Browserless.io)

### 1.1 Why Integrate It?
Currently, WebGenie runs browser sessions locally on the user's computer via Puppeteer/extension page bindings. While convenient for local development, it:
*   Blocks the user's active viewport and cursor.
*   Consumes significant local CPU/RAM.
*   Lacks persistent session state (cookies, local storage) in a secure cloud environment.

Offloading execution to a **Browser-as-a-Service (BaaS)** provider runs headless browser instances in a secure cloud sandbox, streaming interaction sessions back to the side-panel interface.

```
┌─────────────────────────────────┐
│     WebGenie Side Panel UI      │
└──────────────┬──────────────────┘
               │ (WebRTC / VNC Video Stream)
               ▼
┌─────────────────────────────────┐         Connect via CDP WS
│  Browserbase Cloud Infrastructure├─────────────────────────► Target Web Site
│  (Headless Chrome Sandbox)       │
└─────────────────────────────────┘
```

### 1.2 Integration Points
Modify `BrowserContext` (`chrome-extension/src/background/browser/context.ts`) to connect to the remote WebSocket debugging URL rather than launching or attaching to a local tab:

```typescript
// Proposed integration in browser/context.ts
import puppeteer from 'puppeteer-core';

export async function connectToCloudBrowser(apiKey: string, projectId: string) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://connect.browserbase.com?apiKey=${apiKey}&projectId=${projectId}`,
  });
  return browser;
}
```

---

## 2. Proxy & Residential IP Rotation Services (Bright Data / Smartproxy)

### 2.1 Why Integrate It?
Modern websites implement rate limits and anti-bot systems (Cloudflare, Akamai, Datadome). If the agent performs multiple actions or crawls a domain repeatedly from a single IP, the IP gets flagged and blocked. 

Routing traffic through residential proxy networks rotates IPs on every request or page reload, mimicking organic human traffic spread across different geographical regions.

### 2.2 Integration Points
Configure the browser launch arguments inside the Puppeteer driver connection block (or via the Chrome extension's proxy configuration API: `chrome.proxy`):

```typescript
// Configuration in chrome-extension/src/background/browser/context.ts
const proxyServer = 'http://zproxy.lum-superproxy.io:22225';
const proxyAuth = 'lum-customer-hl_12345-zone-webgenie:password';

// Option A: Pass proxy flags during Puppeteer connection
const browser = await puppeteer.connect({
  browserWSEndpoint: `wss://...`,
  // Proxy configuration flags
});

// Option B: Set extension-wide proxy routing dynamically
chrome.proxy.settings.set(
  {
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'http',
          host: 'zproxy.lum-superproxy.io',
          port: 22225
        },
        bypassList: ['localhost', '127.0.0.1']
      }
    },
    scope: 'regular'
  },
  () => { logger.info('Proxy configured successfully.'); }
);
```

---

## 3. Automated CAPTCHA Solving APIs (Capsolver / 2Captcha)

### 3.1 Why Integrate It?
When an agent encounters a CAPTCHA (reCAPTCHA, hCaptcha, Cloudflare Turnstile, FunCaptcha), standard DOM selection fails. While LLMs with vision capabilities can try to solve image grids, they are slow and have low accuracy. 

A CAPTCHA service solves the challenge payload programmatically or swaps tokens via API in 10-15 seconds.

```
┌─────────────┐             Detect CAPTCHA Type & Payload
│  WebGenie   ├─────────────────────────────────────────┐
└──────▲──────┘                                         ▼
       │ (Inject Response Token)                  ┌─────────────┐
       └──────────────────────────────────────────┤  Capsolver  │
                                                  │  API        │
                                                  └─────────────┘
```

### 3.2 Integration Points
Create a CAPTCHA detector service that intercepts navigation results or scans the DOM AXTree. When a CAPTCHA container is matched, send a payload request to the solver and inject the returned token:

```typescript
// Proposed path: chrome-extension/src/background/services/captcha.ts
export class CaptchaSolverService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async solveTurnstile(websiteUrl: string, websiteKey: string): Promise<string> {
    const response = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      body: JSON.stringify({
        clientKey: this.apiKey,
        task: {
          type: 'AntiTurnstileTaskProxyLess',
          websiteURL: websiteUrl,
          websiteKey: websiteKey,
        }
      })
    });
    const { taskId } = await response.json();
    
    // Poll for solution token...
    return token;
  }
}
```

---

## 4. AI-First Markdown Scraper APIs (Firecrawl / Jina Reader)

### 4.1 Why Integrate It?
If the Planner agent determines that the current milestone only requires reading and gathering data from a page (e.g. *"Read the documentation on page X"*), initiating a full Puppeteer session and extracting the DOM tree is slow and wastes token bandwidth. 

Calling a scraping API like Firecrawl fetches a pre-parsed, clean markdown layout of the page, bypassing local browser execution.

```typescript
// Proposed integration in background/agent/agents/navigator.ts
export async function scrapeTargetPage(url: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, pageOptions: { onlyMainContent: true } })
  });
  const data = await response.json();
  return data.data.markdown; // Returns clean LLM-ready markdown content
}
```

---

## 5. Agent Observability & Telemetry Dashboards (LangSmith / Langfuse)

### 5.1 Why Integrate It?
Debugging agent execution loops locally from Chrome Console logs is difficult. Integrating **Langfuse** or **LangSmith** enables visual tracing of every LLM request, input/output tokens, execution latency, and action steps in a web dashboard.

```
┌─────────────────────────────────┐
│       Executor FSM Trace        │
└──────────────┬──────────────────┘
               │ (Send Event Lifecycle Logs)
               ▼
┌─────────────────────────────────┐
│     Langfuse Dashboard API      │
│  - Token Cost Tracker           │
│  - Step Latency Charts          │
│  - LLM Input/Output Diffs       │
└─────────────────────────────────┘
```

### 5.2 Integration Points
Register a tracer hook in `chrome-extension/src/background/agent/executor.ts` that publishes trace logs at the end of each FSM step:

```typescript
// Proposed integration in background/agent/executor.ts
import { Langfuse } from 'langfuse';

const langfuse = new Langfuse({
  publicKey: 'pk-lf-...',
  secretKey: 'sk-lf-...',
  baseUrl: 'https://cloud.langfuse.com'
});

// Inside executor.execute()
const trace = langfuse.trace({
  name: 'webgenie-task',
  userId: context.taskId
});

// Log step input
const span = trace.span({ name: `step-${stepNumber}` });
span.update({ input: { goal: nextGoal } });

// Log step output
span.end({ output: { actions: selectedActions } });
```

---

## 6. Secure Secrets Managers (Bitwarden Secrets Manager / 1Password CLI)

### 6.1 Why Integrate It?
For enterprise automation, storing credentials in plain text or local Chrome storage poses security risks. Connecting the extension to a Secrets Manager API pulls authentication keys and passwords dynamically only during the active login phase, without saving them permanently in browser storage.

```typescript
// Proposed path: chrome-extension/src/background/services/secrets.ts
export async function fetchSecretToken(secretId: string, accessToken: string): Promise<string> {
  const response = await fetch(`https://api.bitwarden.com/secrets/${secretId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const data = await response.json();
  return data.value; // Return Decrypted Password directly to Form Filler
}
```

---

## 7. Comparative Add-on Matrix

| External Service | Category | Integration Target File(s) | Primary Benefit |
| :--- | :--- | :--- | :--- |
| **Browserbase** | Browser Host | `browser/context.ts`, `browser/page.ts` | Runs browsers in a cloud sandbox to save local CPU. |
| **Bright Data** | Proxy Manager | `browser/context.ts`, `manifest.json` | Rotates residential IPs to prevent rate blocks. |
| **Capsolver** | CAPTCHA Solver | `services/captcha.ts`, `agent/executor.ts` | Automatically solves Turnstile, reCAPTCHA, and hCaptcha. |
| **Firecrawl** | AI Scraper | `agent/agents/navigator.ts` | Fetches clean markdown summaries, saving 60%+ tokens. |
| **Langfuse** | Observability | `agent/executor.ts`, `agent/helper.ts` | Displays cost, trace routes, and LLM latencies. |
| **Bitwarden** | Credentials Vault| `services/secrets.ts`, `actions/interaction.ts` | Safely retrieves passwords without storage leaks. |
