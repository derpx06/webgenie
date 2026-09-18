import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, textOf, until, type ToolCall } from '../../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the given navigator calls, one per step, and returns every prompt both agents were sent. */
async function run(calls: ToolCall[]) {
  const h = createHarness({
    task: 'Test task',
    pages: [{ url: 'https://app.test/', title: 'App', text: ['A page'] }],
    planner: Array(calls.length + 4).fill(plan()),
    navigator: [...calls.map(one => [one]), [done('Finished')]].flatMap(step => [step]),
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return {
    context: h.executor.getContext(),
    prompts: h.llm.requests.map(request => textOf(request.messages)),
    last: textOf(h.llm.requests[h.llm.requests.length - 1].messages),
  };
}

describe('notes', () => {
  it('shows every note in a later step, to both agents', async () => {
    const { prompts, last } = await run([call('notes', { action: 'add', text: 'The filters live behind "More"' })]);
    expect(last).toContain('[YOUR NOTES]');
    expect(last).toContain('- The filters live behind "More"');
    // The first prompt was sent before the note existed, so the block is what carries it forward.
    expect(prompts[0]).not.toContain('[YOUR NOTES]');
  });

  it('does not keep the same note twice, and replace and clear do what they say', async () => {
    const twice = await run([
      call('notes', { action: 'add', text: 'Tried the site search; it ignores the location' }),
      call('notes', { action: 'add', text: 'Tried the site search; it ignores the location' }),
    ]);
    expect(twice.context.notes).toEqual(['Tried the site search; it ignores the location']);

    const replaced = await run([
      call('notes', { action: 'add', text: 'first' }),
      call('notes', { action: 'replace', text: 'second' }),
    ]);
    expect(replaced.context.notes).toEqual(['second']);

    const cleared = await run([call('notes', { action: 'add', text: 'first' }), call('notes', { action: 'clear' })]);
    expect(cleared.context.notes).toEqual([]);
    expect(cleared.last).not.toContain('[YOUR NOTES]');
  });

  it('refuses a note with no text', async () => {
    const { prompts } = await run([call('notes', { action: 'add' })]);
    expect(prompts.join('\n')).toContain('Nothing written: notes add needs the text of the note.');
  });
});

describe('todo_list', () => {
  it('shows every part of the task, done and not done, in a later step', async () => {
    const { last } = await run([
      call('todo_list', { action: 'add', items: ['Find the opening hours', 'Find the phone number'] }),
      call('todo_list', { action: 'complete', items: ['Find the opening hours'] }),
    ]);
    expect(last).toContain('[TASK PARTS]\n1. [x] Find the opening hours\n2. [ ] Find the phone number');
  });

  it('completes by number as well as by text, and says what it could not find', async () => {
    const { context, prompts } = await run([
      call('todo_list', { action: 'add', items: ['one', 'two'] }),
      call('todo_list', { action: 'complete', items: ['2', 'three'] }),
    ]);
    expect(context.todos).toEqual([{ text: 'one', done: false }, { text: 'two', done: true }]);
    expect(prompts.join('\n')).toContain('Not on the list: "three".');
  });

  it('adds an item once and reorders by number', async () => {
    const { context } = await run([
      call('todo_list', { action: 'add', items: ['one', 'two', 'one'] }),
      call('todo_list', { action: 'reorder', items: ['2'] }),
    ]);
    expect(context.todos.map(item => item.text)).toEqual(['two', 'one']);
  });
});
