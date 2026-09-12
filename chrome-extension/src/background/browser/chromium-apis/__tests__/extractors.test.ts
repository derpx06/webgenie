import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => {
  return {};
});

import { cdpBridge } from '../cdp-bridge';

describe('Chromium APIs Dependency Injection Tests', () => {
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = {
      attachDebugger: vi.fn().mockResolvedValue(undefined),
      detachDebugger: vi.fn().mockResolvedValue(undefined),
      sendDebuggerCommand: vi.fn().mockImplementation(async (target, method, params) => {
        if (method === 'DOMSnapshot.captureSnapshot') {
          return {
            documents: [
              {
                nodes: {
                  nodeName: [0, 1], // 0: "#document", 1: "BUTTON"
                  nodeType: [9, 1],
                  backendNodeId: [100, 101],
                  attributes: [[], []],
                },
                layout: {
                  nodeIndex: [1],
                  bounds: [[10, 20, 100, 50]], // x, y, width, height
                },
                textBoxes: {
                  nodeIndex: [],
                  bounds: [],
                },
              },
            ],
            strings: ['#document', 'BUTTON'],
          };
        }
        if (method === 'Accessibility.getFullAXTree') {
          return {
            nodes: [
              {
                nodeId: '1',
                role: { value: 'WebArea' },
                name: { value: 'Test AX Page' },
                childIds: ['2', '3'],
              },
              {
                nodeId: '2',
                parentId: '1',
                role: { value: 'button' },
                name: { value: 'Click Me' },
                backendDOMNodeId: 101,
              },
              {
                nodeId: '3',
                parentId: '1',
                role: { value: 'heading' },
                name: { value: 'Visible page heading' },
              },
            ],
          };
        }
        if (method === 'DOM.getBoxModel') {
          return {
            model: {
              content: [10, 20, 110, 20, 110, 70, 10, 70], // quad: x1,y1, x2,y2, x3,y3, x4,y4
            },
          };
        }
        return {};
      }),
      getDebuggerTargets: vi.fn().mockResolvedValue([]),
    };
  });

  describe('CDPBridge DI', () => {
    it('uses injected adapter to attach, send commands, and detach', async () => {
      cdpBridge.setBrowserAdapter(mockAdapter);

      await cdpBridge.attach(123);
      expect(mockAdapter.attachDebugger).toHaveBeenCalledWith({ tabId: 123 }, '1.3');

      await cdpBridge.send(123, 'DOM.getDocument', { depth: 1 });
      expect(mockAdapter.sendDebuggerCommand).toHaveBeenCalledWith(
        { tabId: 123 },
        'DOM.getDocument',
        { depth: 1 }
      );

      await cdpBridge.detach(123);
      expect(mockAdapter.detachDebugger).toHaveBeenCalledWith({ tabId: 123 });
    });
  });
});
