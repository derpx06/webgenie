import { FaHistory, FaPlus, FaGithub, FaCog, FaChevronLeft } from 'react-icons/fa';
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
    <header className={`sticky top-0 z-[60] overflow-hidden p-5 transition-all duration-700 ${isDarkMode
      ? 'border-b border-white/[0.04] bg-webgenie-bg/40'
      : 'border-b border-slate-200/40 bg-white/40'
      } backdrop-blur-3xl`}>

      {/* Atmospheric Glow Integration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute -right-20 -top-20 size-48 rounded-full blur-[100px] transition-all duration-1000 ${isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-400/10'}`}></div>
        <div className={`absolute -bottom-20 -left-20 size-48 rounded-full blur-[100px] transition-all duration-1000 ${isDarkMode ? 'bg-purple-500/5' : 'bg-purple-400/5'}`}></div>
      </div>

      <div className="relative z-10 flex items-center justify-between">
        {/* BRAND IDENTITY - NEURAL CORE LINK */}
        <button
          type="button"
          className="group flex items-center gap-3.5 text-left"
          onClick={showHistory ? onBackToChat : undefined}
          aria-label={showHistory ? 'Back to chat' : 'WebGenie'}
        >
          <div className="relative">
            <div className={`flex size-11 items-center justify-center rounded-[1.25rem] border transition-all duration-700 group-hover:scale-110 ${isDarkMode ? 'border-white/5 bg-white/5 shadow-2xl' : 'border-slate-200 bg-white shadow-lg'
              }`}>
              <img
                src={chrome.runtime.getURL('webgenie-logo.png')}
                alt="WebGenie"
                className={`size-[34px] object-contain ${isDarkMode ? 'drop-shadow-[0_0_12px_rgba(129,140,248,0.5)]' : 'drop-shadow-[0_0_12px_rgba(99,102,241,0.3)]'}`}
              />
            </div>
            {/* Neural Status Pulse */}
            <div className="absolute -right-1 -top-1 flex">
              <span className={`absolute inline-flex size-3.5 animate-ping rounded-full opacity-60 ${isDarkMode ? 'bg-indigo-400' : 'bg-indigo-500'}`}></span>
              <span className={`relative inline-flex size-3.5 rounded-full border-2 shadow-[0_0_10px_rgba(99,102,241,0.6)] ${isDarkMode
                ? 'border-slate-900 bg-indigo-500'
                : 'border-white bg-indigo-500'
                }`}></span>
            </div>
          </div>

          <div className="flex flex-col">
            <span className={`font-outfit text-[20px] font-black leading-none tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              WebGenie
            </span>
          </div>
        </button>

        {/* NAVIGATION SYSTEM - SYMMETRICAL GLASS PILL */}
        <div className={`flex items-center rounded-2xl p-1.5 transition-all duration-700 ${isDarkMode
          ? 'bg-white/[0.05] shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl'
          : 'border border-slate-200 bg-white shadow-xl backdrop-blur-2xl'
          }`}>
          <div className="flex items-center gap-1">
            {showHistory ? (
              <button
                type="button"
                onClick={onBackToChat}
                className={`flex size-9 items-center justify-center rounded-xl transition-all duration-500 ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'
                  }`}
                title={t('nav_back')}>
                <FaChevronLeft size={12} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onNewChat}
                  className={`group/btn flex size-9 items-center justify-center rounded-xl transition-all duration-500 ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-indigo-400' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                  title={t('nav_newChat_a11y')}>
                  <FaPlus size={12} className="transition-transform duration-500 group-hover/btn:rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={onLoadHistory}
                  className={`flex size-9 items-center justify-center rounded-xl transition-all duration-500 ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-indigo-400' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                  title={t('nav_loadHistory_a11y')}>
                  <FaHistory size={12} />
                </button>
              </>
            )}
          </div>

          <div className={`mx-2 h-5 w-px ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

          <div className="flex items-center gap-1">
            <a
              href="https://github.com/derpx06/webgenie"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex size-9 items-center justify-center rounded-xl transition-all duration-500 ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'
                }`}
              title="GitHub"
            >
              <FaGithub size={15} />
            </a>

            <button
              type="button"
              onClick={() => {
                const optionsUrl = chrome.runtime.getURL('options/index.html');
                chrome.tabs.create({ url: optionsUrl });
              }}
              className={`group/cog flex size-9 items-center justify-center rounded-xl transition-all duration-500 ${isDarkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900'
                }`}
              title={t('nav_settings_a11y')}>
              <FaCog size={15} className="transition-transform duration-1000 group-hover/cog:rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default SidePanelHeader;
