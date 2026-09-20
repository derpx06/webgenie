import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDomState, coveringLayer, documentLayout, getAXTreeState, isSkipLink, parseRadius, type AXNode, type FrameTree } from '../ax-tree-extractor';
import { pruneAXTree } from '../../dom/ax-tree-pruner';
import type { DOMElementNode } from '../../dom/views';

const text = (id: string, name: string): AXNode => ({ nodeId: id, role: { value: 'StaticText' }, name: { value: name }, childIds: [`${id}-box`] });
const box = (id: string, name: string): AXNode => ({ nodeId: `${id}-box`, role: { value: 'InlineTextBox' }, name: { value: name } });
const layoutOf = (entries: Array<[number, Partial<{ tagName: string; x: number; y: number; attributes: Record<string, string> }>]>) => ({
  scrollX: 0,
  scrollY: 0,
  nodes: new Map(entries.map(([id, l]) => [id, { tagName: l.tagName ?? 'div', attributes: l.attributes ?? {}, x: l.x ?? 0, y: l.y ?? 0, width: 50, height: 20 }])),
});

function fixture(): FrameTree[] {
  const main: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Page' }, childIds: ['2'] },
    { nodeId: '2', ignored: true, role: { value: 'none' }, childIds: ['3'] },
    { nodeId: '3', ignored: true, role: { value: 'none' }, childIds: ['4', '6', '9', '11', '13', '15', '17', '19'] },
    { nodeId: '4', role: { value: 'heading' }, name: { value: 'Welcome' }, backendDOMNodeId: 40, childIds: ['5'] },
    text('5', 'Welcome'),
    box('5', 'Welcome'),
    { nodeId: '6', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 60, childIds: ['7'] },
    text('7', 'Save'),
    box('7', 'Save'),
    { nodeId: '9', role: { value: 'button' }, name: { value: 'Delete' }, backendDOMNodeId: 90, properties: [{ name: 'disabled', value: { value: true } }], childIds: ['10'] },
    text('10', 'Delete'),
    { nodeId: '11', role: { value: 'gridcell' }, name: { value: 'Cell' }, backendDOMNodeId: 110, childIds: ['12'] },
    text('12', 'Cell'),
    {
      nodeId: '13',
      role: { value: 'generic' },
      backendDOMNodeId: 130,
      properties: [{ name: 'editable', value: { value: 'richtext' } }, { name: 'focusable', value: { value: true } }],
    },
    { nodeId: '15', role: { value: 'link' }, name: { value: 'Docs' }, backendDOMNodeId: 150, properties: [{ name: 'url', value: { value: 'https://example.com/docs' } }], childIds: ['16'] },
    text('16', 'Docs'),
    { nodeId: '17', role: { value: 'Iframe' }, name: { value: 'Embedded editor' }, backendDOMNodeId: 170 },
    { nodeId: '19', role: { value: 'image' }, name: { value: 'Company logo' }, backendDOMNodeId: 190 },
  ];
  const child: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
    { nodeId: '2', role: { value: 'textbox' }, name: { value: 'Notes' }, backendDOMNodeId: 5, properties: [{ name: 'focusable', value: { value: true } }] },
  ];
  return [
    {
      key: 'main',
      nodes: main,
      layout: layoutOf([[60, { tagName: 'button', y: 10 }], [150, { tagName: 'a', y: 5000 }], [170, { tagName: 'iframe', x: 100, y: 200 }]]),
    },
    { key: 'child', parentKey: 'main', hostBackendNodeId: 170, nodes: child, layout: layoutOf([[5, { tagName: 'div', x: 10, y: 20 }]]) },
  ];
}

