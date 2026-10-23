/**
 * Recovery for failed lazy-chunk loads.
 *
 * The Forum, Library and secondary pages are loaded on demand as separate
 * JS chunks. When a visitor's browser holds a cached copy of the app from
 * before a new deploy, the chunk file names it asks for no longer exist on
 * the server, the dynamic import fails, and React (with no error boundary)
 * used to unmount the whole app — a white screen. A single page reload
 * fetches the fresh build and everything works again, so on a chunk-load
 * failure we reload once automatically (guarded against reload loops).
 */

const KEY = 'ltb-chunk-reload-at';
const MIN_INTERVAL_MS = 15000;

export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const text = `${e?.name || ''} ${e?.message || ''} ${typeof err === 'string' ? err : ''}`;
  return /dynamically imported module|chunkloaderror|loading chunk|importing a module script failed|preload/i.test(
    text
  );
}

/** Reload the page, at most once per short window. Returns true if a reload was triggered. */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode edge cases) — reload anyway;
    // the boundary fallback covers a persistent failure.
  }
  window.location.reload();
  return true;
}
