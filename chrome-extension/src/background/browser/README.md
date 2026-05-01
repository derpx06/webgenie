# Browser Module

The Browser module provides a clean abstraction layer over Chrome Extension APIs for browser automation. It handles DOM analysis, element interaction, and page lifecycle management.

## Overview

The browser module separates concerns into specialized layers:
- **DOM Analysis**: Parse and understand web page structure
- **Page Interaction**: Execute commands on web pages
- **Context Management**: Track browser state and tabs
- **Utilities**: Helper functions and debugging tools

## Directory Structure

```
browser/
├── dom/               # DOM analysis and element detection
│   ├── clickable/     # Interactive element detection
│   ├── history/       # DOM state tracking
│   ├── service.ts     # Core DOM analysis
│   └── views.ts       # DOM visualization
├── context.ts         # Browser state management
├── page.ts            # Page interaction commands
├── views.ts           # Utility visualizations
└── util.ts            # General utilities
```

## Key Components

### DOM Analysis (`dom/`)

Analyzes web page structure and generates machine-readable representations:

```typescript
import { DOM } from '@src/background/browser';

const analysis = await DOM.service.analyzePage(tabId);
// Returns: DOM tree, accessibility info, clickable elements
```

**Submodules:**
- **service.ts**: Builds accessibility trees and element analysis
- **clickable/**: Detects buttons, links, inputs, and interactive elements
- **history/**: Maintains DOM snapshots for state tracking
- **views.ts**: Debug visualization of DOM structure

### Browser Context (`context.ts`)

Manages browser state, tabs, and windows:

```typescript
import BrowserContext from '@src/background/browser/context';

const context = new BrowserContext(tabId);
const currentUrl = await context.getCurrentUrl();
await context.navigateTo('https://example.com');
```

### Page Interaction (`page.ts`)

Executes user actions on web pages:

```typescript
import { executePageInteraction } from '@src/background/browser/page';

await executePageInteraction(tabId, {
  action: 'click',
  selector: '#submit-button'
});

await executePageInteraction(tabId, {
  action: 'type',
  selector: 'input[name="search"]',
  text: 'query'
});
```

## Usage Patterns

### Analyzing a Webpage

```typescript
import { DOM } from '@src/background/browser';

async function analyzeActivePage(tabId) {
  const domAnalysis = await DOM.service.analyzePage(tabId);
  const clickableElements = await DOM.DOMClickable.detectClickable(tabId);
  const history = await DOM.DOMHistory.getCurrentSnapshot(tabId);
  
  return { domAnalysis, clickableElements, history };
}
```

### Interacting with Pages

```typescript
import { executePageInteraction } from '@src/background/browser/page';
import type BrowserContext from '@src/background/browser/context';

async function interactWithPage(context: BrowserContext, action: any) {
  const result = await executePageInteraction(context.tabId, action);
  return result;
}
```

## API Reference

### DOM Analysis Functions

- `DOM.service.analyzePage(tabId)` - Get complete DOM analysis
- `DOM.service.getAccessibilityTree(tabId)` - Get accessibility structure
- `DOM.DOMClickable.detectClickable(tabId)` - Find interactive elements
- `DOM.DOMHistory.getCurrentSnapshot(tabId)` - Get DOM snapshot
- `DOM.views.debug(tabId)` - Generate debug information

### Browser Context Methods

- `getCurrentUrl()` - Get current page URL
- `navigateTo(url)` - Navigate to URL
- `reload()` - Reload current page
- `goBack()` / `goForward()` - Navigate history
- `executeScript(script)` - Execute JavaScript
- `captureScreenshot()` - Take page screenshot

### Page Interaction Actions

- `click` - Click element
- `type` - Type text in input
- `scroll` - Scroll page
- `focus` - Focus element
- `submit` - Submit form
- `selectDropdown` - Select dropdown value
- `key` - Press keyboard key

## Error Handling

```typescript
import { URLNotAllowedError } from '@src/background/browser/views';

try {
  await context.navigateTo(url);
} catch (error) {
  if (error instanceof URLNotAllowedError) {
    console.error('URL blocked by firewall');
  }
}
```

## Design Principles

1. **Abstraction**: Hide Chrome API complexity behind clean interfaces
2. **Composition**: Combine modules for complex operations
3. **Error Handling**: Clear error types and messages
4. **Debugging**: Utilities for visualizing and debugging DOM operations
5. **Performance**: Efficient DOM queries and caching where appropriate

## Dependencies

- Chrome Extensions API (manifest v3)
- Content scripts for DOM access
- `@src/background/log` for logging
- `@extension/storage` for state persistence

## Best Practices

1. Always use barrel exports - import from `browser/` via `index.ts`
2. Cache DOM analysis when possible - don't re-analyze unchanged pages
3. Handle async operations carefully - DOM changes can be slow
4. Use specific interaction actions - don't rely on generic JavaScript execution
5. Validate selectors - test element targeting before sending to page
