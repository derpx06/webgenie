# Implementation Plan: The Visible Autonomous Agent

## Overview
This document outlines the architecture and implementation plan for the **Visible Autonomous Agent** feature. This feature will allow the WebGenie LLM to schedule future tasks (using `chrome.alarms`) and trigger tasks based on user inactivity (using `chrome.idle`). 

When these triggers fire, the background service worker will automatically force the WebGenie side panel open (the "visible" way) and begin executing the pre-programmed task without any human intervention.

## 1. Permissions & Manifest Updates
To enable background scheduling and inactivity monitoring, the extension requires new permissions.

**Changes in `manifest.json` (or `manifest.js`):**
- Add `"alarms"` to the `permissions` array.
- Add `"idle"` to the `permissions` array.

## 2. Adapter Expansion (`IBrowserAdapter`)
We must adhere to the decoupled architecture. The native APIs must be abstracted behind the `IBrowserAdapter`.

**Changes in `IBrowserAdapter.ts` & `ChromeBrowserAdapter.ts`:**
- `createAlarm(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void>`
- `clearAlarm(name: string): Promise<boolean>`
- `queryIdleState(detectionIntervalInSeconds: number): Promise<chrome.idle.IdleState>`

## 3. Agent Tool Integration (LLM Schema)
The agent needs to know it has the power to schedule tasks. We will add a new `automation` subsystem to the `chrome_control` tool.

**Changes in `schemas.ts`:**
- Add `'automation'` to the `chromeControlActionSchema.subsystem` enum.
- Add actions: `'scheduleTask'` and `'onIdleTask'`.
- Add parameters: 
  - `delayInMinutes`: How long to wait before triggering.
  - `scheduledPrompt`: The prompt the agent should execute when the alarm fires.
  - `targetTabId`: The tab where the agent should execute the prompt.

**Changes in `handlers/chrome-control.ts`:**
- Implement the `'automation'` switch case.
- When `scheduleTask` is called:
  1. Generate a unique ID: `const taskId = 'auto_' + Date.now();`
  2. Save the payload to storage: `chrome.storage.local.set({ [taskId]: { prompt, tabId } })`
  3. Call the adapter: `await browser.createAlarm(taskId, { delayInMinutes })`

## 4. Background Service Worker Triggers
The background script needs to listen for these alarms and act upon them.

**Changes in `background/index.ts`:**
```typescript
// Listen for Scheduled Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('auto_')) {
    // 1. Fetch the saved task from storage
    const data = await chrome.storage.local.get(alarm.name);
    const taskInfo = data[alarm.name];
    if (!taskInfo) return;

    const { prompt, tabId } = taskInfo;

    // 2. The "Visible" Way: Force the side panel to open on the target tab
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }

    // 3. Handoff the prompt to the side panel
    // We reuse the existing PENDING_OMNIBOX_KEY mechanism so the panel auto-starts when it opens
    await chrome.storage.session.set({ 'pendingOmniboxPrompt': prompt });

    // 4. Cleanup
    await chrome.storage.local.remove(alarm.name);
  }
});
```

## 5. Idle Detection Implementation
For tasks that trigger when the user walks away:

**Changes in `background/index.ts`:**
```typescript
chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === 'idle' || newState === 'locked') {
    // Check storage for registered idle tasks
    const idleTasks = await chrome.storage.local.get('registered_idle_tasks');
    // ... loop through idle tasks and trigger them using the same visible SidePanel open method ...
  }
});
```

## Verification & Testing
- **Unit Tests:** Mock `chrome.alarms` and `chrome.idle` inside `adapters.test.ts` to ensure the adapter correctly passes data.
- **End-to-End Validation:** 
  1. Ask the agent: "Summarize this page in 1 minute."
  2. Close the side panel. Wait 60 seconds.
  3. Observe the side panel automatically sliding open and the agent beginning the summarization task.
