import type { TraceEvent } from './types';
import { record } from '../../trace';

function makeId(): string {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Agent lifecycle events (plans, actions, validations, checkpoints), written to the trace log. */
export class TraceStore {
  append(event: Omit<TraceEvent, 'id'> & { id?: string }): TraceEvent {
    const fullEvent: TraceEvent = { ...event, id: event.id ?? makeId() };
    const { taskId, actor, type, ...rest } = fullEvent;
    record({ level: 'info', kind: 'trace', component: String(actor), msg: String(type), taskId, data: rest });
    return fullEvent;
  }
}
