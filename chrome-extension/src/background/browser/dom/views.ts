import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import type { CoordinateSet, HashedDomElement, ViewportInfo } from './history/view';
import { HistoryTreeProcessor } from './history/service';
import { capTextLength } from '../util';

export const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title',
  'type',
  'checked',
  'name',
  'role',
  'value',
  // The format a native date or time input takes, which its segments do not show.
  'format',
  'placeholder',
  'data-date-format',
  'data-state',
  'alt',
  'aria-checked',
  'aria-label',
  'aria-expanded',
  'href',
  // Additional AX/semantic attributes for richer LLM context
  'aria-description',
  'aria-selected',
  'aria-pressed',
  'aria-current',
  'aria-haspopup',
  'aria-disabled',
  'aria-required',
  'aria-readonly',
  'aria-invalid',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuetext',
  'aria-autocomplete',
  'draggable',
  'data-value',
  // A panel that scrolls on its own, and how much of its content sits outside it.
  'scroll',
  // Cut away by a closed or scrolled-past panel, and what the page paints on top of the element.
  'hidden',
  'covered',
  // A native select's option count, or its option names when few.
  'options',
];

/** Longest address shown on an element line: `href` was 22% of the element block's characters in a live run. */
const MAX_HREF_CHARS = 60;
const HREF_HEAD_CHARS = 24;

/**
 * Offscreen elements are marked by this one character after the index instead of an `offscreen="true"` attribute:
 * 58.7% of element-block lines carry the mark and the attribute spelling was 9.2% of the whole block's characters.
 * The prompt's `# Interactive elements` section documents it.
 */
export const OFFSCREEN_MARKER = '^';
/** A rendered element line for an element outside the visible part of the page. */
export const OFFSCREEN_LINE = /^\t*\*?\[\d+\]\^/;

/**
 * A long address keeps its start and, when it carries a query, its end: requirements are applied with `name=value`
 * parameters and quoted as evidence (`validation/done-evidence.ts`), so the middle of the path is what goes.
 */
export function capHref(href: string, maxLength = MAX_HREF_CHARS): string {
  if (href.length <= maxLength) return href;
  if (!href.includes('?')) return capTextLength(href, maxLength);
  return `${href.slice(0, HREF_HEAD_CHARS)}...${href.slice(HREF_HEAD_CHARS - maxLength)}`;
}

export abstract class DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;

  constructor(isVisible: boolean, parent?: DOMElementNode | null) {
    this.isVisible = isVisible;
    // Use None as default and set parent later to avoid circular reference issues
    this.parent = parent ?? null;
  }
}

export class DOMTextNode extends DOMBaseNode {
  type = 'TEXT_NODE' as const;
  text: string;

  constructor(text: string, isVisible: boolean, parent?: DOMElementNode | null) {
    super(isVisible, parent);
    this.text = text;
  }

  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current != null) {
      // A scroll container is indexed so it can be scrolled, not as a control: the text inside it is still page text.
      if (current.highlightIndex !== null && !current.scrollOnly) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  isParentInViewport(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isInViewport;
  }

  isParentTopElement(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isTopElement;
  }
}

export class DOMElementNode extends DOMBaseNode {
  /** Short label for logs and error messages, e.g. `[3]<select>`. */
  toString(): string {
    return `[${this.highlightIndex ?? '?'}]<${this.tagName}>`;
  }

  tagName: string | null;
  /**
   * xpath: the xpath of the element from the last root node (shadow root or iframe OR document if no shadow root or iframe).
   * To properly reference the element we need to recursively switch the root node until we find the element (work you way up the tree with `.parent`)
   */
  xpath: string | null;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  shadowRoot: boolean;
  highlightIndex: number | null;
  viewportCoordinates?: CoordinateSet;
  pageCoordinates?: CoordinateSet;
  /** Corner radius in CSS pixels; the on-page overlay glows in the element's own shape. */
  cornerRadius?: number;
  viewportInfo?: ViewportInfo;
  backendNodeId?: number;
  /** The frame the node was read from; its backendNodeId is only meaningful there. */
  frame?: Frame;
  frameKey?: string;
  /** Not on the page the model saw at its last step; serialized as *[index]. */
  isNew = false;
  /** Indexed only so `scroll {index}` can reach the panel it scrolls: its own line carries no text. */
  scrollOnly = false;

