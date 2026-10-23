import { useEffect } from 'react';

/** Per-route document title (helps tabs, history and screen-reader navigation). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · WindDesk`;
  }, [title]);
}
