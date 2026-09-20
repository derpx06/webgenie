import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { defangTags, untrustedInline, wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import { RouteMemory, SiteSkills } from '../memory';
import { ensureBrowserObservation, inDialog, newElements } from '../validation/observation';
import { OFFSCREEN_LINE, type DOMElementNode } from '../../browser/dom/views';
import * as actionSchemas from '../actions/schemas';

const logger = createLogger('BasePrompt');

const MAX_INTERACTIVE_ELEMENTS_CHARS = 26000;
const MAX_ACTION_RESULTS_CHARS = 16000;
const MAX_REFLECTION_CHARS = 6000;
const MAX_RESULT_CHARS = 12000;
const MAX_OTHER_TABS = 10;

function clip(value: string | undefined, maxChars: number): string {
  return value && value.length > maxChars ? `${value.slice(0, maxChars)}…` : (value ?? '');
}

export function capPromptSection(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const marker = `\n...[${label} truncated to keep the browser context bounded; re-observe or use a narrower action if needed]...\n`;
  if (maxChars <= marker.length + 2) return marker.slice(0, maxChars);
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.72);
  const tailLength = Math.max(0, available - headLength);
  return `${text.slice(0, headLength)}${marker}${tailLength > 0 ? text.slice(-tailLength) : ''}`;
}

const ELEMENT_LINE = /^\t*\*?\[(\d+)\]/;

/**
 * `[n]` dropped from a message when the element list the prompt shows has no such index: an index the model cannot
 * see names whatever element carries that number now, and the navigator refuses it. A live run's covered-click
 * refusal quoted the consent dialog's buttons at indexes the window had cut, and the guard then refused every one.
 */
export function dropUnshownIndexes(text: string, shown: ReadonlySet<number>): string {
  return text.replace(/\[(\d+)\]\s?/g, (match, digits: string) => (shown.has(Number(digits)) ? match : ''));
}

/**
 * Cuts a long element list to the part around the viewport: from the first on-screen element, growing
 * downward and then upward, with a note of how many lines were left out on each side. Lines whose index is in
 * `keepIndexes` (an open dialog's controls) stay in wherever they sit: a layer that blocks every click is the one
 * thing the model must always see, even when it lives in a late iframe at the end of the list.
 */
export function windowAroundViewport(text: string, maxChars: number, keepIndexes?: ReadonlySet<number>): string {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  const kept = new Set<number>();
  let keptChars = 0;
  if (keepIndexes?.size) {
    for (let i = 0; i < lines.length; i++) {
      const index = ELEMENT_LINE.exec(lines[i])?.[1];
      // A dialog with more controls than half the budget would leave no room for the page itself.
      if (index === undefined || !keepIndexes.has(Number(index))) continue;
      if (keptChars + lines[i].length + 1 > maxChars / 2) break;
      kept.add(i);
      keptChars += lines[i].length + 1;
    }
  }
  const firstOnScreen = lines.findIndex(line => ELEMENT_LINE.test(line) && !OFFSCREEN_LINE.test(line));
  let start = Math.max(0, firstOnScreen);
  let end = start;
  let size = Math.min(lines[start].length, maxChars) + 1;
  const budget = maxChars - keptChars;
  const fits = (index: number) => size + lines[index].length + 1 <= budget;
  for (;;) {
    const down = end + 1 < lines.length && fits(end + 1);
    if (down) size += lines[++end].length + 1;
    const up = start > 0 && fits(start - 1);
    if (up) size += lines[--start].length + 1;
    if (!down && !up) break;
  }
  for (let i = start; i <= end; i++) kept.add(i);
  const parts: string[] = [];
  let previous = -1;
  for (const i of [...kept].sort((a, b) => a - b)) {
    const gap = i - previous - 1;
    if (gap > 0) {
      parts.push(i <= start ? `... ${gap} lines above; scroll up to see them ...` : `... ${gap} lines below; scroll down to see them ...`);
    }
    parts.push(previous === -1 ? lines[i].slice(0, maxChars) : lines[i]);
    previous = i;
  }
  if (previous < lines.length - 1) parts.push(`... ${lines.length - 1 - previous} lines below; scroll down to see them ...`);
  return parts.join('\n');
}

