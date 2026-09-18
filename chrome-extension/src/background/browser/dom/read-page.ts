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

  /**
   * Inline text of an element, with images as their alt text and links as `[label](url)` — but only where the address
   * is worth its characters: a link that is a whole block (a heading, a list item, a table cell, a result title) is
   * somewhere to go, while a short link inside a sentence (a tag, a citation, "about") is not. Every one of them is in
   * the element list already and can be clicked by index, and on a link-dense page their addresses are most of the read.
   */
  const inline = (el: Node): string => {
    let out = '';
    // The first link's label and address, kept only while it is the one link in this block.
    let onlyLabel = '';
    let onlyUrl = '';
    let links = 0;
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
        const raw = element.getAttribute('href') || '';
        const url = (element as HTMLAnchorElement).href || '';
        // A link to a place on this same page (a citation, a contents entry) is not somewhere to go.
        const address = /^(javascript:|#)/i.test(raw) ? '' : url.replace(/#.*$/, '');
        links++;
        const short = address.length > 100 ? `${address.slice(0, 100)}…` : address;
        onlyLabel = links === 1 && label && address ? label : '';
        onlyUrl = onlyLabel ? short : '';
        // A link that names something in full is a destination; a one- or two-word one is chrome.
        if (onlyUrl && (label.length >= 20 || label.split(' ').length >= 3)) {
          out += `[${label}](${short})`;
          onlyLabel = '';
          onlyUrl = '';
          return;
        }
        out += label;
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
    const text = flat(out);
    // One link and nothing else: the block is that link, so it keeps its address however short its label.
    return onlyUrl && text === onlyLabel ? `[${onlyLabel}](${onlyUrl})` : text;
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
  // Longest extraction one frame may return; a runaway page cannot fill memory. Declared here, not at module scope:
  // this function is stringified and run in the page, where nothing outside it exists.
  let budget = 400000;
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
  // The label with its arrows and spacing stripped ("Next →", "Next page »", "→" alone all reach the same test).
  const NEXT = /^(next|next page|older|older posts|more|)$/i;
  const rel = document.querySelector('link[rel="next"], a[rel="next"]') as HTMLAnchorElement | null;
  if (rel && rel.href) return rel.href;
  const links = document.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as HTMLAnchorElement;
    const shown = (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim();
    const arrows = /[»›→>\u00bb\u203a\u2192]/.test(shown);
    const label = shown.replace(/[»›→>\u00bb\u203a\u2192\s]+/g, ' ').trim();
    if (!(NEXT.test(label) && (label || arrows))) continue;
    if (!link.href || /^javascript:/i.test(link.href)) continue;
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

// --- typed extraction: what the markdown itself can answer, before any model call ---

/** One field a caller's JSON Schema asks for. */
export interface FieldSpec {
  name: string;
  type: string;
  description?: string;
}

/** Where a value came from and how sure the parse is; `extract` reports both per field. */
export interface FieldValue {
  value: unknown;
  source: 'table' | 'labels' | 'model';
  confidence: number;
}

type JsonSchema = Record<string, unknown>;

const properties = (schema: JsonSchema): Record<string, JsonSchema> => (schema.properties as Record<string, JsonSchema>) ?? {};

/** The fields a JSON Schema asks for, whether it describes one object or a list of them. */
export function schemaFields(schema: JsonSchema): { many: boolean; fields: FieldSpec[]; required: string[] } {
  const many = schema.type === 'array';
  const item = (many ? ((schema.items as JsonSchema) ?? {}) : schema) as JsonSchema;
  const fields = Object.entries(properties(item)).map(([name, spec]) => ({
    name,
    type: String(spec.type ?? 'string'),
    description: typeof spec.description === 'string' ? spec.description : undefined,
  }));
  return { many, fields, required: Array.isArray(item.required) ? (item.required as string[]) : [] };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** How well a column header answers a field: 1 for the same word, 0.75 for one containing the other, 0 otherwise. */
function headerScore(field: FieldSpec, header: string): number {
  const wanted = normalize(field.name);
  const got = normalize(header);
  if (!wanted || !got) return 0;
  if (wanted === got) return 1;
  if (got.includes(wanted) || wanted.includes(got)) return 0.75;
  const words = normalize(field.description ?? '');
  return words && (words.includes(got) || got.includes(words)) ? 0.5 : 0;
}

/** A value written as the page writes it, read as the type the schema asks for. */
export function coerce(value: string, type: string): unknown {
  const text = value.trim();
  if (type === 'number' || type === 'integer') {
    const number = Number(text.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(number) ? (type === 'integer' ? Math.trunc(number) : number) : undefined;
  }
  if (type === 'boolean') {
    if (/^(yes|true|available|in stock)$/i.test(text)) return true;
    if (/^(no|false|unavailable|out of stock)$/i.test(text)) return false;
    return undefined;
  }
  return text || undefined;
}

/** The markdown tables in a text, each as its rows of cells (the `---` separator row dropped). */
export function markdownTables(markdown: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] = [];
  for (const line of markdown.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!/^\s*\|[\s|:-]*\|\s*$/.test(line)) {
        current.push(line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
      }
      continue;
    }
    if (current.length) tables.push(current);
    current = [];
  }
  if (current.length) tables.push(current);
  return tables.filter(table => table.length >= 2);
}

/**
 * Rows parsed out of the markdown table whose headers answer most of the schema's fields. A product grid, a results list
 * and a data table all reach the models as tables, so this is what parses them without a model call.
 */
export function extractFromTables(markdown: string, fields: FieldSpec[]): Array<Record<string, FieldValue>> {
  let best: { rows: Array<Record<string, FieldValue>>; matched: number } = { rows: [], matched: 0 };
  for (const table of markdownTables(markdown)) {
    const [headers, ...rows] = table;
    const columns = fields
      .map(field => {
        let column = -1;
        let score = 0;
        headers.forEach((header, index) => {
          const value = headerScore(field, header);
          if (value > score) {
            score = value;
            column = index;
          }
        });
        return { field, column, score };
      })
      .filter(match => match.score > 0);
    if (columns.length <= best.matched) continue;
    best = {
      matched: columns.length,
      rows: rows.map(row =>
        Object.fromEntries(
          columns
            .map(({ field, column, score }) => [field.name, { value: coerce(row[column] ?? '', field.type), source: 'table' as const, confidence: score * 0.9 }] as const)
            .filter(([, found]) => found.value !== undefined),
        ),
      ),
    };
  }
  return best.rows.filter(row => Object.keys(row).length > 0);
}

/** `Label: value` lines, for the fields no table answered. */
export function extractFromLabels(markdown: string, fields: FieldSpec[]): Record<string, FieldValue> {
  const found: Record<string, FieldValue> = {};
  const lines = markdown.split('\n');
  for (const field of fields) {
    const label = field.name.replace(/[_-]+/g, '[ _-]?');
    const pattern = new RegExp(`(?:^|[*\\s])${label}\\s*[:\\u2013-]\\s*(.+)$`, 'i');
    for (const line of lines) {
      const match = pattern.exec(line.replace(/\*\*/g, ''));
      const value = match && coerce(match[1], field.type);
      if (value !== undefined && value !== null) {
        found[field.name] = { value, source: 'labels', confidence: 0.8 };
        break;
      }
    }
  }
  return found;
}

/** What a value breaks in the schema: its type, a missing required field, or an item of the wrong shape. */
export function schemaProblems(value: unknown, schema: JsonSchema, path = 'result'): string[] {
  const type = String(schema.type ?? '');
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected a list`];
    return value.flatMap((item, i) => schemaProblems(item, (schema.items as JsonSchema) ?? {}, `${path}[${i}]`));
  }
  if (type === 'object' || schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected an object`];
    const record = value as Record<string, unknown>;
    const missing = (Array.isArray(schema.required) ? (schema.required as string[]) : []).filter(name => record[name] === undefined);
    return [
      ...missing.map(name => `${path}.${name}: missing`),
      ...Object.entries(properties(schema)).flatMap(([name, spec]) => (record[name] === undefined ? [] : schemaProblems(record[name], spec, `${path}.${name}`))),
    ];
  }
  if (value === undefined || value === null) return [];
  if (type === 'string' && typeof value !== 'string') return [`${path}: expected text`];
  if ((type === 'number' || type === 'integer') && typeof value !== 'number') return [`${path}: expected a number`];
  if (type === 'boolean' && typeof value !== 'boolean') return [`${path}: expected true or false`];
  return [];
}
