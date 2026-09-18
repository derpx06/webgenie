import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { downloadActionSchema, readFileActionSchema } from '../schemas';
import { wrapUntrustedContent } from '../../messages/utils';
import { isUrlAllowed } from '@src/background/browser/util';
import { parseFile } from '@src/background/files/parse';
import { matchRanges, passagesFor } from './content';

/** Files held in memory for read_file, and the largest one worth holding: a report, not a disk image. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CACHED_FILES = 5;
const DEFAULT_WAIT_SECONDS = 30;
const MIN_WAIT_SECONDS = 5;
const MAX_WAIT_SECONDS = 120;
const FIND_CONTEXT = 30;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** The file name of a download path, whatever separator the platform uses. */
export const baseName = (path: string) => (path.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').trim();

/**
 * Which downloaded file `path` means: the one whose name matches it, or whose address ends with it. A task names the
 * file the way the state showed it, which is the base name, so that is what has to match.
 */
export function matchDownload<T extends { filename: string; url: string; finalUrl?: string }>(items: T[], path: string): T | undefined {
  const wanted = baseName(path).toLowerCase();
  if (!wanted) return undefined;
  return (
    items.find(item => baseName(item.filename).toLowerCase() === wanted) ??
    items.find(item => baseName(item.finalUrl || item.url).toLowerCase() === wanted) ??
    items.find(item => baseName(item.filename).toLowerCase().includes(wanted))
  );
}

/** The passages of `text` around each match of `find`, so a 2,000-row sheet answers one question without being sent whole. */
export function passagesAround(text: string, find: string, maxPassages = 20): string {
  const ranges = matchRanges(text, find);
  if (ranges.length === 0) return '';
  const passages = passagesFor(text, ranges).slice(0, maxPassages);
  return passages
    .map(passage => {
      const start = passage.row ? passage.start : Math.max(0, passage.start - FIND_CONTEXT);
      const end = passage.row ? passage.end : Math.min(text.length, passage.end + FIND_CONTEXT);
      return `${passage.header ? `${passage.header}\n` : ''}${text.slice(start, end).trim()}`;
    })
    .join('\n---\n');
}

/**
 * Getting a file out of a page and reading it. The bytes are fetched from inside the page, so the session that was
 * allowed to download the file is the one that asks for it; nothing is sent anywhere and no parser is a service.
 */
export class FilesHandler extends BaseHandler {
  /** Bytes of the files this task read, by name, so a second read costs nothing. */
  private readonly cache = new Map<string, Uint8Array>();

  async handleDownload(input: z.infer<typeof downloadActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const node = (await page.getCurrentState()).selectorMap.get(input.index);
    if (!node) return this.handleElementNotFound(input.index);

    const browser = this.context.browserContext.browser;
    const before = new Set((await browser.searchDownloads({ limit: 50, orderBy: ['-startTime'] })).map(item => item.id));
    const label = node.getAllTextTillNextClickableElement(2) || node.attributes['aria-label'] || node.tagName;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Downloading from ${label}`);

    try {
      await page.clickNode(node);
    } catch (error) {
      const msg = `The element could not be clicked: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, input.seconds ?? DEFAULT_WAIT_SECONDS));
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const items = await browser.searchDownloads({ limit: 50, orderBy: ['-startTime'] });
      const fresh = items.find(item => !before.has(item.id));
      if (fresh && fresh.state !== 'in_progress') {
        const name = baseName(fresh.filename) || baseName(fresh.finalUrl || fresh.url) || 'file';
        if (fresh.state === 'interrupted') {
          const msg = `The download of ${name} failed (${fresh.error ?? 'interrupted'}). Try the link again, or read the page instead.`;
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          return new ActionResult({ error: msg, includeInMemory: true });
        }
        const held = fresh.danger && !['safe', 'accepted'].includes(fresh.danger);
        const msg = held
          ? `${name} was held by Chrome as possibly dangerous; only the user can keep it, so it cannot be read.`
          : `${name} was saved (${Math.max(1, Math.round(fresh.totalBytes / 1024))} KB). read_file with path "${name}" reads it.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Downloaded ${name}`);
        return new ActionResult({ extractedContent: msg, includeInMemory: true, ...(held ? { error: msg } : {}) });
      }
      if (Date.now() >= deadline) {
        const msg = fresh
          ? `${baseName(fresh.filename) || 'The file'} is still downloading after ${seconds} s. Wait and check the downloads in the state, or call download again with more seconds.`
          : `No file was downloaded within ${seconds} s. The element may open a page instead of producing a file: check the page state, and read that page.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      await sleep(500);
    }
  }

  async handleReadFile(input: z.infer<typeof readFileActionSchema.schema>): Promise<ActionResult> {
    const path = input.path.trim();
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Reading ${baseName(path) || path}`);
    let name = baseName(path) || 'file';
    let bytes = this.cache.get(name);

    if (!bytes) {
      let source = '';
      if (/^https?:\/\//i.test(path)) {
        source = path;
      } else {
        const items = await this.context.browserContext.browser.searchDownloads({ limit: 100, orderBy: ['-startTime'] });
        const item = matchDownload(items, path);
        if (!item) {
          const known = items.slice(0, 10).map(entry => baseName(entry.filename)).filter(Boolean);
          return this.fail(
            `No downloaded file is called "${path}". ${known.length ? `The browser has: ${known.join(', ')}.` : 'Download it first with the download tool.'}`,
          );
        }
        source = item.finalUrl || item.url;
        name = baseName(item.filename) || name;
      }
      if (/^blob:|^data:/i.test(source)) {
        return this.fail(
          `${name} was produced by the page itself (${source.split(':')[0]}:), so its bytes are not on the network and cannot be fetched again. Read the page that produced it.`,
        );
      }
      const config = this.context.browserContext.getConfig();
      if (!isUrlAllowed(source, config.allowedUrls ?? [], config.deniedUrls ?? [])) {
        return this.fail(`${name} comes from an address the browser's firewall settings block.`);
      }

      const page = await this.context.browserContext.getCurrentPage();
      let reply: Awaited<ReturnType<typeof page.fetchBytesInPage>>;
      try {
        reply = await page.fetchBytesInPage(source, MAX_FILE_BYTES);
      } catch (error) {
        return this.fail(
          `${name} could not be fetched: ${error instanceof Error ? error.message : String(error)}. A file behind a one-time link or a form post cannot be requested again; read the page instead.`,
        );
      }
      if (reply.status < 200 || reply.status >= 300) return this.fail(`${name} answered ${reply.status} when fetched again.`);
      if (reply.bytes > MAX_FILE_BYTES) {
        return this.fail(`${name} is ${Math.round(reply.bytes / 1024 / 1024)} MB, larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB this tool reads.`);
      }
      const binary = atob(reply.base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      this.cache.set(name, bytes);
      // Only the newest few files are worth keeping in the worker's memory.
      for (const key of [...this.cache.keys()].slice(0, Math.max(0, this.cache.size - MAX_CACHED_FILES))) this.cache.delete(key);
    }

    let parsed: ReturnType<typeof parseFile>;
    try {
      parsed = parseFile(name, bytes);
    } catch (error) {
      return this.fail(`${name} could not be read: ${error instanceof Error ? error.message : String(error)}. It may not be the format its name says.`);
    }
    if (!parsed.text.trim()) return this.fail(`${name}: ${parsed.note}`);

    let body = parsed.text;
    let note = parsed.note;
    if (input.find) {
      const passages = passagesAround(body, input.find);
      if (!passages) {
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read ${name}`);
        return new ActionResult({
          extractedContent: `${name}: ${note} "${input.find}" is not in it. Read it without find to see what is.`,
          includeInMemory: true,
        });
      }
      body = passages;
      note += ` Showing the passages around "${input.find}".`;
    }

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read ${name}`);
    return new ActionResult({ extractedContent: wrapUntrustedContent(`${name}: ${note}\n${body}`), includeInMemory: true });
  }

  private fail(message: string): ActionResult {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, message);
    return new ActionResult({ error: message, includeInMemory: true });
  }
}
