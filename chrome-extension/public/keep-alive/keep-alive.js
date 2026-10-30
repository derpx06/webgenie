// This script runs inside the invisible offscreen document.
// It opens a continuous WebSocket-like port connection to the Service Worker.
// What this actually buys, per Chrome's own documentation, because the comment here used to overstate it:
//   - Chrome 109: a message *from* an offscreen document resets the worker's idle timer.
//   - Chrome 114: sending a message over a long-lived port resets it. Holding a port open does not; only traffic
//     counts, which is why this pings rather than merely connecting.
// It does NOT lift the per-invocation five-minute limit on a single event or API call, and it does not help a
// fetch() whose response takes over 30 seconds — that one kills the worker regardless. Keep work below those.

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
