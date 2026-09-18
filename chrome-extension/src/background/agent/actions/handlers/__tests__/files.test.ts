import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { baseName, matchDownload, passagesAround } from '../files';

const item = (filename: string, url = 'https://files.test/get?id=1') => ({ filename, url, finalUrl: url });

describe('naming a downloaded file', () => {
  it('takes the file name off any path or address', () => {
    expect(baseName('/home/u/Downloads/Q3 report.pdf')).toBe('Q3 report.pdf');
    expect(baseName('C:\\Users\\u\\sales.csv')).toBe('sales.csv');
    expect(baseName('https://files.test/a/b/data.xlsx?token=9#x')).toBe('data.xlsx');
  });

  it('finds the download the model named, by its own name or by the address it came from', () => {
    const items = [item('/tmp/dl/invoice-42.pdf'), item('/tmp/dl/sales.csv', 'https://files.test/export/rows.csv')];
    expect(matchDownload(items, 'invoice-42.pdf')?.filename).toBe('/tmp/dl/invoice-42.pdf');
    // The state shows the base name, so a full local path must match too.
    expect(matchDownload(items, '/tmp/dl/sales.csv')?.filename).toBe('/tmp/dl/sales.csv');
    expect(matchDownload(items, 'rows.csv')?.filename).toBe('/tmp/dl/sales.csv');
    expect(matchDownload(items, 'nothing.pdf')).toBeUndefined();
    expect(matchDownload(items, '')).toBeUndefined();
  });
});

describe('find inside a file', () => {
  const sheet = 'Region | Revenue | Year\nNorth | 1200 | 2025\nSouth | 900 | 2025\nEast | 1500 | 2026';

  it('returns a matching row with its header, so the value keeps its column name', () => {
    const found = passagesAround(sheet, 'South');
    expect(found).toContain('Region | Revenue | Year');
    expect(found).toContain('South | 900 | 2025');
    expect(found).not.toContain('East');
  });

  it('is empty when the text is not there, so the caller can say so instead of sending the file', () => {
    expect(passagesAround(sheet, 'West')).toBe('');
  });

  it('shows the surroundings of a match in running text', () => {
    const text = `${'x'.repeat(200)} the total is 42 pounds ${'y'.repeat(200)}`;
    const found = passagesAround(text, 'the total is 42');
    expect(found).toContain('the total is 42 pounds');
    expect(found.length).toBeLessThan(text.length);
  });
});
