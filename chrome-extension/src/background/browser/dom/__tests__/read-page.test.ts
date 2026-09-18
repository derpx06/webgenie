import { describe, expect, it } from 'vitest';
import {
  blocksToMarkdown,
  coerce,
  extractFromLabels,
  extractFromTables,
  findSection,
  hashText,
  outlineOf,
  renderOutline,
  schemaFields,
  schemaProblems,
  sliceRead,
  type ReadBlock,
} from '../read-page';

describe('blocksToMarkdown', () => {
  it('writes headings, paragraphs, lists and links', () => {
    const blocks: ReadBlock[] = [
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'text', text: 'A paragraph with a [link](https://example.test/a).' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'list', items: ['first', 'second'], ordered: true },
      { kind: 'quote', text: 'quoted' },
      { kind: 'code', text: 'x = 1' },
    ];

    expect(blocksToMarkdown(blocks)).toBe(
      [
        '# Title',
        '',
        'A paragraph with a [link](https://example.test/a).',
        '',
        '- one\n- two',
        '',
        '1. first\n2. second',
        '',
        '> quoted',
        '',
        '```\nx = 1\n```',
      ].join('\n'),
    );
  });

  it('writes a table as compact markdown, padding short rows so no cell shifts column', () => {
    const markdown = blocksToMarkdown([{ kind: 'table', rows: [['Name', 'Price'], ['Widget', '$4'], ['Gadget']] }]);

    expect(markdown).toBe(['| Name | Price |', '| --- | --- |', '| Widget | $4 |', '| Gadget |  |'].join('\n'));
    expect(markdown).not.toContain('<');
  });

  it('escapes a pipe inside a cell and drops empty blocks', () => {
    expect(blocksToMarkdown([{ kind: 'table', rows: [['a|b']] }])).toContain('a\\|b');
    expect(blocksToMarkdown([{ kind: 'text', text: '   ' }, { kind: 'heading', level: 2, text: 'Kept' }])).toBe('## Kept');
  });
});

describe('outlineOf', () => {
  const markdown = ['# Top', 'intro', '## One', 'a'.repeat(50), '### Deep', 'b', '## Two', 'c'].join('\n\n');
  const sections = outlineOf(markdown);

  it('numbers every heading and ends a section at the next heading of its rank or higher', () => {
    expect(sections.map(section => [section.id, section.level, section.title])).toEqual([
      ['s1', 1, 'Top'],
      ['s2', 2, 'One'],
      ['s3', 3, 'Deep'],
      ['s4', 2, 'Two'],
    ]);
    // The h1 holds the whole document; "One" ends where "Two" starts, and contains "Deep".
    expect(sections[0].end).toBe(markdown.length);
    expect(sections[1].end).toBe(sections[3].start);
    expect(sections[2].end).toBe(sections[3].start);
    expect(markdown.slice(sections[1].start, sections[1].end)).toContain('### Deep');
  });

  it('finds a section by id, by exact title and by part of a title', () => {
    expect(findSection(sections, 's3')?.title).toBe('Deep');
    expect(findSection(sections, 'two')?.id).toBe('s4');
    expect(findSection(sections, 'ee')?.id).toBe('s3');
    expect(findSection(sections, 'nothing here')).toBeUndefined();
  });

  it('renders the outline with each section size', () => {
    expect(renderOutline(sections)).toContain('s2 ## One [');
    expect(renderOutline(sections, 2).trim().split('\n')).toHaveLength(3);
    expect(renderOutline(sections, 2)).toContain('[2 more sections]');
    expect(renderOutline([])).toBe('');
  });
});