describe('buildDomState', () => {
  const state = pruneAXTree(buildDomState(fixture(), { width: 1000, height: 800 }));
  const serialized = state.elementTree.clickableElementsToString();
  const byLabel = (label: string) => [...state.selectorMap.values()].find(node => node.attributes['aria-label'] === label);

  it('indexes interactive nodes 0..n-1 in document order across frames', () => {
    expect([...state.selectorMap.keys()]).toEqual([0, 1, 2, 3, 4]);
    expect([...state.selectorMap.values()].map(node => node.attributes['aria-label'] ?? node.attributes.role)).toEqual([
      'Save',
      'Delete',
      'generic',
      'Docs',
      'Notes',
    ]);
  });

  it('keeps text under ignored wrappers and shows element text once', () => {
    expect(serialized.match(/Welcome/g)).toHaveLength(1);
    expect(serialized.match(/Save/g)).toHaveLength(1);
    expect(serialized).toContain('Company logo');
    expect(serialized).not.toContain('Page');
  });

  it('applies the interactive rule: disabled controls and contenteditable are indexed, plain grid cells are not', () => {
    expect(byLabel('Delete')?.attributes['aria-disabled']).toBe('true');
    expect(byLabel('Cell')).toBeUndefined();
    expect(serialized).toContain('Cell');
    expect(state.selectorMap.get(2)?.frameKey).toBe('main');
  });

  it('maps link urls to href and marks offscreen elements', () => {
    const docs = byLabel('Docs')!;
    expect(docs.attributes.href).toBe('https://example.com/docs');
    expect(docs.tagName).toBe('a');
    expect(docs.isInViewport).toBe(false);
    expect(byLabel('Save')?.isInViewport).toBe(true);
  });

  it('places child-frame nodes under their iframe with frame-offset coordinates', () => {
    const notes = byLabel('Notes')!;
    expect(notes.frameKey).toBe('child');
    let ancestor: DOMElementNode | null = notes.parent;
    while (ancestor && ancestor.tagName !== 'iframe') ancestor = ancestor.parent;
    expect(ancestor?.backendNodeId).toBe(170);
    expect(notes.viewportCoordinates?.topLeft).toEqual({ x: 110, y: 220 });
  });
});

describe('pointer targets', () => {
  it('indexes elements the page made clickable or draggable and named images, not unnamed images or wrappers of controls', () => {
    const box = (x: number, extra: Partial<{ clickable: boolean; attributes: Record<string, string>; width: number; height: number }> = {}) => ({
      tagName: 'div', attributes: {}, x, y: 10, width: 100, height: 40, ...extra,
    });
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3', '4', '5', '7', '9', '10'] },
      { nodeId: '10', role: { value: 'image' }, backendDOMNodeId: 10 },
      { nodeId: '2', role: { value: 'generic' }, backendDOMNodeId: 2, childIds: ['2t'] },
      text('2t', 'Box A'),
      { nodeId: '3', role: { value: 'generic' }, backendDOMNodeId: 3, childIds: ['3t'] },
      text('3t', 'Open details'),
      { nodeId: '4', role: { value: 'image' }, name: { value: 'User avatar' }, backendDOMNodeId: 4 },
      { nodeId: '5', role: { value: 'generic' }, backendDOMNodeId: 5, childIds: ['6'] },
      { nodeId: '6', role: { value: 'button' }, name: { value: 'Buy' }, backendDOMNodeId: 6 },
      { nodeId: '7', role: { value: 'link' }, name: { value: 'Home' }, backendDOMNodeId: 7, childIds: ['8'] },
      { nodeId: '8', role: { value: 'image' }, name: { value: 'Logo' }, backendDOMNodeId: 8 },
      { nodeId: '9', role: { value: 'generic' }, backendDOMNodeId: 9, childIds: ['9t'] },
      text('9t', 'Whole page'),
    ];
    const layout = {
      scrollX: 0,
      scrollY: 0,
      nodes: new Map([
        [2, box(0, { attributes: { draggable: 'true' } })],
        [3, box(110, { clickable: true })],
        [4, box(220)],
        [5, box(330, { clickable: true })],
        [8, box(440)],
        [9, box(0, { clickable: true, width: 1000, height: 800 })],
        [10, box(550)],
      ]),
    };
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout }], { width: 1000, height: 800 }));
    const indexed = [...state.selectorMap.values()].map(node => node.attributes['aria-label'] ?? node.getAllTextTillNextClickableElement());

    // The named avatar is a hover target; the unnamed image (10) and the logo inside a link get no index of their own.
    expect(indexed).toEqual(['Box A', 'Open details', 'User avatar', 'Buy', 'Home']);
    expect(state.selectorMap.get(0)?.attributes.draggable).toBe('true');
  });

  it('indexes an element the accessibility tree ignores when it has its own pointer listener', () => {
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
      text('2', 'Right-click in the box below'),
      // An empty div with only a contextmenu handler: ignored by the accessibility tree.
      { nodeId: '3', ignored: true, role: { value: 'none' }, backendDOMNodeId: 30 },
    ];
    const layout = { scrollX: 0, scrollY: 0, nodes: new Map([[30, { tagName: 'div', attributes: {}, x: 10, y: 60, width: 250, height: 150 }]]) };

    const withoutListener = pruneAXTree(buildDomState([{ key: 'main', nodes, layout }], { width: 1000, height: 800 }));
    const withListener = pruneAXTree(buildDomState([{ key: 'main', nodes, layout, pointerListeners: new Set([30]) }], { width: 1000, height: 800 }));

    expect(withoutListener.selectorMap.size).toBe(0);
    expect(withListener.selectorMap.get(0)?.backendNodeId).toBe(30);
  });

  it('reads nothing hidden with aria-hidden, even a draggable element with its own listener', () => {
    // Like the agent's own status overlay: aria-hidden, draggable, with a text label inside.
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
      text('2', 'Log in'),
      {
        nodeId: '3',
        ignored: true,
        ignoredReasons: [{ name: 'ariaHiddenElement', value: { type: 'boolean', value: true } }],
        role: { value: 'none' },
        backendDOMNodeId: 30,
        childIds: ['4'],
      },
      { nodeId: '4', ignored: true, ignoredReasons: [{ name: 'ariaHiddenSubtree' }], role: { value: 'StaticText' }, name: { value: 'Input tomsmith into index 2' } },
    ];
    const layout = { scrollX: 0, scrollY: 0, nodes: new Map([[30, { tagName: 'div', attributes: { draggable: 'true' }, x: 10, y: 60, width: 250, height: 40 }]]) };

    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout, pointerListeners: new Set([30]) }], { width: 1000, height: 800 }));

    expect(state.selectorMap.size).toBe(0);
    expect(JSON.stringify(state.elementTree, (key, value) => (key === 'parent' ? undefined : value))).not.toContain('Input tomsmith');
  });
});

