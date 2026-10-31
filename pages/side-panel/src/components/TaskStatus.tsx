import { memo } from 'react';
import { t } from '@extension/i18n';
import type { TaskPhase, TaskProgress } from '../types/event';

interface TaskStatusProps {
  progress: TaskProgress;
  /** What the person asked for: shown under the phase so the panel always says what it is working on. */
  goal: string | null;
  isPaused: boolean;
  pausedReason: string | null;
}

type Tone = 'accent' | 'ok' | 'wait' | 'err' | 'idle';

/**
 * One row per phase: the tone it is drawn in, the word for it, and whether the
 * agent is still working. Tones are semantic — waiting on the person is never the
 * accent, so a question cannot be mistaken for ordinary progress.
 */
const PHASES: Record<TaskPhase, { tone: Tone; label: () => string; live: boolean }> = {
  idle: { tone: 'idle', label: () => t('status_phase_idle'), live: false },
  starting: { tone: 'accent', label: () => t('status_phase_starting'), live: true },
  planning: { tone: 'accent', label: () => t('status_phase_planning'), live: true },
  acting: { tone: 'accent', label: () => t('status_phase_acting'), live: true },
  observing: { tone: 'accent', label: () => t('status_phase_observing'), live: true },
  waiting_human: { tone: 'wait', label: () => t('status_phase_waitingHuman'), live: false },
  paused: { tone: 'wait', label: () => t('status_phase_paused'), live: false },
  done: { tone: 'ok', label: () => t('status_phase_done'), live: false },
  failed: { tone: 'err', label: () => t('status_phase_failed'), live: false },
  cancelled: { tone: 'idle', label: () => t('status_phase_cancelled'), live: false },
};

const PhaseIcon = ({ phase }: { phase: TaskPhase }) => {
  const common = { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'size-3.5', 'aria-hidden': true };
  if (phase === 'done') return <svg {...common}><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
  if (phase === 'failed') return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 5v4M8 11h.01" /></svg>;
  if (phase === 'cancelled') return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M5.5 5.5l5 5" /></svg>;
  if (phase === 'waiting_human') return <svg {...common}><path d="M8 2.5A5.5 5.5 0 1 1 3.4 11L2 14l3-1.4A5.5 5.5 0 0 1 8 2.5Z" /></svg>;
  if (phase === 'paused') return <svg {...common}><path d="M6 4v8M10 4v8" /></svg>;
  if (phase === 'idle') return <svg {...common}><circle cx="8" cy="8" r="6" /></svg>;
  return null; // Live phases use the breathing dot instead of a glyph.
};

/**
 * The one-second read: what the agent is doing, what it is doing it for, and how
 * far through its step budget it is. Its height never changes as events arrive —
 * the goal line always reserves two lines and the rail is always present — so the
 * trail below it never jumps.
 */
export const TaskStatus = memo(function TaskStatus({
  progress,
  goal,
  isPaused,
  pausedReason,
}: TaskStatusProps) {
  const { phase, step, maxSteps } = progress;
  // A pause outranks whatever the last execution event said.
  const effective: TaskPhase = isPaused && phase !== 'waiting_human' ? 'paused' : phase;
  const meta = PHASES[effective];
  const hasCount = step > 0 && maxSteps > 0;
  const pct = hasCount ? Math.min(100, Math.round((step / maxSteps) * 100)) : 0;

  const label = meta.label();
  // One sentence for assistive tech, so a screen reader gets the same read as the eye.
  const announcement = hasCount ? `${label}. ${t('status_stepOf', [String(step), String(maxSteps)])}` : label;

  return (
    <div className={`wg-status wg-tone-${meta.tone}`}>
      <div className="wg-status-top">
        <span className="wg-status-phase">
          {meta.live ? <span className="wg-dot wg-dot-live" aria-hidden="true" /> : <PhaseIcon phase={effective} />}
          <span>{label}</span>
        </span>

        {hasCount && (
          <span className="wg-status-count wg-num">{t('status_stepOf', [String(step), String(maxSteps)])}</span>
        )}
      </div>

      <p className="wg-status-goal" title={goal ?? undefined}>
        {goal || progress.detail || t('status_phase_idleHint')}
      </p>

      <div
        className="wg-status-rail"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={hasCount ? maxSteps : undefined}
        aria-valuenow={hasCount ? step : undefined}
        aria-label={announcement}>
        {hasCount ? (
          <div className="wg-status-fill" style={{ width: `${pct}%` }} />
        ) : meta.live ? (
          <div className="wg-status-fill wg-status-fill-idle" />
        ) : null}
      </div>

      {/* Live region: the phase in words, for anyone not watching the colour. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {pausedReason && <p className="wg-callout-note">{pausedReason}</p>}

    </div>
  );
});
