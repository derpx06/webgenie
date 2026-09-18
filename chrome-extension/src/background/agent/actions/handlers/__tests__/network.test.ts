import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { NetworkLog, type NetRecord } from '../../../../browser/network-log';
import { atPath, dataEndpoints, endpointShape } from '../network';

const json = (url: string, extra: Partial<NetRecord> = {}): NetRecord => ({
  method: 'GET',
  url,
  status: 200,
  type: 'application/json',
  size: 2048,
  ...extra,
});

describe('NetworkLog', () => {
  it('keeps a finished request and asks for the body of a JSON one only', () => {
    const log = new NetworkLog();
    log.started('1', 'get', 'https://shop.test/api/products?page=1');
    log.responded('1', 200, 'application/json; charset=utf-8');
    const first = log.finished('1', 4096.4);
    expect(first?.wantsBody).toBe(true);
    expect(log.all()).toEqual([{ method: 'GET', url: 'https://shop.test/api/products?page=1', status: 200, type: 'application/json', size: 4096 }]);

    log.started('2', 'GET', 'https://shop.test/logo.png');
    log.responded('2', 200, 'image/png');
    expect(log.finished('2', 100)?.wantsBody).toBe(false);
  });

  it('ignores non-http requests, unstarted ids and failed ones', () => {
    const log = new NetworkLog();
    log.started('d', 'GET', 'data:application/json,{}');
    expect(log.finished('d', 10)).toBeNull();
    log.started('f', 'GET', 'https://shop.test/api/x');
    log.failed('f');
    expect(log.finished('f', 10)).toBeNull();
    expect(log.all()).toEqual([]);
  });

  it('samples a JSON body but not an error page served as JSON', () => {
    const log = new NetworkLog();
    const record = json('https://shop.test/api/a');
    log.sampled(record, '  {"rows":[1,2]} ');
    expect(record.sample).toBe('{"rows":[1,2]}');
    log.sampled(record, '<!doctype html><html>oops</html>');
    expect(record.sample).toBe('{"rows":[1,2]}');
  });
});

describe('dataEndpoints', () => {
  const page = 'https://www.shop.test/catalogue/page-3';

  it('keeps the site\'s own JSON and drops other sites, trackers, failures and non-JSON', () => {
    const urls = dataEndpoints(
      [
        json('https://api.shop.test/v1/products?page=1'),
        json('https://other.test/v1/products'),
        json('https://www.shop.test/collect?e=view'),
        json('https://www.shop.test/api/analytics/hit'),
        json('https://www.shop.test/api/broken', { status: 500 }),
        json('https://www.shop.test/page-4', { type: 'text/html' }),
      ],
      page,
    ).map(endpoint => endpoint.url);
    expect(urls).toEqual(['https://api.shop.test/v1/products?page=1']);
  });

  it('collapses the pages of one endpoint into a single line with a count', () => {
    const records = [1, 2, 3].map(n => json(`https://www.shop.test/api/rows?page=${n}&size=20`, n === 2 ? { sample: '{"rows":[]}' } : {}));
    const [endpoint, ...rest] = dataEndpoints(records, page);
    expect(rest).toEqual([]);
    expect(endpoint.times).toBe(3);
    expect(endpoint.sample).toBe('{"rows":[]}');
    // The newest call is the one to re-request, and the shape is what makes the three one.
    expect(endpoint.url).toBe('https://www.shop.test/api/rows?page=3&size=20');
    expect(endpoint.shape).toBe('GET https://www.shop.test/api/rows?page,size');
  });

  it('treats an address that ends in .json as JSON whatever the server called it', () => {
    expect(dataEndpoints([json('https://www.shop.test/data/rows.json', { type: 'text/plain' })], page)).toHaveLength(1);
  });

  it('filters on the address and on the sample', () => {
    const records = [json('https://www.shop.test/api/rows'), json('https://www.shop.test/api/users', { sample: '{"price":3}' })];
    expect(dataEndpoints(records, page, 'rows').map(e => e.url)).toEqual(['https://www.shop.test/api/rows']);
    expect(dataEndpoints(records, page, 'price').map(e => e.url)).toEqual(['https://www.shop.test/api/users']);
  });

  it('numbers an id out of the shape so /items/7 and /items/9 are one endpoint', () => {
    expect(endpointShape('GET', 'https://a.test/items/7/reviews')).toBe(endpointShape('GET', 'https://a.test/items/9/reviews'));
  });
});

describe('atPath', () => {
  it('walks a dotted path and returns undefined when it leads nowhere', () => {
    const reply = { data: { items: [1, 2] } };
    expect(atPath(reply, 'data.items')).toEqual([1, 2]);
    expect(atPath(reply, '')).toBe(reply);
    expect(atPath(reply, 'data.missing.deep')).toBeUndefined();
  });
});
