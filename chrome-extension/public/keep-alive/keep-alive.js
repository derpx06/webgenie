// This script runs inside the invisible offscreen document.
// It opens a continuous WebSocket-like port connection to the Service Worker.
// What this buys, measured rather than quoted. A standalone extension with the same permissions and this same page
// was given a fetch() to a server that answers after 45 seconds, nothing sent until then, which is what a
// non-streaming model call looks like to the worker:
//   - without this page running, the fetch never completed (a 15 second control in the same setup did);
//   - with it running, the same fetch completed in 45.02 seconds.
// Chrome's documentation says a fetch that takes over 30 seconds to arrive ends the worker whatever else is going on;
// in that measurement this traffic is what kept it alive. Only traffic counts: holding a port open resets nothing,
// which is why this pings instead of merely connecting (Chrome 109 and 114 are where messages from an offscreen
// document and over a long-lived port started to reset the idle timer).
// Not measured: a single call past five minutes. The per-invocation limit is documented and is not known to be lifted.

const KEEP_ALIVE_INTERVAL_MS = 20000; // 20 seconds
let keepAlivePort = null;
let pingInterval = null;

function connectToServiceWorker() {
  console.log('[Offscreen Keep-Alive] Connecting to service worker...');
  keepAlivePort = chrome.runtime.connect({ name: 'enterprise-keep-alive' });

  keepAlivePort.onDisconnect.addListener(() => {
    console.log('[Offscreen Keep-Alive] Disconnected from service worker. Reconnecting...');
    cleanup();
    // Attempt to reconnect immediately if disconnected unexpectedly
    setTimeout(connectToServiceWorker, 1000);
  });

  // Start pinging the service worker to ensure the port isn't closed due to inactivity
  pingInterval = window.setInterval(() => {
    if (keepAlivePort) {
      try {
        keepAlivePort.postMessage({ ping: 'keep-alive-tick' });
      } catch (err) {
        console.warn('[Offscreen Keep-Alive] Failed to send ping, reconnecting...', err);
        cleanup();
        connectToServiceWorker();
      }
    }
  }, KEEP_ALIVE_INTERVAL_MS);
}

function cleanup() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  keepAlivePort = null;
}

// Initiate the connection as soon as the offscreen document loads
connectToServiceWorker();
