/**
 * BuiltInAITools — Chrome Built-in AI API integration toolkit (Gemini Nano)
 *
 * Wraps Chrome 138+ on-device AI capabilities. Runs entirely locally —
 * zero API cost, zero latency, zero data leaves the device.
 *
 * APIs covered:
 *   - Prompt API      (LanguageModel) — general-purpose reasoning/NLP
 *   - Summarizer API  — condense long page content before LLM injection
 *   - Translator API  — translate non-English pages to English
 *   - LanguageDetector — detect page language for routing
 *   - Writer API      — generate text content for form fields
 *   - Rewriter API    — refine/rephrase extracted content
 *
 * Permission required: None — built into Chrome 138+.
 * Check availability with isBuiltInAIAvailable() before using.
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 *
 * Agent integration use-cases:
 *   - Summarize extracted page content before putting it in LLM context (saves tokens)
 *   - Detect and translate non-English pages automatically
 *   - Compact agent step history locally (Phase 5 memory pyramid)
 *   - Generate form fill content (email body, descriptions)
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('BuiltInAI');

// ── Availability Check ────────────────────────────────────────────────────────

export interface AIAvailability {
  promptAPI: boolean;
  summarizerAPI: boolean;
  translatorAPI: boolean;
  languageDetectorAPI: boolean;
  writerAPI: boolean;
  rewriterAPI: boolean;
}

/**
 * Check which Chrome built-in AI APIs are available in the current browser.
 * Call this before any AI operation — these APIs require Chrome 138+ and
 * sufficient hardware (RAM, GPU).
 */
export async function checkBuiltInAIAvailability(): Promise<AIAvailability> {
  const w = self as unknown as Record<string, unknown>;
  const availability: AIAvailability = {
    promptAPI: 'LanguageModel' in w || 'ai' in w,
    summarizerAPI: 'Summarizer' in w || ('ai' in w && typeof (w.ai as Record<string, unknown>)?.summarizer !== 'undefined'),
    translatorAPI: 'Translator' in w || ('ai' in w && typeof (w.ai as Record<string, unknown>)?.translator !== 'undefined'),
    languageDetectorAPI: 'LanguageDetector' in w || ('ai' in w && typeof (w.ai as Record<string, unknown>)?.languageDetector !== 'undefined'),
    writerAPI: 'Writer' in w || ('ai' in w && typeof (w.ai as Record<string, unknown>)?.writer !== 'undefined'),
    rewriterAPI: 'Rewriter' in w || ('ai' in w && typeof (w.ai as Record<string, unknown>)?.rewriter !== 'undefined'),
  };

  logger.info('[BuiltInAI] Availability:', availability);
  return availability;
}

export async function isBuiltInAIAvailable(): Promise<boolean> {
  const avail = await checkBuiltInAIAvailability();
  return Object.values(avail).some(v => v);
}

// ── Prompt API (LanguageModel) ────────────────────────────────────────────────

/**
 * Run a one-shot prompt through the local Gemini Nano model.
 * Ideal for: step summarization, content classification, data extraction.
 *
 * @returns Generated text, or null if the API is unavailable.
 */
export async function promptLocalAI(
  prompt: string,
  systemPrompt = 'You are a helpful AI assistant running inside a browser agent.',
): Promise<string | null> {
  const w = self as unknown as Record<string, unknown>;

  // Try new `LanguageModel` API (Chrome 138+)
  if ('LanguageModel' in w) {
    try {
      const session = await (w.LanguageModel as {
        create: (opts: { systemPrompt: string }) => Promise<{ prompt: (p: string) => Promise<string> }>;
      }).create({ systemPrompt });
      const result = await session.prompt(prompt);
      logger.debug(`[BuiltInAI] Prompt API response (${result.length} chars)`);
      return result;
    } catch (err) {
      logger.warning('[BuiltInAI] LanguageModel failed:', err);
    }
  }

  // Fallback: chrome.aiOriginTrial (older Chrome versions)
  if ('chrome' in w && typeof (w.chrome as Record<string, unknown>).aiOriginTrial !== 'undefined') {
    try {
      const ai = (w.chrome as Record<string, unknown>).aiOriginTrial as {
        languageModel: {
          create: (opts: { systemPrompt: string }) => Promise<{ prompt: (p: string) => Promise<string> }>;
        };
      };
      const session = await ai.languageModel.create({ systemPrompt });
      return await session.prompt(prompt);
    } catch (err) {
      logger.warning('[BuiltInAI] aiOriginTrial failed:', err);
    }
  }

  logger.warning('[BuiltInAI] Prompt API not available in this Chrome version');
  return null;
}

