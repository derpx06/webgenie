# WebGenie Agent Extensions & Roadmap Blueprint

This document details the architectural options and features that the WebGenie agent can be extended with to achieve state-of-the-art capability, split by priority, complexity, and performance impact.

---

## 1. Extension Feature Matrix

| Feature | Primary Benefit | Complexity | Token Impact | Priority |
| :--- | :--- | :--- | :--- | :--- |
| **1. Deep Web Search Tool** | Resolves blind browsing & guessing URLs | Medium | Saves ~25% tokens | **1 (Highest)** |
| **2. Visual Set-of-Marks (SoM)** | Visual tag-overlay coordinates for vision models | High | Saves ~50% tokens | **2** |
| **3. Secure Credential Vault** | Zero-log login form filling (prevents credential leaks) | Low | Neutral | **3** |
| **4. MCP Server Integration** | Connects browser automation directly to IDEs (Claude Desktop) | Medium | Neutral | 4 |
| **5. Visual Diff Critique Engine** | Detects silent click failures and loops | Medium | Neutral | 5 |
| **6. Self-Healing Selector Resolver** | Calculates element similarity to heal broken selectors | Medium | Neutral | 6 |

---

## 2. Deep Dive: Top Recommended Extensions

### 1. Deep Web Search Integration (Tavily / Perplexity)
*   **Why it's critical**: Currently, if the agent receives an instruction like *"Check the stock price of Apple"*, it has to guess the URL or navigate Yahoo Finance manually. 
*   **How it works**: A new action handler is added. The agent calls the Tavily API asynchronously, retrieves the top 5 relevant search result snippets and clean URLs, and directly navigates to the target page, bypassing raw search engine loading completely.

### 2. Visual Set-of-Marks (SoM) Coordinates Overlay
*   **Why it's critical**: Processing long raw HTML or Accessibility Trees consumes large token budgets.
*   **How it works**:
    1. Before capturing a viewport screenshot, the extension injects a transparent SVG layer over the webpage.
    2. Interactive DOM nodes are mapped to numeric labels (e.g. `[1]`, `[2]`).
    3. The vision model sees the labeled screenshot and outputs the action by element number: `click(12)`.
    4. The extension instantly removes the overlay and simulates the click on target coordinates, saving ~50% in input tokens.

### 3. Secure Credential Vault & Form-Filler
*   **Why it's critical**: Prevents usernames, passwords, or API keys from ever being exposed to the LLM context or logs.
*   **How it works**: Credentials are encrypted using AES-GCM and stored in `chrome.storage.local`. The LLM only calls the command `fill_credentials(domain: "github.com")`. The service worker decrypts the values and injects them directly using CDP (`Input.dispatchKeyEvent`), keeping logs completely clean.

### 4. Self-Healing Selector Resolver
*   **Why it's critical**: Web layouts frequently change, causing hardcoded selectors to fail.
*   **How it works**: If a click target is not found, the resolver searches the current DOM tree for candidate elements and calculates a similarity score based on element tag, class match, text overlap, and layout tree depth. If similarity is $> 0.75$, the selector is healed dynamically.

---

## 3. Integration Blueprint

To add any of these features, we extend the central actions registry:

1. **Register the Schema** in `chrome-extension/src/background/agent/actions/schemas.ts`.
2. **Implement the Handler** in `chrome-extension/src/background/agent/actions/handlers/`.
3. **Register the Handler** in `chrome-extension/src/background/agent/actions/builder.ts` to expose it to the LLM loop.
