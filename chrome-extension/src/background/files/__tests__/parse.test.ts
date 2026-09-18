import { describe, expect, it } from 'vitest';
import { deflateSync, zipSync } from 'fflate';
import { columnOf, fileKind, parseDelimited, parseDocx, parseFile, parseXlsx } from '../parse';
import { pdfPages, toUnicodeMap } from '../pdf-text';

const bytesOf = (text: string) => new TextEncoder().encode(text);
const latin1Bytes = (text: string) => Uint8Array.from([...text].map(char => char.charCodeAt(0)));

/** A PDF whose page content streams are deflated, as a real one's are. */
function makePdf(pages: string[], extra = ''): Uint8Array {
  const parts: Uint8Array[] = [latin1Bytes(`%PDF-1.4\n${extra}`)];
  pages.forEach((content, index) => {
    const deflated = deflateSync(latin1Bytes(content));
    parts.push(latin1Bytes(`${index + 2} 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`));
    parts.push(deflated);
    parts.push(latin1Bytes('\nendstream\nendobj\n'));
  });
  parts.push(latin1Bytes('trailer\n<< >>\n%%EOF'));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A minimal xlsx: the parts the parser reads and nothing else. */
function makeXlsx(): Uint8Array {
  return zipSync({
    'xl/workbook.xml': bytesOf('<workbook><sheets><sheet name="Q3 &amp; Q4" sheetId="1"/></sheets></workbook>'),
    'xl/sharedStrings.xml': bytesOf('<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North, inc.</t></si></sst>'),
    'xl/worksheets/sheet1.xml': bytesOf(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        // C skips B on purpose: an empty cell must not shift the column.
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1200.5</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>South</t></is></c><c r="B3"><v>900</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  });
}

function makeDocx(): Uint8Array {
  return zipSync({
    'word/document.xml': bytesOf(
      '<w:document><w:body>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Invoice 42</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Due </w:t></w:r><w:r><w:t>2026-01-31</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p><w:r><w:t>Desk</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&#163;240</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '</w:body></w:document>',
    ),
  });
}

describe('csv', () => {
  it('honours quoted fields, so a comma inside one does not shift the columns', () => {
    const rows = parseDelimited('name,city,total\n"Ada, L.","Bath, UK",12\n"He said ""hi""",Rome,3\n');
    expect(rows).toEqual([
      ['name', 'city', 'total'],
      ['Ada, L.', 'Bath, UK', '12'],
      ['He said "hi"', 'Rome', '3'],
    ]);
  });

  it('picks the separator the file actually uses', () => {
    expect(parseDelimited('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseDelimited('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads a .csv file into rows the model can read', () => {
    const parsed = parseFile('sales.csv', bytesOf('region,total\nNorth,12\nSouth,9\n'));
    expect(parsed.text).toBe('region | total\nNorth | 12\nSouth | 9');
    expect(parsed.note).toContain('3 row(s)');
  });
});

describe('xlsx', () => {
  it('resolves shared and inline strings and keeps empty cells in their column', () => {
    const { sheets } = parseXlsx(makeXlsx());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Q3 & Q4');
    expect(sheets[0].rows).toEqual([
      ['Region', 'Revenue'],
      ['North, inc.', '', '1200.5'],
      ['South', '900'],
    ]);
  });

  it('names the sheet and counts the rows when read as a file', () => {
    const parsed = parseFile('report.xlsx', makeXlsx());
    expect(parsed.text).toContain('[sheet Q3 & Q4] 3 row(s)');
    expect(parsed.text).toContain('North, inc. |  | 1200.5');
    expect(parsed.note).toContain('1 sheet(s), 3 row(s)');
  });

  it('turns A1 notation into a column number', () => {
    expect([columnOf('A1'), columnOf('B2'), columnOf('Z9'), columnOf('AA1'), columnOf('AB100')]).toEqual([0, 1, 25, 26, 27]);
  });
});

describe('docx', () => {
  it('keeps headings, joins a paragraph split across runs, and renders tables as rows', () => {
    expect(parseDocx(makeDocx())).toBe('# Invoice 42\nDue 2026-01-31\nItem | Price\nDesk | £240');
  });
});

describe('pdf', () => {
  it('reads each page and marks it, so a value can cite the page it came from', () => {
    const parsed = parseFile('report.pdf', makePdf([
      'BT /F1 12 Tf (Quarterly report) Tj T* (Revenue: 1,200) Tj ET',
      'BT /F1 12 Tf (Appendix A) Tj ET',
    ]));
    expect(parsed.text).toBe('[page 1]\nQuarterly report\nRevenue: 1,200\n\n[page 2]\nAppendix A');
    expect(parsed.note).toContain('2 page(s)');
  });

  it('skips a stream that draws no text, so a font or image is not a page', () => {
    expect(pdfPages(makePdf(['q 1 0 0 1 0 0 cm /Im0 Do Q', 'BT (Only page) Tj ET']))).toEqual(['Only page']);
  });

  it('decodes octal escapes and hex strings', () => {
    expect(pdfPages(makePdf(['BT (Caf\\351 \\(open\\)) Tj T* <48656C6C6F> Tj ET']))).toEqual(['Café (open)\nHello']);
  });

  it('maps a subset font through its ToUnicode table instead of returning control characters', () => {
    const cmap =
      '/CIDInit /ProcSet findresource begin 1 begincmap\nbeginbfchar\n<0003> <0054>\n<0004> <004F>\nendbfchar\nbeginbfrange\n<0010> <0012> <0041>\nendbfrange\nendcmap';
    expect(toUnicodeMap([cmap]).get(0x0003)).toBe('T');
    expect(pdfPages(makePdf([cmap, 'BT <00030004001000110012> Tj ET']))).toEqual(['TOABC']);
  });

  it('says so rather than inventing text when nothing is readable', () => {
    const parsed = parseFile('scan.pdf', latin1Bytes('%PDF-1.4\ntrailer\n<< /Encrypt 1 0 R >>\n%%EOF'));
    expect(parsed.text).toBe('');
    expect(parsed.note).toContain('No text could be read');
  });
});

describe('fileKind', () => {
  it('goes by extension, and by the bytes when the name says nothing', () => {
    expect(fileKind('a.PDF', new Uint8Array())).toBe('pdf');
    expect(fileKind('a.tsv', new Uint8Array())).toBe('csv');
    expect(fileKind('download', latin1Bytes('%PDF-1.7 ...'))).toBe('pdf');
    expect(fileKind('download', makeXlsx())).toBe('xlsx');
    expect(fileKind('download', makeDocx())).toBe('docx');
    expect(fileKind('notes', bytesOf('plain'))).toBe('text');
  });
});

describe('the whole file is capped', () => {
  it('cuts a long file and says so, because an unbounded file is an unbounded prompt', () => {
    const parsed = parseFile('big.csv', bytesOf(Array.from({ length: 4000 }, (_, i) => `row${i},${'value'.repeat(10)}`).join('\n')));
    expect(parsed.note).toContain('first 2000 shown');
    expect(parsed.note).toContain('Cut at 60000 characters');
    expect(parsed.text.endsWith('…cut at 60000 characters.')).toBe(true);
  });
});