  /**
   * What the element *is*, as opposed to the number it was given. Every read renumbers interactive nodes 0..n-1
   * (`pruneAXTree`), so the index the model holds is a handle that is only valid for one step; this is the node
   * behind that handle — its backendNodeId in the frame it was read from — and it survives a re-read.
   */
  get durableId(): string | null {
    return this.backendNodeId === undefined ? null : `${this.frameKey ?? ''}#${this.backendNodeId}`;
  }

  constructor(params: {
    tagName: string | null;
    xpath: string | null;
    attributes: Record<string, string>;
    children: DOMBaseNode[];
    isVisible: boolean;
    isInteractive?: boolean;
    isTopElement?: boolean;
    isInViewport?: boolean;
    shadowRoot?: boolean;
    highlightIndex?: number | null;
    viewportCoordinates?: CoordinateSet;
    pageCoordinates?: CoordinateSet;
    cornerRadius?: number;
    viewportInfo?: ViewportInfo;
    parent?: DOMElementNode | null;
    backendNodeId?: number;
    frame?: Frame;
    frameKey?: string;
    scrollOnly?: boolean;
  }) {
    super(params.isVisible, params.parent);
    this.tagName = params.tagName;
    this.xpath = params.xpath;
    this.attributes = params.attributes;
    this.children = params.children;
    this.isInteractive = params.isInteractive ?? false;
    this.isTopElement = params.isTopElement ?? false;
    this.isInViewport = params.isInViewport ?? false;
    this.shadowRoot = params.shadowRoot ?? false;
    this.highlightIndex = params.highlightIndex ?? null;
    this.viewportCoordinates = params.viewportCoordinates;
    this.pageCoordinates = params.pageCoordinates;
    this.cornerRadius = params.cornerRadius;
    this.viewportInfo = params.viewportInfo;
    this.backendNodeId = params.backendNodeId;
    this.frame = params.frame;
    this.frameKey = params.frameKey;
    this.scrollOnly = params.scrollOnly ?? false;
  }

  // Cache for the hash value
  private _hashedValue?: HashedDomElement;
  private _hashPromise?: Promise<HashedDomElement>;

  /**
   * Returns a hashed representation of this DOM element
   * Async equivalent of the Python @cached_property hash method
   *
   * @returns {Promise<HashedDomElement>} A promise that resolves to the hashed DOM element
   * @throws {Error} If the hashing operation fails
   */
  async hash(): Promise<HashedDomElement> {
    // If we already have the value, return it immediately
    if (this._hashedValue) {
      return this._hashedValue;
    }

    // If a calculation is in progress, reuse that promise
    if (!this._hashPromise) {
      this._hashPromise = HistoryTreeProcessor.hashDomElement(this)
        .then((result: HashedDomElement) => {
          this._hashedValue = result;
          this._hashPromise = undefined; // Clean up
          return result;
        })
        .catch((error: Error) => {
          // Clear the promise reference to allow retry on next call
          this._hashPromise = undefined;

          // Log the error for debugging
          console.error('Error computing DOM element hash:', error);

          // Create a more descriptive error
          const enhancedError = new Error(
            `Failed to hash DOM element (${this.tagName || 'unknown'}): ${error.message}`,
          );

          // Preserve the original stack trace if possible
          if (error.stack) {
            enhancedError.stack = error.stack;
          }

          // Rethrow to propagate to caller
          throw enhancedError;
        });
    }

    return this._hashPromise;
  }

  /**
   * Clears the cached hash value, forcing recalculation on next hash() call
   */
  clearHashCache(): void {
    this._hashedValue = undefined;
    this._hashPromise = undefined;
  }