/** Whether the element list the models see is cut to a window around the viewport (a long page's list). */
export function elementsWindowed(state: { elementTree: { clickableElementsToString(include: string[]): string } }, includeAttributes: string[]): boolean {
  return state.elementTree.clickableElementsToString(includeAttributes).length > MAX_INTERACTIVE_ELEMENTS_CHARS;
}

const MAX_COLLAPSED_LISTED = 15;

/**
 * Lines shown above the element list: collapsed sections and popup controls by index and name, and a count of form
 * controls. A live run scrolled 8-21 times for filters that sat inside collapsed sections or were already listed.
 */
export function controlSummary(elements: Iterable<DOMElementNode>): string {
  const collapsed: string[] = [];
  let collapsedCount = 0;
  const counts = { checkbox: 0, checked: 0, radio: 0, selected: 0, select: 0, slider: 0 };
  for (const node of elements) {
    const { attributes: a } = node;
    const role = a.role ?? '';
    const type = (a.type ?? '').toLowerCase();
    const on = a['aria-checked'] === 'true' || a.checked === 'true';
    // Fields and native selects with a popup (autocomplete, options) are not sections; selects are counted below.
    const field = ['input', 'select', 'textarea'].includes(node.tagName ?? '');
    if (!field && (a['aria-expanded'] === 'false' || (a['aria-haspopup'] && a['aria-haspopup'] !== 'false' && a['aria-expanded'] !== 'true'))) {
      collapsedCount++;
      const name = (a['aria-label'] || node.getAllTextTillNextClickableElement()).replace(/\s+/g, ' ').trim();
      if (collapsed.length < MAX_COLLAPSED_LISTED) collapsed.push(`[${node.highlightIndex}] ${clip(name, 40) || node.tagName}`);
    }
    if (role === 'checkbox' || role === 'switch' || type === 'checkbox') {
      counts.checkbox++;
      if (on) counts.checked++;
    } else if (role === 'radio' || type === 'radio') {
      counts.radio++;
      if (on) counts.selected++;
    } else if (node.tagName === 'select') {
      counts.select++;
    } else if (role === 'slider' || type === 'range') {
      counts.slider++;
    }
  }
  const lines: string[] = [];
  if (collapsed.length > 0) {
    const more = collapsedCount > collapsed.length ? ` and ${collapsedCount - collapsed.length} more` : '';
    lines.push(`Collapsed sections: ${collapsed.join(', ')}${more}`);
  }
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : noun.endsWith('x') ? 'es' : 's'}`;
  const controls = [
    counts.checkbox && `${count(counts.checkbox, 'checkbox')} (${counts.checked} checked)`,
    counts.radio && `${count(counts.radio, 'radio button')} (${counts.selected} selected)`,
    counts.select && count(counts.select, 'select'),
    counts.slider && count(counts.slider, 'slider'),
  ].filter(Boolean);
  if (controls.length > 0) lines.push(`Controls: ${controls.join(', ')}`);
  return lines.map(line => `${line}\n`).join('');
}

const TOOL_NAMES = Object.values(actionSchemas).flatMap(value =>
  typeof value === 'object' && value !== null && 'name' in value && 'schema' in value ? [String(value.name)] : [],
);

/**
 * The prompt for the tools this task has, so it never offers one that is missing (with web search removed, the planner
 * kept planning searches and the navigator asked the user for the tool): a sentence naming an unregistered tool is left
 * out, and a sentence starting with [[without tool_name]] is kept only when that tool is missing.
 */
export function forTools(prompt: string, tools: ReadonlySet<string>): string {
  const absent = TOOL_NAMES.filter(name => !tools.has(name));
  const namesAbsent = new RegExp(`\\b(${absent.join('|')})\\b`);
  return prompt
    .split('\n')
    .flatMap(line => {
      const [, item, body] = /^(\s*(?:-\s+|\d+\.\s+)?)(.*)$/.exec(line)!;
      const kept = body.split(/(?<=\.)\s+(?=[A-Z[])/).flatMap(sentence => {
        const marker = /^\[\[without (\w+)\]\]\s*/.exec(sentence);
        if (marker) return tools.has(marker[1]) ? [] : [sentence.slice(marker[0].length)];
        return absent.length > 0 && namesAbsent.test(sentence) ? [] : [sentence];
      });
      // A line whose every sentence was left out goes too.
      return body !== '' && kept.length === 0 ? [] : [item + kept.join(' ')];
    })
    .join('\n');
}

/**
 * A tab worth no tokens in the tab list: the empty tab a new window opens with, and the agent's own side panel and
 * options pages. Two of the three tabs a live run listed on every call were these, for 4 664 tokens a task, and
 * neither can be switched to or read.
 */
export function deadTab(url: string | undefined): boolean {
  const address = (url ?? '').trim();
  return address === '' || address === 'about:blank' || address.startsWith('chrome-extension://');
}

export function scrollViewportPercentage(scrollHeight: number, viewportHeight: number): number | null {
  const scrollableDistance = scrollHeight - viewportHeight;
  if (!Number.isFinite(scrollableDistance) || scrollableDistance <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((viewportHeight / scrollableDistance) * 100)));
}

/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns SystemMessage from LangChain
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns HumanMessage from LangChain
   */
  abstract getUserMessage(context: AgentContext): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<HumanMessage> {
    // The last read if still current: an action's settle read is usually exactly the page to show.
    // A screenshot only when it can help: the model asked for one (view_screenshot) or the task is stuck.
    const withScreenshot = context.options.useVision && context.screenshotWanted;
    context.screenshotWanted = false;
    const browserState = await context.browserContext.getCachedState(withScreenshot);
    if (withScreenshot) {
      record({ level: 'info', kind: 'span', component: 'Prompt', msg: 'screenshot attached', data: { taken: Boolean(browserState.screenshot), chars: browserState.screenshot?.length ?? 0 } });
    }

    const observation = ensureBrowserObservation(browserState);
    context.activeObservation = observation;
    // Elements that were not on the page the models saw last step are marked *[index]: what an action just revealed.
    const fresh = new Set(newElements(context.promptState, browserState));
    for (const node of browserState.selectorMap.values()) node.isNew = fresh.has(node);
    context.promptState = browserState;
    context.promptIndexes = new Set();

    // A route saved from this task's start page, read once per task.
    if (context.routeNote === undefined) {
      context.routeNote = context.taskStartUrl ? await RouteMemory.note(context.taskStartUrl) : '';
      if (context.routeNote) logger.info(`Route from an earlier task shown for ${context.taskStartUrl}`);
    }
    // And what earlier successful tasks learned about this domain, read once per task.
    if (context.siteSkillNote === undefined) {
      context.siteSkillNote = context.taskStartUrl ? await SiteSkills.note(context.taskStartUrl) : '';
      if (context.siteSkillNote) logger.info(`Site skill shown for ${context.taskStartUrl}`);
    }

    const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

    // ── DOM SNAPSHOT LOGGING ──────────────────────────────────────────────────
    // When the "Log DOM Snapshot" developer option is enabled, dump the full
    // serialised DOM the LLM is about to receive to the background console.
    // Open chrome://extensions → Service Worker → Inspect to view the output.
    if (context.options.logDOMSnapshot) {
      const ts = new Date().toISOString();
      console.group(`%c[DOM Snapshot @ ${ts}] URL: ${browserState.url}`, 'color: #818cf8; font-weight: bold;');
      console.log('%c--- Interactive elements sent to LLM ---', 'color: #34d399;');
      console.log(rawElementsText || '(empty page — no interactive elements)');
      console.log('%c--- selectorMap keys (highlight indices) ---', 'color: #fbbf24;');
      console.log([...browserState.selectorMap.keys()].join(', ') || '(none)');
      console.groupEnd();
    }
    // ─────────────────────────────────────────────────────────────────────────

    let formattedElementsText = '';
    if (rawElementsText !== '') {
      const scrollPercentage = scrollViewportPercentage(browserState.scrollHeight, browserState.visualViewportHeight);
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, page height: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${scrollPercentage === null ? 'not scrollable' : `${scrollPercentage}%`}\n`;
      logger.info(scrollInfo);

      // Use non-strict mode: strict would redact email addresses and credential-
      // shaped text found in page content (e.g. Gmail To: field, WhatsApp chat).
      // The `nano_untrusted_content` wrapper + system prompt already tell the LLM
      // to ignore injections — strict pattern-matching here causes more harm than good.
      // An open dialog's controls are always in the window, wherever they sit: a live run's consent modal lived in a
      // late iframe, fell outside the viewport window from the first step on, and blocked every click for 12 steps.
      const dialogIndexes = new Set([...browserState.selectorMap].filter(([, node]) => inDialog(node)).map(([index]) => index));
      const shownElements =
        controlSummary(browserState.selectorMap.values()) + windowAroundViewport(rawElementsText, MAX_INTERACTIVE_ELEMENTS_CHARS, dialogIndexes);
      context.promptIndexes = new Set([...shownElements.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])));
      const elementsText = wrapUntrustedContent(shownElements, /* filterFirst= */ false);

      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else if (browserState.unreadable) {
      formattedElementsText =
        'The page could not be read in time (it is very large or still busy); it is not empty. Read it again with wait_for, or read its text with read_page, before leaving it.';
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${capPromptSection(result.extractedContent, MAX_RESULT_CHARS, 'action result')}`;
        }
        if (result.error) {
          // only use last line of error
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
        if (result.failureReason) {
          actionResultsDescription += `\nAction failure ${i + 1}/${context.actionResults.length}: ${capPromptSection(result.failureReason, 2000, 'action failure')}`;
        }
        if (result.retryability && result.retryability !== 'none') {
          actionResultsDescription += `\nAction retry policy ${i + 1}/${context.actionResults.length}: ${result.retryability}`;
        }
        if (result.targetFingerprint?.index !== undefined && context.promptIndexes?.has(result.targetFingerprint.index)) {
          actionResultsDescription += `\nFailed/used target index ${i + 1}/${context.actionResults.length}: ${result.targetFingerprint.index}`;
        }
      }
    }

    // Indexes are only meaningful against the list above: what it does not show is dropped from these messages.
    actionResultsDescription = defangTags(
      capPromptSection(dropUnshownIndexes(actionResultsDescription, context.promptIndexes ?? new Set()), MAX_ACTION_RESULTS_CHARS, 'action results'),
    );

    // Titles and addresses are written by sites: data, never instructions.
    const currentTab = `{id: ${browserState.tabId}, url: ${defangTags(browserState.url)}, title: ${untrustedInline(browserState.title)}}`;
    const allOtherTabs = browserState.tabs.filter(tab => tab.id !== browserState.tabId && !deadTab(tab.url));
    const otherTabs = allOtherTabs
      .slice(0, MAX_OTHER_TABS)
      .map(tab => `- {id: ${tab.id}, url: ${defangTags(clip(tab.url, 120))}, title: ${untrustedInline(clip(tab.title, 80))}}`);
    if (allOtherTabs.length > MAX_OTHER_TABS) otherTabs.push(`- ...and ${allOtherTabs.length - MAX_OTHER_TABS} more tabs`);

    // Notes shown above the page: a route from an earlier task, the navigator's memory.
    let reflectionPrefix = `${context.siteSkillNote ?? ''}${context.routeNote ?? ''}`;
    const durableMemory = context.messageManager.getWorkingMemory();
    if (durableMemory) {
      reflectionPrefix += `[Agent memory]: ${durableMemory}\n`;
    }
    if (reflectionPrefix) {
      // Model notes can quote page text.
      reflectionPrefix = `${defangTags(capPromptSection(reflectionPrefix, MAX_REFLECTION_CHARS, 'agent memory'))}\n`;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const dialog = browserState.dialog;
    const dialogNotice = dialog
      ? `JavaScript ${dialog.type} dialog open, written by the page: ${untrustedInline(clip(dialog.message, 500))}${dialog.defaultValue ? ` (default text: ${untrustedInline(clip(dialog.defaultValue, 100))})` : ''} — call handle_dialog before anything else.\n`
      : '';

    const stateDescription = `${reflectionPrefix}[Current browser state]
Current tab: ${currentTab}
Other open tabs:
${otherTabs.join('\n') || '(none)'}
${dialogNotice}Interactive elements of the current page (offscreen elements are marked; links on the current site show their path, so the full address is the current tab's origin plus that path):
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription ? `Results of your last actions:${actionResultsDescription}` : ''}`.trim();

    if (withScreenshot && browserState.screenshot) {
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }
}

export { BasePrompt };
