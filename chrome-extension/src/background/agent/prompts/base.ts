import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { ContextRouter } from '../memory';
import { ensureBrowserObservation, fingerprintFailureKey } from '../validation/observation';

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
    const browserState = await context.browserContext.getState(context.options.useVision);

    // Compute page-path and layout fingerprint
    // The URL is passed so the fingerprint is page-path-scoped (not just domain).
    let layoutHash = '';
    let domain = '';
    let pagePath = '/';
    
    let isValidUrl = false;
    if (browserState.url) {
      try {
        new URL(browserState.url);
        isValidUrl = true;
      } catch {
        isValidUrl = false;
      }
    }

    if (isValidUrl) {
      try {
        domain = new URL(browserState.url).hostname;
        pagePath = ContextRouter.getPagePath(browserState.url);
        layoutHash = await ContextRouter.computeLayoutFingerprint(browserState, browserState.url);
        context.activeLayoutHash = layoutHash;
        logger.info(`Layout fingerprint: ${layoutHash} | domain: ${domain} | path: ${pagePath}`);
      } catch (err) {
        logger.error('Failed to compute layout fingerprint:', err);
      }
    } else {
      logger.warning(`Invalid or empty URL: "${browserState.url || ''}". Skipping layout fingerprinting.`);
    }

    // Apply goal-based DOM attention masking (unchanged)
    try {
      ContextRouter.applyAttentionMask(browserState, context.lastGoal);
    } catch (err) {
      logger.error('Failed to apply DOM attention mask:', err);
    }

    const observation = ensureBrowserObservation(browserState);
    context.activeObservation = observation;

    // JIT Selector Hint Recall — pagePath-scoped (no cross-page pollution)
    let memoryHints = '';
    if (layoutHash && domain) {
      try {
        memoryHints = await ContextRouter.getSelectorHints(domain, pagePath, layoutHash);
      } catch (err) {
        logger.error('Failed to load selector hints:', err);
      }
    }

    // JIT Episodic Context Recall — intent-matched top-2 past sessions for this domain
    let episodicContext = '';
    if (domain) {
      try {
        episodicContext = await ContextRouter.getEpisodicContext(
          domain,
          context.lastGoal,  // intent-matched scoring
          pagePath,
        );
      } catch (err) {
        logger.error('Failed to load episodic context:', err);
      }
    }

    // Domain session priming — for known domains, inject a briefing block
    let domainPrime = '';
    if (domain) {
      try {
        domainPrime = await ContextRouter.primeDomainContext(domain);
      } catch (err) {
        logger.error('Failed to load domain prime:', err);
      }
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
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${scrollPercentage === null ? 'not scrollable' : `${scrollPercentage}%`}\n`;
      logger.info(scrollInfo);

      // ── FAILURE REGISTRY — annotate blocked elements ─────────────────────────
      // Walk each line of the serialised element tree. Lines that start with
      // an index marker like "[42]" are checked against the FailureRegistry.
      // Blocked elements (failCount ≥ FAILURE_THRESHOLD) receive a visible
      // ⛔ [BLOCKED] prefix so the LLM knows to avoid them and find another path.
      const currentUrl = browserState.url;
      const annotatedLines = rawElementsText.split('\n').map(line => {
        // Match lines that begin with an element index, e.g. "[42] button ..."
        const indexMatch = line.match(/^\[(\d+)\]/);
        if (!indexMatch) return line;

        const index = parseInt(indexMatch[1], 10);
        const domElement = browserState.selectorMap.get(index);
        if (!domElement) return line;

        const target = observation.targets.find(candidate => candidate.index === index);
        const selector = fingerprintFailureKey(target, currentUrl);

        if (context.isSelectorBlocked(selector, currentUrl)) {
          return `⛔ [BLOCKED - repeated no-op] ${line}`;
        }
        return line;
      });
      const annotatedText = annotatedLines.join('\n');
      // ─────────────────────────────────────────────────────────────────

      // Use non-strict mode: strict would redact email addresses and credential-
      // shaped text found in page content (e.g. Gmail To: field, WhatsApp chat).
      // The `nano_untrusted_content` wrapper + system prompt already tell the LLM
      // to ignore injections — strict pattern-matching here causes more harm than good.
      const elementsText = wrapUntrustedContent(
        capPromptSection(annotatedText, MAX_INTERACTIVE_ELEMENTS_CHARS, 'interactive DOM'),
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

    actionResultsDescription = capPromptSection(actionResultsDescription, MAX_ACTION_RESULTS_CHARS, 'action results');

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const allOtherTabs = browserState.tabs.filter(tab => tab.id !== browserState.tabId);
    const otherTabs = allOtherTabs
      .slice(0, MAX_OTHER_TABS)
      .map(tab => `- {id: ${tab.id}, url: ${clip(tab.url, 120)}, title: ${clip(tab.title, 80)}}`);
    if (allOtherTabs.length > MAX_OTHER_TABS) otherTabs.push(`- ...and ${allOtherTabs.length - MAX_OTHER_TABS} more tabs`);

    // Notes shown above the page: domain briefing, the navigator's memory, past sessions, selector hints.
    let reflectionPrefix = '';
    if (domainPrime) {
      reflectionPrefix += domainPrime;
    }
    const durableMemory = context.messageManager.getWorkingMemory();
    if (durableMemory) {
      reflectionPrefix += `[Agent memory]: ${durableMemory}\n`;
    }
    if (episodicContext) {
      reflectionPrefix += episodicContext;
    }
    if (memoryHints) {
      reflectionPrefix += memoryHints;
    }
    if (reflectionPrefix) {
      reflectionPrefix = `${capPromptSection(reflectionPrefix, MAX_REFLECTION_CHARS, 'agent memory')}\n`;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const stateDescription = `${reflectionPrefix}[Current browser state]
Current tab: ${currentTab}
Other open tabs:
${otherTabs.join('\n') || '(none)'}
Interactive elements of the current page (offscreen elements are marked):
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription ? `Results of your last actions:${actionResultsDescription}` : ''}`.trim();

    if (browserState.screenshot && context.options.useVision) {
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
