import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import MessageManager from '../../messages/service';
import { MessageMetadata, type MessageHistory } from '../../messages/views';
import { ActionResult, AgentContext } from '../../types';
import type BrowserContext from '../../../browser/context';
import type { EventManager } from '../../event/manager';
import { ContextBuilder } from '../in-chat/context-builder';

function makeContext() {
  const messageManager = new MessageManager(undefined, null);
  const eventManager = { emit: async () => undefined } as unknown as EventManager;
  const context = new AgentContext('task-1', {} as BrowserContext, messageManager, eventManager, {});
  return { context, messageManager };
}

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  id,
  name,
  args: { ...args, memory: `memory ${id}` },
});
const system = new SystemMessage('navigator system');
const state = (n: number) => new HumanMessage(`browser state ${n}`);
const text = (message: BaseMessage) => String(message.content);
const toolCallIds = (packet: BaseMessage[]) =>
  packet.filter((m): m is AIMessage => m instanceof AIMessage).flatMap(m => (m.tool_calls ?? []).map(c => c.id));

describe('ContextBuilder packets', () => {
  it('sends the system prompt, the task, the recent tool turns, and the state last', () => {
    const { context, messageManager } = makeContext();
    messageManager.addTask('Find the price of the book');
    messageManager.addToolTurn([call('a', 'click_element', { index: 3 })], [new ActionResult({ extractedContent: 'Clicked' })]);

    const packet = ContextBuilder.buildContextPacket(context, system, state(1), 'navigator');

    expect(packet[0]).toBe(system);
    expect(text(packet[1])).toContain('<nano_user_request>');
    expect(text(packet[1])).toContain('Find the price of the book');
    expect(packet[2]).toBeInstanceOf(AIMessage);
    expect(packet[3]).toBeInstanceOf(ToolMessage);
    expect(text(packet[3])).toBe('Clicked');
    expect(text(packet[packet.length - 1])).toBe('browser state 1');
  });

  it('adds a task once on resume and keeps follow-up tasks and human answers in order', () => {
    const { context, messageManager } = makeContext();
    messageManager.addTask('open the first page');
    messageManager.addTask('open the first page');
    messageManager.addHumanAnswer('use the blue one');
    messageManager.addTask('now open the second page');

    const humanTexts = ContextBuilder.buildContextPacket(context, system, state(1))
      .filter(m => m instanceof HumanMessage)
      .map(text);

    expect(humanTexts.filter(t => t.includes('open the first page'))).toHaveLength(1);
    expect(humanTexts[1]).toContain('use the blue one');
    expect(humanTexts[2]).toContain('Follow-up task');
    expect(humanTexts[2]).toContain('now open the second page');
  });

  it('pairs every tool call with exactly one result, including calls that were not executed', () => {
    const { context, messageManager } = makeContext();
    messageManager.addToolTurn(
      [call('a', 'input_text', { index: 1, text: 'x' }), call('b', 'click_element', { index: 2 })],
      [new ActionResult({ error: 'Element with index 1 does not exist' })],
    );

    const packet = ContextBuilder.buildContextPacket(context, system, state(1));
    const results = packet.filter((m): m is ToolMessage => m instanceof ToolMessage);

    expect(toolCallIds(packet)).toEqual(['a', 'b']);
    expect(results.map(r => r.tool_call_id)).toEqual(['a', 'b']);
    expect(text(results[0])).toContain('Error: Element with index 1 does not exist');
    expect(text(results[1])).toContain('Not executed');
  });

  it('sends the last five turns as messages and summarizes older ones above the state', () => {
    const { context, messageManager } = makeContext();
    for (let i = 1; i <= 7; i++) {
      messageManager.addToolTurn([call(`c${i}`, 'scroll_to_text', { text: `t${i}` })], [new ActionResult({ extractedContent: `result ${i}` })]);
    }

    const packet = ContextBuilder.buildContextPacket(context, system, state(1));
    const finalMessage = text(packet[packet.length - 1]);

    expect(toolCallIds(packet)).toEqual(['c3', 'c4', 'c5', 'c6', 'c7']);
    expect(packet.filter(m => m instanceof ToolMessage)).toHaveLength(5);
    expect(finalMessage).toContain('[Earlier steps]');
    expect(finalMessage).toContain('scroll_to_text {"text":"t1"} → result 1');
    expect(finalMessage).toContain('(memory: memory c2)');
    expect(finalMessage).not.toContain('result 3');
    expect(finalMessage.endsWith('browser state 1')).toBe(true);
  });

  it('keeps the system prompt and transcript prefix identical from one step to the next', () => {
    const { context, messageManager } = makeContext();
    messageManager.addTask('read the heading');
    const first = ContextBuilder.buildContextPacket(context, system, state(1));
    messageManager.addToolTurn([call('a', 'get_complete_page_content')], [new ActionResult({ extractedContent: 'Example Domain' })]);
    const second = ContextBuilder.buildContextPacket(context, system, state(2));

    expect(second[0]).toBe(first[0]);
    expect(text(second[1])).toBe(text(first[1]));
  });

  it('gives the planner the steps as text and no tool-call messages', () => {
    const { context, messageManager } = makeContext();
    messageManager.addTask('read the heading');
    messageManager.addToolTurn([call('a', 'get_complete_page_content')], [new ActionResult({ extractedContent: 'Example Domain' })]);

    const packet = ContextBuilder.buildContextPacket(context, system, state(1), 'planner');
    const finalMessage = text(packet[packet.length - 1]);

    expect(packet.some(m => m instanceof AIMessage || m instanceof ToolMessage)).toBe(false);
    expect(finalMessage).toContain('[Steps so far, oldest first]');
    expect(finalMessage).toContain('get_complete_page_content {} → Example Domain');
  });

  it('ignores messages written by older versions and incomplete turns', () => {
    const { context, messageManager } = makeContext();
    const history = (messageManager as unknown as { history: MessageHistory }).history;
    history.addMessage(new HumanMessage('[Your task history memory starts here]'), new MessageMetadata(1, null));
    history.addMessage(
      new AIMessage({ content: 'tool call', tool_calls: [{ id: '1', name: 'AgentOutput', args: {}, type: 'tool_call' }] }),
      new MessageMetadata(1, 'turn_ai'),
    );
    messageManager.addTask('read the heading');

    const packet = ContextBuilder.buildContextPacket(context, system, state(1));

    expect(packet.map(text)).toEqual(['navigator system', expect.stringContaining('read the heading'), 'browser state 1']);
  });

  it('shows the current plan above the browser state', () => {
    const { context } = makeContext();
    context.currentContract = {
      id: 'contract-1',
      mode: 'multi_step_task',
      goal: 'open the Travel category',
      macroObjective: 'NAVIGATE',
      expectedObservation: { observationId: null },
      successCondition: 'The Travel page is open',
      failureSignals: [],
      createdAt: 1,
    };

    const finalMessage = text(ContextBuilder.buildContextPacket(context, system, state(1)).at(-1)!);

    expect(finalMessage).toContain('[CURRENT PLAN]\ngoal: open the Travel category\nphase: NAVIGATE');
    expect(finalMessage.endsWith('browser state 1')).toBe(true);
  });
});
