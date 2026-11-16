# Chrome Web Store listing — WebGenie 1.0.0

Everything the dashboard asks for, in the order it asks. Claims are limited to what the extension does and was measured to do:
it works while you watch, asks before account changes, and hands back purchases. No autonomy claim, no accuracy figure, and
never the word "safe".

## Store listing

**Name:** WebGenie

**Summary (132 characters max):** An AI assistant that works in your browser while you watch. It asks before it changes anything.

**Description**

WebGenie is a side-panel assistant that carries out a task in your browser while you watch: open a site, read a page, fill a
form, move through a few pages, bring back what it found. You use your own AI model key. There is no WebGenie server, and
nothing you do is sent to us.

What it does
• Reads and works on the pages you point it at, in tabs it opens for the task or the one you are on.
• Shows what it is doing on the page, and you can pause, stop or take over at any time.
• Asks you before it changes an account, for example subscribing.
• Never makes a purchase, a payment or an account. It takes the task to the checkout or sign-up page and hands the browser
  back to you. It does not type card, security-code or bank details, even ones you give it.
• Keeps an unfinished task so you can resume it after closing the panel or the browser.

What it sends, and to whom
The page the agent is working on and your task go to the AI provider you configure (Google, OpenAI, Anthropic or another), using
your key. If the agent searches the web, the search words go to DuckDuckGo or Google. Usage reports are off unless you turn
them on. A notice before your first task says all of this. The full policy is linked below.

Your responsibility
You remain responsible for all actions taken in your browser on your behalf. AI models make mistakes and web pages can try to
mislead them. The risk is not zero: watch what it does, and use a separate browser profile for sensitive accounts.

**Category:** Productivity  **Language:** English

## Privacy practices

**Single purpose:** Carry out tasks the user describes in their browser, under their supervision, using an AI model the user
configures.

**Data collected (declare):** Website content (page text and structure, sent to the user's chosen AI provider); User activity
(the task text and the user's answers, same destination). Nothing is sent to the developer.

**Certifications:** data is not sold; not used for purposes unrelated to the single purpose; not used for creditworthiness or
lending.

**Privacy policy URL:** https://github.com/derpx06/webgenie/blob/main/PRIVACY.md  *(resolves only after the repository's `main` is pushed)*

## Permission justifications (one sentence each)

| Permission | Justification |
| --- | --- |
| Host access `<all_urls>` | The task is the user's, and so is the site: the agent works on whichever site the user points it at, so no fixed list can cover it. |
| `debugger` | Reads a page's structure and performs clicks and typing the way DevTools does; Chrome shows its banner while it is attached. |
| `tabs`, `tabGroups`, `webNavigation` | Opens, switches between and groups the tabs a task uses, and notices when a page finishes navigating. |
| `scripting` | Reads the text of a tab the user mentions and runs small helpers that measure or read a page. |
| `storage`, `unlimitedStorage` | Keeps settings, chat history and unfinished tasks on the user's device. |
| `downloads` | Tells the agent which files a page saved during a task and reads a file it downloaded for the user. |
| `offscreen` | Keeps the extension alive through a model call that runs longer than 30 seconds. |
| `contextMenus` | The right-click shortcut that asks WebGenie about the current page. |
| `sidePanel` | The panel the user talks to it in. |
| Optional: `bookmarks`, `readingList`, `history`, `browsingData`, `sessions`, `management`, `system.cpu`, `system.memory` | Requested only when the user turns on the browser-data tools in Options, and handed back when they turn them off. |

**Remote code:** none. All code ships in the package; the extension makes no remote-code requests.

## Assets

Produced from the real screens, 1280×800, in `store-assets/` (not committed; regenerate from a build): the first-run notice,
the ready-for-a-task screen and the options page. Still to capture, because they only exist during a live task: a task
running with the on-page cursor and goal chip, the hand-back at a checkout, and the confirmation before a subscription.
Small promo tile 440×280 not yet made.

## Needs the owner

Developer account and fee, 2-step verification, trader/non-trader declaration, support email, and pushing `main` so the
privacy link resolves. Submission itself is the owner's click.
