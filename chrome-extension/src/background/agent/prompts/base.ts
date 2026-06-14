import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { ContextRouter } from '../memory';

const logger = createLogger('BasePrompt');
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
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((browserState.visualViewportHeight / (browserState.scrollHeight - browserState.visualViewportHeight)) * 100)}%\n`;
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

        // Build the same selector key the registry uses
        const selector = domElement.attributes?.['data-webgenie-id'] ??
                         domElement.tagName ??
                         String(index);

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
      const elementsText = wrapUntrustedContent(annotatedText, /* filterFirst= */ false);

      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${result.extractedContent}`;
        }
        if (result.error) {
          // only use last line of error
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
      }
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);

    // ── SELF-REFLECTION + MEMORY INJECTION ───────────────────────────────────
    // Injection order (priority high → low):
    //   1. [Domain Intelligence] — orient fast on known sites
    //   2. [Previous goal evaluation] — self-grade of last action
    //   3. [Agent memory] — durable working scratchpad (never compacted)
    //   4. [Past Sessions] — intent-matched proven routes
    //   5. [Selector Memory] — 💡 FAST PATH verified selectors
    //
    // The working memory is read from the MessageManager's durable scratchpad
    // (separate session-storage key, survives service worker restarts) rather
    // than context.lastMemory which is only set when the LLM explicitly outputs it.
    // Research ref: browser_agent_research_pt2.md §Working Memory, A-MEM §3.2.
    let reflectionPrefix = '';
    if (domainPrime) {
      reflectionPrefix += domainPrime;
    }
    if (context.lastEvaluation) {
      reflectionPrefix += `[Previous goal evaluation]: ${context.lastEvaluation}\n`;
    }
    const durableMemory = context.messageManager.getWorkingMemory();
    if (durableMemory) {
      reflectionPrefix += `[Agent memory]: ${durableMemory}\n`;
    } else if (context.lastMemory) {
      // Fallback to lastMemory for backward compatibility on first step
      reflectionPrefix += `[Agent memory]: ${context.lastMemory}\n`;
    }
    if (episodicContext) {
      reflectionPrefix += episodicContext;
    }
    if (memoryHints) {
      reflectionPrefix += memoryHints;
    }
    if (reflectionPrefix) {
      reflectionPrefix += '\n';
    }
    // ─────────────────────────────────────────────────────────────────────────

    const stateDescription = `
${reflectionPrefix}[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from the current page (with offscreen markers for out-of-viewport elements):
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription}
`;

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
