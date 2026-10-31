# WebGenie privacy policy

WebGenie is a browser extension that works in your browser while you watch. This page says what it does with your data,
including the parts you might not expect. It describes the extension as shipped; if that changes, this page changes with it.

**The short version.** WebGenie has no server. Nothing you do goes to us. The page the agent is working on goes to the AI
model provider **you** choose, using **your** API key. Everything else it keeps stays in your browser.

## What leaves your computer

| What | Where it goes | When | Can you stop it? |
| --- | --- | --- | --- |
| The page the agent is working on: its text and structure, the address and title of the tabs it is working in, and a screenshot only if you turned vision on | The model provider you configured (Google, OpenAI, Anthropic, or another), using your own API key | Every step of a task | Yes: do not run a task. WebGenie cannot run without a model |
| Your task, your follow-ups and your answers to its questions | The same model provider | During a task | Same |
| The site names of your other open tabs (not their addresses or titles) | The same model provider, so the agent can tell you have a tab open on a site | During a task | Same |
| Web searches the agent makes for you | DuckDuckGo, or Google if the agent chooses it. The search words come from your task | When the agent searches | Yes: block the search engines in Options, and the agent will not search |
| Microphone recordings | The browser's own speech recognition (in Chrome, Google) or, if you have a Gemini model configured, that provider | Only if you press the microphone button | Yes: do not use it |
| A small usage report: a random task number, how long it took, a broad error category, and the website name of each site the agent opens, under a random ID made on your device | PostHog | **Only if you turn on usage reports in Options. It is off by default** | Yes: it is off until you turn it on |
| Detailed traces of a task, if you configured LangSmith tracing | LangSmith, with your key | **Only if you turn it on in Developer Options. It is off by default** | Yes |

The usage report never contains what you asked the agent to do, anything on a page, the full address of a page, your
answers, or your API keys.

WebGenie does not sell data, show ads, or build profiles. No person at WebGenie reads your tasks or pages, because they never
reach us.

## What stays on your computer

- **API keys.** Stored in the browser's extension storage on this device, in the clear, as extensions normally store them.
  They are sent only to the provider they belong to.
- **Chat history and the progress of unfinished tasks.** So a task can resume after the browser or the panel is closed.
- **Routes it learned.** The shape of paths that worked on a site, such as which kind of control led where. Never what you typed.
- **Traces.** A log of what the agent did, kept only if you turn on developer tracing. Keys are removed from it.

All of this is cleared from Options. Uninstalling the extension removes it.

Passwords you give the agent are replaced by a placeholder before the model sees anything, and are typed only into a password
field on the same site you gave them for.

## What the agent will and will not do

It acts on pages you point it at, in front of you. It stops and asks before changes to an account such as subscribing. It does
not place orders, make payments, open accounts or type card details: it takes a task to that point and hands the browser back
to you. Page content is treated as data, not as instructions, but no defense against a hostile page is perfect. Review what it
does, and use a separate browser profile for sensitive accounts.

## Why each permission is asked for

| Permission | Why |
| --- | --- |
| Access to all sites | The agent works on whichever site you are on. It is not limited to a list because the task is yours |
| `debugger` | To read a page's structure and to click and type, the way DevTools does. Chrome shows a banner while it is in use |
| `tabs`, `tabGroups`, `webNavigation` | To open, switch between and group the tabs a task uses, and to notice navigation |
| `scripting` | To read the text of a tab you @-mention, and to run the small helpers the agent uses to read or measure a page |
| `storage`, `unlimitedStorage` | To keep settings, history and unfinished tasks on your device |
| `downloads` | To tell the agent which files a page saved during a task, and to read a file it downloaded for you |
| `offscreen` | To keep the extension running through a long model call |
| `contextMenus` | The right-click shortcut to ask WebGenie about a page |
| `sidePanel` | The panel you talk to it in |

These are requested only if you turn on the browser-data tools in Options: bookmarks, reading list, history,
browsing data, sessions, extension management and system information. They are off by default, Chrome asks you when you turn
them on, and they are handed back when you turn them off.

## Contact and changes

Questions and reports: https://github.com/derpx06/webgenie/issues

This policy is versioned with the extension. The date of the last change is in the repository history.
