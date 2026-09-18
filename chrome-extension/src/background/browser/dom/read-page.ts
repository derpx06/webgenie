/**
 * Reading a page as text instead of scrolling through it.
 *
 * `extractReadBlocks` is stringified by puppeteer and runs inside the page, so it must stay self-contained: no imports,
 * no module-scope references, no closures. Everything after it — markdown, outline, sections, chunking, hashing — is
 * pure and lives here, so it is tested without a DOM.
 *
 * ponytail: hand-rolled instead of @mozilla/readability + a markdown library. Readability needs a DOM, which an MV3
 * service worker does not have, so it would have to be injected into every frame as ~100 KB of source, and its output is
 * HTML that a second library would have to turn into markdown. The walk below is Readability's paragraph-parent scoring
 * plus a serializer that emits markdown directly. Upgrade path if extraction quality is ever measured short: inject
 * Readability's UMD build as a raw string and keep everything below `blocksToMarkdown`.
 */

/** One piece of readable content, as the in-page walk emits it. */
export interface ReadBlock {
  kind: 'heading' | 'text' | 'list' | 'table' | 'quote' | 'code';
  /** Heading rank, 1-6. */
  level?: number;
  text?: string;
  items?: string[];
  ordered?: boolean;
  rows?: string[][];
}

/** Longest extraction one frame may return; a runaway page cannot fill memory. */
const MAX_EXTRACT_CHARS = 400_000;

/**
 * The readable blocks of the current document. `main` keeps the article or result list and drops navigation, footers,
 * sticky banners and link menus; `full` keeps everything the page renders.
 *
 * Runs in the page. Keep it self-contained.
 */