/**
 * Compact a list of agent step descriptions into a concise summary.
 * Uses on-device AI — zero cost, instant.
 * Falls back to simple join if AI is unavailable.
 *
 * Agent use-case: Phase 5 memory pyramid compaction.
 */
export async function compactStepsLocally(steps: string[]): Promise<string> {
  if (!steps.length) return '';

  const result = await promptLocalAI(
    `Compress these browser agent trace steps into a 2-3 sentence summary. Keep all URLs, element names, and extracted values verbatim:\n\n${steps.join('\n')}`,
    'You are a browser automation trace compactor. Output concise summaries preserving key facts.',
  );

  if (result) {
    logger.info(`[BuiltInAI] Compacted ${steps.length} steps into ${result.length} chars`);
    return result;
  }

  // Fallback: truncated join
  return steps.slice(-5).join(' → ');
}

// ── Summarizer API ────────────────────────────────────────────────────────────

export type SummaryType = 'tl;dr' | 'key-points' | 'teaser' | 'headline';
export type SummaryFormat = 'plain-text' | 'markdown';
export type SummaryLength = 'short' | 'medium' | 'long';

/**
 * Summarize text using the built-in Summarizer API.
 * Much more structured than the raw Prompt API for condensation tasks.
 *
 * Agent use-case: Summarize extracted page content before injecting into
 * the LLM prompt context — reduces token usage by 80%.
 */
export async function summarizeText(
  text: string,
  type: SummaryType = 'key-points',
  format: SummaryFormat = 'plain-text',
  length: SummaryLength = 'short',
): Promise<string | null> {
  const w = self as unknown as Record<string, unknown>;

  // Try standalone Summarizer API
  if ('Summarizer' in w) {
    try {
      const summarizer = await (w.Summarizer as {
        create: (opts: object) => Promise<{ summarize: (t: string) => Promise<string> }>;
      }).create({ type, format, length });
      const summary = await summarizer.summarize(text);
      logger.debug(`[BuiltInAI] Summarized ${text.length} → ${summary.length} chars`);
      return summary;
    } catch (err) {
      logger.warning('[BuiltInAI] Summarizer API failed:', err);
    }
  }

  // Fallback: use Prompt API for summarization
  return promptLocalAI(
    `Summarize the following text as ${type} in ${length} length:\n\n${text}`,
    'You are a precise text summarizer.',
  );
}

// ── Language Detector ─────────────────────────────────────────────────────────

export interface LanguageDetectionResult {
  language: string;  // BCP 47 language tag e.g. "en", "fr", "zh"
  confidence: number; // 0–1
}

/**
 * Detect the language of a text using the built-in LanguageDetector API.
 * Agent use-case: automatically route pages to translation before DOM parsing.
 */
export async function detectLanguage(text: string): Promise<LanguageDetectionResult | null> {
  const w = self as unknown as Record<string, unknown>;

  if ('LanguageDetector' in w) {
    try {
      const detector = await (w.LanguageDetector as {
        create: () => Promise<{
          detect: (t: string) => Promise<Array<{ detectedLanguage: string; confidence: number }>>;
        }>;
      }).create();
      const results = await detector.detect(text.slice(0, 1000)); // API limit
      const top = results[0];
      if (top) {
        logger.debug(`[BuiltInAI] Detected language: ${top.detectedLanguage} (${(top.confidence * 100).toFixed(1)}%)`);
        return { language: top.detectedLanguage, confidence: top.confidence };
      }
    } catch (err) {
      logger.warning('[BuiltInAI] LanguageDetector failed:', err);
    }
  }

  return null;
}

