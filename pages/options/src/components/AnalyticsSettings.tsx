/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { analyticsSettingsStore, chatHistoryStore } from '@extension/storage';
import type { AnalyticsSettingsConfig } from '@extension/storage';
import { FiActivity, FiClock, FiShield, FiAlertCircle } from 'react-icons/fi';

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
      <div className="space-y-8 p-4">
        <div className={`h-10 w-48 rounded-2xl ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}></div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className={`h-40 rounded-[2rem] border transition-all duration-300 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-slate-50'}`}></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 xl:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>

      {/* LEFT COLUMN: ACTIVE VELOCITY */}
      <div className="space-y-8">
        <DashboardSection
          title="Usage Overview"
          subtitle="Workspace activity and runtime metrics"
          icon={<FiActivity size={20} />}
          isDarkMode={isDarkMode}
          colorTheme="indigo"
          contentClassName="grid grid-cols-1 gap-6 p-6"
        >
          <div className="group/stat flex items-center justify-between">
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Tasks Executed</span>
              <span className={`text-4xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                {formatNumber(stats.last30DaySessions)}
              </span>
            </div>
            <div className={`h-10 w-px ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}></div>
            <div className="flex flex-col text-right">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Operations Processed</span>
              <span className={`text-4xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                {formatNumber(stats.last30DayMessages)}
              </span>
            </div>
          </div>

          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-100 bg-slate-50/50'}`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Efficiency Score</span>
              <span className={`text-xl font-bold ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>{stats.avgMessagesPerSession}%</span>
            </div>
            <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-white/5' : 'bg-slate-200'}`}>
              <div
                className="h-full bg-indigo-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, stats.avgMessagesPerSession * 10)}%` }}
              ></div>
            </div>
          </div>
        </DashboardSection>

        {/* All-Time Historical Logs */}
        <DashboardSection
          title="Historical Logs"
          subtitle="Cumulative system telemetry"
          icon={<FiClock size={20} />}
          isDarkMode={isDarkMode}
          colorTheme="slate"
          contentClassName="grid grid-cols-2 gap-6 p-6"
        >
          <div className="group/stat flex flex-col">
            <span className={`text-3xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
              {formatNumber(stats.totalSessions)}
            </span>
            <span className={`mt-1 text-[9px] font-bold uppercase tracking-wider opacity-40`}>Total Sessions</span>
          </div>
          <div className="group/stat flex flex-col">
            <span className={`text-3xl font-bold tracking-tight transition-all duration-300 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
              {formatNumber(stats.totalMessages)}
            </span>
            <span className={`mt-1 text-[9px] font-bold uppercase tracking-wider opacity-40`}>Total Messages</span>
          </div>
          <div className="group/stat col-span-2 flex items-center justify-between rounded-xl border border-dashed border-white/10 p-4">
            <span className={`text-[9px] font-bold uppercase tracking-wider opacity-40`}>Archive Age</span>
            <span className={`text-sm font-bold tracking-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {daysSince(stats.oldestSessionDate)}
            </span>
          </div>
        </DashboardSection>
      </div>

      {/* RIGHT COLUMN: SYSTEM INSTRUMENTATION & PRIVACY */}
      <div className="space-y-8">
        {/* Instrumentation Note */}
        <section className={`overflow-hidden rounded-2xl border p-8 transition-all duration-300 ${isDarkMode ? 'border-amber-500/10 bg-amber-500/5' : 'border-amber-100 bg-amber-50/50'
          }`}>
          <div className="flex flex-col gap-4">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${isDarkMode ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-100 text-amber-700'
              }`}>
              <FiAlertCircle size={20} />
            </div>
            <div>
              <h3 className={`font-outfit text-base font-bold uppercase tracking-tight ${isDarkMode ? 'text-amber-400' : 'text-amber-800'}`}>
                Advanced Analytics Unavailable
              </h3>
              <p className={`mt-3 text-[13px] font-medium leading-relaxed opacity-70 ${isDarkMode ? 'text-amber-200/60' : 'text-amber-700/70'}`}>
                Detailed token and cost tracking has not been enabled. Current metrics are derived strictly from your local session data.
              </p>
              
              <div className="mt-6 flex items-center gap-2">
                <div className="size-1 rounded-full bg-amber-500 animate-pulse"></div>
                <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">Local Mode Active</span>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy Toggle Section */}
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
                  after:left-[3px] after:top-[3px] after:size-4 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-focus:outline-none
                  ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-white/20 peer-checked:bg-indigo-600' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-indigo-600'} 
                  peer-checked:after:bg-white`}>
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
      </div>
    </div>
  );
};
