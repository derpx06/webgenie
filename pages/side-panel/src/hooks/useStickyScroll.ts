import { useCallback, useEffect, useRef, useState } from 'react';

/** How far from the bottom still counts as "watching the newest". One step card of slack. */
const PIN_THRESHOLD_PX = 80;

/**
 * Keeps the newest content in view without fighting the person.
 *
 * While the view sits at the bottom it follows new messages. The moment someone scrolls
 * back to read, following stops and stays stopped until they return to the bottom or press
 * the jump control — so a task that is still emitting steps cannot yank the page away.
 */
export const useStickyScroll = <T,>(dep: T) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(true);

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
  }, []);

  const scrollToEnd = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const jumpToLatest = useCallback(() => {
    setIsPinned(true);
    scrollToEnd(true);
  }, [scrollToEnd]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setIsPinned(atBottom());
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [atBottom]);

  // Follow new content only while pinned. The frame delay lets the new rows lay out first,
  // so the scroll lands on the real bottom instead of the previous one.
  useEffect(() => {
    if (!isPinned) return undefined;
    const frame = requestAnimationFrame(() => scrollToEnd(false));
    return () => cancelAnimationFrame(frame);
    // isPinned is deliberately not a dependency: re-pinning scrolls through jumpToLatest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep, scrollToEnd]);

  return { scrollRef, endRef, isPinned, jumpToLatest };
};