/**
 * Check if a text is in English.
 * Convenience wrapper around detectLanguage.
 */
export async function isEnglish(text: string): Promise<boolean> {
  const result = await detectLanguage(text);
  if (!result) return true; // assume English if detection fails
  return result.language.startsWith('en') && result.confidence > 0.7;
}

// ── Translator API ────────────────────────────────────────────────────────────

/**
 * Translate text to a target language using the built-in Translator API.
 * Agent use-case: translate non-English pages before LLM reasoning.
 *
 * @param text       - Text to translate
 * @param targetLang - BCP 47 language code (e.g. 'en', 'fr', 'zh')
 * @param sourceLang - Source language (auto-detect if omitted)
 */
export async function translateText(
  text: string,
  targetLang = 'en',
  sourceLang?: string,
): Promise<string | null> {
  const w = self as unknown as Record<string, unknown>;

  if ('Translator' in w) {
    try {
      const translator = await (w.Translator as {
        create: (opts: { sourceLanguage?: string; targetLanguage: string }) => Promise<{
          translate: (t: string) => Promise<string>;
        }>;
      }).create({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
      const translated = await translator.translate(text);
      logger.debug(`[BuiltInAI] Translated ${text.length} chars → ${targetLang}`);
      return translated;
    } catch (err) {
      logger.warning('[BuiltInAI] Translator API failed:', err);
    }
  }

  logger.warning('[BuiltInAI] Translator API not available');
  return null;
}

// ── Writer / Rewriter APIs ────────────────────────────────────────────────────

/**
 * Generate written content using the built-in Writer API.
 * Agent use-case: compose email bodies, fill in text fields, write descriptions.
 */
export async function writeContent(
  prompt: string,
  context?: string,
  tone: 'formal' | 'casual' | 'neutral' = 'neutral',
): Promise<string | null> {
  const w = self as unknown as Record<string, unknown>;

  if ('Writer' in w) {
    try {
      const writer = await (w.Writer as {
        create: (opts: { tone: string; sharedContext?: string }) => Promise<{
          write: (p: string) => Promise<string>;
        }>;
      }).create({ tone, sharedContext: context });
      const result = await writer.write(prompt);
      logger.debug(`[BuiltInAI] Writer generated ${result.length} chars`);
      return result;
    } catch (err) {
      logger.warning('[BuiltInAI] Writer API failed:', err);
    }
  }

  // Fallback to Prompt API
  return promptLocalAI(
    `Write ${tone} content for: ${prompt}${context ? `\n\nContext: ${context}` : ''}`,
    'You are a helpful content writer.',
  );
}

/**
 * Rewrite/rephrase existing text using the built-in Rewriter API.
 * Agent use-case: clean up scraped text, improve extracted content clarity.
 */
export async function rewriteContent(
  text: string,
  goal = 'Make this clearer and more concise',
  tone: 'formal' | 'casual' | 'neutral' = 'neutral',
): Promise<string | null> {
  const w = self as unknown as Record<string, unknown>;

  if ('Rewriter' in w) {
    try {
      const rewriter = await (w.Rewriter as {
        create: (opts: { tone: string; sharedContext: string }) => Promise<{
          rewrite: (t: string) => Promise<string>;
        }>;
      }).create({ tone, sharedContext: goal });
      return await rewriter.rewrite(text);
    } catch (err) {
      logger.warning('[BuiltInAI] Rewriter API failed:', err);
    }
  }

  return promptLocalAI(`${goal}:\n\n${text}`, 'You are a precise text editor.');
}
