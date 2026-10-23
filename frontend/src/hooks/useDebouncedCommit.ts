import { useEffect, useRef, useState } from 'react';

/**
 * Local draft of a URL-backed value that is committed after a pause.
 *
 * The draft only resyncs from the URL when the URL changes for some other reason (back/forward,
 * a link). Our own commits are remembered, so a commit landing while the user keeps adjusting
 * never snaps the control back to an older value.
 */
export function useDebouncedCommit<T>(value: T, commit: (next: T) => void, delayMs: number) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (!Object.is(value, committed.current)) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (Object.is(draft, committed.current)) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      commit(draft);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [draft, commit, delayMs]);

  return [draft, setDraft] as const;
}
