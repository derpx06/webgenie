# The reading layer, measured

`read_page`, `find_in_page` and `extract` against the old `get_complete_page_content`
(`document.body.innerText` in 12,000-character slices), on three live pages of different
shapes.

Measured on 2026-09-18 with `node chrome-extension/e2e/read-bench.mjs`, which drives
Chromium directly: it loads each page, runs the old in-page text function and the new
`extractReadBlocks` + `blocksToMarkdown` against the same DOM, and follows the site's own
next-page links for the paginated case. Tokens are characters ÷ 4. Both tools return
12,000 characters (3,000 tokens) per call by default, so the call counts are comparable.

## The whole document

What one full read of the page yields.

| page | old: innerText | `read_page(mode=main)` | sections in the outline |
| --- | --- | --- | --- |
| Long article — `en.wikipedia.org/wiki/Coffee` | 103,152 chars / 25,788 tok | 105,963 chars / 26,491 tok | 47 |
| Paginated list — `quotes.toscrape.com`, 10 pages | 16,680 chars / 4,170 tok | 24,639 chars / 6,160 tok | 20 |
| Product grid — `books.toscrape.com`, 20 items | 2,029 chars / 508 tok | 2,887 chars / 722 tok | 20 |

The markdown is the same size or larger, because it carries what plain text does not:
heading levels, table columns, and the addresses of links that lead somewhere. That is the
point of the next table — the whole document is no longer what a read returns.

## Answering a question about the page

| page | question | old path | `read_page` / `extract` |
| --- | --- | --- | --- |
| Long article | *What does the "Decaffeination" section say?* | `get_complete_page_content` ×3 from `start_char` 0 → **3 steps, 36,000 chars, 9,000 tok** | `read_page(mode=structured)` then `read_page(section="Decaffeination")` → **2 steps, 2,141 chars, 536 tok** |
| Paginated list | *Which authors are quoted anywhere on the site?* | a read per page plus a click on "Next" ×9 → **19 steps, 16,680 chars, 4,170 tok** | `read_page(all_pages=true, max_pages=10)` then 2 cursor reads → **3 steps, 24,639 chars, 6,160 tok** |
| Product grid | *Which of the 20 books is cheapest, and at what price?* | one read, then 20 prices picked out of prose → **2 steps, 2,029 chars, 508 tok** | `extract(schema={title, price})` → **1 step, 1,016 chars, 254 tok** |

**Article: 3 steps → 2, and 9,000 tokens → 536 (−94%).** The old path has to read from the
top until the section appears; the outline names all 47 sections with their sizes and
`section` jumps straight to one.

**Paginated list: 19 steps → 3 (−84%), at 6,160 tokens against 4,170 (+48%).** The steps
are the point — nineteen of them is the pagination thrash the trace review costed at 710
wasted steps and $3.27 across 247 tasks — but the characters are honestly higher: the
markdown keeps each quote's author link and the tag names, which `innerText` flattens away.

**Product grid: 2 steps → 1, and half the tokens,** and what comes back is validated JSON
with a source and a confidence per field rather than prose to be re-read. This grid is
built from `div`s, not a table, so the deterministic parse finds no table and `extract`
answers it through its one model call over 2,887 characters; on a real table (or a
`Label: value` page) that call does not happen at all.

## What the numbers moved during the build

The first cut returned 194,878 characters for the Wikipedia article (against innerText's
103,152) and 41,022 for ten pages of quotes. Link addresses were the whole difference. The
rule now: a link to a place on the same page keeps its text only, and an address is written
out only for a link that names something in full (20 characters, or 3 words) or that is a
block on its own — a heading, a list item, a table cell, a result title. Short links inside
a sentence keep their text; they are in the element list already, with their `href`, and
can be clicked by index. That took the article to 105,963 and the ten pages to 24,639.

The same measurement caught two bugs that no unit test would have: `extractReadBlocks`
referred to a module-level constant, which throws in the page on every read, and
`findNextPageHref` matched none of "Next →", "Next page »" or "→", so `all_pages` read one
page where it should have read ten. Both are covered by tests now — the in-page functions
are rebuilt from their own source and run against a stub DOM, so a reference to anything
outside them fails in the suite instead of on a live page.

## What is not measured here

Wall-clock time (one extraction is a single `Runtime.callFunctionOn` per frame, against one
for `innerText`, so it is not expected to differ), and the content cache, whose saving
depends on how often a task re-reads an unchanged page — 20% of `get_complete_page_content`
calls in the reviewed runs were an exact repeat, and each of those now returns
`[unchanged since step N]` instead of up to 3,000 tokens.
