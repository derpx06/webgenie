import React from 'react';

interface DashboardSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  isDarkMode: boolean;
  colorTheme?: 'indigo' | 'teal' | 'amber' | 'rose' | 'slate';
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  isOverflowVisible?: boolean;
}

export const DashboardSection: React.FC<DashboardSectionProps> = ({
  title,
  subtitle,
  icon,
  children,
  isDarkMode,
  colorTheme = 'indigo',
  className = '',
  headerClassName = '',
  contentClassName = '',
  isOverflowVisible = false,
}) => {
  const themeStyles = {
    indigo: {
      border: isDarkMode ? 'border-indigo-500/10' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#0f1117]' : 'bg-white',
      iconBg: isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-50',
      iconText: isDarkMode ? 'text-indigo-400' : 'text-indigo-600',
      subtitleText: isDarkMode ? 'text-slate-500' : 'text-slate-500',
    },
    teal: {
      border: isDarkMode ? 'border-teal-500/10' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#0f1117]' : 'bg-white',
      iconBg: isDarkMode ? 'bg-teal-500/10' : 'bg-teal-50',
      iconText: isDarkMode ? 'text-teal-400' : 'text-teal-600',
      subtitleText: isDarkMode ? 'text-slate-500' : 'text-slate-500',
    },
    amber: {
      border: isDarkMode ? 'border-amber-500/10' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#0f1117]' : 'bg-white',
      iconBg: isDarkMode ? 'bg-amber-500/10' : 'bg-amber-50',
      iconText: isDarkMode ? 'text-amber-400' : 'text-amber-600',
      subtitleText: isDarkMode ? 'text-slate-500' : 'text-slate-500',
    },
    rose: {
      border: isDarkMode ? 'border-rose-500/10' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#0f1117]' : 'bg-white',
      iconBg: isDarkMode ? 'bg-rose-500/10' : 'bg-rose-50',
      iconText: isDarkMode ? 'text-rose-400' : 'text-rose-600',
      subtitleText: isDarkMode ? 'text-slate-500' : 'text-slate-500',
    },
    slate: {
      border: isDarkMode ? 'border-white/5' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#0f1117]' : 'bg-white',
      iconBg: isDarkMode ? 'bg-white/5' : 'bg-slate-100',
      iconText: isDarkMode ? 'text-slate-400' : 'text-slate-600',
      subtitleText: isDarkMode ? 'text-slate-500' : 'text-slate-500',
    },
  };

  const style = themeStyles[colorTheme];

  return (
    <section className={`group ${isOverflowVisible ? 'overflow-visible' : 'overflow-hidden'} rounded-2xl border transition-all duration-300 ${style.border} ${style.bg} ${isDarkMode ? 'shadow-lg shadow-black/20' : 'shadow-sm shadow-slate-200/50'} ${className}`}>
      <div className={`flex items-center gap-4 border-b px-5 py-3 transition-colors duration-300 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-100 bg-slate-50/30'} ${headerClassName}`}>
        <div className={`flex size-9 items-center justify-center rounded-lg transition-all duration-300 ${style.iconBg} ${style.iconText}`}>
          {React.cloneElement(icon as React.ReactElement, { size: 18 })}
        </div>
        <div>
          <h2 className={`font-outfit text-lg font-bold tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
            {title}
          </h2>
          <p className={`mt-0.5 text-xs font-medium ${style.subtitleText}`}>
            {subtitle}
          </p>
        </div>
      </div>
      <div className={contentClassName}>
        {children}
      </div>
    </section>
  );
};
