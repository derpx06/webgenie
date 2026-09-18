/**
 * Turns a downloaded file into text and tables a model can read, inside the extension: no service, no upload.
 * PDF text carries its page number so a reported value can cite one; spreadsheets and documents come back as
 * pipe-separated rows, which is the shape the read tools already give for a table on a page.
 */
import { unzipSync } from 'fflate';
import { pdfPages } from './pdf-text';

/** Rows kept per table and characters kept per file; a 500-row sheet is worth reading, a 500,000-row one is not. */
export const MAX_ROWS = 2000;
export const MAX_CHARS = 60_000;

export interface ParsedFile {
  /** The file's content as text. */
  text: string;
  /** What the parser did, for the model: the page or sheet count, and whether anything was cut. */
  note: string;
}

const decoder = new TextDecoder('utf-8');
const utf8 = (bytes: Uint8Array) => decoder.decode(bytes).replace(/^\uFEFF/, '');

/** A row as the table tools render one. */
const row = (cells: string[]) => cells.map(cell => cell.replace(/\s+/g, ' ').trim()).join(' | ');

/**
 * Comma- or tab-separated rows, with quoted fields (and doubled quotes inside them) honoured, because a quoted comma
 * in an address column silently shifts every later column otherwise.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const head = text.slice(0, 4000);
  const sep = delimiter ?? ((head.split('\t').length > head.split(',').length) ? '\t' : ((head.split(';').length > head.split(',').length) ? ';' : ','));
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === sep) (cells.push(cell), (cell = ''));
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = '';
    } else cell += char;
  }
  if (cell || cells.length > 0) {
    cells.push(cell);
    rows.push(cells);
  }
  return rows.filter(entry => entry.some(value => value.trim() !== ''));
}

/** A1 to its column number, so a sheet with empty cells keeps its columns lined up. */
export function columnOf(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
}

/** The text of every `<t>` in a shared-strings or inline-string element, in order. */
const textOf = (xml: string) =>
  (xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [])
    .map(part => part.replace(/<[^>]+>/g, ''))
    .join('');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) =>
    entity.startsWith('#')
      ? String.fromCodePoint(parseInt(entity.slice(entity[1] === 'x' || entity[1] === 'X' ? 2 : 1), entity[1] === 'x' || entity[1] === 'X' ? 16 : 10))
      : (ENTITIES[entity.toLowerCase()] ?? whole),
  );

