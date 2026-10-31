import { t } from '@extension/i18n';

type SidePanelHeaderProps = {
  isDarkMode?: boolean;
  showHistory: boolean;
  onBackToChat: () => void;
  onNewChat: () => void;
  onLoadHistory: () => void;
  isTransparent?: boolean;
};

const icon = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'size-4',
  'aria-hidden': true,
};

/**
 * A quiet, fixed-height bar: identity on the left, the three things the panel can do on
 * the right. It stays the same height in every state so nothing below it ever shifts.
 */
const SidePanelHeader = ({ showHistory, onBackToChat, onNewChat, onLoadHistory }: SidePanelHeaderProps) => (
  <header className="wg-header">
    {showHistory ? (
      <button type="button" className="wg-brand" onClick={onBackToChat}>
        <svg {...icon}><path d="M12 15l-5-5 5-5" /></svg>
        <span className="wg-brand-name">{t('chat_history_title')}</span>
      </button>
    ) : (
      <div className="wg-brand">
        <img src={chrome.runtime.getURL('webgenie-logo.png')} alt="" className="wg-brand-mark" />
        <span className="wg-brand-name">WebGenie</span>
      </div>
    )}

    <div className="flex items-center gap-0.5">
      {!showHistory && (
        <>
          <button type="button" className="wg-icon-btn" onClick={onNewChat} aria-label={t('nav_newChat_a11y')} title={t('nav_newChat_a11y')}>
            <svg {...icon}><path d="M10 4v12M4 10h12" /></svg>
          </button>
          <button type="button" className="wg-icon-btn" onClick={onLoadHistory} aria-label={t('nav_loadHistory_a11y')} title={t('nav_loadHistory_a11y')}>
            <svg {...icon}><path d="M10 5.5V10l3 1.75" /><circle cx="10" cy="10" r="6.5" /></svg>
          </button>
        </>
      )}
      <button
        type="button"
        className="wg-icon-btn"
        onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') })}
        aria-label={t('nav_settings_a11y')}
        title={t('nav_settings_a11y')}>
        <svg {...icon}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="M16.1 12.2a1.4 1.4 0 0 0 .28 1.55l.05.05a1.7 1.7 0 1 1-2.4 2.4l-.05-.05a1.4 1.4 0 0 0-1.55-.28 1.4 1.4 0 0 0-.85 1.29V17a1.7 1.7 0 1 1-3.4 0v-.07A1.4 1.4 0 0 0 7.3 15.6a1.4 1.4 0 0 0-1.55.28l-.05.05a1.7 1.7 0 1 1-2.4-2.4l.05-.05a1.4 1.4 0 0 0 .28-1.55 1.4 1.4 0 0 0-1.29-.85H2.3a1.7 1.7 0 1 1 0-3.4h.07a1.4 1.4 0 0 0 1.29-.9 1.4 1.4 0 0 0-.28-1.55l-.05-.05a1.7 1.7 0 1 1 2.4-2.4l.05.05a1.4 1.4 0 0 0 1.55.28h.07a1.4 1.4 0 0 0 .85-1.29V2.3a1.7 1.7 0 1 1 3.4 0v.07a1.4 1.4 0 0 0 .85 1.29 1.4 1.4 0 0 0 1.55-.28l.05-.05a1.7 1.7 0 1 1 2.4 2.4l-.05.05a1.4 1.4 0 0 0-.28 1.55v.07a1.4 1.4 0 0 0 1.29.85h.07a1.7 1.7 0 1 1 0 3.4h-.07a1.4 1.4 0 0 0-1.29.85Z" />
        </svg>
      </button>
    </div>
  </header>
);

export default SidePanelHeader;