describe('coordinates', () => {
  it('converts device-pixel snapshots to CSS pixels and keeps page coordinates for scrolled pages', () => {
    const strings = ['INPUT'];
    // Measured on a 1.5417 display scale: CSS rect x 117.26 y 16.0 w 180.4, page scrolled by 99.9 CSS px.
    const layout = documentLayout(
      { frameId: 0, nodes: { nodeName: [0], backendNodeId: [7] }, layout: { nodeIndex: [0], bounds: [[180.78, 178.66, 278.16, 33.06]] }, scrollOffsetY: 154 },
      strings,
      1.5417,
    );
    expect(layout.nodes.get(7)?.x).toBeCloseTo(117.26, 1);
    expect(layout.nodes.get(7)?.width).toBeCloseTo(180.42, 1);
    expect(layout.scrollY).toBeCloseTo(99.89, 1);

    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
      { nodeId: '2', role: { value: 'textbox' }, name: { value: 'Customer name' }, backendDOMNodeId: 7 },
    ];
    const state = buildDomState([{ key: 'main', nodes, layout }], { width: 1363, height: 717 });
    const field = state.selectorMap.get(0)!;
    // Viewport position is document position minus scroll; page position is the document position.
    expect(field.viewportCoordinates?.topLeft.y).toBeCloseTo(115.9 - 99.89, 0);
    expect(field.pageCoordinates?.topLeft.y).toBeCloseTo(115.9, 0);
    expect(field.isInViewport).toBe(true);
  });
});