/** Every sheet of an xlsx, as rows of cells. Shared strings are resolved; formulas give their last cached value. */
export function parseXlsx(bytes: Uint8Array): { sheets: Array<{ name: string; rows: string[][] }> } {
  const files = unzipSync(bytes, { filter: file => /^xl\/(worksheets\/|workbook\.xml$|sharedStrings\.xml$)/.test(file.name) });
  const sharedXml = files['xl/sharedStrings.xml'] ? utf8(files['xl/sharedStrings.xml']) : '';
  const shared = (sharedXml.match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g) ?? []).map(item => unescapeXml(textOf(item)));

  // Sheet names in workbook order; a sheet the zip does not carry is skipped.
  const names = [...(files['xl/workbook.xml'] ? utf8(files['xl/workbook.xml']) : '').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map(match =>
    unescapeXml(match[1]),
  );
  const paths = Object.keys(files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  return {
    sheets: paths.map((path, index) => {
      const xml = utf8(files[path]);
      const rows: string[][] = [];
      for (const rowXml of xml.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
        const cells: string[] = [];
        for (const match of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attributes = match[1];
          const body = match[2] ?? '';
          const at = columnOf(/\br="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '');
          const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
          const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
          const value =
            type === 's' ? (shared[Number(raw)] ?? '')
              : type === 'inlineStr' ? unescapeXml(textOf(body))
                : type === 'str' ? unescapeXml(raw)
                  : unescapeXml(raw);
          while (cells.length < at) cells.push('');
          cells[at] = value;
        }
        if (cells.some(cell => cell.trim() !== '')) rows.push(cells);
        if (rows.length >= MAX_ROWS) break;
      }
      return { name: names[index] ?? `Sheet${index + 1}`, rows };
    }),
  };
}

/** A docx as its paragraphs and tables, in document order. */
export function parseDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: file => file.name === 'word/document.xml' });
  const xml = files['word/document.xml'] ? utf8(files['word/document.xml']) : '';
  const blocks: string[] = [];
  // Paragraphs and tables at the top level, in the order they appear; a paragraph inside a table is taken by the table.
  for (const match of xml.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)) {
    const block = match[0];
    if (match[1] === 'p') {
      const text = unescapeXml(
        (block.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? []).map(part => part.replace(/<[^>]+>/g, '')).join(''),
      ).trim();
      const heading = /<w:pStyle\b[^>]*w:val="Heading(\d)"/.exec(block)?.[1];
      if (text) blocks.push(heading ? `${'#'.repeat(Math.min(6, Number(heading)))} ${text}` : text);
      continue;
    }
    for (const rowMatch of block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const cells = [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(cellMatch =>
        unescapeXml((cellMatch[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? []).map(part => part.replace(/<[^>]+>/g, '')).join('')),
      );
      if (cells.some(cell => cell.trim() !== '')) blocks.push(row(cells));
    }
  }
  return blocks.join('\n');
}

/** The kind of file, from its name and, when that says nothing, the bytes it starts with. */
export function fileKind(name: string, bytes: Uint8Array): 'pdf' | 'xlsx' | 'docx' | 'csv' | 'text' {
  const extension = (name.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'xlsx' || extension === 'xlsm') return 'xlsx';
  if (extension === 'docx') return 'docx';
  if (extension === 'csv' || extension === 'tsv') return 'csv';
  // A name that says nothing: %PDF and the zip header do.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const names = Object.keys(unzipSync(bytes, { filter: file => /^(word\/document|xl\/workbook)\.xml$/.test(file.name) }));
    if (names.includes('xl/workbook.xml')) return 'xlsx';
    if (names.includes('word/document.xml')) return 'docx';
  }
  return extension === 'txt' || extension === 'json' || extension === 'md' || extension === 'html' ? 'text' : 'text';
}

/** A file as text and tables, with a note saying what it was and what was cut. */
export function parseFile(name: string, bytes: Uint8Array): ParsedFile {
  const kind = fileKind(name, bytes);
  let text: string;
  let note: string;

  if (kind === 'pdf') {
    const pages = pdfPages(bytes);
    if (pages.length === 0) {
      return {
        text: '',
        note: 'No text could be read from this PDF. It is a scan with no text layer, or it is encrypted; look at the page it came from, or view_screenshot it.',
      };
    }
    // The page marker is what lets an answer cite a page.
    text = pages.map((page, index) => `[page ${index + 1}]\n${page}`).join('\n\n');
    note = `PDF, ${pages.length} page(s); each page is marked [page n], so cite the page a value came from.`;
  } else if (kind === 'xlsx') {
    const { sheets } = parseXlsx(bytes);
    text = sheets
      .filter(sheet => sheet.rows.length > 0)
      .map(sheet => `[sheet ${sheet.name}] ${sheet.rows.length} row(s)\n${sheet.rows.map(row).join('\n')}`)
      .join('\n\n');
    const total = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    note = `Spreadsheet, ${sheets.length} sheet(s), ${total} row(s)${sheets.some(sheet => sheet.rows.length >= MAX_ROWS) ? `, cut at ${MAX_ROWS} rows a sheet` : ''}. A formula gives its last saved value.`;
  } else if (kind === 'docx') {
    text = parseDocx(bytes);
    note = `Document, ${text.split('\n').filter(Boolean).length} paragraph(s) and table row(s).`;
  } else if (kind === 'csv') {
    const rows = parseDelimited(utf8(bytes));
    const kept = rows.slice(0, MAX_ROWS);
    text = kept.map(row).join('\n');
    note = `${rows.length} row(s)${rows.length > kept.length ? `, first ${MAX_ROWS} shown` : ''}; the first row is usually the header.`;
  } else {
    text = utf8(bytes);
    note = 'Plain text.';
  }

  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n…cut at ${MAX_CHARS} characters.`;
    note += ` Cut at ${MAX_CHARS} characters.`;
  }
  return { text, note };
}
