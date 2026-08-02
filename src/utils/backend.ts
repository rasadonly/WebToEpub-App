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

export const HEROKU_BACKEND_URL = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';
/** Hugging Face Space running the identical Express server (Docker, port 7860). */
export const HF_BACKEND_URL = 'https://prasadonly-web-to-epub-bot.hf.space';
export const DEFAULT_BACKEND_URL = HEROKU_BACKEND_URL;

/** Every known backend, tried in order when the active one is unreachable. */
export const BACKEND_URLS: readonly string[] = [HEROKU_BACKEND_URL, HF_BACKEND_URL];

/**
 * Hostnames that have a dedicated server-side parser in fetcher.js.
 * For everything else the browser engine (WebToEpub, 386 parsers) handles it.
 */
export const BACKEND_SUPPORTED_HOSTS: readonly string[] = [
  'novelhall.com',
  'freewebnovel.com',
  'novelfire.net', 'novelfire.com', 'novelfire.io',
  'novgo.com',
  'novelbuddy.com', 'novelbuddy.io',
  'novelarrow.com',
  'novelfull.com', 'novelfull.net',
  'novelbin.com', 'novelbin.net', 'novlove.com',
  'wtr-lab.com',
  'wattpad.com',
];

/** Domains reported live by the backend's /api/sites (526+ entries). */
const SITES_CACHE_KEY = 'backend_sites_v1';
let dynamicHosts: Set<string> | null = null;
let dynamicHostsPromise: Promise<Set<string>> | null = null;

function readSitesCache(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SITES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; domains: string[] };
    if (!parsed?.domains?.length) return null;
    if (Date.now() - parsed.at > 24 * 60 * 60 * 1000) return null;
    return new Set(parsed.domains);
  } catch {
    return null;
  }
}

/** Loads (and caches for a day) the full domain list the backend can parse. */
export async function loadBackendHosts(): Promise<Set<string>> {
  if (dynamicHosts) return dynamicHosts;
  const cached = readSitesCache();
  if (cached) {
    dynamicHosts = cached;
    return cached;
  }
  if (dynamicHostsPromise) return dynamicHostsPromise;
  dynamicHostsPromise = (async () => {
    try {
      const { domains } = await api<{ domains: string[] }>('/api/sites', undefined, 20_000);
      const set = new Set((domains || []).map(d => d.replace(/^www\./, '').toLowerCase()));
      if (set.size) {
        dynamicHosts = set;
        try {
          localStorage.setItem(
            SITES_CACHE_KEY,
            JSON.stringify({ at: Date.now(), domains: [...set] })
          );
        } catch { /* quota */ }
        return set;
      }
    } catch { /* offline / old backend */ }
    return new Set(BACKEND_SUPPORTED_HOSTS.map(h => h.toLowerCase()));
  })();
  const result = await dynamicHostsPromise;
  dynamicHostsPromise = null;
  return result;
}

function matches(host: string, hosts: Iterable<string>): boolean {
  for (const h of hosts) if (host === h || host.endsWith('.' + h)) return true;
  return false;
}

/** Synchronous best-effort check (static list + whatever is already cached). */
export function isBackendSupportedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (matches(host, BACKEND_SUPPORTED_HOSTS)) return true;
    const known = dynamicHosts ?? readSitesCache();
    if (known) {
      dynamicHosts = known;
      return matches(host, known);
    }
    return false;
  } catch {
    return false;
  }
}

/** Authoritative check — fetches the backend's live domain table if needed. */
export async function isBackendSupportedUrlAsync(url: string): Promise<boolean> {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  if (matches(host, BACKEND_SUPPORTED_HOSTS)) return true;
  return matches(host, await loadBackendHosts());
}

/** URL format for the Heroku CORS proxy — use as a drop-in CORS proxy. */
export function backendProxyUrl(): string {
  return `${getBackendUrl()}/api/proxy?url=`;
}

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

async function pingBackend(base: string, timeoutMs = 15_000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Health check with automatic failover: if the active backend is down, try the
 * other known backends (Heroku ⇄ Hugging Face) and switch to the first that
 * answers, so a sleeping/dead host never takes the app down.
 */
export async function backendHealthy(): Promise<boolean> {
  const active = getBackendUrl();
  if (await pingBackend(active)) return true;

  for (const alt of BACKEND_URLS) {
    if (alt === active) continue;
    // HF Spaces sleep — the first request wakes them, so allow more time.
    if (await pingBackend(alt, 45_000)) {
      setBackendUrl(alt);
      return true;
    }
  }
  return false;
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
