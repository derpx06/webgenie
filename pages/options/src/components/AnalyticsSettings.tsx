/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { analyticsSettingsStore, chatHistoryStore } from '@extension/storage';
import type { AnalyticsSettingsConfig } from '@extension/storage';
import { FiActivity, FiClock, FiShield } from 'react-icons/fi';

import { DashboardSection } from './shared/DashboardSection';

interface AnalyticsSettingsProps {
  isDarkMode: boolean;
}

interface RealStats {
  totalSessions: number;
  totalMessages: number;
  last30DaySessions: number;
  last30DayMessages: number;
  avgMessagesPerSession: number;
  oldestSessionDate: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export const AnalyticsSettings: React.FC<AnalyticsSettingsProps> = ({ isDarkMode }) => {
  const [settings, setSettings] = useState<AnalyticsSettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RealStats>({
    totalSessions: 0,
    totalMessages: 0,
    last30DaySessions: 0,
    last30DayMessages: 0,
    avgMessagesPerSession: 0,
    oldestSessionDate: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [currentSettings, sessions] = await Promise.all([
          analyticsSettingsStore.getSettings(),
          chatHistoryStore.getSessionsMetadata(),
        ]);
        setSettings(currentSettings);

        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount ?? 0), 0);
        const last30 = sessions.filter(s => s.createdAt >= thirtyDaysAgo);
        const last30Messages = last30.reduce((sum, s) => sum + (s.messageCount ?? 0), 0);
        const oldest = sessions.length > 0 ? Math.min(...sessions.map(s => s.createdAt)) : null;

        setStats({
          totalSessions: sessions.length,
          totalMessages,
          last30DaySessions: last30.length,
          last30DayMessages: last30Messages,
          avgMessagesPerSession: sessions.length > 0 ? Math.round(totalMessages / sessions.length) : 0,
          oldestSessionDate: oldest,
          totalInputTokens: currentSettings.totalInputTokens || 0,
          totalOutputTokens: currentSettings.totalOutputTokens || 0,
        });
      } catch (error) {
        console.error('Failed to load analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
    const unsub = analyticsSettingsStore.subscribe(load);
    return () => unsub();
  }, []);