describe('link addresses', () => {
  it('shows same-site links as their path and other sites in full', () => {
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
      { nodeId: '2', role: { value: 'link' }, name: { value: 'Excel' }, properties: [{ name: 'url', value: { value: 'https://example.com/download/jqueryui/menu/menu.xls' } }] },
      { nodeId: '3', role: { value: 'link' }, name: { value: 'Docs' }, properties: [{ name: 'url', value: { value: 'https://docs.other.org/guide?x=1#top' } }] },
    ];
    const state = buildDomState([{ key: 'main', url: 'https://example.com/jqueryui/menu', nodes }], null);
    expect(state.selectorMap.get(0)?.attributes.href).toBe('/download/jqueryui/menu/menu.xls');
    expect(state.selectorMap.get(1)?.attributes.href).toBe('https://docs.other.org/guide?x=1#top');
  });
});

describe('native selects', () => {
  const selectTree = (count: number, selected: number): AXNode[] => [
    { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['s', 'b'] },
    { nodeId: 's', role: { value: 'combobox' }, name: { value: 'Country' }, backendDOMNodeId: 5, childIds: ['p'] },
    { nodeId: 'p', role: { value: 'MenuListPopup' }, childIds: Array.from({ length: count }, (_, i) => `o${i}`) },
    ...Array.from({ length: count }, (_, i): AXNode => ({
      nodeId: `o${i}`,
      role: { value: 'option' },
      name: { value: `Country ${i}` },
      properties: i === selected ? [{ name: 'selected', value: { value: true } }] : [],
    })),
    { nodeId: 'b', role: { value: 'button' }, name: { value: 'Continue' }, backendDOMNodeId: 6 },
  ];
  const layout = { scrollX: 0, scrollY: 0, nodes: new Map([[5, { tagName: 'select', attributes: {}, x: 0, y: 0, width: 100, height: 20 }]]) };

  it('lists a long select as one element with its value and option count', () => {
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes: selectTree(240, 3), layout }], null));
    expect(state.selectorMap.size).toBe(2);
    const select = state.selectorMap.get(0)!;
    expect(select.tagName).toBe('select');
    expect(select.attributes.value).toBe('Country 3');
    expect(select.attributes.options).toBe('240');
    const serialized = state.elementTree.clickableElementsToString();
    expect(serialized).toContain('value="Country 3"');
    expect(serialized).toContain('options="240"');
    expect(serialized).not.toContain('Country 7');
  });

  it('names the options of a short select', () => {
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes: selectTree(3, 0), layout }], null));
    expect(state.selectorMap.get(0)?.attributes.options).toBe('Country 0 | Country 1 | Country 2');
    expect(state.selectorMap.get(1)?.attributes['aria-label']).toBe('Continue');
  });

  it('keeps ARIA listbox options as their own elements', () => {
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['l'] },
      { nodeId: 'l', role: { value: 'listbox' }, name: { value: 'Sizes' }, backendDOMNodeId: 7, childIds: ['a', 'b'] },
      { nodeId: 'a', role: { value: 'option' }, name: { value: 'Small' } },
      { nodeId: 'b', role: { value: 'option' }, name: { value: 'Large' } },
    ];
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes }], null));
    expect(state.selectorMap.size).toBe(3);
  });
});

describe('cursor as a clickability signal', () => {
  // Nodes: 0 body, 1 a div a framework made clickable (cursor: pointer), 2 the span inside it, which only inherits
  // that cursor, 3 a control the page switched off with cursor: not-allowed.
  const strings = ['BODY', 'DIV', 'SPAN', 'visible', 'static', 'auto', '0px', 'pointer', 'not-allowed'];
  const style = (cursor: number) => [6, 3, 3, 5, 3, 4, cursor];
  const doc = {
    frameId: 0,
    nodes: { nodeName: [0, 1, 2, 1], nodeType: [1, 1, 1, 1], backendNodeId: [10, 11, 12, 13], parentIndex: [-1, 0, 1, 0] },
    layout: {
      nodeIndex: [0, 1, 2, 3],
      bounds: [[0, 0, 1264, 368], [8, 32, 100, 30], [8, 32, 68, 17], [8, 80, 100, 30]],
      styles: [style(5), style(7), style(7), style(8)],
      paintOrders: [1, 2, 2, 3],
    },
  };

  it('treats an element that asks for a pointer as a target, but not what merely inherits it', () => {
    const layout = documentLayout(doc as never, strings);
    expect(layout.nodes.get(11)?.clickable).toBe(true);
    expect(layout.nodes.get(12)?.clickable).toBe(false);
  });

  it('reads cursor: not-allowed as disabled', () => {
    expect(documentLayout(doc as never, strings).nodes.get(13)?.attributes.disabled).toBe('true');
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
      { nodeId: '2', role: { value: 'button' }, name: { value: 'Add to cart' }, backendDOMNodeId: 13 },
    ];
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout: documentLayout(doc as never, strings) }], { width: 1000, height: 800 }));
    expect(state.elementTree.clickableElementsToString()).toContain('disabled="true"');
  });
});

