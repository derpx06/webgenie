import { describe, expect, it, vi } from 'vitest';
import type { AgentContext } from '../../../types';
import { forTools } from '../../../prompts/base';
import { navigatorSystemPromptTemplate } from '../../../prompts/templates/navigator';
import { ManageBookmarksHandler } from '../manage-bookmarks';
import { ManageHistoryHandler } from '../manage-history';
import { ManageTabsHandler } from '../manage-tabs';

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const contextFor = (browser: Record<string, unknown>) =>
  ({ emitEvent: vi.fn(), browserContext: { browser } }) as unknown as AgentContext;

const tab = (id: number, title: string, url: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  url,
  windowId: 1,
  groupId: -1,
  active: false,
  ...extra,
});

describe('manage_tabs', () => {
  const tabs = [
    tab(11, 'Flights to Lisbon', 'https://air.example/lisbon'),
    tab(12, 'Hotels in Lisbon', 'https://stay.example/lisbon', { groupId: 5 }),
    tab(13, 'Inbox', 'https://mail.example/', { active: true, windowId: 2 }),
  ];
  const browser = () => ({
    queryTabs: vi.fn(async (q: { windowId?: number }) => tabs.filter(t => q.windowId === undefined || t.windowId === q.windowId)),
    queryTabGroups: vi.fn(async () => [{ id: 5, title: 'Trip', color: 'blue', collapsed: false, windowId: 1 }]),
    groupTabs: vi.fn(async () => 9),
    updateTabGroup: vi.fn(async () => undefined),
    ungroupTabs: vi.fn(async () => undefined),
  });

  it('lists every open tab with its id, window and group, and filters by text', async () => {
    const b = browser();
    const all = await new ManageTabsHandler(contextFor(b)).handleManageTabs({ action: 'listTabs' });
    expect(all.extractedContent).toContain('3 open tabs');
    expect(all.extractedContent).toContain('[12] Hotels in Lisbon (https://stay.example/lisbon) window 1, group 5');
    expect(all.extractedContent).toContain('[13] Inbox (https://mail.example/) window 2, active');

    const some = await new ManageTabsHandler(contextFor(b)).handleManageTabs({ action: 'listTabs', query: 'lisbon' });
    expect(some.extractedContent).toContain('2 open tabs matching "lisbon"');
    expect(some.extractedContent).not.toContain('Inbox');
  });

  it('lists groups with the tabs in each', async () => {
    const result = await new ManageTabsHandler(contextFor(browser())).handleManageTabs({ action: 'listGroups' });
    expect(result.extractedContent).toContain('[5] "Trip" blue, window 1, tabs 12');
  });

  it('groups tabs into a new group and names it, or adds them to an existing group', async () => {
    const b = browser();
    const handler = new ManageTabsHandler(contextFor(b));
    const created = await handler.handleManageTabs({ action: 'groupTabs', tabIds: [11, 12], title: 'Lisbon', color: 'green' });
    expect(b.groupTabs).toHaveBeenLastCalledWith({ tabIds: [11, 12] });
    expect(b.updateTabGroup).toHaveBeenCalledWith(9, { title: 'Lisbon', color: 'green', collapsed: undefined });
    expect(created.extractedContent).toContain('into group 9 "Lisbon"');

    await handler.handleManageTabs({ action: 'groupTabs', tabIds: [13], groupId: 5 });
    expect(b.groupTabs).toHaveBeenLastCalledWith({ tabIds: [13], groupId: 5 });
  });

  it('refuses tabs outside the window it was told, and a group call with no tabs', async () => {
    const handler = new ManageTabsHandler(contextFor(browser()));
    await expect(handler.handleManageTabs({ action: 'groupTabs', tabIds: [11, 13], windowId: 1 })).rejects.toThrow(
      'Tabs 13 are not in window 1',
    );
    await expect(handler.handleManageTabs({ action: 'groupTabs' })).rejects.toThrow('tabIds array is required');
  });
});

describe('manage_history', () => {
  const item = (n: number) => ({ title: `Page ${n}`, url: `https://site.example/${n}`, visitCount: n, lastVisitTime: Date.now() - n * 3_600_000 });

  it('lists newest first with when and how often, 50 by default', async () => {
    const searchHistory = vi.fn(async () => [item(1), item(2)]);
    const result = await new ManageHistoryHandler(contextFor({ searchHistory })).handleManageHistory({ action: 'getRecent' });
    expect(searchHistory).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 50, text: '' }));
    expect(result.extractedContent).toMatch(/Page 1 \(https:\/\/site\.example\/1\) last visited .*, 1 visits/);
  });

  it('never asks for more than 200 pages, and reads a one-day window', async () => {
    const searchHistory = vi.fn<(query: Record<string, unknown>) => Promise<never[]>>(async () => []);
    await new ManageHistoryHandler(contextFor({ searchHistory })).handleManageHistory({
      action: 'getRecent',
      maxResults: 5000,
      daysAgo: 2,
      endDaysAgo: 1,
      query: 'recipe',
    });
    const asked = searchHistory.mock.calls[0][0] as unknown as { maxResults: number; startTime: number; endTime: number; text: string };
    expect(asked.maxResults).toBe(200);
    expect(asked.text).toBe('recipe');
    expect(asked.endTime - asked.startTime).toBeCloseTo(24 * 3_600_000, -3);
  });

  it('says when a listing was cut short, so the model narrows it instead of assuming it saw everything', async () => {
    const searchHistory = vi.fn(async () => Array.from({ length: 50 }, (_, n) => item(n + 1)));
    const result = await new ManageHistoryHandler(contextFor({ searchHistory })).handleManageHistory({ action: 'getRecent' });
    expect(result.extractedContent).toContain('showing the newest 50');
  });

  it('ranks the most visited sites', async () => {
    const searchHistory = vi.fn(async () => [
      { url: 'https://a.example/1', visitCount: 5, lastVisitTime: 1 },
      { url: 'https://a.example/2', visitCount: 3, lastVisitTime: 2 },
      { url: 'https://b.example/', visitCount: 4, lastVisitTime: 3 },
    ]);
    const result = await new ManageHistoryHandler(contextFor({ searchHistory })).handleManageHistory({ action: 'getFrequentDomains' });
    const text = result.extractedContent ?? '';
    expect(text.indexOf('a.example: 8 visits')).toBeGreaterThan(-1);
    expect(text.indexOf('a.example')).toBeLessThan(text.indexOf('b.example'));
  });
});

