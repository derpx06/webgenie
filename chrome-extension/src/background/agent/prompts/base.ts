import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { defangTags, untrustedInline, wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import { RouteMemory } from '../memory';
import { ensureBrowserObservation, newElements } from '../validation/observation';

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

/**
 * Cuts a long element list to the part around the viewport: from the first on-screen element, growing
 * downward and then upward, with a note of how many lines were left out on each side.
 */
export function windowAroundViewport(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  const firstOnScreen = lines.findIndex(line => /^\t*\*?\[\d+\]/.test(line) && !line.includes('offscreen="true"'));
  let start = Math.max(0, firstOnScreen);
  let end = start;
  let size = Math.min(lines[start].length, maxChars) + 1;
  const fits = (index: number) => size + lines[index].length + 1 <= maxChars;
  for (;;) {
    const down = end + 1 < lines.length && fits(end + 1);
    if (down) size += lines[++end].length + 1;
    const up = start > 0 && fits(start - 1);
    if (up) size += lines[--start].length + 1;
    if (!down && !up) break;
  }
  const parts = lines.slice(start, end + 1);
  parts[0] = parts[0].slice(0, maxChars);
  if (start > 0) parts.unshift(`... ${start} lines above; scroll up to see them ...`);
  if (end < lines.length - 1) parts.push(`... ${lines.length - 1 - end} lines below; scroll down to see them ...`);
  return parts.join('\n');
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

    // A route saved from this task's start page, read once per task.
    if (context.routeNote === undefined) {
      context.routeNote = context.taskStartUrl ? await RouteMemory.note(context.taskStartUrl) : '';
      if (context.routeNote) logger.info(`Route from an earlier task shown for ${context.taskStartUrl}`);
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
      const elementsText = wrapUntrustedContent(
        windowAroundViewport(rawElementsText, MAX_INTERACTIVE_ELEMENTS_CHARS),
        /* filterFirst= */ false,
      );

      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `${stepInfoDescription ? '\n' : ''}Current date and time: ${timeStr}`;

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
        if (result.targetFingerprint?.index !== undefined) {
          actionResultsDescription += `\nFailed/used target index ${i + 1}/${context.actionResults.length}: ${result.targetFingerprint.index}`;
        }
      }
    }

    actionResultsDescription = defangTags(capPromptSection(actionResultsDescription, MAX_ACTION_RESULTS_CHARS, 'action results'));

    // Titles and addresses are written by sites: data, never instructions.
    const currentTab = `{id: ${browserState.tabId}, url: ${defangTags(browserState.url)}, title: ${untrustedInline(browserState.title)}}`;
    const allOtherTabs = browserState.tabs.filter(tab => tab.id !== browserState.tabId);
    const otherTabs = allOtherTabs
      .slice(0, MAX_OTHER_TABS)
      .map(tab => `- {id: ${tab.id}, url: ${defangTags(clip(tab.url, 120))}, title: ${untrustedInline(clip(tab.title, 80))}}`);
    if (allOtherTabs.length > MAX_OTHER_TABS) otherTabs.push(`- ...and ${allOtherTabs.length - MAX_OTHER_TABS} more tabs`);

    // Notes shown above the page: a route from an earlier task, the navigator's memory.
    let reflectionPrefix = context.routeNote ?? '';
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
