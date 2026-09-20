import { ActionResult } from '@src/background/agent/types';
import type {
  clickElementActionSchema,
  fillFormActionSchema,
  handleDialogActionSchema,
  inputTextActionSchema,
  selectDropdownOptionActionSchema,
  uploadFileActionSchema,
} from '../schemas';
import { currentIndexFor } from '../../validation/service';
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

/** Whether an element is a two-state control: a checkbox, a switch or a radio button. */
function isToggle(node: DOMElementNode): boolean {
  const { role = '', type = '' } = node.attributes;
  return ['checkbox', 'switch', 'radio'].includes(role) || ['checkbox', 'radio'].includes(type.toLowerCase());
}

/** Whether a toggle is on, as the accessibility tree reports it; null when the element does not say. */
function toggleState(node: DOMElementNode): boolean | null {
  const { attributes: a } = node;
  const value = a['aria-checked'] ?? a.checked;
  return value === 'true' || value === '' ? true : value === 'false' ? false : null;
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
      notes.push('A file chooser opened: call upload_file on this element with a file the user attached (ask_human for the file when none is).');
    }
    if (!outcome.dialog) {
      // The gesture watched for the tab it opened and waited for it; the tab list is the fallback for one that arrived
      // by another route. Either way the agent follows it: work left behind in the old tab is work on the wrong page.
      const newTabId = outcome.newTabId ?? [...(await this.context.browserContext.getAllTabIds())].find(id => !tabsBefore.has(id));
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

  /** One pointer verb: a click, or the gesture an option names (double, right, hover, drag and drop). */
  async handleClickElement(input: z.infer<typeof clickElementActionSchema.schema>): Promise<ActionResult> {
    if (input.drop_on !== undefined) return this.dragOnto(input.index, input.drop_on);
    if (input.desired_state) {
      const settled = await this.alreadyInState(input.index, input.desired_state);
      if (settled) return settled;
    }
    if (input.hover) {
      return this.pointerAction(
        input.index,
        `Hovering over element ${input.index}`,
        (page, node) => page.hoverNode(node),
        node => `Hovered over element ${input.index}: ${describe(node)}`,
        'hovered over',
      );
    }
    if (input.right) {
      return this.pointerAction(
        input.index,
        `Right clicking element ${input.index}`,
        (page, node) => page.rightClickNode(node),
        node => `Right clicked element ${input.index}: ${describe(node)}`,
        'right-clicked',
      );
    }
    return this.pointerAction(
      input.index,
      t('act_click_start', [input.index.toString()]),
      (page, node) => page.clickNode(node, input.double ? 2 : 1),
      node => t('act_click_ok', [input.index.toString(), describe(node)]),
      input.double ? 'double-clicked' : 'clicked',
    );
  }

  async handleUploadFile(input: z.infer<typeof uploadFileActionSchema.schema>): Promise<ActionResult> {
    const file = this.context.files.get(input.file);
    if (!file) {
      const names = [...this.context.files.keys()];
      throw new Error(
        names.length > 0
          ? `No attached file is named "${input.file}"; the user attached: ${names.join(', ')}.`
          : 'The user has not attached a file. Ask the user (ask_human) to attach it in the side panel.',
      );
    }
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Uploading ${input.file}`);
    const { page, node } = await this.resolveIndex(input.index);
    const how = await page.uploadFile(node, { name: input.file, ...file });
    const kb = Math.max(1, Math.round((file.data.length * 3) / 4 / 1024));
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Uploaded ${input.file}`);
    return new ActionResult({
      extractedContent: ownAction(`You uploaded ${input.file} (${kb} KB) to [${input.index}] "${describe(node)}" ${how}`),
      includeInMemory: true,
    });
  }

  /**
   * A checkbox, switch or radio the call asked for a state that it already has: clicking it would turn it off, which
   * is the opposite of what was asked. The result says so and counts as done, so the step is not spent and not undone.
   */
  private async alreadyInState(index: number, desired: 'checked' | 'unchecked'): Promise<ActionResult | null> {
    const { node } = await this.resolveIndex(index);
    if (!isToggle(node)) return null;
    const state = toggleState(node);
    if (state === null || state !== (desired === 'checked')) return null;
    const msg = `[${index}] "${describe(node)}" is already ${desired}; it was left as it is, because clicking it would turn it ${desired === 'checked' ? 'off' : 'on'}.`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
      evidence: [{ kind: 'target_state', passed: true, message: msg, after: { checked: state } }],
    });
  }

  private async dragOnto(index: number, targetIndex: number): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Dragging element ${index} onto ${targetIndex}`);
    const { page, node } = await this.resolveIndex(index);
    const { node: target } = await this.resolveIndex(targetIndex);
    await page.dragNode(node, target);
    const msg = `Dragged element ${index} (${describe(node)}) onto element ${targetIndex} (${describe(target)})`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: ownAction(`You dragged [${index}] "${describe(node)}" onto [${targetIndex}] "${describe(target)}"`),
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
    return new ActionResult({
      extractedContent: ownAction(`You typed "${shown}" into [${input.index}]${input.submit ? ' and pressed Enter' : ''}`),
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

  /**
   * A whole form in one call and one page read. Each field of a form was a step of its own, with the element list re-sent
   * for every one of them; the values are known before the first is typed, so they cost one observation together.
   * Every index is resolved before anything is typed: a form half filled from a stale index is worse than one not filled.
   */
  async handleFillForm(input: z.infer<typeof fillFormActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Filling ${input.fields.length} fields`);
    const page = await this.context.browserContext.getCurrentPage();
    const state = await this.context.browserContext.getCachedState();
    const shown = this.context.promptIndexes;

    const targets: Array<{ index: number; value: string; node: DOMElementNode }> = [];
    const problems: string[] = [];
    for (const field of input.fields) {
      if (shown && !shown.has(field.index)) {
        problems.push(`[${field.index}] is not in the element list you were given`);
        continue;
      }
      const current = currentIndexFor(this.context.promptState, state, field.index);
      const node = current === null ? undefined : state.selectorMap.get(current);
      if (!node) problems.push(`[${field.index}] is not on the current page`);
      else targets.push({ index: field.index, value: field.value, node });
    }
    if (problems.length > 0) {
      const msg = `Nothing was typed: ${problems.join('; ')}. Re-read the page and fill the form with indexes from the current element list.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const filled: string[] = [];
    let allMatched = true;
    let left = '';
    for (const [position, target] of targets.entries()) {
      const before = page.url();
      const outcome = await page.inputTextNode(target.node, target.value);
      if (outcome.secret) registerSecret(target.value);
      const shownValue = outcome.secret ? '•'.repeat(target.value.length) : target.value;
      allMatched &&= outcome.matched;
      filled.push(
        outcome.matched
          ? `[${target.index}] "${shownValue}"`
          : `[${target.index}] shows "${outcome.secret ? '•'.repeat(outcome.actualLength ?? 0) : (outcome.actual ?? '').slice(0, 60)}" instead of "${shownValue}"`,
      );
      // Pressing Enter in the last field is the form's own submit; it is gated like input_text with submit.
      if (position === targets.length - 1 && input.submit) await page.sendKeys('Enter', target.node);
      if (page.url() !== before) {
        const rest = targets.slice(position + 1);
        if (rest.length > 0) left = ` The page left ${before}, so ${rest.map(field => `[${field.index}]`).join(', ')} ${rest.length === 1 ? 'was' : 'were'} not filled; re-read the page before filling the rest.`;
        break;
      }
    }

    const msg = `Filled ${filled.join(', ')}${input.submit ? ' and pressed Enter' : ''}.${left}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: ownAction(`You filled ${filled.join(', ')}${input.submit ? ' and pressed Enter' : ''}`) + left,
      includeInMemory: true,
      evidence: [
        {
          kind: 'target_value',
          passed: allMatched && !left,
          message: allMatched ? 'Every field contains the typed text.' : 'A field shows a different value than the typed text.',
          after: { actual: filled.join(', ').slice(0, 200) },
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
