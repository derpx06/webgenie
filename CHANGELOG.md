# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0]

WebGenie works in your browser while you watch. This is the first release meant for the Chrome Web Store, and it is
described by what it does and does not do rather than by a score: no accuracy figure is claimed.

### Changed: what the agent will and will not do
- It no longer places orders, makes payments, opens accounts or types card, CVC or bank details, including details you gave
  it. It takes a task to the decision and hands the browser back. Subscriptions and other account changes are still asked
  about first.
- Checkout pages are recognised as a whole (a payment processor's frame, an iframe granted the Payment Request API, or a
  checkout address) rather than by finding a card field, which hosted checkouts keep in a frame the page cannot read.
- The first time you use it, a notice says what is sent and to whom. The agent does not start until you accept it.

### Fixed: safety
- The confirmation dialog no longer quotes an amount. It was read from page text, where a hidden `$0.00` could set it.
- The check that asks "did the user want this address opened?" no longer sees page-supplied addresses, and a link on the page
  no longer counts as the user's permission. Addresses carrying a query string must match exactly.
- Commit wording is no longer overridden by markup (`<a href>`, `aria-expanded`), which the page controls.
- A commit approval is never restored after a restart, so a spent yes cannot be used twice.
- Provider error messages no longer echo API keys into the chat.
- The agent no longer sends the addresses and titles of the tabs you did not open it in. They are reduced to site names.
- The content filter no longer rewrites numbers and ordinary words in your own task.
- Only this extension's own pages can talk to its background worker, and the diagnostic message handlers no longer answer in
  a published build.
- A managed browser that blocks debugger access now says so, naming the policy, instead of suggesting DevTools is open.

### Fixed: reliability
- `extract` repairs the broken schemas models write (11 distinct broken schemas found in saved runs) instead of failing; when it
  cannot, it returns the page.
- A model that repeats one move at a changing element index is now stopped, and a refused action makes the planner replan at
  once rather than after a second refusal.
- The agent re-reads the page before accepting that a task is finished.
- The keep-alive document no longer stays open after the worker restarts.
- A failed read of saved task state is no longer reported as "no saved task".
- Saving a model provider now assigns a model to both roles. Before, a new user could not run a task.
- After a provider rejects tool calls, the rest of that provider's settings (timeouts, hedging) are kept.
- The default of 100 mission steps was outside the control that sets it; the default is 50 and the control goes to 100.
- The side panel keeps a task's events in the conversation it started in, clears the last screenshot when you change
  conversation, and shows a message instead of a blank pane if it fails to draw.

### Added
- Working across several tabs: the tabs the task opened are tracked and shown in full, a wrong tab id is answered with the
  list of open ones, and a switch says which page it landed on.
- A side panel that says whether a task is running, waiting for you or paused, and why.
- A privacy policy (`PRIVACY.md`).

### Changed: permissions and package
- Install-time permissions go from 20 to 11. Bookmarks, reading list, history, browsing data, sessions, extension
  management and system information are requested when you turn the browser-data tools on, and returned when you turn them
  off. `activeTab` and `alarms` are removed.
- `web_accessible_resources` is removed: it exposed the extension's scripts to every website.
- Icons are square at 16, 32, 48 and 128, the package is 4.1 MB instead of 9.1 MB, and the minimum Chrome version is 120.
- Usage reports are off by default, and the text describing them now says what they contain.

### Previously unreleased

### Added
- Redesigned `AgentSight` live screen preview component to be a neat, floating circular button/icon that smoothly morphs/expands to a detailed viewport modal on click.

### Changed
- Removed the large, non-interactive `AgentSight` and `TabOrchestrator` layouts from blocking/cluttering the header and messages in the active chat view.
- Enabled SOTA Accessibility Tree (`axtree`) perception mode as the default browser perception mode to reduce DOM serialization payload size by 60-80%.
- Bypassed heavy page load and network-idle wait periods during sequential actions in single-turn batches using a new `skipNetworkIdle` parameter.
- Reduced the default inter-action delay from 500ms to 150ms and adjusted default page load timings for faster execution.
