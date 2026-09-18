// Measures the old page read against read_page/extract on three real pages of different shapes.
//   node chrome-extension/e2e/read-bench.mjs
// Not part of the build or the suites; it drives Chromium directly and prints the table for reports/READING.md.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = '/tmp/claude-1000/read-page.bundle.mjs';

await build({
  entryPoints: [path.join(ROOT, 'chrome-extension/src/background/browser/dom/read-page.ts')],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
const lib = await import(`${OUT}?v=${Date.now()}`);

// The old path, exactly as browser/page.ts had it before read_page.
function pageTextWithShadowRoots() {
  const text = document.body?.innerText ?? '';
  const hosts = [];
  const collect = root =>
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        hosts.push(el);
        collect(el.shadowRoot);
      }
    });
  collect(document);
  const rendered = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node instanceof Element && ['STYLE', 'SCRIPT', 'TEMPLATE'].includes(node.tagName)) return '';
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      return (assigned.length > 0 ? assigned : Array.from(node.childNodes)).map(rendered).join(' ');
    }
    const children = node instanceof Element && node.shadowRoot ? [node.shadowRoot] : Array.from(node.childNodes);
    return children.map(rendered).join(' ');
  };
  const sections = hosts
    .slice(0, 20)
    .map(host => {
      const inner = rendered(host.shadowRoot).replace(/\s+/g, ' ').trim().slice(0, 500);
      return inner ? `[Shadow root of <${host.tagName.toLowerCase()}>] ${inner}` : '';
    })
    .filter(Boolean);
  return [text, ...sections].join('\n');
}

/** Both tools return 12,000 characters (3,000 tokens) per call by default. */
const CHUNK = 12000;
const tokens = chars => Math.ceil(chars / 4);
const inPage = (page, fn, ...args) =>
  page.evaluate(new Function('args', `return (${fn.toString()}).apply(null, args)`), args);

const SPECS = [
  {
    name: 'Long article',
    url: 'https://en.wikipedia.org/wiki/Coffee',
    question: 'What does the "Decaffeination" section say?',
    old: old => {
      // Read 12,000 characters at a time from the top until the section is reached.
      const at = old.toLowerCase().indexOf('decaffeination');
      const calls = at < 0 ? Math.ceil(old.length / CHUNK) : Math.ceil((at + 1) / CHUNK);
      return { calls, steps: calls, chars: Math.min(calls * CHUNK, old.length), how: `get_complete_page_content ×${calls} (start_char 0, 12000, …)` };
    },
    now: markdown => {
      const outline = lib.renderOutline(lib.outlineOf(markdown));
      const section = lib.findSection(lib.outlineOf(markdown), 'Decaffeination');
      const body = markdown.slice(section.start, section.end);
      return { calls: 2, steps: 2, chars: outline.length + Math.min(body.length, CHUNK), how: 'read_page(mode=structured) then read_page(section="Decaffeination")' };
    },
  },
  {
    name: 'Paginated list (10 pages)',
    url: 'https://quotes.toscrape.com/',
    pages: 10,
    allPages: true,
    question: 'Which authors are quoted anywhere on the site?',
    old: (old, spec) => {
      const perPage = Math.ceil(old.length / CHUNK);
      const calls = perPage * spec.pages;
      return { calls, steps: calls + spec.pages - 1, chars: old.length * spec.pages, how: `get_complete_page_content ×${calls} with click "Next" ×${spec.pages - 1}` };
    },
    now: markdown => {
      const calls = Math.ceil(markdown.length / CHUNK);
      return { calls, steps: calls, chars: markdown.length, how: `read_page(all_pages=true, max_pages=10), then ${calls - 1} cursor read${calls === 2 ? '' : 's'}` };
    },
  },
  {
    name: 'Product grid (20 items)',
    url: 'https://books.toscrape.com/',
    question: 'Which of the 20 books listed is cheapest, and at what price?',
    old: old => ({ calls: Math.ceil(old.length / CHUNK), steps: Math.ceil(old.length / CHUNK) + 1, chars: old.length, how: 'get_complete_page_content, then read 20 prices out of the text by hand' }),
    now: markdown => {
      // extract returns the JSON, not the page: 20 {title, price} records.
      const titles = [...markdown.matchAll(/^#{1,6} \[([^\]]+)\]/gm)].map(match => match[1]);
      const prices = [...markdown.matchAll(/£\d+\.\d\d/g)].map(match => match[0]);
      const json = JSON.stringify(titles.slice(0, 20).map((title, i) => ({ title, price: prices[i] })));
      return { calls: 1, steps: 1, chars: json.length, how: 'extract(schema={title, price}); this grid is divs, not a table, so the model leg fills it from 2.9k characters' };
    },
  },
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const rows = [];
for (const spec of SPECS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(spec.url, { waitUntil: 'networkidle2', timeout: 60000 });

  const old = await page.evaluate(pageTextWithShadowRoots);
  let markdown = lib.blocksToMarkdown(await inPage(page, lib.extractReadBlocks, 'main'));
  let pagesRead = 1;
  if (spec.allPages) {
    for (; pagesRead < spec.pages; pagesRead++) {
      const href = await inPage(page, lib.findNextPageHref);
      if (!href) break;
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
      markdown += `\n\n${lib.blocksToMarkdown(await inPage(page, lib.extractReadBlocks, 'main'))}`;
    }
  }
  await page.close();
  if (process.env.DUMP) fs.writeFileSync(`/tmp/claude-1000/md-${rows.length}.md`, markdown);

  rows.push({
    name: spec.name,
    url: spec.url,
    question: spec.question,
    pagesRead,
    doc: { oldChars: old.length * (spec.pages ?? 1), newChars: markdown.length, sections: lib.outlineOf(markdown).length },
    old: spec.old(old, spec),
    now: spec.now(markdown, spec),
  });
}
await browser.close();

for (const row of rows) {
  row.doc.oldTokens = tokens(row.doc.oldChars);
  row.doc.newTokens = tokens(row.doc.newChars);
  row.old.tokens = tokens(row.old.chars);
  row.now.tokens = tokens(row.now.chars);
}
fs.writeFileSync('/tmp/claude-1000/read-bench.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