describe('manage_bookmarks', () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          parentId: '0',
          children: [
            { id: '10', title: 'Recipes', parentId: '1', children: [{ id: '100', title: 'Soup', url: 'https://soup.example/', parentId: '10' }] },
            { id: '11', title: 'News', url: 'https://news.example/', parentId: '1' },
          ],
        },
      ],
    },
  ];
  const browser = () => ({
    getBookmarksTree: vi.fn(async () => tree),
    searchBookmarks: vi.fn(async () => [{ id: '100', title: 'Soup', url: 'https://soup.example/', parentId: '10' }]),
    getRecentBookmarks: vi.fn(async () => []),
    createBookmark: vi.fn(async (b: Record<string, unknown>) => ({ id: '200', parentId: '1', ...b })),
    updateBookmark: vi.fn(async (id: string, c: Record<string, string>) => ({ id, title: 'Old', ...c })),
    moveBookmark: vi.fn(async (id: string, d: { parentId: string }) => ({ id, title: 'Soup', parentId: d.parentId })),
  });

  it('lists folders with their ids and paths, so a bookmark can be moved into one', async () => {
    const result = await new ManageBookmarksHandler(contextFor(browser())).handleManageBookmarks({ action: 'listFolders' });
    expect(result.extractedContent).toContain('[1] Bookmarks bar (2 items)');
    expect(result.extractedContent).toContain('[10] Bookmarks bar/Recipes (1 items)');
  });

  it('lists bookmarks with ids and the folder each sits in, filtered by folder name', async () => {
    const result = await new ManageBookmarksHandler(contextFor(browser())).handleManageBookmarks({ action: 'getFlat', folderPath: 'recipes' });
    expect(result.extractedContent).toContain('1 bookmarks');
    expect(result.extractedContent).toContain('[100] Soup (https://soup.example/) in "Bookmarks bar/Recipes"');
  });

  it('creates a folder when there is no url, renames by id, and moves into a folder', async () => {
    const b = browser();
    const handler = new ManageBookmarksHandler(contextFor(b));
    const folder = await handler.handleManageBookmarks({ action: 'create', title: 'Travel' });
    expect(folder.extractedContent).toContain('Created folder [200] "Travel"');

    await handler.handleManageBookmarks({ action: 'update', id: '100', title: 'Tomato soup' });
    expect(b.updateBookmark).toHaveBeenCalledWith('100', { title: 'Tomato soup' });

    const moved = await handler.handleManageBookmarks({ action: 'move', id: '100', parentId: '200' });
    expect(b.moveBookmark).toHaveBeenCalledWith('100', { parentId: '200' });
    expect(moved.extractedContent).toContain('into folder 200');
  });

  it('asks for the id or the destination instead of guessing', async () => {
    const handler = new ManageBookmarksHandler(contextFor(browser()));
    await expect(handler.handleManageBookmarks({ action: 'update', title: 'x' })).rejects.toThrow('id is required');
    await expect(handler.handleManageBookmarks({ action: 'move', id: '100' })).rejects.toThrow('parentId');
  });

  it('cuts a very long listing and says how many it left out', async () => {
    const many = Array.from({ length: 450 }, (_, n) => ({ id: `b${n}`, title: `T${n}`, url: `https://x.example/${n}`, parentId: '1' }));
    const b = { ...browser(), getBookmarksTree: vi.fn(async () => [{ id: '0', title: '', children: many }]) };
    const result = await new ManageBookmarksHandler(contextFor(b)).handleManageBookmarks({ action: 'getFlat' });
    expect(result.extractedContent).toContain('450 bookmarks');
    expect(result.extractedContent).toContain('250 more not shown');
  });
});

describe('the prompt for the user\'s own browser', () => {
  const rule = (tools: string[]) =>
    forTools(navigatorSystemPromptTemplate.replace('{{max_actions}}', '3'), new Set(tools))
      .split('\n')
      .find(line => /^11\./.test(line)) ?? '';

  it('names the three tools when they are registered, and says nothing about turning them on', () => {
    const line = rule(['manage_history', 'manage_bookmarks', 'manage_tabs']);
    expect(line).toContain('manage_tabs to list every open tab and tab group');
    expect(line).not.toContain('Browser data tools');
  });

  it('tells the model how the user turns them on when they are missing, and never to open chrome:// pages', () => {
    const line = rule([]);
    expect(line).toContain('turn on Browser data tools under Options, Advanced');
    expect(line).not.toContain('manage_history');
  });
});
