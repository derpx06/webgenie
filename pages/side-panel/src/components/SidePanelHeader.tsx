import { t } from '@extension/i18n';

type SidePanelHeaderProps = {
  isDarkMode: boolean;
  showHistory: boolean;
  onBackToChat: () => void;
  onNewChat: () => void;
  onLoadHistory: () => void;
};

const SidePanelHeader = ({
  isDarkMode,
  showHistory,
  onBackToChat,
  onNewChat,
  onLoadHistory,
}: SidePanelHeaderProps) => {
  return (
    <header className={`sticky top-0 z-[60] flex h-[52px] shrink-0 items-center justify-between px-3 border-b transition-all duration-300 ${isDarkMode
      ? 'border-white/[0.08] bg-[#020617]'
      : 'border-slate-200/80 bg-white'
      }`}>
      
      {/* Left: Brand / Logo or Back Button */}
      {showHistory ? (
        <button
          type="button"
          onClick={onBackToChat}
          className={`group flex items-center gap-2 text-left focus:outline-none`}
          aria-label="Back to chat"
        >
          <div className={`flex size-[26px] items-center justify-center rounded-[7px] border transition-all duration-300 ${isDarkMode 
            ? 'border-white/[0.08] bg-white/[0.04] text-slate-400 group-hover:border-indigo-500/40 group-hover:text-white' 
            : 'border-slate-200 bg-slate-50 text-slate-500 group-hover:border-indigo-300 group-hover:text-slate-900'
            }`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </div>
          <span className={`font-sans text-[14px] font-medium tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
            Back to Chat
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          {/* Logo Mark: 26x26px square, violet accent bg, 7px radius, white magic icon */}
          <div className="flex size-[26px] items-center justify-center rounded-[7px] bg-[#8B5CF6] text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3">
              <path d="m15 4-2 2L6.5 12.5a3 3 0 0 0 0 4.24l.76.76a3 3 0 0 0 4.24 0L18 11l2-2" />
              <path d="m13 6 5 5" />
              <path d="M19 2v3" />
              <path d="M2 12h3" />
              <path d="M14 22v-3" />
              <path d="M22 12h-3" />
              <path d="M4 4l3 3" />
            </svg>
          </div>
          {/* App Name: sans-serif, 14px, weight 500, letter-spacing -0.015em */}
          <span className={`font-sans text-[14px] font-medium tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`} style={{ letterSpacing: '-0.015em' }}>
            WebGenie
          </span>
        </div>
      )}

      {/* Right: 4 small icon buttons */}
      <div className="flex items-center gap-1.5">
        {/* New Chat */}
        <button
          type="button"
          onClick={onNewChat}
          disabled={showHistory}
          className={`flex size-[25px] items-center justify-center rounded-[5px] border bg-transparent transition-all duration-200 ${
            showHistory 
              ? 'opacity-20 cursor-not-allowed border-transparent' 
              : isDarkMode
                ? 'border-white/[0.08] text-slate-500 hover:border-[#818cf8]/40 hover:text-white'
                : 'border-slate-200 text-slate-400 hover:border-[#8B5CF6]/30 hover:text-slate-900'
          }`}
          title={t('nav_newChat_a11y')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>

        {/* History */}
        <button
          type="button"
          onClick={showHistory ? onBackToChat : onLoadHistory}
          className={`flex size-[25px] items-center justify-center rounded-[5px] border bg-transparent transition-all duration-200 ${
            showHistory
              ? isDarkMode
                ? 'border-[#818cf8]/40 text-[#818cf8]'
                : 'border-[#8B5CF6]/30 text-[#8B5CF6]'
              : isDarkMode
                ? 'border-white/[0.08] text-slate-500 hover:border-[#818cf8]/40 hover:text-white'
                : 'border-slate-200 text-slate-400 hover:border-[#8B5CF6]/30 hover:text-slate-900'
          }`}
          title={showHistory ? t('nav_back') : t('nav_loadHistory_a11y')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </button>

        {/* GitHub */}
        <a
          href="https://github.com/derpx06/webgenie"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex size-[25px] items-center justify-center rounded-[5px] border bg-transparent transition-all duration-200 ${isDarkMode
            ? 'border-white/[0.08] text-slate-500 hover:border-[#818cf8]/40 hover:text-white'
            : 'border-slate-200 text-slate-400 hover:border-[#8B5CF6]/30 hover:text-slate-900'
            }`}
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
        </a>

        {/* Settings */}
        <button
          type="button"
          onClick={() => {
            const optionsUrl = chrome.runtime.getURL('options/index.html');
            chrome.tabs.create({ url: optionsUrl });
          }}
          className={`flex size-[25px] items-center justify-center rounded-[5px] border bg-transparent transition-all duration-200 ${isDarkMode
            ? 'border-white/[0.08] text-slate-500 hover:border-[#818cf8]/40 hover:text-white'
            : 'border-slate-200 text-slate-400 hover:border-[#8B5CF6]/30 hover:text-slate-900'
            }`}
          title={t('nav_settings_a11y')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default SidePanelHeader;
