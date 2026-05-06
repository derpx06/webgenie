import React from 'react';

interface DashboardSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  isDarkMode: boolean;
  colorTheme?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'indigo' | 'slate';
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
  colorTheme = 'slate',
  className = '',
  headerClassName = '',
  contentClassName = '',
  isOverflowVisible = false,
}) => {
  const themeStyles = {
    cyan: {
      border: isDarkMode ? 'border-cyan-500/20' : 'border-slate-200',
      bg: isDarkMode ? 'bg-cyan-500/5' : 'bg-white',
      iconBg: isDarkMode ? 'bg-cyan-500/20' : 'bg-cyan-100',
      iconText: isDarkMode ? 'text-cyan-400' : 'text-cyan-600',
      subtitleText: isDarkMode ? 'text-cyan-400' : 'text-cyan-600',
    },
    violet: {
      border: isDarkMode ? 'border-violet-500/20' : 'border-slate-200',
      bg: isDarkMode ? 'bg-violet-600/5' : 'bg-white',
      iconBg: isDarkMode ? 'bg-violet-500/20' : 'bg-violet-400',
      iconText: isDarkMode ? 'text-violet-400' : 'text-violet-400',
      subtitleText: isDarkMode ? 'text-violet-400' : 'text-violet-600',
    },
    emerald: {
      border: isDarkMode ? 'border-emerald-500/20' : 'border-emerald-500/5',
      bg: isDarkMode ? 'bg-emerald-500/5' : 'bg-white',
      iconBg: isDarkMode ? 'bg-emerald-500/20' : 'bg-emerald-100',
      iconText: isDarkMode ? 'text-emerald-400' : 'text-emerald-600',
      subtitleText: isDarkMode ? 'text-emerald-400' : 'text-emerald-600',
    },
    amber: {
      border: isDarkMode ? 'border-amber-500/20' : 'border-slate-200',
      bg: isDarkMode ? 'bg-amber-500/5' : 'bg-white',
      iconBg: isDarkMode ? 'bg-amber-500/20' : 'bg-amber-100',
      iconText: isDarkMode ? 'text-amber-400' : 'text-amber-600',
      subtitleText: isDarkMode ? 'text-amber-400' : 'text-amber-600',
    },
    indigo: {
      border: isDarkMode ? 'border-indigo-500/20' : 'border-slate-200',
      bg: isDarkMode ? 'bg-indigo-600/5' : 'bg-white',
      iconBg: isDarkMode ? 'bg-indigo-500/20' : 'bg-indigo-100',
      iconText: isDarkMode ? 'text-indigo-400' : 'text-indigo-600',
      subtitleText: isDarkMode ? 'text-indigo-400' : 'text-indigo-600',
    },
    slate: {
      border: isDarkMode ? 'border-white/5' : 'border-slate-200',
      bg: isDarkMode ? 'bg-[#1a1c23]/60' : 'bg-white',
      iconBg: isDarkMode ? 'bg-white/5' : 'bg-slate-100',
      iconText: isDarkMode ? 'text-white/60' : 'text-slate-600',
      subtitleText: isDarkMode ? 'text-white/40' : 'text-slate-500',
    },
  };

  const style = themeStyles[colorTheme];

  return (
    <section className={`group ${isOverflowVisible ? 'overflow-visible' : 'overflow-hidden'} rounded-[2.5rem] border transition-all duration-500 hover:shadow-2xl ${style.border} ${style.bg} ${isDarkMode ? 'shadow-2xl backdrop-blur-3xl' : 'shadow-xl'} ${className}`}>
      <div className={`flex items-center gap-6 border-b px-10 py-8 transition-colors duration-500 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-slate-50/50'} ${headerClassName}`}>
        <div className={`flex size-14 items-center justify-center rounded-2xl shadow-inner ${style.iconBg} ${style.iconText}`}>
          {icon}
        </div>
        <div>
          <h2 className={`font-outfit text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            {title}
          </h2>
          <p className={`mt-1 text-[13px] font-medium ${style.subtitleText}`}>
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
