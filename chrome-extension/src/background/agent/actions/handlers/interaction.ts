import { ActionResult } from '@src/background/agent/types';
import type {
  clickElementActionSchema,
  dragElementActionSchema,
  handleDialogActionSchema,
  hoverElementActionSchema,
  inputTextActionSchema,
  rightClickElementActionSchema,
  selectDropdownOptionActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type Page from '@src/background/browser/page';
import type { MouseOutcome } from '@src/background/browser/page';
import type { DOMElementNode } from '@src/background/browser/dom/views';
import { registerSecret } from '@src/background/trace';

function describe(node: DOMElementNode): string {
  return node.getAllTextTillNextClickableElement(2) || node.attributes['aria-label'] || node.tagName || 'element';
}

/**
 * What the model reads back about its own action. The side panel keeps its wording; the model gets a note in its
 * own voice, because "Clicked button with index 2: Remove" was reported as the page's message (C7, C13).
 */
function ownAction(text: string): string {
  return `${text}; the page's response is in the browser state, not in this note.`;
}

export class InteractionHandler extends BaseHandler {
  /**
   * The current page and the element at `index` in its current read. The navigator has already mapped the
   * index the model chose (from the page in its prompt) onto that read.
   */
  private async resolveIndex(index: number): Promise<{ page: Page; node: DOMElementNode }> {
    const page = await this.context.browserContext.getCurrentPage();
    const node = (await page.getCurrentState()).selectorMap.get(index);
    if (!node) {
      throw new Error(t('act_errors_elementNotExist', [index.toString()]));
    }
    return { page, node };
  }

  /** What a pointer action caused beyond the page itself: a dialog, a file chooser, a new tab (which becomes current). */
  private async describeOutcome(outcome: MouseOutcome, tabsBefore: Set<number>): Promise<string> {
    const notes: string[] = [];
    if (outcome.dialog) {
      notes.push(`It opened a JavaScript ${outcome.dialog.type} dialog: "${outcome.dialog.message}". Call handle_dialog to answer it.`);
    }
    if (outcome.fileChooser) {
      notes.push('A file chooser opened; uploading files is not supported, so ask the user to upload the file.');
    }
    if (!outcome.dialog) {
      const newTabId = [...(await this.context.browserContext.getAllTabIds())].find(id => !tabsBefore.has(id));
      if (newTabId !== undefined) {
        notes.push(t('act_click_newTabOpened'));
        await this.context.browserContext.switchTab(newTabId);
      }
    }
    return notes.length ? ` ${notes.join(' ')}` : '';
  }

  private async pointerAction(
    index: number,
    startMessage: string,
    act: (page: Page, node: DOMElementNode) => Promise<MouseOutcome>,
    okMessage: (node: DOMElementNode) => string,
    verb: string,
  ): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, startMessage);
    const { page, node } = await this.resolveIndex(index);
    const tabsBefore = await this.context.browserContext.getAllTabIds();
    const outcome = await act(page, node);
    const extra = await this.describeOutcome(outcome, tabsBefore);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, okMessage(node) + extra);
    return new ActionResult({ extractedContent: ownAction(`You ${verb} [${index}] "${describe(node)}"`) + extra, includeInMemory: true });
  }

  async handleClickElement(input: z.infer<typeof clickElementActionSchema.schema>): Promise<ActionResult> {
    return this.pointerAction(
      input.index,
      t('act_click_start', [input.index.toString()]),
      (page, node) => page.clickNode(node, input.double ? 2 : 1),
      node => t('act_click_ok', [input.index.toString(), describe(node)]),
      input.double ? 'double-clicked' : 'clicked',
    );
  }

  async handleHoverElement(input: z.infer<typeof hoverElementActionSchema.schema>): Promise<ActionResult> {
    return this.pointerAction(
      input.index,
      `Hovering over element ${input.index}`,
      (page, node) => page.hoverNode(node),
      node => `Hovered over element ${input.index}: ${describe(node)}`,
      'hovered over',
    );
  }

  async handleRightClickElement(input: z.infer<typeof rightClickElementActionSchema.schema>): Promise<ActionResult> {
    return this.pointerAction(
      input.index,
      `Right clicking element ${input.index}`,
      (page, node) => page.rightClickNode(node),
      node => `Right clicked element ${input.index}: ${describe(node)}`,
      'right-clicked',
    );
  }

  async handleDragElement(input: z.infer<typeof dragElementActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Dragging element ${input.index} onto ${input.target_index}`);
    const { page, node } = await this.resolveIndex(input.index);
    const { node: target } = await this.resolveIndex(input.target_index);
    await page.dragNode(node, target);
    const msg = `Dragged element ${input.index} (${describe(node)}) onto element ${input.target_index} (${describe(target)})`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: ownAction(`You dragged [${input.index}] "${describe(node)}" onto [${input.target_index}] "${describe(target)}"`),
      includeInMemory: true,
    });
  }

  async handleInputText(input: z.infer<typeof inputTextActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_inputText_start', [input.index.toString()]));
    const { page, node } = await this.resolveIndex(input.index);
    const outcome = await page.inputTextNode(node, input.text);
    if (outcome.secret) registerSecret(input.text);
    // The value is read back before Enter: a submitted field is often cleared.
    if (input.submit) await page.sendKeys('Enter', node);
    // A password never leaves the page again: messages show its length only.
    const shown = outcome.secret ? '•'.repeat(input.text.length) : input.text;
    const msg = t('act_inputText_ok', [shown, input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    const suggests = node.attributes.role === 'combobox' || /^(list|both)$/.test(node.attributes.autocomplete ?? node.attributes['aria-autocomplete'] ?? '');
    const hint = suggests ? ' This field offers suggestions: to use one, click it in the browser state instead of pressing Enter.' : '';
    return new ActionResult({
      extractedContent: ownAction(`You typed "${shown}" into [${input.index}]${input.submit ? ' and pressed Enter' : ''}`) + hint,
      includeInMemory: true,
      evidence: [
        {
          kind: 'target_value',
          passed: outcome.matched,
          message: outcome.matched ? 'The field contains the typed text.' : 'The field shows a different value than the typed text.',
          before: { expectedLength: input.text.length },
          after: outcome.secret
            ? { actualLength: outcome.actualLength }
            : { actualLength: outcome.actualLength, actual: outcome.actual?.slice(0, 80) },
        },
      ],
    });
  }

  async handleSelectDropdownOption(input: z.infer<typeof selectDropdownOptionActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_selectDropdownOption_start', [input.text, input.index.toString()]));
    const { page, node } = await this.resolveIndex(input.index);
    const outcome = await page.selectOption(node, input.text);
    if (!outcome.selected) {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, outcome.message);
      return new ActionResult({ error: outcome.message, includeInMemory: true });
    }
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, outcome.message);
    return new ActionResult({
      extractedContent: outcome.message,
      includeInMemory: true,
      evidence: [{ kind: 'selection', passed: outcome.confirmed, message: outcome.message }],
    });
  }

  async handleHandleDialog(input: z.infer<typeof handleDialogActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, input.accept ? 'Accepting the dialog' : 'Dismissing the dialog');
    const page = await this.context.browserContext.getCurrentPage();
    const msg = await page.handleDialog(input.accept, input.prompt_text);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}
