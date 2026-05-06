/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { analyticsSettingsStore, chatHistoryStore } from '@extension/storage';
import type { AnalyticsSettingsConfig } from '@extension/storage';
import { FiActivity, FiClock, FiShield, FiAlertCircle } from 'react-icons/fi';

import { DashboardSection } from './shared/DashboardSection';

interface AnalyticsSettingsProps {
  isDarkMode: boolean;
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
          title="30-Day Velocity"
          subtitle="Dynamic performance metrics"
          icon={<FiActivity size={24} />}
          isDarkMode={isDarkMode}
          colorTheme="cyan"
          contentClassName="grid grid-cols-1 gap-10 p-10"
        >
          <div className="group/stat flex items-center justify-between">
            <div className="flex flex-col">
              <span className={`text-[11px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Tasks Executed</span>
              <span className={`text-5xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-105 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {formatNumber(stats.last30DaySessions)}
              </span>
            </div>
            <div className={`h-12 w-px ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}></div>
            <div className="flex flex-col text-right">
              <span className={`text-[11px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Packets Processed</span>
              <span className={`text-5xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-105 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                {formatNumber(stats.last30DayMessages)}
              </span>
            </div>
          </div>

          <div className={`rounded-3xl border p-8 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-100 bg-slate-50/50'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className={`text-[11px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Efficiency Score</span>
              <span className={`text-2xl font-black ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>{stats.avgMessagesPerSession}%</span>
            </div>
            <div className={`h-2 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-white/5' : 'bg-slate-200'}`}>
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, stats.avgMessagesPerSession * 10)}%` }}
              ></div>
            </div>
          </div>
        </DashboardSection>

        {/* All-Time Historical Logs */}
        <DashboardSection
          title="Historical Logs"
          subtitle="Cumulative system telemetry"
          icon={<FiClock size={24} />}
          isDarkMode={isDarkMode}
          colorTheme="violet"
          contentClassName="grid grid-cols-2 gap-8 p-10"
        >
          <div className="group/stat flex flex-col">
            <span className={`text-4xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-105 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
              {formatNumber(stats.totalSessions)}
            </span>
            <span className={`mt-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-40`}>Operations</span>
          </div>
          <div className="group/stat flex flex-col">
            <span className={`text-4xl font-black tracking-tighter transition-all duration-500 group-hover/stat:scale-105 ${isDarkMode ? 'text-amber-400' : 'text-amber-500'}`}>
              {formatNumber(stats.totalMessages)}
            </span>
            <span className={`mt-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-40`}>Signals</span>
          </div>
          <div className="group/stat col-span-2 flex items-center justify-between rounded-2xl border border-dashed border-white/10 p-5">
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] opacity-40`}>Uptime Record</span>
            <span className={`text-lg font-black italic tracking-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {daysSince(stats.oldestSessionDate)}
            </span>
          </div>
        </DashboardSection>
      </div>

      {/* RIGHT COLUMN: SYSTEM INSTRUMENTATION & PRIVACY */}
      <div className="space-y-8">
        {/* Instrumentation Note */}
        <section className={`overflow-hidden rounded-[2.5rem] border p-10 transition-all duration-500 ${isDarkMode ? 'border-amber-500/20 bg-amber-500/5 shadow-2xl backdrop-blur-3xl' : 'border-amber-100 bg-amber-50/50 shadow-xl'
          }`}>
          <div className="flex flex-col gap-6">
            <div className={`flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-inner ${isDarkMode ? 'bg-amber-500/20 text-amber-500' : 'bg-amber-200 text-amber-700'
              }`}>
              <FiAlertCircle size={28} />
            </div>
            <div>
              <h3 className={`font-outfit text-xl font-black uppercase tracking-tight ${isDarkMode ? 'text-amber-400' : 'text-amber-800'}`}>
                Instrumentation Required
              </h3>
              <p className={`mt-4 text-[14px] font-semibold leading-relaxed opacity-80 ${isDarkMode ? 'text-amber-200/60' : 'text-amber-700/70'}`}>
                Detailed token consumption tracking and cost analysis require advanced instrumentation. This protocol is currently in standby.
                Existing telemetry is derived strictly from your local data core.
              </p>
              
              <div className="mt-8 flex items-center gap-2">
                <div className="size-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Awaiting Connection</span>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy Toggle Section */}
        {settings && (
          <section className={`group overflow-hidden rounded-[2.5rem] border transition-all duration-500 hover:shadow-2xl ${isDarkMode ? 'border-indigo-500/20 bg-indigo-600/5 shadow-2xl backdrop-blur-3xl' : 'border-slate-200 bg-white shadow-xl'
            }`}>
            <div className={`flex items-center gap-6 border-b px-10 py-8 transition-colors duration-500 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-slate-50/50'
              }`}>
              <div className={`flex size-14 items-center justify-center rounded-2xl shadow-inner ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'
                }`}>
                <FiShield size={24} />
              </div>
              <div>
                <h2 className={`font-outfit text-2xl font-black uppercase italic tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Data Privacy</h2>
                <p className={`mt-1 text-[13px] font-medium ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  Anonymous telemetry core
                </p>
              </div>
            </div>

            <div className="p-10 space-y-8">
              <div className="flex items-center justify-between gap-8">
                <p className={`text-[14px] font-semibold leading-relaxed opacity-70 ${isDarkMode ? 'text-slate-300' : 'text-slate-500'}`}>
                  Securely share system-level diagnostics. No personal identifiers or data logs are ever exported.
                </p>
                <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
                  <input type="checkbox" className="peer sr-only" checked={settings.enabled} onChange={e => handleToggleAnalytics(e.target.checked)} />
                  <div className={`peer h-8 w-14 rounded-full border transition-all duration-300 after:absolute 
                    after:left-[4px] after:top-[4px] after:size-6 after:rounded-full after:shadow-2xl 
                    after:backdrop-blur-md after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-focus:outline-none
                    ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-white/20 peer-checked:bg-indigo-500 shadow-indigo-500/20' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-indigo-600 shadow-sm'} 
                    peer-checked:after:bg-white`}>
                  </div>
                </label>
              </div>

              <div className={`rounded-2xl border p-6 ${isDarkMode ? 'border-white/5 bg-white/[0.01]' : 'border-slate-100 bg-slate-50/30'}`}>
                <div className="flex items-center gap-3 opacity-40">
                  <div className="size-1 rounded-full bg-emerald-500"></div>
                  <span className="text-[10px] font-black uppercase tracking-widest">End-to-End Local Processing</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