describe('clipped and covered elements', () => {
  // Nodes: 0 body, 1 a collapsed panel (height 0, overflow hidden), 2 the button inside it, 3 a button lower down
  // the page, 4 a fixed cookie banner painted over it, 5 the banner's "Accept" button.
  const strings = ['BODY', 'DIV', 'BUTTON', 'visible', 'hidden', 'static', 'fixed', 'none', '0px', 'auto'];
  const style = (overflow: number, position: number, pointer = 9) => [8, overflow, overflow, pointer, 3, position];
  const doc = {
    frameId: 0,
    nodes: {
      nodeName: [0, 1, 2, 2, 1, 2],
      nodeType: [1, 1, 1, 1, 1, 1],
      backendNodeId: [10, 11, 12, 13, 14, 15],
      parentIndex: [-1, 0, 1, 0, 0, 4],
    },
    layout: {
      nodeIndex: [0, 1, 2, 3, 4, 5],
      bounds: [[0, 0, 1264, 368], [8, 180, 1264, 0], [8, 180, 100, 21], [10, 400, 100, 21], [0, 380, 300, 100], [10, 400, 80, 20]],
      styles: [style(3, 5), style(4, 5), style(3, 5), style(3, 5), style(3, 6), style(3, 6)],
      paintOrders: [1, 2, 2, 3, 4, 5],
    },
  };
  const nodes: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '4', '5'] },
    { nodeId: '2', ignored: true, role: { value: 'none' }, backendDOMNodeId: 11, childIds: ['3'] },
    { nodeId: '3', role: { value: 'button' }, name: { value: 'Filter by size' }, backendDOMNodeId: 12 },
    { nodeId: '4', role: { value: 'button' }, name: { value: 'Add to cart' }, backendDOMNodeId: 13 },
    { nodeId: '5', role: { value: 'dialog' }, name: { value: 'Cookie consent' }, backendDOMNodeId: 14, childIds: ['6'] },
    { nodeId: '6', role: { value: 'button' }, name: { value: 'Accept' }, backendDOMNodeId: 15 },
  ];

  it('marks a control its panel cuts away, and leaves one the panel would scroll to alone', () => {
    const layout = documentLayout(doc as never, strings);
    expect(layout.nodes.get(12)?.clipped).toBe(true);
    expect(layout.nodes.get(13)?.clipped).toBeUndefined();

    const scrolled = { ...doc, layout: { ...doc.layout, styles: doc.layout.styles.map((s, i) => (i === 1 ? style(9, 5) : s)) } };
    expect(documentLayout(scrolled as never, strings).nodes.get(12)?.clipped).toBeUndefined();
  });

  it('names the layer painted over an element, and not the element itself or what it holds', () => {
    const layout = documentLayout(doc as never, strings);
    expect(coveringLayer(layout, 13)).toBe(14);
    expect(coveringLayer(layout, 15)).toBeUndefined();
    expect(coveringLayer(layout, 14)).toBeUndefined();

    const serialized = pruneAXTree(buildDomState([{ key: 'main', nodes, layout }], { width: 1000, height: 800 })).elementTree.clickableElementsToString();
    expect(serialized).toContain('aria-label="Add to cart" covered="dialog Cookie consent"');
    expect(serialized).toContain('aria-label="Filter by size" hidden="clipped"');
    expect(serialized).not.toContain('aria-label="Accept" covered');
  });
});