export function extractReadBlocks(mode: 'main' | 'full'): ReadBlock[] {
  const SKIP: Record<string, number> = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, VIDEO: 1,
    AUDIO: 1, MAP: 1, LINK: 1, META: 1, HEAD: 1,
  };
  const BOILERPLATE_TAGS: Record<string, number> = { NAV: 1, HEADER: 1, FOOTER: 1, ASIDE: 1 };
  const BOILERPLATE_ROLES: Record<string, number> = {
    navigation: 1, banner: 1, contentinfo: 1, complementary: 1, search: 1, dialog: 1, alertdialog: 1, menu: 1,
    menubar: 1, toolbar: 1, tooltip: 1, alert: 1,
  };
  const BLOCK_SELECTOR =
    'p,div,ul,ol,dl,table,section,article,h1,h2,h3,h4,h5,h6,li,pre,blockquote,form,header,footer,nav,aside,main,figure';

  const flat = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
  const textOf = (node: Node) => flat(node.textContent);

  const isHidden = (el: Element) => {
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = window.getComputedStyle(el);
    return !!style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
  };

  const linkDensity = (el: Element) => {
    const all = textOf(el).length;
    if (!all) return 1;
    let linked = 0;
    let count = 0;
    el.querySelectorAll('a').forEach(link => {
      linked += textOf(link).length;
      count++;
    });
    return count === 0 ? 0 : linked / all;
  };

  /**
   * Navigation, footers, cookie bars and link menus. Every rule is about shape, never about a site: a landmark role, a
   * floating position (how banners and sticky bars are built), or a block that is almost entirely short links.
   */
  const isBoilerplate = (el: Element) => {
    if (BOILERPLATE_TAGS[el.tagName]) return true;
    if (BOILERPLATE_ROLES[(el.getAttribute('role') || '').toLowerCase()]) return true;
    const style = window.getComputedStyle(el);
    if (style && (style.position === 'fixed' || style.position === 'sticky')) return true;
    const links = el.querySelectorAll('a');
    if (links.length >= 5 && textOf(el).length > 40 && linkDensity(el) > 0.85) {
      let labels = 0;
      links.forEach(link => {
        labels += textOf(link).length;
      });
      // Menus are many short links; an index of articles is many long ones and stays.
      if (labels / links.length < 25) return true;
    }
    return false;
  };

  const childrenOf = (node: Node): Node[] => {
    const el = node as Element;
    if (el.shadowRoot) return Array.prototype.slice.call(el.shadowRoot.childNodes);
    return Array.prototype.slice.call(node.childNodes);
  };

  /** Inline text of an element, with links as `[label](url)` and images as their alt text. */
  const inline = (el: Node): string => {
    let out = '';
    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        out += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      const tag = element.tagName;
      if (SKIP[tag]) return;
      if (tag === 'BR') {
        out += ' ';
        return;
      }
      if (tag === 'A') {
        const label = textOf(element);
        const href = (element as HTMLAnchorElement).href || '';
        out += href && label && !/^javascript:/i.test(href) ? `[${label}](${href.slice(0, 200)})` : label;
        return;
      }
      if (tag === 'IMG') {
        const alt = element.getAttribute('alt');
        if (alt) out += ` ![${alt}] `;
        return;
      }
      const kids = childrenOf(element);
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    walk(el);
    return flat(out);
  };

  /**
   * The element holding the page's content: an explicit landmark, else Readability's scoring — every paragraph-like node
   * scores its ancestors, and the best-scoring ancestor with little link text wins.
   */
  const pickRoot = (): Element => {
    const body: Element = document.body || document.documentElement;
    if (mode === 'full') return body;
    const explicit = document.querySelector('main, [role="main"], article');
    if (explicit && textOf(explicit).length >= 200) return explicit;
    const scores = new Map<Element, number>();
    document.querySelectorAll('p, li, pre, blockquote, td, dd').forEach(node => {
      const length = textOf(node).length;
      if (length < 25) return;
      const score = 1 + Math.min(length / 100, 3) + (node.textContent || '').split(',').length - 1;
      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 3; depth++) {
        scores.set(parent, (scores.get(parent) || 0) + score / (depth + 1));
        parent = parent.parentElement;
      }
    });
    let best: Element | null = null;
    let bestScore = 0;
    scores.forEach((score, el) => {
      const final = score * (1 - linkDensity(el));
      if (final > bestScore) {
        bestScore = final;
        best = el;
      }
    });
    return best || body;
  };

  const blocks: ReadBlock[] = [];
  let budget = MAX_EXTRACT_CHARS;
  const push = (block: ReadBlock) => {
    const size = (block.text || '').length + (block.items || []).join('').length + (block.rows || []).flat().join('').length;
    if (size === 0 || budget <= 0) return;
    const last = blocks[blocks.length - 1];
    // A page that repeats a line (a visually-hidden copy, a sticky title) says it once.
    if (last && last.kind === block.kind && last.text && last.text === block.text) return;
    budget -= size;
    blocks.push(block);
  };

  const tableRows = (table: Element): string[][] => {
    const rows: string[][] = [];
    const trs = table.querySelectorAll('tr');
    for (let i = 0; i < trs.length && i < 300; i++) {
      const cells = trs[i].children;
      const row: string[] = [];
      for (let j = 0; j < cells.length && j < 40; j++) row.push(inline(cells[j]));
      if (row.some(cell => cell.length > 0)) rows.push(row);
    }
    return rows;
  };

  const walkBlocks = (el: Element) => {
    const kids = childrenOf(el);
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      if (node.nodeType === 3) {
        const text = flat(node.nodeValue);
        if (text) push({ kind: 'text', text });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const tag = child.tagName;
      if (SKIP[tag] || isHidden(child)) continue;
      if (mode === 'main' && isBoilerplate(child)) continue;

      if (/^H[1-6]$/.test(tag)) {
        push({ kind: 'heading', level: Number(tag[1]), text: inline(child) });
        continue;
      }
      if (tag === 'TABLE') {
        const rows = tableRows(child);
        // A one-cell table is a layout wrapper: read what is inside it instead.
        if (rows.length > 1 || (rows[0] || []).length > 1) push({ kind: 'table', rows });
        else walkBlocks(child);
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        const items: string[] = [];
        const lis = child.children;
        for (let j = 0; j < lis.length && j < 500; j++) {
          if (lis[j].tagName !== 'LI' || isHidden(lis[j])) continue;
          const text = inline(lis[j]);
          if (text) items.push(text);
        }
        if (items.length) push({ kind: 'list', items, ordered: tag === 'OL' });
        continue;
      }
      if (tag === 'PRE') {
        push({ kind: 'code', text: (child.textContent || '').trim() });
        continue;
      }
      if (tag === 'BLOCKQUOTE') {
        push({ kind: 'quote', text: inline(child) });
        continue;
      }
      if (child.querySelector(BLOCK_SELECTOR)) {
        walkBlocks(child);
        continue;
      }
      // A leaf: everything inside it is one paragraph, so spans do not become a block each.
      const text = inline(child);
      if (text) push({ kind: 'text', text });
    }
  };

  walkBlocks(pickRoot());
  return blocks;
}

