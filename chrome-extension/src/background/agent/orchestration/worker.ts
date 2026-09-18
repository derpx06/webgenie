/**
 * One worker: an ordinary `Executor` running one node's brief, on its own tab, under its own task id.
 *
 * **What isolation means here, honestly.** This is one MV3 service worker. There is no second process, no second
 * browser context and no incognito split, so workers share cookies, storage, the network and the extension's own
 * state. What they do not share is a tab (each gets its own, with its own `BrowserContext` and its own debugger
 * session) and a storage namespace: the task id `<runId>:<nodeId>` keys the transcript in `chrome.storage.session`,
 * the step checkpoint in IndexedDB and the trace records. A worker signed in as another worker's user would see it;
 * that is a real limitation of running inside the extension, not something this layer hides.
 *
 * The runner takes its browser and its executor as dependencies, so a test drives the real thing on the fakes in
 * `agent/__tests__/fakes.ts` and `background/index.ts` supplies the Chrome ones.
 */
import type BrowserContext from '../../browser/context';
import type { Executor } from '../executor';
import { ExecutionState } from '../event/types';
import type { NodeResult, NodeRunner, WorkerBrief } from './types';

export interface WorkerWorkspace {
  /** This worker's own tab, in its own BrowserContext: no other worker touches it. */
  browserContext: BrowserContext;
  tabId: number | null;
  /** Closes the worker's tab and detaches its debugger; called whatever the attempt did. */
  close: () => Promise<void>;
}

export interface WorkerDeps {
  /** A fresh tab for this worker, already pointed at the brief's start page. */
  openWorkspace: (brief: WorkerBrief) => Promise<WorkerWorkspace>;
  /** An executor for that workspace; `taskId` is the worker's storage namespace. */
  createExecutor: (params: { taskId: string; brief: WorkerBrief; workspace: WorkerWorkspace }) => Promise<Executor>;
}

export function workerTaskId(brief: WorkerBrief): string {
  return `${brief.runId}:${brief.nodeId}`;
}

export function createWorkerRunner(deps: WorkerDeps): NodeRunner {
  return async (brief, control) => {
    const taskId = workerTaskId(brief);
    const workspace = await deps.openWorkspace(brief);
    let executor: Executor | null = null;
    try {
      executor = await deps.createExecutor({ taskId, brief, workspace });
      const agent = executor;
      let ok = false;
      let lastDetail = '';
      agent.subscribeExecutionEvents(async event => {
        const detail = event.data.details ?? '';
        if (detail) lastDetail = detail;
        if (event.state === ExecutionState.TASK_OK) ok = true;
        const usage = event.data.usage;
        control.onProgress(
          `${event.state}|${detail.slice(0, 120)}`,
          usage ? Math.max(0, usage.inputTokens - (usage.cachedTokens ?? 0)) : undefined,
        );
      });

      const stop = () => void agent.cancel();
      control.signal.addEventListener('abort', stop, { once: true });
      try {
        await agent.execute();
      } finally {
        control.signal.removeEventListener('abort', stop);
      }

      const context = agent.getContext();
      const tokens = Math.max(
        0,
        context.messageManager.cumulativeInputTokens - context.messageManager.cumulativeCachedTokens,
      );
      const result: NodeResult = {
        ok: ok && !control.signal.aborted,
        answer: context.finalAnswer ?? lastDetail,
        tokens,
        urls: [...context.visitedUrls],
        facts: [...context.findings],
      };
      if (!result.ok) result.error = context.interruption ?? lastDetail ?? 'the worker did not finish its subtask';
      return result;
    } finally {
      await executor?.cleanup().catch(() => {});
      await workspace.close().catch(() => {});
    }
  };
}