  getAllTextTillNextClickableElement(maxDepth = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      // Skip this branch if we hit a highlighted element (except for the current node, and a scroll container,
      // which is indexed but holds page text rather than a control's own label)
      if (node instanceof DOMElementNode && node !== this && node.highlightIndex !== null && !node.scrollOnly) {
        return;
      }

      if (node instanceof DOMTextNode) {
        textParts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        for (const child of node.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(this, 0);
    return textParts.join('\n').trim();
  }

  clickableElementsToString(includeAttributes: string[] | null = null): string {
    /**
     * Convert the processed DOM content to HTML.
     */
    const formattedText: string[] = [];

    if (!includeAttributes) {
      includeAttributes = DEFAULT_INCLUDE_ATTRIBUTES;
    }

    const SEMANTIC_LAYOUT_TAGS = ['nav', 'header', 'main', 'footer', 'aside', 'section', 'ul', 'ol', 'table', 'form', 'article', 'dialog', 'menu'];
    const SEMANTIC_ROLES = ['navigation', 'banner', 'main', 'contentinfo', 'complementary', 'list', 'table', 'form', 'dialog'];

    const processNode = (node: DOMBaseNode, depth: number): void => {
      let nextDepth = depth;
      const depthStr = '\t'.repeat(depth);

      if (node instanceof DOMElementNode) {
        if (node.attributes['_collapsible'] === 'true') {
          for (const child of node.children) {
            processNode(child, depth);
          }
          return;
        }

        const isClickable = node.highlightIndex !== null;
        
        let isSemanticLayout = false;
        if (!isClickable) {
          const tagLower = (node.tagName ?? '').toLowerCase();
          const roleLower = (node.attributes.role ?? '').toLowerCase();
          if (SEMANTIC_LAYOUT_TAGS.includes(tagLower) || SEMANTIC_ROLES.includes(roleLower)) {
            isSemanticLayout = true;
          }
        }

        const startIndex = formattedText.length;

        if (isClickable) {
          nextDepth += 1;

          const text = node.scrollOnly ? '' : node.getAllTextTillNextClickableElement();
          let attributesHtmlStr: string | null = null;

          if (includeAttributes) {
            const attributesToInclude: Record<string, string> = {};

            for (const [key, value] of Object.entries(node.attributes)) {
              if (includeAttributes.includes(key) && String(value).trim() !== '') {
                attributesToInclude[key] = String(value).trim();
              }
            }

            const orderedKeys = includeAttributes.filter(key => key in attributesToInclude);

            if (orderedKeys.length > 1) {
              const keysToRemove = new Set<string>();
              const seenValues: Record<string, string> = {};

              for (const key of orderedKeys) {
                const value = attributesToInclude[key];
                if (value.length > 5) {
                  if (value in seenValues) {
                    keysToRemove.add(key);
                  } else {
                    seenValues[value] = key;
                  }
                }
              }

              for (const key of keysToRemove) {
                delete attributesToInclude[key];
              }
            }

            if (node.tagName === attributesToInclude.role) {
              delete attributesToInclude.role;
            }

            const REDUNDANT_ROLES_FOR_TAGS: Record<string, string> = {
              'a': 'link', 'button': 'button', 'input': 'textbox', 'textarea': 'textbox',
              'select': 'combobox', 'option': 'option', 'img': 'img', 'h1': 'heading',
              'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading',
              'h6': 'heading', 'li': 'listitem', 'ul': 'list', 'ol': 'list',
              'table': 'table', 'tr': 'row', 'td': 'gridcell', 'th': 'columnheader',
              // Landmarks: the tag name already carries the role (`role` was 3.5% of the element block's characters).
              'nav': 'navigation', 'main': 'main', 'header': 'banner', 'footer': 'contentinfo',
              'aside': 'complementary', 'section': 'region', 'form': 'form', 'dialog': 'dialog',
              'article': 'article', 'menu': 'list', 'summary': 'button', 'progress': 'progressbar',
            };
            const tagLower = (node.tagName ?? '').toLowerCase();
            if (
              attributesToInclude.role &&
              REDUNDANT_ROLES_FOR_TAGS[tagLower] === attributesToInclude.role.toLowerCase()
            ) {
              delete attributesToInclude.role;
            }

            // An attribute that only repeats the element's own text tells the model nothing the line does not
            // already say: `aria-label` alone was 12.0% of the element block's characters in a live run.
            const ownText = text.trim().toLowerCase();
            if (ownText !== '') {
              for (const [key, value] of Object.entries(attributesToInclude)) {
                if (value.trim().toLowerCase() === ownText) delete attributesToInclude[key];
              }
            }

            // A control the page has switched off, marked like offscreen: shown as aria-disabled a live run clicked
            // it anyway and spent the step on "The element is disabled".
            if (node.attributes['aria-disabled'] === 'true' || node.attributes.disabled === 'true' || node.attributes.disabled === '') {
              delete attributesToInclude['aria-disabled'];
              attributesToInclude['disabled'] = 'true';
            }

             if (Object.keys(attributesToInclude).length > 0) {
               attributesHtmlStr = Object.entries(attributesToInclude)
                 .map(([key, value]) => {
                   // A field's value and an element's label are what the model checks its work against: cut short,
                   // a typed address or a long option name cannot be verified.
                   const capLimit = ['aria-label', 'aria-description', 'placeholder', 'title', 'value', 'options', 'scroll'].includes(key) ? 120 : 30;
                   const capped = key === 'href' ? capHref(value) : capTextLength(value, capLimit);
                   const escaped = capped.replace(/"/g, '&quot;');
                   return `${key}="${escaped}"`;
                 })
                 .join(' ');
             }
           }
 
           const highlightIndicator = `${node.isNew ? '*' : ''}[${node.highlightIndex}]${node.isInViewport ? '' : OFFSCREEN_MARKER}`;
           let line = `${depthStr}${highlightIndicator}<${node.tagName ?? 'DIV'}`;
           if (attributesHtmlStr) {
             line += ` ${attributesHtmlStr}`;
           }
           if (text) {
             const trimmedText = text.trim();
             if (!attributesHtmlStr) {
               line += ' ';
             }
             line += `>${trimmedText}`;
           }
           line += ' />';
           formattedText.push(line);
        } else if (isSemanticLayout) {
          nextDepth += 1;
          let layoutLine = `${depthStr}<${node.tagName ?? 'DIV'}`;
          if (node.attributes.role) {
            layoutLine += ` role="${node.attributes.role}"`;
          }
          if (node.attributes['aria-label']) {
            layoutLine += ` aria-label="${node.attributes['aria-label']}"`;
          }
          layoutLine += `>`;
          formattedText.push(layoutLine);
        }

        // Process children regardless
        for (const child of node.children) {
          processNode(child, nextDepth);
        }

        // Auto-prune empty semantic layouts
        if (isSemanticLayout && formattedText.length === startIndex + 1) {
           formattedText.pop(); // Remove the layout tag since no printable children were found
        }
      } else if (node instanceof DOMTextNode) {
        if (node.hasParentWithHighlightIndex()) {
          return;
        }

        if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
          // Headings keep their level ("# All products"), so a page heading is not mistaken for other large text.
          const level = /^h([1-6])$/.exec((node.parent.tagName ?? '').toLowerCase())?.[1];
          formattedText.push(`${depthStr}${level ? `${'#'.repeat(Number(level))} ` : ''}${node.text}`);
        }
      }
    };

    processNode(this, 0);
    return formattedText.join('\n');
  }

  getFileUploadElement(checkSiblings = true): DOMElementNode | null {
    // Check if current element is a file input
    if (this.tagName === 'input' && this.attributes?.type === 'file') {
      return this;
    }

    // Check children
    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.getFileUploadElement(false);
        if (result) return result;
      }
    }

    // Check siblings only for the initial call
    if (checkSiblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.getFileUploadElement(false);
          if (result) return result;
        }
      }
    }

    return null;
  }

  getEnhancedCssSelector(): string {
    return this.enhancedCssSelectorForElement();
  }

  convertSimpleXPathToCssSelector(xpath: string): string {
    if (!xpath) {
      return '';
    }

    // Remove leading slash if present
    const cleanXpath = xpath.replace(/^\//, '');

    // Split into parts
    const parts = cleanXpath.split('/');
    const cssParts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      // Handle custom elements with colons by escaping them
      if (part.includes(':') && !part.includes('[')) {
        const basePart = part.replace(/:/g, '\\:');
        cssParts.push(basePart);
        continue;
      }

      // Handle index notation [n]
      if (part.includes('[')) {
        const bracketIndex = part.indexOf('[');
        let basePart = part.substring(0, bracketIndex);

        // Handle custom elements with colons in the base part
        if (basePart.includes(':')) {
          basePart = basePart.replace(/:/g, '\\:');
        }

        const indexPart = part.substring(bracketIndex);

        // Handle multiple indices
        const indices = indexPart
          .split(']')
          .slice(0, -1)
          .map(i => i.replace('[', ''));

        for (const idx of indices) {
          // Handle numeric indices
          if (/^\d+$/.test(idx)) {
            try {
              const index = Number.parseInt(idx, 10) - 1;
              basePart += `:nth-of-type(${index + 1})`;
            } catch (error) {
              // continue
            }
          }
          // Handle last() function
          else if (idx === 'last()') {
            basePart += ':last-of-type';
          }
          // Handle position() functions
          else if (idx.includes('position()')) {
            if (idx.includes('>1')) {
              basePart += ':nth-of-type(n+2)';
            }
          }
        }

        cssParts.push(basePart);
      } else {
        cssParts.push(part);
      }
    }

    const baseSelector = cssParts.join(' > ');
    return baseSelector;
  }

  enhancedCssSelectorForElement(includeDynamicAttributes = true): string {
    try {
      if (!this.xpath) {
        return '';
      }

      // Get base selector from XPath
      let cssSelector = this.convertSimpleXPathToCssSelector(this.xpath);

      // Handle class attributes
      const classValue = this.attributes.class;
      if (classValue && includeDynamicAttributes) {
        // Define a regex pattern for valid class names in CSS
        const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

        // Iterate through the class attribute values
        const classes = classValue.trim().split(/\s+/);
        for (const className of classes) {
          // Skip empty class names
          if (!className.trim()) {
            continue;
          }

          // Check if the class name is valid
          if (validClassNamePattern.test(className)) {
            // Append the valid class name to the CSS selector
            cssSelector += `.${className}`;
          }
        }
      }

      // Expanded set of safe attributes that are stable and useful for selection
      const SAFE_ATTRIBUTES = new Set([
        // Data attributes (if they're stable in your application)
        'id',
        // Standard HTML attributes
        'name',
        'type',
        'placeholder',
        // Accessibility attributes
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'role',
        // Common form attributes
        'for',
        'autocomplete',
        'required',
        'readonly',
        // Media attributes
        'alt',
        'title',
        'src',
        // Custom stable attributes
        'href',
        'target',
        // Common data attributes
        'data-id',
        'data-qa',
        'data-cy',
        'data-testid',
        'data-test',
      ]);

      // Handle other attributes
      if (includeDynamicAttributes) {
        SAFE_ATTRIBUTES.add('data-id');
        SAFE_ATTRIBUTES.add('data-qa');
        SAFE_ATTRIBUTES.add('data-cy');
        SAFE_ATTRIBUTES.add('data-testid');
      }

      // Handle other attributes
      for (const [attribute, value] of Object.entries(this.attributes)) {
        if (attribute === 'class') {
          continue;
        }

        // Skip invalid attribute names
        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        // Escape special characters in attribute names
        const safeAttribute = attribute.replace(':', '\\:');

        // Handle different value cases
        if (value === '') {
          cssSelector += `[${safeAttribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // Use contains for values with special characters
          // Regex-substitute any whitespace with a single space, then trim
          const collapsedValue = value.replace(/\s+/g, ' ').trim();
          // Escape embedded double-quotes
          const safeValue = collapsedValue.replace(/"/g, '\\"');
          cssSelector += `[${safeAttribute}*="${safeValue}"]`;
        } else {
          cssSelector += `[${safeAttribute}="${value}"]`;
        }
      }

      return cssSelector;
    } catch (error) {
      // Fallback to a more basic selector if something goes wrong
      const tagName = this.tagName || '*';
      return `${tagName}[highlightIndex='${this.highlightIndex}']`;
    }
  }
}

export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
  /** The main document could not be read in time: an unknown page, not an empty one. */
  unreadable?: boolean;
}

/** What an element is called, for matching it across reads: the same frame, tag, role and accessible name. */
function identityKey(node: DOMElementNode): string {
  return `${node.frameKey ?? ''}|${node.tagName ?? ''}|${node.attributes.role ?? ''}|${node.attributes['aria-label'] ?? ''}`;
}

/**
 * The handle a later read gives the element chosen from an earlier one, or null when it is gone.
 *
 * The handle itself cannot be carried over — indexes are renumbered on every read — so the element is followed by
 * identity: the same node (`durableId`), then, once a re-render has replaced the node, the one element of the read
 * with the same frame, tag, role and name. A named candidate only counts when it is the *only* one that fits: two
 * matches mean the wrong element could be acted on, and a refusal is cheaper than a wrong click.
 */
export function resolveByIdentity(chosen: DOMElementNode, selectorMap: Map<number, DOMElementNode>): number | null {
  const wanted = identityKey(chosen);
  // An element with neither role nor name would match every other nameless one; only its own node identifies it.
  const named = Boolean(chosen.attributes.role || chosen.attributes['aria-label']);
  let sameName: number | null = null;
  let ambiguous = false;
  for (const [index, node] of selectorMap) {
    if (node === chosen) return index;
    if (chosen.durableId !== null && node.durableId === chosen.durableId && node.tagName === chosen.tagName) return index;
    if (!named || identityKey(node) !== wanted) continue;
    if (sameName !== null) ambiguous = true;
    else sameName = index;
  }
  return ambiguous ? null : sameName;
}