/** The address of a "next page" control, when the page offers one as a link. Shape only, never a site. */
export function findNextPageHref(): string {
  const NEXT = /^(next|next page|next »|older|older posts|»|›|→|>|>>)$/i;
  const rel = document.querySelector('link[rel="next"], a[rel="next"]') as HTMLAnchorElement | null;
  if (rel && rel.href) return rel.href;
  const links = document.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as HTMLAnchorElement;
    const label = (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim();
    if (!NEXT.test(label) || !link.href || /^javascript:/i.test(link.href)) continue;
    if (link.getAttribute('aria-disabled') === 'true') continue;
    return link.href;
  }
  return '';
}

// --- pure, below: everything the service worker does with the blocks ---

/** Markdown for one table; every row gets the widest row's column count, so no cell drifts into the wrong column. */
function tableToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(row => row.length));
  const cell = (value: string | undefined) => (value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(row[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** Clean markdown for the blocks: headings, paragraphs, lists, compact tables, links as `[text](url)`. */
export function blocksToMarkdown(blocks: ReadBlock[]): string {
  const parts = blocks.map(block => {
    switch (block.kind) {
      case 'heading':
        return `${'#'.repeat(Math.min(Math.max(block.level ?? 2, 1), 6))} ${block.text ?? ''}`;
      case 'list':
        return (block.items ?? []).map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${item}`).join('\n');
      case 'table':
        return tableToMarkdown(block.rows ?? []);
      case 'quote':
        return (block.text ?? '').split('\n').map(line => `> ${line}`).join('\n');
      case 'code':
        return `\`\`\`\n${block.text ?? ''}\n\`\`\``;
      default:
        return block.text ?? '';
    }
  });
  return parts.filter(part => part.trim().length > 0).join('\n\n');
}

/** A heading and the text under it: what the outline lists and what `section` selects. */
export interface ReadSection {
  id: string;
  title: string;
  level: number;
  /** Character offsets in the markdown; a section ends where the next heading of the same or higher rank starts. */
  start: number;
  end: number;
}

export function outlineOf(markdown: string): ReadSection[] {
  const sections: ReadSection[] = [];
  const headings = /^(#{1,6}) +(.+)$/gm;
  for (let match = headings.exec(markdown); match; match = headings.exec(markdown)) {
    sections.push({ id: `s${sections.length + 1}`, title: match[2].trim(), level: match[1].length, start: match.index, end: markdown.length });
  }
  return sections.map((section, i) => ({
    ...section,
    end: sections.slice(i + 1).find(later => later.level <= section.level)?.start ?? markdown.length,
  }));
}

/** The section a `section` argument names: its id, its exact title, else the first title containing the text. */
export function findSection(sections: ReadSection[], wanted: string): ReadSection | undefined {
  const key = wanted.trim().toLowerCase();
  if (!key) return undefined;
  return (
    sections.find(section => section.id === key) ??
    sections.find(section => section.title.toLowerCase() === key) ??
    sections.find(section => section.title.toLowerCase().includes(key))
  );
}

/** The outline as the models see it: id, rank, title and how much text the section holds. */
export function renderOutline(sections: ReadSection[], limit = 60): string {
  if (sections.length === 0) return '';
  const shown = sections.slice(0, limit).map(section => `${section.id} ${'#'.repeat(section.level)} ${section.title} [${section.end - section.start} chars]`);
  const more = sections.length > limit ? `\n[${sections.length - limit} more sections]` : '';
  return `${shown.join('\n')}${more}`;
}

/** One chunk of a long read, cut at a line break so a table row or list item is never split. */
export function sliceRead(text: string, cursor: number, maxChars: number): { body: string; next: number | null } {
  const start = Math.max(0, Math.min(Math.trunc(cursor) || 0, text.length));
  const limit = Math.max(1, Math.trunc(maxChars) || 1);
  if (start + limit >= text.length) return { body: text.slice(start), next: null };
  const hard = start + limit;
  const breakAt = text.lastIndexOf('\n', hard);
  const end = breakAt > start + limit / 2 ? breakAt : hard;
  return { body: text.slice(start, end), next: end };
}

/** FNV-1a, hex. Only ever compared with itself, so its job is to change when the content does. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Rough token count; the models bill about four characters a token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
