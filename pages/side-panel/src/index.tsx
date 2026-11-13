import { createRoot } from 'react-dom/client';
import { withErrorBoundary } from '@extension/shared';
import '@src/index.css';
import '@src/SidePanel.css';
import '@src/design.css';
import SidePanel from '@src/SidePanel';

/**
 * A render throw used to leave a blank white pane with no way out: no message, no reload, and the task it was
 * watching still running in the background with nothing reporting on it.
 */
const Fallback = (
  <div
    style={{
      padding: '24px 20px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 14,
      lineHeight: 1.6,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      alignItems: 'flex-start',
    }}>
    <strong style={{ fontSize: 15 }}>The panel stopped drawing</strong>
    <span style={{ opacity: 0.75 }}>
      Any task that was running is still running, and reopening the panel reconnects to it. If this keeps happening,
      Options &rarr; Developer Options has the traces to send with a report.
    </span>
    <button
      type="button"
      onClick={() => location.reload()}
      style={{ padding: '6px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid currentColor', background: 'transparent', color: 'inherit', font: 'inherit' }}>
      Reload the panel
    </button>
  </div>
);

const Panel = withErrorBoundary(SidePanel, Fallback);

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(<Panel />);
}

init();
