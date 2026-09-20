/**
 * Forgetting everything the agent remembers across tasks. Every global store keeps its data under `MEMORY_KEY_PREFIX`
 * (routes, site playbooks, and the stores older versions wrote), so one sweep clears them all, including a store added
 * later, and the user's "Forget site memory" in the options page never leaves part of it behind.
 */
export const MEMORY_KEY_PREFIX = 'wg_mem:';

/** Removes every cross-task memory key and answers how many were removed. */
export async function clearAll(): Promise<number> {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith(MEMORY_KEY_PREFIX));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
  return keys.length;
}
