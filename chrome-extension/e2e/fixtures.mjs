// Local pages for environments no public site offers reliably: a cross-site iframe (a separate
// renderer process) holding a contenteditable field and a shadow-DOM button.
import http from 'node:http';

const EDITOR_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Embedded editor</title>
<h1>Embedded editor</h1>
<p>Notes</p>
<div id="notes" contenteditable="true" role="textbox" aria-label="Notes" aria-multiline="true"
  style="border:1px solid #888;min-height:3em;padding:4px"></div>
<save-button></save-button>
<p id="status">Not saved</p>
<script>
  customElements.define('save-button', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<button type="button">Save</button>';
      root.querySelector('button').addEventListener('click', () => {
        document.getElementById('status').textContent = 'Saved: ' + document.getElementById('notes').innerText.trim();
      });
    }
  });
</script>`;

const hostHtml = editorUrl => `<!doctype html>
<meta charset="utf-8">
<title>Frame host</title>
<h1>Frame host page</h1>
<p>The editor below is served from another site.</p>
<iframe src="${editorUrl}" title="Embedded editor" style="width:640px;height:340px;border:1px solid #444"></iframe>`;

function listen(handler) {
  const server = http.createServer(handler);
  // No host: dual-stack, so both 127.0.0.1 and localhost (which may resolve to ::1) connect.
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

const send = (res, html) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
};

export async function startFixtures() {
  const editorServer = await listen((req, res) => (req.url.startsWith('/editor') ? send(res, EDITOR_HTML) : res.writeHead(404).end()));
  const editorOrigin = `http://localhost:${editorServer.address().port}`;
  const hostServer = await listen((req, res) =>
    req.url.startsWith('/oopif') ? send(res, hostHtml(`${editorOrigin}/editor`)) : res.writeHead(404).end(),
  );
  const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;
  return {
    hostOrigin,
    editorOrigin,
    oopifUrl: `${hostOrigin}/oopif`,
    close: () => Promise.all([editorServer, hostServer].map(server => new Promise(resolve => server.close(resolve)))),
  };
}
