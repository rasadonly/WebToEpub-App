/**
 * Heroku backend client.
 *
 * When enabled, conversions run on the server so they keep going after the
 * user closes the tab. When disabled (admin toggle), the app falls back to the
 * original in-browser WebToEpub pipeline — nothing else changes.
 */

const ENABLED_KEY = 'backendEnabled';
const URL_KEY = 'backendUrl';
const JOB_KEY = 'backendJobId';

export const DEFAULT_BACKEND_URL = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

export function getBackendUrl(): string {
  return (localStorage.getItem(URL_KEY) || DEFAULT_BACKEND_URL).replace(/\/$/, '');
}

export function setBackendUrl(url: string) {
  localStorage.setItem(URL_KEY, url.trim().replace(/\/$/, ''));
}

export function isBackendEnabled(): boolean {
  const raw = localStorage.getItem(ENABLED_KEY);
  // Default: on (server-side conversion is faster and survives tab close).
  return raw === null ? true : raw === 'true';
}

export function setBackendEnabled(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, String(enabled));
}

export interface BackendJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  phase: string;
  total: number;
  completed: number;
  failed: number;
  title: string;
  error: string | null;
  size: number;
  filename: string;
  ready: boolean;
}

export interface BackendChapter {
  url: string;
  title: string;
}

async function api<T>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${getBackendUrl()}${path}`, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Backend error ${r.status}`);
    return (await r.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function backendHealthy(): Promise<boolean> {
  try {
    await api<{ ok: boolean }>('/health', undefined, 15_000);
    return true;
  } catch {
    return false;
  }
}

export async function backendToc(
  tocUrl: string,
  selector = '',
  onBatch?: (items: BackendChapter[], meta?: Record<string, string>) => void
): Promise<{ chapters: BackendChapter[]; meta: Record<string, string> }> {
  const streamUrl = `${getBackendUrl()}/api/toc/stream?url=${encodeURIComponent(tocUrl)}&selector=${encodeURIComponent(selector)}`;
  const allChapters: BackendChapter[] = [];
  let meta: Record<string, string> = {};

  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 120_000);
    let r: Response;
    try {
      r = await fetch(streamUrl, { signal: ctrl.signal });
    } finally {
      window.clearTimeout(timer);
    }
    if (!r.ok || !r.body) throw new Error(`Stream error ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'chapters' && Array.isArray(obj.items)) {
            allChapters.push(...obj.items);
            onBatch?.(obj.items);
          } else if (obj.type === 'meta') {
            const { type: _t, ...rest } = obj;
            meta = rest;
            onBatch?.([], meta);
          } else if (obj.type === 'error') {
            throw new Error(obj.message);
          }
        } catch {
          /* skip malformed line */
        }
      }
    }
    return { chapters: allChapters, meta };
  } catch {
    // Fallback: legacy buffered endpoint
    const result = await api<{ chapters: BackendChapter[]; meta: Record<string, string> }>(
      `/api/toc?url=${encodeURIComponent(tocUrl)}&selector=${encodeURIComponent(selector)}`,
      undefined,
      120_000
    );
    onBatch?.(result.chapters, result.meta);
    return result;
  }
}

export async function backendStartJob(payload: {
  tocUrl?: string;
  chapters?: BackendChapter[];
  metadata: Record<string, string>;
  options?: Record<string, unknown>;
  selector?: string;
}): Promise<BackendJob> {
  const job = await api<BackendJob>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  saveActiveJobId(job.id);
  return job;
}

export async function backendJobStatus(id: string): Promise<BackendJob> {
  return api<BackendJob>(`/api/jobs/${id}`, undefined, 20_000);
}

export async function backendCancelJob(id: string): Promise<void> {
  try {
    await api(`/api/jobs/${id}/cancel`, { method: 'POST' }, 15_000);
  } finally {
    clearActiveJobId();
  }
}

/** Downloads the finished EPUB as a real .epub file (correct MIME + extension). */
export async function backendDownload(job: BackendJob): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/api/jobs/${job.id}/download`);
  if (!res.ok) throw new Error('EPUB not ready on the server');
  const raw = await res.blob();
  const blob = new Blob([raw], { type: 'application/epub+zip' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = job.filename.endsWith('.epub') ? job.filename : `${job.filename}.epub`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

// ----- session persistence (survives closing the page) -----

export function saveActiveJobId(id: string) {
  localStorage.setItem(JOB_KEY, id);
}

export function getActiveJobId(): string | null {
  return localStorage.getItem(JOB_KEY);
}

export function clearActiveJobId() {
  localStorage.removeItem(JOB_KEY);
}

/** Polls a job until it finishes (or the poll is cancelled). */
export function pollJob(
  id: string,
  onUpdate: (job: BackendJob) => void,
  intervalMs = 1500
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const job = await backendJobStatus(id);
      if (stopped) return;
      onUpdate(job);
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return;
    } catch {
      /* transient — keep polling */
    }
    if (!stopped) window.setTimeout(tick, intervalMs);
  };
  tick();
  return () => {
    stopped = true;
  };
}
