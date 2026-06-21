// This script runs inside the invisible offscreen document.
// It opens a continuous WebSocket-like port connection to the Service Worker.
// In Chrome 116+, an active port connection from an offscreen document
// legally suspends both the 30-second and 5-minute Service Worker termination limits.

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