  const handleToggleAnalytics = async (enabled: boolean) => {
    if (!settings) return;
    try {
      await analyticsSettingsStore.updateSettings({ enabled });
      setSettings({ ...settings, enabled });
    } catch (error) {
      console.error('Failed to update analytics settings:', error);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  const daysSince = (ts: number | null) => {
    if (!ts) return '—';
    const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 max-w-2xl mx-auto pb-10">
        <div className={`h-10 w-48 rounded-2xl ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}></div>
        <div className="grid grid-cols-1 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className={`h-40 rounded-[2rem] border transition-all duration-300 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-slate-50'}`}></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 max-w-2xl mx-auto pb-10 duration-700 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>

      {/* 1. TOKEN CONSUMPTION HERO SECTION */}
      <DashboardSection
        title="Compute Intelligence"
        subtitle="Real-time LLM token utilization"
        icon={<FiActivity size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        contentClassName="p-6"
      >
        <div className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-indigo-500/10 via-cyan-500/5 to-transparent p-8 shadow-2xl">
          <div className="absolute -right-12 -top-12 size-48 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 size-48 rounded-full bg-cyan-500/10 blur-3xl" />
          
          <div className="relative flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>System Telemetry</span>
                <div className="flex items-center gap-2">
                  <div className="size-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
                  <span className="text-sm font-bold tracking-tight opacity-70">Active Monitoring</span>
                </div>
              </div>
              <div className={`rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-white/5 text-white/40' : 'bg-slate-200 text-slate-500'}`}>
                Live Stream
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12">
              <div className="group/stat flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <span className={`font-mono text-5xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-110 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(stats.totalInputTokens)}
                  </span>
                  <span className="mb-2 text-xs font-bold opacity-30">tkns</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-12 overflow-hidden rounded-full bg-slate-500/20">
                    <div className="h-full w-2/3 bg-slate-400/50" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Input (Context)</span>
                </div>
              </div>

              <div className="group/stat flex flex-col items-end gap-2 text-right">
                <div className="flex items-end gap-2">
                  <span className="mb-2 text-xs font-bold opacity-30">tkns</span>
                  <span className={`font-mono text-5xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-110 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                    {formatNumber(stats.totalOutputTokens)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Output (Inference)</span>
                  <div className="h-1 w-12 overflow-hidden rounded-full bg-cyan-500/20">
                    <div className="h-full w-1/3 bg-cyan-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className={`mt-4 flex items-center justify-between rounded-2xl border border-white/5 p-6 ${isDarkMode ? 'bg-white/[0.03]' : 'bg-white/50 shadow-sm'}`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-black uppercase tracking-[0.15em] opacity-30">Aggregate Compute Utilization</span>
                <span className="text-lg font-black tracking-tight">Total Consumed Tokens</span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`font-mono text-2xl font-black tracking-tighter ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  {formatNumber(stats.totalInputTokens + stats.totalOutputTokens)}
                </span>
                <div className="flex items-center gap-1.5 opacity-40">
                  <span className="text-[9px] font-bold uppercase">100% Local Validation</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DashboardSection>

      {/* 2. TELEMETRY & WORKSPACE ACTIVITY SECTION */}
      <DashboardSection
        title="Telemetry & Workspace Activity"
        subtitle="Workspace activity and cumulative runtime metrics"
        icon={<FiActivity size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        contentClassName="flex flex-col p-6 gap-6 divide-y divide-white/5"
      >
        {/* Section A: Last 30 Days */}
        <div className="space-y-4">
          <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Last 30 Days Activity</div>
          <div className="group/stat flex items-center justify-between">
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Tasks Executed</span>
              <span className={`font-mono text-4xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                {formatNumber(stats.last30DaySessions)}
              </span>
            </div>
            <div className={`h-10 w-px ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}></div>
            <div className="flex flex-col text-right">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Operations Processed</span>
              <span className={`font-mono text-4xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                {formatNumber(stats.last30DayMessages)}
              </span>
            </div>
          </div>

          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-100 bg-slate-50/50'}`}>
            <div className="mb-3 flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Avg Operations / Task</span>
              <span className={`font-mono text-xl font-bold ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>{stats.avgMessagesPerSession}</span>
            </div>
            <div className={`h-1.5 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-200'}`}>
              <div
                className="h-full bg-indigo-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, (stats.avgMessagesPerSession / 20) * 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Section B: All-Time Logs */}
        <div className="space-y-4 pt-6">
          <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Cumulative Telemetry</div>
          <div className="grid grid-cols-2 gap-6">
            <div className="group/stat flex flex-col">
              <span className={`font-mono text-3xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                {formatNumber(stats.totalSessions)}
              </span>
              <span className={`mt-1 text-[9px] font-bold uppercase tracking-wider opacity-40`}>Total Sessions</span>
            </div>
            <div className="group/stat flex flex-col">
              <span className={`font-mono text-3xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                {formatNumber(stats.totalMessages)}
              </span>
              <span className={`mt-1 text-[9px] font-bold uppercase tracking-wider opacity-40`}>Total Messages</span>
            </div>
            <div className="group/stat col-span-2 flex items-center justify-between rounded-xl border border-dashed border-white/10 p-4">
              <span className={`text-[9px] font-bold uppercase tracking-wider opacity-40`}>Archive Age</span>
              <span className={`font-mono text-sm font-bold tracking-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                {daysSince(stats.oldestSessionDate)}
              </span>
            </div>
          </div>
        </div>
      </DashboardSection>

      {/* 3. PRIVACY TOGGLE SECTION */}
      {settings && (
        <DashboardSection
          title="Data Privacy"
          subtitle="Anonymous telemetry settings"
          icon={<FiShield size={20} />}
          isDarkMode={isDarkMode}
          colorTheme="indigo"
          contentClassName="p-6 space-y-6"
        >
          <div className="flex items-center justify-between gap-6">
            <p className={`text-[13px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-300' : 'text-slate-500'}`}>
              Securely share system-level diagnostics. No personal identifiers or data logs are ever exported from your device.
            </p>
            <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
              <input type="checkbox" className="peer sr-only" checked={settings.enabled} onChange={e => handleToggleAnalytics(e.target.checked)} />
              <div className={`peer h-6 w-11 rounded-full border transition-all duration-300 after:absolute 
                after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-focus:outline-none
                ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-[#818cf8] peer-checked:bg-indigo-500' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-indigo-600'} 
                peer-checked:after:border-white peer-checked:after:bg-white`}>
              </div>
            </label>
          </div>

          <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-white/5 bg-white/[0.01]' : 'border-slate-100 bg-slate-50/30'}`}>
            <div className="flex items-center gap-2 opacity-40">
              <div className="size-1 rounded-full bg-teal-500"></div>
              <span className="text-[9px] font-bold uppercase tracking-wider">End-to-End Local Processing</span>
            </div>
          </div>
        </DashboardSection>
      )}

      {/* 4. PRECISION ANALYTICS ACTIVE BANNER */}
      <section className={`overflow-hidden rounded-2xl border p-8 transition-all duration-300 ${isDarkMode ? 'border-cyan-500/10 bg-cyan-500/5' : 'border-cyan-100 bg-cyan-50/50'
        }`}>
        <div className="flex flex-col gap-4">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${isDarkMode ? 'bg-cyan-500/10 text-cyan-500' : 'bg-cyan-100 text-cyan-700'
            }`}>
            <FiShield size={20} />
          </div>
          <div>
            <h3 className={`font-outfit text-base font-bold uppercase tracking-tight ${isDarkMode ? 'text-cyan-400' : 'text-cyan-800'}`}>
              Precision Analytics Active
            </h3>
            <p className={`mt-3 text-[13px] font-medium leading-relaxed opacity-70 ${isDarkMode ? 'text-cyan-200/60' : 'text-cyan-700/70'}`}>
              Full token tracking is now enabled across all agent nodes. Usage metrics are derived directly from model response headers for maximum accuracy.
            </p>
            
            <div className="mt-6 flex items-center gap-2">
              <div className="size-1 animate-pulse rounded-full bg-cyan-500"></div>
              <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">Precision Tracking Enabled</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
