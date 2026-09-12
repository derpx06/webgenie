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

// Pages where a person must decide or provide something, or must not be bothered.
const PAGES = {
  '/shop': `<!doctype html><meta charset="utf-8"><title>Shirt shop</title>
<h1>Shirts</h1>
<ul>
  <li><h2>Blue shirt</h2><p>Cotton, regular fit — $20</p><button data-item="Blue shirt (cotton)" data-price="20">Add to cart</button></li>
  <li><h2>Blue shirt</h2><p>Linen, relaxed fit — $35</p><button data-item="Blue shirt (linen)" data-price="35">Add to cart</button></li>
  <li><h2>Red shirt</h2><p>Cotton — $18</p><button data-item="Red shirt" data-price="18">Add to cart</button></li>
</ul>
<p id="cart">Cart: empty</p>
<script>
  const cart = [];
  document.querySelectorAll('button[data-item]').forEach(button => button.addEventListener('click', () => {
    cart.push({ item: button.dataset.item, price: Number(button.dataset.price) });
    document.getElementById('cart').textContent = 'Cart: ' + cart.map(c => c.item).join(', ') + ' — total $' + cart.reduce((t, c) => t + c.price, 0);
  }));
</script>`,
  '/checkout': `<!doctype html><meta charset="utf-8"><title>Checkout</title>
<h1>Checkout</h1>
<table>
  <tr><td>Blue shirt (linen)</td><td>$35.00</td></tr>
  <tr><td>Shipping</td><td>$5.00</td></tr>
  <tr><th>Total</th><th>$40.00</th></tr>
</table>
<p>Payment: Visa ending 4242</p>
<button id="place">Place order</button>
<p id="status">Order not placed</p>
<script>document.getElementById('place').addEventListener('click', () => { document.getElementById('status').textContent = 'Order placed: #1042'; });</script>`,
  '/message': `<!doctype html><meta charset="utf-8"><title>Messages</title>
<h1>New message</h1>
<p><label>To <select id="to"><option>Alex</option><option>Sam</option></select></label></p>
<p><label>Message <textarea id="text"></textarea></label></p>
<button id="send">Send</button>
<p id="status">Not sent</p>
<script>document.getElementById('send').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Sent to ' + document.getElementById('to').value + ': ' + document.getElementById('text').value.trim();
});</script>`,
  '/delivery': `<!doctype html><meta charset="utf-8"><title>Book a delivery</title>
<h1>Book a delivery</h1>
<form id="booking">
  <p><label>Name <input name="fullname" required></label></p>
  <p><label>Address <input name="address" required></label></p>
  <p><label>Phone <input name="phone" type="tel" required></label></p>
  <button>Book delivery</button>
</form>
<p id="status">Not booked</p>
<script>document.getElementById('booking').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target.elements;
  document.getElementById('status').textContent = 'Booked for ' + form.fullname.value + ', ' + form.address.value + ', ' + form.phone.value;
});</script>`,
};

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
  const hostServer = await listen((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname.startsWith('/oopif')) return send(res, hostHtml(`${editorOrigin}/editor`));
    if (PAGES[pathname]) return send(res, PAGES[pathname]);
    return res.writeHead(404).end();
  });
  const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;
  return {
    hostOrigin,
    editorOrigin,
    oopifUrl: `${hostOrigin}/oopif`,
    close: () => Promise.all([editorServer, hostServer].map(server => new Promise(resolve => server.close(resolve)))),
  };
}