describe('sliceRead', () => {
  const text = ['line one', 'line two', 'line three', 'line four'].join('\n');

  it('returns the whole text and no cursor when it fits', () => {
    expect(sliceRead(text, 0, 1000)).toEqual({ body: text, next: null });
  });

  it('cuts at a line break so a table row is never split, and the cursor continues there', () => {
    const first = sliceRead(text, 0, 20);
    expect(first.body).toBe('line one\nline two');
    expect(first.next).toBe(17);

    const second = sliceRead(text, first.next as number, 20);
    expect(second.body).toBe('\nline three');
    const third = sliceRead(text, second.next as number, 20);
    expect(third.next).toBeNull();
    expect(first.body + second.body + third.body).toBe(text);
  });

  it('cuts hard when there is no line break to cut at', () => {
    const solid = 'x'.repeat(1000);
    expect(sliceRead(solid, 0, 200).body).toHaveLength(200);
  });

  it('clamps a cursor outside the text and a tiny budget', () => {
    expect(sliceRead(text, -5, 1000).body).toBe(text);
    expect(sliceRead(text, 1000, 1000).body).toBe('');
    expect(sliceRead('y'.repeat(500), 0, 1).body).toHaveLength(1);
  });
});

describe('typed extraction', () => {
  const productSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'product name' },
        price: { type: 'number' },
        in_stock: { type: 'boolean' },
      },
      required: ['name'],
    },
  };

  it('reads the fields a schema asks for, for one object and for a list', () => {
    expect(schemaFields(productSchema)).toEqual({
      many: true,
      required: ['name'],
      fields: [
        { name: 'name', type: 'string', description: 'product name' },
        { name: 'price', type: 'number', description: undefined },
        { name: 'in_stock', type: 'boolean', description: undefined },
      ],
    });
    expect(schemaFields({ type: 'object', properties: { title: { type: 'string' } } }).many).toBe(false);
    expect(schemaFields({}).fields).toEqual([]);
  });

  it('parses the markdown table whose headers answer most of the fields', () => {
    const markdown = [
      '| Colour | Note |',
      '| --- | --- |',
      '| red | none |',
      '',
      '| Product name | Price | In stock |',
      '| --- | --- | --- |',
      '| Widget | $4.50 | yes |',
      '| Gadget | $12 | no |',
    ].join('\n');

    const rows = extractFromTables(markdown, schemaFields(productSchema).fields);

    expect(rows).toHaveLength(2);
    expect(rows[0].name.value).toBe('Widget');
    expect(rows[0].price.value).toBe(4.5);
    expect(rows[0].in_stock.value).toBe(true);
    expect(rows[1].in_stock.value).toBe(false);
    // An exactly matching header is surer than one that only contains the field's name.
    expect(rows[0].price.confidence).toBeGreaterThan(rows[0].name.confidence);
    expect(rows[0].price.source).toBe('table');
  });

  it('falls back to Label: value lines for a single object', () => {
    const markdown = ['# Widget', '**Price:** $4.50', 'In stock: yes', 'Unrelated line'].join('\n');

    const found = extractFromLabels(markdown, schemaFields(productSchema).fields);

    expect(found.price).toEqual({ value: 4.5, source: 'labels', confidence: 0.8 });
    expect(found.in_stock.value).toBe(true);
    expect(found.name).toBeUndefined();
  });

  it('reads values as the type the schema asks for', () => {
    expect(coerce('$1,299.99', 'number')).toBe(1299.99);
    expect(coerce('$1,299.99', 'integer')).toBe(1299);
    expect(coerce('out of stock', 'boolean')).toBe(false);
    expect(coerce('maybe', 'boolean')).toBeUndefined();
    expect(coerce('  n/a  ', 'string')).toBe('n/a');
    expect(coerce('   ', 'string')).toBeUndefined();
  });

  it('names what does not match the schema', () => {
    expect(schemaProblems([{ name: 'Widget' }], productSchema)).toEqual([]);
    expect(schemaProblems([{ price: 4 }], productSchema)).toEqual(['result[0].name: missing']);
    expect(schemaProblems([{ name: 'Widget', price: 'free' }], productSchema)).toEqual(['result[0].price: expected a number']);
    expect(schemaProblems({ name: 'Widget' }, productSchema)).toEqual(['result: expected a list']);
  });
});

describe('hashText', () => {
  it('is stable for the same text and differs for changed text', () => {
    expect(hashText('same')).toBe(hashText('same'));
    expect(hashText('same')).not.toBe(hashText('samf'));
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
