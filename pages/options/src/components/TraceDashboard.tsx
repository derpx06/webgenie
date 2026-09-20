/**
 * What the agent just did, what it cost and where the time went — read from this browser's local
 * trace store and nothing else: no server, no third-party service, no telemetry (decision D1).
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@extension/i18n';
import { advancedSettingsStore } from '@extension/storage';
import { FiActivity, FiAlertTriangle, FiClock, FiList, FiRefreshCw } from 'react-icons/fi';
import type { Health, StepSummary, TaskOverview, WallClock } from '@trace-summary';
import { formatDuration, formatTokens } from '@trace-summary';
import type { TaskDetailResult } from './traces/reader';
import { MAX_TASKS, MAX_TASK_RECORDS, listRecentTasks, readStatus, readTaskDetail } from './traces/reader';
import { DashboardSection } from './shared/DashboardSection';

interface TraceDashboardProps {
  isDarkMode?: boolean;
}

/** Fixed palette for the wall-clock bar; ordered as `WallClock` is charged. */
const BUCKETS: { key: keyof WallClock; color: string; label: () => string }[] = [
  { key: 'modelOkMs', color: '#6366F1', label: () => t('traces_bucket_modelOk') },
  { key: 'modelFailedMs', color: '#F43F5E', label: () => t('traces_bucket_modelFailed') },
  { key: 'hedgeMs', color: '#A855F7', label: () => t('traces_bucket_hedge') },
  { key: 'backoffMs', color: '#F59E0B', label: () => t('traces_bucket_backoff') },
  { key: 'settleMs', color: '#2ED9A8', label: () => t('traces_bucket_settle') },
  { key: 'actionMs', color: '#38BDF8', label: () => t('traces_bucket_action') },
  { key: 'getStateMs', color: '#14B8A6', label: () => t('traces_bucket_getState') },
  { key: 'networkIdleMs', color: '#64748B', label: () => t('traces_bucket_networkIdle') },
  { key: 'otherMs', color: '#475569', label: () => t('traces_bucket_other') },
];

const HEALTH_ROWS: { key: keyof Health; label: () => string }[] = [
  { key: 'rateLimited', label: () => t('traces_health_rateLimited') },
  { key: 'providerUnreachable', label: () => t('traces_health_providerUnreachable') },
  { key: 'transientRetries', label: () => t('traces_health_transientRetries') },
  { key: 'hedges', label: () => t('traces_health_hedges') },
  { key: 'timeouts', label: () => t('traces_health_timeouts') },
  { key: 'failedCalls', label: () => t('traces_health_failedCalls') },
  { key: 'validationReasks', label: () => t('traces_health_validationReasks') },
  { key: 'toolCallGiveUps', label: () => t('traces_health_toolCallGiveUps') },
  { key: 'toolsRejected', label: () => t('traces_health_toolsRejected') },
  { key: 'guardChecks', label: () => t('traces_health_guardChecks') },
  { key: 'validationsFailed', label: () => t('traces_health_validationsFailed') },
  { key: 'errors', label: () => t('traces_health_errors') },
];

const OUTCOME_STYLE: Record<TaskOverview['outcome'], string> = {
  ok: 'border-[#2ED9A8]/20 bg-[#2ED9A8]/10 text-[#2ED9A8]',
  fail: 'border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E]',
  cancel: 'border-[#6B7280]/20 bg-[#6B7280]/10 text-[#6B7280]',
  pause: 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]',
  running: 'border-[#6366F1]/20 bg-[#6366F1]/10 text-[#818CF8]',
};

const outcomeLabel = (outcome: TaskOverview['outcome']): string =>
  outcome === 'ok'
    ? t('traces_outcome_ok')
    : outcome === 'fail'
      ? t('traces_outcome_fail')
      : outcome === 'cancel'
        ? t('traces_outcome_cancel')
        : outcome === 'pause'
          ? t('traces_outcome_pause')
          : t('traces_outcome_running');

const Stat = ({ label, value, isDarkMode }: { label: string; value: string; isDarkMode: boolean }) => (
  <div className={`rounded-xl border px-4 py-3 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-200 bg-slate-50/60'}`}>
    <div className="text-[9px] font-black uppercase tracking-[0.18em] opacity-40">{label}</div>
    <div className="font-outfit mt-1 text-lg font-bold tracking-tight">{value}</div>
  </div>
);

