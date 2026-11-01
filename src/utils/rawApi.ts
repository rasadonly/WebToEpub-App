// API client for linktoepub's /raw translation section. The
// backend proxies translation work to the Translate Me HF Space
// (see server/src/spaceClient.js); the browser only ever talks
// to linktoepub's own backend, never to the Space directly.
import { getBackendUrl } from './backend';

export interface RawJob {
  id: string;
  kind: 'raw';
  status: 'queued' | 'running' | 'done' | 'done_with_errors' | 'error' | 'cancelled';
  phase: string;
  title: string;
  originalTitle?: string;
  tocUrl: string;
  source: string;
  target: string;
  spaceJobId?: string | null;
  total: number;
  completed: number;
  failed: number;
  failedChapters?: string[];
  error?: string | null;
  size: number;
  filename: string;
  ready: boolean;
  libraryUrl?: string;
  libraryPageUrl?: string;
  libraryStatus?: 'uploading' | 'saved' | 'failed' | null;
  libraryError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RawSearchResult {
  label: string;
  url: string;
}

export interface RawLibraryResult {
  title: string;
  path: string;
  size: number;
  url: string;
}

export interface RawToc {
  title: string;
  count: number;
  chaptersText: string;
  info: string;
  source: 'space' | 'linktoepub';
  note?: string;
}

async function rawApi<T>(path: string, init?: RequestInit, timeoutMs = 300_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${getBackendUrl().replace(/\/$/, '')}${path}`, { ...init, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = body && typeof body.error === 'string' ? body.error : `Backend error ${r.status}`;
      const err = new Error(msg) as Error & { status?: number; body?: unknown };
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export function rawSearch(query: string) {
  return rawApi<{ results: RawSearchResult[]; status: string; libraryResults: RawLibraryResult[] }>('/api/raw/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

export function rawToc(url: string) {
  return rawApi<RawToc>('/api/raw/toc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function rawStartJob(payload: {
  tocUrl: string;
  title?: string;
  source?: string;
  target?: string;
  from?: number;
  to?: number;
}) {
  return rawApi<RawJob | { suggestion: 'job'; job: RawJob } | { suggestion: 'library'; title: string; path: string; url: string }>(
    '/api/raw/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export function rawJobStatus(id: string) {
  return rawApi<RawJob>(`/api/raw/jobs/${encodeURIComponent(id)}`, {}, 60_000);
}

export function rawJobsList() {
  return rawApi<{ jobs: RawJob[] }>('/api/raw/jobs', {}, 60_000);
}

export function rawCancelJob(id: string) {
  return rawApi<RawJob>(`/api/raw/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, 60_000);
}

// Download a finished raw job's EPUB through linktoepub's own
// download route (same route main jobs use). Handles
// done_with_errors jobs too, not just "done".
export async function rawDownload(job: RawJob) {
  const r = await fetch(`${getBackendUrl().replace(/\/$/, '')}/api/jobs/${encodeURIComponent(job.id)}/download`);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = job.filename || 'book.epub';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
