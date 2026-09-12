import { describe, expect, it } from 'vitest';
import { buildDomState, documentLayout, type AXNode, type FrameTree } from '../ax-tree-extractor';
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
  it('indexes elements the page made clickable or draggable and standalone images, not wrappers of controls', () => {
    const box = (x: number, extra: Partial<{ clickable: boolean; attributes: Record<string, string>; width: number; height: number }> = {}) => ({
      tagName: 'div', attributes: {}, x, y: 10, width: 100, height: 40, ...extra,
    });
    const nodes: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3', '4', '5', '7', '9'] },
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
      ]),
    };
    const state = pruneAXTree(buildDomState([{ key: 'main', nodes, layout }], { width: 1000, height: 800 }));
    const indexed = [...state.selectorMap.values()].map(node => node.attributes['aria-label'] ?? node.getAllTextTillNextClickableElement());

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