const WallClockBar = ({ wallClock, isDarkMode }: { wallClock: WallClock; isDarkMode: boolean }) => {
  const total = Math.max(1, wallClock.totalMs);
  const shown = BUCKETS.filter(bucket => wallClock[bucket.key] > 0);
  return (
    <div className="space-y-3">
      <div className={`flex h-4 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-200'}`}>
        {shown.map(bucket => (
          <div
            key={bucket.key}
            title={`${bucket.label()} — ${formatDuration(wallClock[bucket.key])}`}
            style={{ width: `${(wallClock[bucket.key] / total) * 100}%`, backgroundColor: bucket.color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {shown.map(bucket => (
          <li key={bucket.key} className="flex items-center gap-2 text-[11px] font-medium">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: bucket.color }} />
            <span className="flex-1 truncate opacity-70">{bucket.label()}</span>
            <span className="font-mono tabular-nums opacity-90">{formatDuration(wallClock[bucket.key])}</span>
            <span className="w-10 text-right font-mono tabular-nums opacity-40">
              {Math.round((wallClock[bucket.key] / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const StepRow = ({ step, isDarkMode }: { step: StepSummary; isDarkMode: boolean }) => (
  <li className={`border-t px-5 py-3 ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-outfit min-w-14 text-sm font-black tracking-tight">
        {t('traces_step')} {step.step}
      </span>
      <span className="font-mono text-[11px] tabular-nums opacity-50">{formatDuration(step.durationMs)}</span>
      <span className="font-mono text-[11px] tabular-nums opacity-50">
        {formatTokens(step.tokens.inputTokens)} / {formatTokens(step.tokens.outputTokens)}
      </span>
      <span className="font-mono text-[11px] tabular-nums opacity-50">
        {t('traces_step_model')} {formatDuration(step.modelMs)}
      </span>
    </div>
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {step.llmCalls.map(call => (
        <span
          key={`${call.ts}-${call.component}`}
          title={call.error ?? call.finishReason ?? ''}
          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
            call.status === 'ok'
              ? isDarkMode
                ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300'
                : 'border-indigo-100 bg-indigo-50 text-indigo-700'
              : 'border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E]'
          }`}>
          {call.component} {formatDuration(call.durationMs)}
          {call.status === 'ok' ? '' : ` · ${call.status}`}
        </span>
      ))}
      {step.actions.map(action => (
        <span
          key={`${action.ts}-${action.name}`}
          title={action.error ?? ''}
          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
            action.error
              ? 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]'
              : isDarkMode
                ? 'border-white/10 bg-white/5 text-slate-300'
                : 'border-slate-200 bg-slate-100 text-slate-700'
          }`}>
          {action.name} {formatDuration(action.durationMs)}
        </span>
      ))}
      {step.validations.map(validation => (
        <span
          key={`${validation.ts}-${validation.name}`}
          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
            validation.verdict === 'failed'
              ? 'border-[#F43F5E]/20 bg-[#F43F5E]/10 text-[#F43F5E]'
              : 'border-[#2ED9A8]/20 bg-[#2ED9A8]/10 text-[#2ED9A8]'
          }`}>
          ✓ {validation.name}: {validation.verdict}
        </span>
      ))}
    </div>
    {step.errors.map(error => (
      <p key={`${error.ts}-${error.msg}`} className="mt-1 truncate font-mono text-[10px] text-[#F43F5E]">
        {error.component}: {error.msg}
      </p>
    ))}
  </li>
);

export const TraceDashboard = ({ isDarkMode = false }: TraceDashboardProps) => {
  const [tasks, setTasks] = useState<TaskOverview[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetailResult | null>(null);
  const [records, setRecords] = useState(0);
  const [captureOn, setCaptureOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const settings = await advancedSettingsStore.getSettings();
      setCaptureOn(import.meta.env.DEV || Boolean(settings.enableDeveloperOptions && settings.captureTraces));
      const status = await readStatus();
      setRecords(status.records);
      setTasks(await listRecentTasks());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setTasks([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    readTaskDetail(selected)
      .then(result => {
        if (live) setDetail(result);
      })
      .catch(cause => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [selected]);

  const toggle = (taskId: string) => setSelected(current => (current === taskId ? null : taskId));
  const cardBorder = isDarkMode ? 'border-white/5' : 'border-slate-200';

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-medium opacity-50">
          {t('traces_store_summary')} {records} · {t('traces_store_limit')} {MAX_TASKS}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7C3AED] disabled:opacity-40 ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}>
          <FiRefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          {t('traces_refresh')}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-[#F43F5E]/20 bg-[#F43F5E]/10 px-4 py-3 text-[11px] text-[#F43F5E]" aria-live="polite">
          {error}
        </p>
      )}

      {tasks !== null && tasks.length === 0 && (
        <DashboardSection
          title={t('traces_empty_title')}
          subtitle={captureOn ? t('traces_empty_capturing') : t('traces_empty_off')}
          icon={<FiActivity />}
          isDarkMode={isDarkMode}
          colorTheme="slate">
          <p className="p-5 text-[12px] font-medium leading-relaxed opacity-70">{t('traces_empty_how')}</p>
        </DashboardSection>
      )}

      {tasks !== null && tasks.length > 0 && (
        <DashboardSection
          title={t('traces_tasks_title')}
          subtitle={t('traces_tasks_subtitle')}
          icon={<FiList />}
          isDarkMode={isDarkMode}
          colorTheme="indigo">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className={`border-b text-[9px] font-black uppercase tracking-[0.18em] opacity-40 ${cardBorder}`}>
                <tr>
                  <th className="px-5 py-2 font-black">{t('traces_col_started')}</th>
                  <th className="px-3 py-2 font-black">{t('traces_col_task')}</th>
                  <th className="px-3 py-2 font-black">{t('traces_col_outcome')}</th>
                  <th className="px-3 py-2 text-right font-black">{t('traces_col_steps')}</th>
                  <th className="px-3 py-2 text-right font-black">{t('traces_col_duration')}</th>
                  <th className="px-3 py-2 text-right font-black">{t('traces_col_tokens')}</th>
                  <th className="px-3 py-2 text-right font-black">{t('traces_col_cached')}</th>
                  <th className="px-5 py-2 font-black">{t('traces_col_model')}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr
                    key={task.taskId}
                    tabIndex={0}
                    aria-selected={selected === task.taskId}
                    onClick={() => toggle(task.taskId)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle(task.taskId);
                      }
                    }}
                    className={`cursor-pointer border-b transition-colors ${cardBorder} ${
                      selected === task.taskId
                        ? isDarkMode
                          ? 'bg-indigo-500/10'
                          : 'bg-indigo-50'
                        : isDarkMode
                          ? 'hover:bg-white/[0.03]'
                          : 'hover:bg-slate-50'
                    }`}>
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono tabular-nums opacity-60">
                      {new Date(task.startedAt).toLocaleString()}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2.5" title={task.task ?? task.taskId}>
                      {task.task ?? <span className="font-mono opacity-50">{task.taskId}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${OUTCOME_STYLE[task.outcome]}`}>
                        {outcomeLabel(task.outcome)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{task.steps}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatDuration(task.durationMs)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatTokens(task.tokens.inputTokens)} / {formatTokens(task.tokens.outputTokens)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{Math.round(task.cachedShare * 100)}%</td>
                    <td className="max-w-40 truncate px-5 py-2.5 font-mono opacity-60" title={task.models.join(', ')}>
                      {task.models.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[10px] font-medium opacity-40">{t('traces_provider_note')}</p>
        </DashboardSection>
      )}

      {detail && (
        <>
          <DashboardSection
            title={t('traces_detail_title')}
            subtitle={detail.detail.overview.task ?? detail.detail.overview.taskId}
            icon={<FiClock />}
            isDarkMode={isDarkMode}
            colorTheme="teal">
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t('traces_col_duration')} value={formatDuration(detail.detail.wallClock.totalMs)} isDarkMode={isDarkMode} />
                <Stat label={t('traces_col_steps')} value={String(detail.detail.overview.steps)} isDarkMode={isDarkMode} />
                <Stat label={t('traces_stat_calls')} value={String(detail.detail.overview.llmCalls)} isDarkMode={isDarkMode} />
                <Stat
                  label={t('traces_col_cached')}
                  value={`${Math.round(detail.detail.overview.cachedShare * 100)}%`}
                  isDarkMode={isDarkMode}
                />
              </div>
              <WallClockBar wallClock={detail.detail.wallClock} isDarkMode={isDarkMode} />
              {detail.detail.overview.outcomeDetails && (
                <p className="text-[12px] font-medium leading-relaxed opacity-70">{detail.detail.overview.outcomeDetails}</p>
              )}
              {detail.truncated && (
                <p className="text-[10px] font-medium text-[#F59E0B]">
                  {t('traces_truncated')} {MAX_TASK_RECORDS}
                </p>
              )}
            </div>
          </DashboardSection>

          <DashboardSection
            title={t('traces_health_title')}
            subtitle={t('traces_health_subtitle')}
            icon={<FiAlertTriangle />}
            isDarkMode={isDarkMode}
            colorTheme="amber">
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 p-5 sm:grid-cols-3">
              {HEALTH_ROWS.map(row => (
                <li key={row.key} className="flex items-baseline justify-between gap-3 text-[11px] font-medium">
                  <span className="truncate opacity-60">{row.label()}</span>
                  <span
                    className={`font-mono tabular-nums ${detail.detail.health[row.key] > 0 ? 'font-bold text-[#F59E0B]' : 'opacity-30'}`}>
                    {detail.detail.health[row.key]}
                  </span>
                </li>
              ))}
            </ul>
          </DashboardSection>

          <DashboardSection
            title={t('traces_timeline_title')}
            subtitle={t('traces_timeline_subtitle')}
            icon={<FiActivity />}
            isDarkMode={isDarkMode}
            colorTheme="indigo">
            <ul>
              {detail.detail.steps.map(step => (
                <StepRow key={step.step} step={step} isDarkMode={isDarkMode} />
              ))}
            </ul>
          </DashboardSection>
        </>
      )}
    </div>
  );
};
