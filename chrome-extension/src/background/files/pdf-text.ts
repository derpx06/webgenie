/**
 * Text out of a PDF, one entry per page, so a reported value can cite the page it came from.
 *
 * It reads the file's streams directly: every stream is inflated (FlateDecode) or taken raw, and the ones holding
 * text operators are the pages, in file order. Text is decoded through the ToUnicode maps the file carries, which is
 * what makes a subset-embedded font readable.
 *
 * ponytail: no xref or object-stream walk, no encryption, no OCR of scanned pages, and a single merged ToUnicode map
 * rather than one per font resource — so a file that maps the same code to different glyphs in two CID fonts can come
 * back wrong. Upgrade path: pdfjs-dist, at roughly 1.5 MB in the worker bundle.
 */
import { inflateSync } from 'fflate';

/** Bytes as one character per byte, which is how PDF syntax is meant to be read. */
function latin1(bytes: Uint8Array, from = 0, to = bytes.length): string {
  let text = '';
  for (let i = from; i < to; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(to, i + 8192)));
  }
  return text;
}

interface RawStream {
  /** The dictionary in front of the stream. */
  dict: string;
  bytes: Uint8Array;
}

/** Every `stream ... endstream` in the file, with the dictionary that introduces it. */
function streams(bytes: Uint8Array, source: string): RawStream[] {
  const found: RawStream[] = [];
  const pattern = /stream\r?\n?/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const start = match.index + match[0].length;
    const end = source.indexOf('endstream', start);
    if (end < 0) continue;
    // Past the whole keyword: "endstream" holds "stream", and resuming inside it swallowed the next stream whole.
    pattern.lastIndex = end + 'endstream'.length;
    const dictStart = source.lastIndexOf('<<', match.index);
    found.push({
      dict: dictStart >= 0 ? source.slice(dictStart, match.index) : '',
      // The newline before `endstream` belongs to the syntax, not to the data.
      bytes: bytes.subarray(start, source[end - 1] === '\n' ? (source[end - 2] === '\r' ? end - 2 : end - 1) : end),
    });
  }
  return found;
}

/** The stream's data: inflated when the dictionary says so, raw otherwise, empty when it cannot be read. */
function decoded(stream: RawStream): Uint8Array {
  if (!/\/Flate(Decode)?/.test(stream.dict)) return stream.bytes;
  try {
    return inflateSync(stream.bytes);
  } catch {
    return new Uint8Array(0);
  }
}

/** `<0041>` and `0041` to a character code. */
const hexCode = (text: string) => parseInt(text.replace(/[<>\s]/g, ''), 16);

/**
 * The file's ToUnicode maps, merged: character code to the text it stands for. Subset fonts number their glyphs from
 * 1, so without this their text comes back as control characters.
 */
export function toUnicodeMap(contents: string[]): Map<number, string> {
  const map = new Map<number, string>();
  const chars = (hex: string) =>
    (hex.replace(/[<>\s]/g, '').match(/.{1,4}/g) ?? []).map(part => String.fromCharCode(parseInt(part, 16))).join('');
  for (const text of contents) {
    for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) ?? []) {
      for (const [, from, to] of block.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(hexCode(from), chars(to));
    }
    for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) ?? []) {
      for (const [, low, high, target] of block.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]+>|\[[\s\S]*?\])/gi)) {
        const start = hexCode(low);
        const end = hexCode(high);
        if (end < start || end - start > 65_535) continue;
        if (target.startsWith('[')) {
          const items = target.match(/<[0-9a-f]+>/gi) ?? [];
          items.forEach((item, i) => map.set(start + i, chars(item)));
        } else {
          const base = chars(target);
          const tail = base.charCodeAt(base.length - 1);
          for (let code = start; code <= end; code++) {
            map.set(code, base.slice(0, -1) + String.fromCharCode(tail + (code - start)));
          }
        }
      }
    }
  }
  return map;
}

/** Escapes of a PDF string literal. */
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

/** A `(...)` literal to its character codes, octal escapes and line continuations resolved. */
function literalCodes(text: string): number[] {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      codes.push(text.charCodeAt(i));
      continue;
    }
    const next = text[++i];
    if (next === undefined) break;
    if (next === '\n') continue;
    if (next === '\r') {
      if (text[i + 1] === '\n') i++;
      continue;
    }
    if (next >= '0' && next <= '7') {
      let octal = next;
      while (octal.length < 3 && text[i + 1] >= '0' && text[i + 1] <= '7') octal += text[++i];
      codes.push(parseInt(octal, 8));
      continue;
    }
    codes.push((ESCAPES[next] ?? next).charCodeAt(0));
  }
  return codes;
}

/**
 * Character codes to text. Two-byte codes are used when the map knows them all, which is how Identity-H CID fonts are
 * written; otherwise each byte is looked up on its own and falls back to itself.
 */
function decodeCodes(codes: number[], map: Map<number, string>): string {
  if (map.size > 0 && codes.length >= 2 && codes.length % 2 === 0) {
    const wide: string[] = [];
    for (let i = 0; i < codes.length; i += 2) {
      const text = map.get((codes[i] << 8) | codes[i + 1]);
      if (text === undefined) {
        wide.length = 0;
        break;
      }
      wide.push(text);
    }
    if (wide.length > 0) return wide.join('');
  }
  return codes.map(code => map.get(code) ?? String.fromCharCode(code)).join('');
}

/** The text of one content stream, with the line breaks its text-positioning operators imply. */
export function contentText(content: string, map: Map<number, string>): string {
  let out = '';
  // One pass over the operators that produce or move text; `(...)` and `<...>` strings and array elements included.
  const pattern = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\bT[dDJj*]|\bTL\b|\bET\b|'|"/g;
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    const token = match[0];
    if (token.startsWith('(')) {
      out += decodeCodes(literalCodes(token.slice(1, -1)), map);
    } else if (token.startsWith('<')) {
      const hex = token.slice(1, -1).replace(/\s/g, '');
      const codes = (hex.match(/.{1,2}/g) ?? []).map(part => parseInt(part.padEnd(2, '0'), 16));
      out += decodeCodes(codes, map);
    } else if (token === 'Td' || token === 'TD' || token === 'T*' || token === 'ET' || token === "'" || token === '"') {
      // A new text line: these are the operators that move the cursor off the current one.
      if (!out.endsWith('\n')) out += '\n';
    }
  }
  return out;
}

/** True when a stream holds drawing operators for text, which is what makes it a page and not a resource. */
const isContentStream = (text: string) => /\bBT\b[\s\S]*\bET\b/.test(text);

/**
 * The text of each page, in file order. An empty array means nothing readable was found: an encrypted file, or a scan
 * with no text layer.
 */
export function pdfPages(bytes: Uint8Array): string[] {
  const source = latin1(bytes);
  const texts = streams(bytes, source).map(stream => latin1(decoded(stream)));
  // The maps may live in any stream, and in the file itself when it is not compressed.
  const map = toUnicodeMap([...texts.filter(text => text.includes('beginbf')), source.includes('beginbf') ? source : '']);
  return texts
    .filter(isContentStream)
    .map(text => contentText(text, map).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    .filter(text => text.length > 0);
}
