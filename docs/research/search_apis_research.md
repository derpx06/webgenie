# WebGenie Research: SOTA Search APIs for AI Grounding

This document summarizes the best and most popular search APIs for AI agents, detailing their free-tier plans, pay-as-you-go pricing, authentication, and HTTP request structures.

---

## 1. Tavily Search API (AI-First Grounding)
Tavily is built from the ground up for LLMs and RAG (Retrieval-Augmented Generation). It removes html tags, ads, and irrelevant snippets, returning clean text summaries and relevance-scored search results.

*   **Pricing / Free Tier**:
    *   **Free Tier**: 1,000 queries per month.
    *   **Paid Tier**: Starts at $15/month for 10,000 queries.
*   **Authentication Key**: `api_key` in the request body.
*   **API Endpoint**: `POST https://api.tavily.com/search`

### API Call Example
```bash
curl -X POST "https://api.tavily.com/search" \
     -H "Content-Type: application/json" \
     -d '{
       "api_key": "YOUR_TAVILY_API_KEY",
       "query": "Who won the latest Monaco Grand Prix?",
       "search_depth": "advanced",
       "max_results": 5
     }'
```

---

## 2. Exa API (formerly Metaphor - Neural Semantic Search)
Exa uses a custom transformer model trained to predict link sharing. It excels at semantic lookup rather than simple keyword matches (e.g. searching *"blog posts about rust memory safety"* returns high-quality articles rather than search-optimized match text).

*   **Pricing / Free Tier**:
    *   **Free Tier**: 1,000 queries per month.
    *   **Paid Tier**: $7 per 1,000 requests.
*   **Authentication Key**: `x-api-key` in HTTP header.
*   **API Endpoint**: `POST https://api.exa.ai/search`

### API Call Example
```bash
curl -X POST "https://api.exa.ai/search" \
     -H "Content-Type: application/json" \
     -H "x-api-key: YOUR_EXA_API_KEY" \
     -d '{
       "query": "deep research papers on multi-agent alignment",
       "type": "auto",
       "numResults": 5,
       "useAutoprompt": true
     }'
```

---

## 3. Serper.dev (Google Search API Alternative)
Serper scraper wraps Google Search results (organic, local, news, images) at a fraction of the cost of standard Google Custom Search APIs, with extremely low latency.

*   **Pricing / Free Tier**:
    *   **Free Tier**: 2,500 queries upon account creation.
    *   **Paid Tier**: $1.00 per 1,000 queries (scales down to $0.30 at enterprise volume).
*   **Authentication Key**: `X-API-KEY` in HTTP header.
*   **API Endpoint**: `POST https://google.serper.dev/search`

### API Call Example
```bash
curl -X POST "https://google.serper.dev/search" \
     -H "Content-Type: application/json" \
     -H "X-API-KEY: YOUR_SERPER_API_KEY" \
     -d '{
       "q": "current stock price of NVDA",
       "gl": "us",
       "hl": "en"
     }'
```

---

## 4. Brave Search API (Independent Web Index)
Brave Search maintains its own private, independent search engine index. Its `llm/context` endpoint returns summaries pre-curated for LLM inputs.

*   **Pricing / Free Tier**:
    *   **Free Tier**: 10,000 queries per month.
    *   **Paid Tier**: Starts at $3.00 to $5.00 per 1,000 queries.
*   **Authentication Key**: `X-Subscription-Token` in HTTP header.
*   **API Endpoint**: `GET https://api.search.brave.com/res/v1/llm/context`

### API Call Example
```bash
curl -X GET "https://api.search.brave.com/res/v1/llm/context?q=latest+spacex+starship+launch+date" \
     -H "Accept: application/json" \
     -H "X-Subscription-Token: YOUR_BRAVE_API_KEY"
```

---

## 5. Perplexity API (Conversational Search LLM)
Perplexity combines LLM reasoning directly with live web search results. It returns a fully synthesized natural language answer referencing live sources.

*   **Pricing / Free Tier**:
    *   **Free Tier**: None (requires paid credit token).
    *   **Paid Tier**: Pay-as-you-go based on LLM output/input token usage (approx. $0.07 per search query).
*   **Authentication Key**: `Authorization: Bearer <key>` in HTTP header.
*   **API Endpoint**: `POST https://api.perplexity.ai/chat/completions`

### API Call Example
```bash
curl -X POST "https://api.perplexity.ai/chat/completions" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_PERPLEXITY_API_KEY" \
     -d '{
       "model": "sonar-pro",
       "messages": [
         { "role": "user", "content": "What is the current status of the Artemis 3 mission?" }
       ]
     }'
```

---

## 6. Jina Search API / Reader (Web to Markdown Parser)
Jina Search reads public web urls or queries and returns clean, LLM-friendly markdown content. It is extremely popular for quick RAG integrations.

*   **Pricing / Free Tier**:
    *   **Free Tier**: Rate-limited public access.
    *   **Paid Tier**: Starts at $0.02 per 1,000 transactions.
*   **Authentication Key**: `Authorization: Bearer <key>` in HTTP header (optional for free tier).
*   **API Endpoint**: `GET https://s.jina.ai/<query>` or `GET https://r.jina.ai/<url>`

### API Call Example
```bash
curl -X GET "https://s.jina.ai/spacex+launch+updates" \
     -H "Authorization: Bearer YOUR_JINA_API_KEY" \
     -H "Accept: text/plain"
```

---

## 7. Google Custom Search JSON API (Official Google Index)
Google's official web search mapping interface. It requires setting up a Custom Search Engine (CSE) container and referencing the Engine ID.

*   **Pricing / Free Tier**:
    *   **Free Tier**: 100 queries per day.
    *   **Paid Tier**: $5.00 per 1,000 queries.
*   **Authentication Keys**:
    *   `key`: Developer API Key.
    *   `cx`: Custom Search Engine ID.
*   **API Endpoint**: `GET https://www.googleapis.com/customsearch/v1`

### API Call Example
```bash
curl -G "https://www.googleapis.com/customsearch/v1" \
     --data-urlencode "key=YOUR_GOOGLE_API_KEY" \
     --data-urlencode "cx=YOUR_SEARCH_ENGINE_CX" \
     --data-urlencode "q=quantum computing developments"
```

---

## 8. DuckDuckGo Search Integration (Free No-Key Option)
DuckDuckGo does not provide an official commercial search API key. Instead, agents use the free Instant Answer API for quick summaries, or query the HTML/Lite search layouts to scrap links directly.

*   **Pricing / Free Tier**:
    *   **Free Tier**: 100% Free, no registration required.
    *   **Paid Tier**: None.
*   **Authentication Keys**: None.
*   **API Endpoint**: `GET https://api.duckduckgo.com` (Instant Answers) or `GET https://html.duckduckgo.com/html` (Web SERP Scraping)

### API Call Example (Instant Answers)
```bash
curl -sG "https://api.duckduckgo.com/" \
     --data-urlencode "q=Relativity Space" \
     --data-urlencode "format=json" \
     --data-urlencode "no_html=1"
```

### Scraping Example (Lite SERP Links)
```typescript
// Proposed implementation logic to query organic links without a key
async function queryDuckDuckGoHtml(query: string): Promise<string[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const htmlText = await response.text();
  
  // Extract result links (e.g. matching tags like <a class="result__url">)
  const links: string[] = [];
  const regex = /class="result__url"\s+href="([^"]+)"/g;
  let match;
  while ((match = regex.exec(htmlText)) !== null) {
    links.push(match[1]);
  }
  return links;
}
```