describe('scroll containers', () => {
  // Nodes: 0 body, 1 the panel that scrolls (503 px of content in 100), 2 a button inside it, 3 a scroller nested in
  // the first one, 4 the page itself, which `scroll` moves without an index.
  const strings = ['BODY', 'DIV', 'BUTTON', 'auto', 'visible', '0px'];
  const doc = {
    frameId: 0,
    nodes: { nodeName: [0, 1, 2, 1], backendNodeId: [10, 11, 12, 13], parentIndex: [-1, 0, 1, 1] },
    layout: {
      nodeIndex: [0, 1, 2, 3],
      bounds: [[0, 0, 1264, 368], [8, 32, 1264, 100], [8, 40, 100, 20], [8, 80, 1264, 50]],
      styles: [[5, 3, 3], [5, 3, 3], [5, 4, 4], [5, 3, 3]],
      clientRects: [[0, 0, 1264, 368], [0, 0, 1264, 100], [0, 0, 100, 20], [0, 0, 1264, 50]],
      scrollRects: [[0, 0, 1264, 900], [0, 50, 1264, 503], [0, 0, 100, 20], [0, 0, 1264, 232]],
    },
  };

  it('measures the outermost scroller only, in screens of its own height, and never the page', () => {
    const layout = documentLayout(doc as never, strings);
    expect(layout.nodes.get(11)?.scroll).toEqual({ above: 0.5, below: 3.5 });
    expect(layout.nodes.get(10)?.scroll).toBeUndefined();
    expect(layout.nodes.get(13)?.scroll).toBeUndefined();
  });

  it('gives the panel an index and its own line, and keeps the text inside it where it is', () => {
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
      { nodeId: '2', ignored: true, role: { value: 'none' }, backendDOMNodeId: 11, childIds: ['3', '4'] },
      text('3', 'Filters'),
      { nodeId: '4', role: { value: 'button' }, name: { value: 'Apply' }, backendDOMNodeId: 12 },
    ];
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout: documentLayout(doc as never, strings) }], { width: 1000, height: 800 }));
    expect([...state.selectorMap.values()].map(node => node.tagName)).toEqual(['div', 'button']);
    expect(state.elementTree.clickableElementsToString()).toBe(
      ['[0]<div scroll="0.5 screens above, 3.5 screens below" />', '\tFilters', '\t[1]<button aria-label="Apply" />'].join('\n'),
    );
  });
});

describe('native date and time inputs', () => {
  // As Chrome reads <label>Start <input type=date value=2025-09-18></label>: the input's role is its internal name
  // and its user-agent segments are spinbutton spans (a <span> takes no text).
  const nodes: AXNode[] = [
    { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
    { nodeId: '2', role: { type: 'internalRole', value: 'Date' }, name: { value: 'Start' }, value: { value: '2025-09-18' }, backendDOMNodeId: 11, childIds: ['3', '9'] },
    { nodeId: '3', ignored: true, role: { value: 'none' }, backendDOMNodeId: 12, childIds: ['4', '6', '8'] },
    { nodeId: '4', role: { value: 'spinbutton' }, name: { value: 'Day Day' }, value: { value: 18 }, backendDOMNodeId: 15, childIds: ['5'] },
    text('5', '18'),
    { nodeId: '6', role: { value: 'spinbutton' }, name: { value: 'Month Month' }, value: { value: 9 }, backendDOMNodeId: 17, childIds: ['7'] },
    text('7', '09'),
    { nodeId: '8', role: { value: 'button' }, name: { value: 'Show date picker' }, backendDOMNodeId: 20 },
    { nodeId: '9', role: { value: 'MenuListPopup' }, childIds: [] },
  ];
  const layout = layoutOf([[11, { tagName: 'input', attributes: { type: 'date' } }], [15, { tagName: 'span' }], [17, { tagName: 'span' }], [20, { tagName: 'div' }]]);

  it('lists the input alone, with its ISO value and the format it takes, and never its segments', () => {
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout }], { width: 1000, height: 800 }));
    expect(state.selectorMap.size).toBe(1);
    const field = state.selectorMap.get(0)!;
    expect(field.tagName).toBe('input');
    expect(field.attributes).toMatchObject({ type: 'date', value: '2025-09-18', format: 'YYYY-MM-DD' });
    const serialized = state.elementTree.clickableElementsToString();
    expect(serialized).toBe('[0]<input type="date" aria-label="Start" value="2025-09-18" format="YYYY-MM-DD" />');
  });

  it('collapses every date-family input, and shows no value for an empty one', () => {
    for (const [type, format] of [['time', 'HH:MM'], ['datetime-local', 'YYYY-MM-DDTHH:MM'], ['month', 'YYYY-MM'], ['week', 'YYYY-Www']]) {
      const empty = nodes.map(node => (node.nodeId === '2' ? { ...node, role: { type: 'internalRole', value: 'DateTime' }, value: undefined } : node));
      const state = pruneAXTree(
        buildDomState([{ key: 'main', nodes: empty, layout: layoutOf([[11, { tagName: 'input', attributes: { type } }], [15, { tagName: 'span' }]]) }], null),
      );
      expect(state.selectorMap.size).toBe(1);
      expect(state.selectorMap.get(0)?.attributes).toMatchObject({ type, format });
      expect(state.selectorMap.get(0)?.attributes.value).toBeUndefined();
    }
  });
});

