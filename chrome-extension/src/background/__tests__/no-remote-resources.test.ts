import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The privacy policy says nothing leaves the computer but the model provider's traffic and the search the agent makes. A page
// that pulled a font or stylesheet from a CDN would send the user's address to that host every time the panel opened, which
// is what the side panel and options page did with Google Fonts until 1.0.0.
const root = path.resolve(__dirname, '../../../..');
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(full).isDirectory() ? files(full, ext) : ext.test(name) ? [full] : [];
  });

describe('extension pages', () => {
  it('load no stylesheet, font or script from another host', () => {
    const sources = [
      ...files(path.join(root, 'pages'), /\.(html|css)$/),
      ...files(path.join(root, 'chrome-extension/public'), /\.(html|css)$/),
    ];
    expect(sources.length).toBeGreaterThan(3);
    const remote = sources.flatMap(file =>
      [...readFileSync(file, 'utf8').matchAll(/(?:@import\s+(?:url\()?|url\(|(?:href|src)=)["']?(https?:\/\/[^"')\s>]+)/g)].map(
        match => `${path.relative(root, file)}: ${match[1]}`,
      ),
    );
    expect(remote).toEqual([]);
  });
});