describe('skip links', () => {
  it('drops keyboard skip links to a fragment of the same page, keeps other links', () => {
    const link = (id: string, name: string, url: string): AXNode => ({
      nodeId: id,
      role: { value: 'link' },
      name: { value: name },
      properties: [{ name: 'url', value: { value: url } }],
    });
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['a', 'b', 'c', 'd'] },
      link('a', 'Skip to main content', 'https://example.com/list?q=1#main'),
      link('b', 'Skip navigation', 'https://example.com/list?q=1#nav'),
      link('c', 'Skip to checkout', 'https://example.com/checkout'),
      link('d', 'Results', 'https://example.com/list?q=1#results'),
    ];
    const state = buildDomState([{ key: 'main', url: 'https://example.com/list?q=1', nodes }], null);
    expect([...state.selectorMap.values()].map(node => node.attributes['aria-label'])).toEqual(['Skip to checkout', 'Results']);
    expect(isSkipLink('Skip to filters', 'https://example.com/#filters', undefined)).toBe(false);
  });
});

describe('documentLayout', () => {
  it('maps backend node ids to their first layout box, lowercase tag and selected attributes', () => {
    const strings = ['INPUT', 'type', 'password', 'class', 'x', 'frame-1'];
    const layout = documentLayout(
      {
        frameId: 5,
        nodes: { nodeName: [0, 0], backendNodeId: [11, 12], attributes: [[1, 2, 3, 4], []] },
        layout: { nodeIndex: [0, 0, 1], bounds: [[1, 2, 30, 40], [9, 9, 9, 9], [5, 6, 7, 8]] },
        scrollOffsetY: 300,
      },
      strings,
    );

    expect(layout.scrollY).toBe(300);
    expect(layout.nodes.get(11)).toEqual({ tagName: 'input', attributes: { type: 'password' }, clickable: false, x: 1, y: 2, width: 30, height: 40 });
    expect(layout.nodes.get(12)?.x).toBe(5);
  });
});

describe('checked state of custom-styled checkboxes and radios', () => {
  // Nodes: 0 label[for=a], 1 input#a checkbox (checked, no box), 2 label, 3 input radio inside it (no box),
  // 4 label[for=c], 5 input#c checkbox with its own box.
  const strings = ['LABEL', 'INPUT', 'for', 'a', 'id', 'type', 'checkbox', 'radio', 'c'];
  const doc = {
    frameId: 0,
    nodes: {
      nodeName: [0, 1, 0, 1, 0, 1],
      backendNodeId: [10, 11, 12, 13, 14, 15],
      parentIndex: [-1, -1, -1, 2, -1, -1],
      attributes: [[2, 3], [4, 3, 5, 6], [], [5, 7], [2, 8], [4, 8, 5, 6]],
      isClickable: { index: [0, 2, 4] },
      inputChecked: { index: [1, 5] },
    },
    layout: { nodeIndex: [0, 2, 4, 5], bounds: [[0, 0, 80, 20], [0, 30, 80, 20], [0, 60, 80, 20], [0, 60, 16, 16]] },
  };

  it('puts a hidden input\'s checked state on its label, by for= or by nesting, and leaves visible inputs alone', () => {
    const layout = documentLayout(doc, strings);
    expect(layout.nodes.get(10)?.attributes.checked).toBe('true');
    expect(layout.nodes.get(12)?.attributes.checked).toBe('false');
    expect(layout.nodes.get(14)?.attributes.checked).toBeUndefined();
  });

  it('shows the state on the label the model clicks, and the accessibility state on a boxless input', () => {
    const frames: FrameTree[] = [{
      key: 'main',
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '4'] },
        { nodeId: '2', ignored: true, role: { value: 'none' }, backendDOMNodeId: 10, childIds: ['3'] },
        text('3', '4 stars & up'),
        { nodeId: '4', role: { value: 'checkbox' }, name: { value: 'Free shipping' }, backendDOMNodeId: 11, properties: [{ name: 'checked', value: { value: 'false' } }] },
      ],
      layout: documentLayout(doc, strings),
    }];
    const serialized = pruneAXTree(buildDomState(frames, { width: 1000, height: 800 })).elementTree.clickableElementsToString();
    expect(serialized).toMatch(/\[\d\]<label checked="true"[^>]*>4 stars & up \/>/);
    expect(serialized).toMatch(/\[\d\]<input role="checkbox" aria-label="Free shipping" aria-checked="false" \/>/);
  });
});

describe('getAXTreeState on a slow page', () => {
  afterEach(() => vi.useRealTimers());

  const pageWith = (treeReplies: Array<() => Promise<unknown>>) => {
    const send = vi.fn((method: string) => {
      if (method === 'Accessibility.getFullAXTree') return (treeReplies.shift() ?? (() => new Promise(() => undefined)))();
      if (method === 'DOMSnapshot.captureSnapshot') return Promise.resolve({ documents: [], strings: [] });
      return Promise.reject(new Error('unsupported'));
    });
    const frame = { client: { send }, _id: 'main', detached: false, url: () => 'https://example.com/', parentFrame: () => null, evaluateHandle: () => Promise.reject(new Error('no')) };
    return { page: { frames: () => [frame], mainFrame: () => frame } as unknown as Parameters<typeof getAXTreeState>[0], send };
  };
  const nodes = [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Page' }, childIds: [] }];

  it('gives the main document a longer second try', async () => {
    vi.useFakeTimers();
    const { page, send } = pageWith([() => new Promise(() => undefined), () => Promise.resolve({ nodes })]);
    const read = getAXTreeState(page);
    await vi.advanceTimersByTimeAsync(3000);
    const state = await read;
    expect(send.mock.calls.filter(([method]) => method === 'Accessibility.getFullAXTree')).toHaveLength(2);
    expect(state.unreadable).toBeUndefined();
  });

  it('marks the page unreadable, not empty, when both tries time out', async () => {
    vi.useFakeTimers();
    const { page } = pageWith([]);
    const read = getAXTreeState(page);
    await vi.advanceTimersByTimeAsync(20000);
    expect((await read).unreadable).toBe(true);
  });
});

describe('corner radius', () => {
  it('reads a pixel radius, resolves a percentage against the shorter side and caps it at half the box', () => {
    expect(parseRadius('8px', 200, 40)).toBe(8);
    expect(parseRadius('25%', 200, 40)).toBe(10);
    expect(parseRadius('9999px', 200, 40)).toBe(20);
  });

  it('is no radius for a square corner, a missing value or anything it cannot measure', () => {
    for (const value of [undefined, '', '0px', 'calc(2px + 1em)', 'inherit', '-4px'])
      expect(parseRadius(value, 200, 40)).toBeUndefined();
  });

  it('carries the snapshot style through to the layout node', () => {
    const doc = {
      frameId: 0,
      nodes: { nodeName: [1], backendNodeId: [77], attributes: [[]] },
      layout: { nodeIndex: [0], bounds: [[0, 0, 120, 48]], styles: [[2]] },
    };
    const layout = documentLayout(doc as never, ['', 'BUTTON', '24px'], 1);
    expect(layout.nodes.get(77)?.radius).toBe(24);
  });
});
