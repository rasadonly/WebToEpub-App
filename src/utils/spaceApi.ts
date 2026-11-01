// Browser client for the Translate Me Hugging Face Space — the
// translation backend for linktoepub's /raw section.
//
// ARCHITECTURE (2026-11-01, at the user's direction): the browser
// talks to the Space DIRECTLY for search, TOC, jobs, progress and
// EPUB downloads. No linktoepub server sits in that path, so there
// is no 30s router limit on Space calls and no proxy hop. The ONLY
// /raw call that still goes to linktoepub's own backend is the
// library save (see saveToLibrary): it needs the library token,
// which must never reach the browser or the public Space.
//
// The Space exposes its Books functions through Gradio's API
// (see /config: book_search, book_fetch_toc, book_start_job,
// book_check_progress, book_get_epub, translate_text).
// Gradio 6's direct POST /gradio_api/call/<name> endpoints refuse
// plain clients (405 / 500, verified 2026-11-01), but the classic
// queue protocol works with no Space changes at all:
//   POST /gradio_api/queue/join {data, fn_index, session_hash}
//   GET  /gradio_api/queue/data?session_hash=...  (SSE stream)
//   -> process_completed with output.data
//
// Deliberate differences from the old Heroku proxy, all from the
// rewire decision:
//  - No Space-side stop function exists, so Cancel only stops
//    this browser's tracking; a Space worker already running
//    finishes harmlessly in the Space's /tmp.
//  - No one-job-at-a-time guard, no library suggestions, no
//    linktoepub-parser TOC fallback: those lived on the Heroku
//    proxy and were dropped with it. Jobs are tracked per
//    browser (localStorage) instead of server-side, so /raw/jobs
//    shows jobs started in THIS browser.
//  - No byte-level info-page EPUB gate: that needed a zip reader
//    on the server. The TOC retry below (info-page first ->
//    retry) is the guard that remains; a job's progress display
//    shows its current chapter, so a bad TOC is visible.
//  - The Space MUST stay open (no password gate): re-enabling
//    its APP_PASSWORD secret would break every call here, since
//    the browser has no way to authenticate to the Space.
import { getBackendUrl } from './backend';

export const SPACE_URL = 'https://learningtrade-translate-me.hf.space';

export interface SpaceSearchResult {
  label: string;
  url: string;
}

export interface SpaceToc {
  title: string;
  count: number;
  chaptersText: string;
  info: string;
}

export type SpaceJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'done_with_errors'
  | 'error'
  | 'cancelled';

export interface SpaceJob {
  spaceJobId: string;
  title: string;
  originalTitle: string;
  tocUrl: string;
  source: string;
  target: string;
  from: number;
  to: number;
  createdAt: number;
  updatedAt: number;
  status: SpaceJobStatus;
  phase: string;
  completed: number;
  total: number;
  failed: number;
  failedChapters: string[];
  /** Chapter the Space worker is on right now (its "Current chapter" line). */
  currentChapter?: string;
  /** Wall-clock ms of the last successful progress check (polling liveness). */
  lastCheckedAt?: number;
  error?: string | null;
  epubUrl?: string | null;
  epubFilename?: string;
  libraryStatus?: 'uploading' | 'saved' | 'failed' | null;
  libraryError?: string;
  libraryUrl?: string;
}

let fnIndexCache: Record<string, number> | null = null;
let fnIndexAt = 0;

async function getFnIndex(): Promise<Record<string, number>> {
  if (fnIndexCache && Date.now() - fnIndexAt < 60 * 60_000) return fnIndexCache;
  const res = await fetch(`${SPACE_URL}/config`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Space /config failed (${res.status})`);
  const cfg = await res.json();
  const map: Record<string, number> = {};
  for (let i = 0; i < (cfg.dependencies || []).length; i++) {
    const name = cfg.dependencies[i]?.api_name;
    if (name) map[name] = i;
  }
  if (map.book_search === undefined) throw new Error('Space /config has no Books API');
  fnIndexCache = map;
  fnIndexAt = Date.now();
  return map;
}

/** Call one Space Books function and wait for its result. Returns output.data. */
export async function callSpace(apiName: string, data: unknown[], timeoutMs = 300_000): Promise<unknown[]> {
  const fnMap = await getFnIndex();
  const fnIndex = fnMap[apiName];
  if (fnIndex === undefined) throw new Error(`Space has no function ${apiName}`);
  const session = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const join = await fetch(`${SPACE_URL}/gradio_api/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: session }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!join.ok) {
    const t = await join.text().catch(() => '');
    throw new Error(`Space queue join failed (${join.status}): ${t.slice(0, 200)}`);
  }
  const started = Date.now();
  const res = await fetch(`${SPACE_URL}/gradio_api/queue/data?session_hash=${session}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) throw new Error(`Space queue stream failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (Date.now() - started > timeoutMs) throw new Error(`Space call ${apiName} timed out`);
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let msg: { msg?: string; output?: { data?: unknown[]; error?: string }; message?: string };
          try {
            msg = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (msg.msg === 'process_completed') return (msg.output?.data ?? []) as unknown[];
          if (msg.msg === 'process_failed' || msg.msg === 'error') {
            throw new Error(`Space ${apiName} failed: ${msg.output?.error || msg.message || 'unknown'}`);
          }
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
  throw new Error(`Space call ${apiName} ended without a result`);
}

/** Parse book_check_progress display text into fields. */
export function parseSpaceProgress(text: string) {
  const out = {
    status: 'running',
    done: 0,
    failed: 0,
    total: 0,
    epubReady: false,
    failedChapters: [] as string[],
    currentChapter: '',
  };
  const t = String(text || '');
  const status = t.match(/Status:\s*([A-Za-z_]+)/);
  if (status) out.status = status[1];
  const ch = t.match(/Chapters:\s*(\d+)\s*done,\s*(\d+)\s*failed,\s*(\d+)\s*total/);
  if (ch) {
    out.done = Number(ch[1]);
    out.failed = Number(ch[2]);
    out.total = Number(ch[3]);
  }
  out.epubReady = /EPUB ready:\s*yes/i.test(t);
  const cur = t.match(/Current chapter:\s*(.+)/);
  if (cur) out.currentChapter = cur[1].trim();
  const failSection = t.split(/Failed chapters:/i)[1];
  if (failSection) {
    out.failedChapters = failSection
      .split('\n')
      .map((l) => l.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  return out;
}

function isInfoPageTitle(t: string): boolean {
  const s = String(t || '').trim();
  return s === '作品情報' || s === '作品信息' || /^(Information|Book info)\b/.test(s);
}

function parseTitleCount(titleCount: string): { title: string; count: number } {
  const m = String(titleCount || '').match(/^(.*) — (\d+) chapters$/);
  if (m) return { title: m[1].trim(), count: Number(m[2]) };
  return { title: String(titleCount || '').trim(), count: 0 };
}

// Why a Space TOC is unusable (null = usable). The old client
// only retried the info-page case and gave up on partial,
// tiny, or reversed lists with a bare "please retry" —
// now every bad shape is retried, and the final error names
// the shape so the user knows what actually went wrong.
function spaceTocProblem(toc: SpaceToc): string | null {
  if (!toc || toc.count <= 0) return 'no chapters found';
  if (toc.count < 1) return 'no chapters found';
  const lines = toc.chaptersText.split('\n').filter((l) => l.trim());
  if (!lines.length) return 'no chapters found';
  const firstTitle = lines[0].replace(/^\d+\.\s*/, '');
  if (isInfoPageTitle(firstTitle)) return 'info page first';
  const num = (s: string): number | null => {
    const m = s.match(/(\d{1,5})/);
    return m ? Number(m[1]) : null;
  };
  const firstNum = num(firstTitle);
  const lastNum = num(lines[lines.length - 1].replace(/^\d+\.\s*/, ''));
  if (firstNum !== null && lastNum !== null && firstNum > lastNum) {
    return 'chapters in reverse order';
  }
  return null;
}

/** Fetch a TOC from the Space, retrying any unusable shape. */
export async function fetchSpaceToc(url: string): Promise<SpaceToc> {
  let lastReason = 'no chapters found';
  for (let attempt = 0; attempt < 4; attempt++) {
    const outs = await callSpace('book_fetch_toc', [url], 300_000);
    const { title, count } = parseTitleCount(String((outs && outs[0]) || ''));
    const chaptersText = String((outs && outs[1]) || '');
    const info = String((outs && outs[2]) || '');
    const toc = { title, count, chaptersText, info };
    const reason = spaceTocProblem(toc);
    if (!reason) return toc;
    lastReason = reason;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Space returned an unusable chapter list (${lastReason}) — please retry`);
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

// Search labels look like "Re:Zero — Japanese ncode.syosetu.com
// (Ｒｅ：ゼロから始める異世界生活)". Translate the trailing
// parenthesised CJK title to English (MyMemory via the Space,
// parallel, 8s per call) so users pick from English titles;
// anything untranslated keeps its original label.
async function translateResultTitles(
  choices: [string, string][],
): Promise<SpaceSearchResult[]> {
  return Promise.all(
    choices.map(async ([label, url]) => {
      const m = String(label).match(/^(.*?) — (.*?) \(([^)]*)\)$/);
      if (!m || !CJK_RE.test(m[3])) return { label, url };
      try {
        const outs = await callSpace('translate_text', [m[3], 'auto', 'en', 'mymemory'], 8_000);
        const translated = String((outs && outs[0]) || '').trim();
        if (!translated || translated === m[3]) return { label, url };
        return { label: `${translated} — ${m[2]} (${m[3]})`, url };
      } catch {
        return { label, url };
      }
    }),
  );
}

/** Search original-language sites via the Space. Titles come back translated to English. */
export async function searchBooks(query: string): Promise<{ results: SpaceSearchResult[]; status: string }> {
  const outs = await callSpace('book_search', [query], 300_000);
  const dropdown = outs && (outs[0] as { choices?: [string, string][] });
  const choices = Array.isArray(dropdown?.choices) ? dropdown.choices : [];
  const results = await translateResultTitles(choices);
  return { results, status: String((outs && outs[1]) || '') };
}

/** Correct (translated) name for a finished book; falls back to the original title. */
export async function resolveJobTitle(
  originalTitle: string,
  source: string,
  target: string,
  engine = 'auto',
): Promise<string> {
  try {
    const outs = await callSpace('translate_text', [originalTitle, source, target, engine], 120_000);
    const translated = String((outs && outs[0]) || '').trim();
    if (translated) return translated;
  } catch {
    /* keep the original title */
  }
  return originalTitle;
}

/** Start a translation job on the Space. Returns the Space job id. */
export async function startSpaceJob(payload: {
  tocUrl: string;
  source: string;
  target: string;
  engine: string;
  from: number;
  to: number;
}): Promise<string> {
  const outs = await callSpace(
    'book_start_job',
    [payload.tocUrl, payload.source, payload.target, payload.engine, payload.from, payload.to],
    300_000,
  );
  const id = String((outs && outs[0]) || '').trim();
  if (!id) throw new Error(`Failed to start job on the Space: ${String((outs && outs[1]) || '')}`);
  return id;
}

export interface SpaceProgress {
  status: SpaceJobStatus;
  phase: string;
  completed: number;
  total: number;
  failed: number;
  failedChapters: string[];
  currentChapter: string;
  epubReady: boolean;
  error?: string | null;
}

function mapSpaceStatus(spaceStatus: string, failed: number): SpaceJobStatus {
  if (spaceStatus === 'done') return failed > 0 ? 'done_with_errors' : 'done';
  if (spaceStatus === 'failed') return 'error';
  if (spaceStatus === 'stopped') return 'cancelled';
  if (spaceStatus === 'queued') return 'queued';
  return 'running';
}

/** One progress check against the Space. */
export async function checkSpaceProgress(spaceJobId: string): Promise<SpaceProgress> {
  const outs = await callSpace('book_check_progress', [spaceJobId], 60_000);
  const prog = parseSpaceProgress(String((outs && outs[0]) || ''));
  const status = mapSpaceStatus(prog.status, prog.failed);
  const phase =
    status === 'done'
      ? 'Ready to download'
      : status === 'done_with_errors'
        ? 'Done with errors'
        : status === 'error'
          ? 'Error'
          : status === 'cancelled'
            ? 'Cancelled'
            : status === 'queued'
              ? 'Queued'
              : `Translating (${prog.done}/${prog.total || '?'} chapters)`;
  return {
    status,
    phase,
    completed: prog.done,
    total: prog.total,
    failed: prog.failed,
    failedChapters: prog.failedChapters,
    currentChapter: prog.currentChapter,
    epubReady: prog.epubReady,
  };
}

/** Resolve a finished job's EPUB to a downloadable Space file URL. */
export async function getSpaceEpubFile(
  spaceJobId: string,
): Promise<{ url: string; filename: string }> {
  const outs = await callSpace('book_get_epub', [spaceJobId], 120_000);
  const fileObj = outs && (outs[0] as { url?: string; path?: string; orig_name?: string });
  const url = fileObj?.url || fileObj?.path;
  if (!url) throw new Error('Space returned no EPUB file');
  const full = /^https?:\/\//i.test(url) ? url : `${SPACE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  return { url: full, filename: fileObj?.orig_name || `${spaceJobId}.epub` };
}

/** Download an EPUB from a Space file URL in the browser. */
/** Readable "<Title>.epub" name from a job title. */
export function epubNameFor(title: string, fallback = 'book'): string {
  const base = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || fallback}.epub`;
}

export async function downloadSpaceEpub(url: string, filename: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const blob = await r.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'book.epub';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

// ---- Library save: the ONLY call that still goes to linktoepub's
// own backend. It needs the library token, which must never reach
// the browser or the public Space, so the browser hands the Space
// file URL to this endpoint and the server downloads it and
// uploads it to the community library dataset. ----------------------
export function trackOnServer(spaceJobId: string, title: string): void {
  fetch(`${getBackendUrl().replace(/\/$/, '')}/api/raw/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceJobId, title }),
  }).catch(() => {
    /* the browser-side save below is the fallback */
  });
}

export async function saveToLibrary(
  spaceFileUrl: string,
  title: string,
  spaceJobId?: string,
): Promise<{ libraryUrl: string; libraryPageUrl?: string; path?: string }> {
  const r = await fetch(`${getBackendUrl().replace(/\/$/, '')}/api/raw/library-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceFileUrl, title, spaceJobId }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(body && typeof body.error === 'string' ? body.error : `Library save failed (${r.status})`);
  }
  return body as { libraryUrl: string; libraryPageUrl?: string; path?: string };
}

// ---- Job tracking, per browser (localStorage). The Space holds
// the real job state; this store is only how /raw/jobs lists jobs
// started in THIS browser. The Space ALSO exposes a public queue
// (book_list_jobs, below) so the page can show every job
// currently translating, from all users. -------------------------
const STORE_KEY = 'linktoepub-raw-jobs';

export function loadSpaceJobs(): SpaceJob[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSpaceJobs(jobs: SpaceJob[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(jobs));
  } catch {
    /* storage full or unavailable: jobs still work, just not listed */
  }
}

export function upsertSpaceJob(job: SpaceJob): void {
  const jobs = loadSpaceJobs();
  const i = jobs.findIndex((j) => j.spaceJobId === job.spaceJobId);
  if (i >= 0) jobs[i] = job;
  else jobs.unshift(job);
  saveSpaceJobs(jobs);
}

export function findDoneJobForUrl(tocUrl: string): SpaceJob | null {
  return (
    loadSpaceJobs().find(
      (j) =>
        j.tocUrl === tocUrl &&
        (j.status === 'done' || j.status === 'done_with_errors') &&
        Boolean(j.epubUrl),
    ) || null
  );
}

/** One row of the Space's public queue (book_list_jobs).
 * Deliberately minimal: no source URL, no error text, no
 * EPUB path — so a finished book's EPUB stays downloadable
 * only from the browser that started the job. */
export interface PublicQueueJob {
  job_id: string;
  title: string;
  status: string;
  done: number;
  failed: number;
  total: number;
  percent: number;
  current_chapter: string;
  created_at: number;
}

/** Every job on the Space, active first — the public queue. */
export async function fetchPublicQueue(): Promise<PublicQueueJob[]> {
  let outs: unknown[];
  try {
    outs = await callSpace('book_list_jobs', [], 60_000);
  } catch (e) {
    // The fn_index map is cached for an hour; a browser that
    // loaded the page before the Space gained book_list_jobs
    // retries once with a fresh map instead of failing.
    if (e instanceof Error && e.message.includes('has no function')) {
      fnIndexCache = null;
      fnIndexAt = 0;
      outs = await callSpace('book_list_jobs', [], 60_000);
    } else {
      throw e;
    }
  }
  const raw = String((outs && outs[0]) || '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 200) || 'Space returned an unreadable queue');
  }
  if (!Array.isArray(parsed)) throw new Error('Space returned an unreadable queue');
  return parsed as PublicQueueJob[];
}
/** Split a Space TOC text dump into numbered chapter rows for display. */
export function parseTocLines(chaptersText: string): { n: number; title: string }[] {
  return String(chaptersText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // Trailers from book_fetch_toc, not chapters: the
    // "… and N more" count line and the Novelpia login note.
    .filter((line) => !line.startsWith('…') && !line.startsWith('Note:'))
    .map((line, i) => {
      const m = line.match(/^(\d+)\.\s*(.*)$/);
      return m ? { n: Number(m[1]), title: m[2] } : { n: i + 1, title: line };
    });
}

/**
 * Refresh one job from the Space. When it newly reaches a terminal
 * state, fetch its EPUB URL once and attempt the library save
 * (best-effort: a refusal only sets libraryStatus, the Space
 * download still works). Returns the updated job.
 */
export async function refreshSpaceJob(job: SpaceJob): Promise<SpaceJob> {
  if (job.status === 'cancelled' || job.status === 'error') return job;
  let next: SpaceJob = { ...job, updatedAt: Date.now() };
  if (next.status !== 'done' && next.status !== 'done_with_errors') {
    const prog = await checkSpaceProgress(job.spaceJobId);
    next = {
      ...next,
      status: prog.status,
      phase: prog.phase,
      completed: prog.completed,
      total: prog.total,
      failed: prog.failed,
      failedChapters: prog.failedChapters,
      currentChapter: prog.currentChapter,
      lastCheckedAt: Date.now(),
    };
  }
  if (
    (next.status === 'done' || next.status === 'done_with_errors') &&
    !next.epubUrl
  ) {
    try {
      const ep = await getSpaceEpubFile(job.spaceJobId);
      next = { ...next, epubUrl: ep.url, epubFilename: ep.filename, phase: 'Ready to download' };
    } catch {
      /* Download button retries on click; not a job failure */
    }
  }
  if (next.epubUrl && !next.libraryStatus) {
    next = { ...next, libraryStatus: 'uploading' as const };
    try {
      const lib = await saveToLibrary(next.epubUrl, next.title, next.spaceJobId);
      next = { ...next, libraryStatus: 'saved' as const, libraryUrl: lib.libraryUrl };
    } catch (e) {
      next = {
        ...next,
        libraryStatus: 'failed' as const,
        libraryError: e instanceof Error ? e.message : 'Library save failed',
      };
    }
  }
  return next;
}

/** Cancel tracking for a job in this browser. No Space-side stop
 * exists, so a Space worker already running finishes harmlessly
 * in the Space's /tmp; it simply stops being followed here. */
export function cancelSpaceJob(job: SpaceJob): SpaceJob {
  return { ...job, status: 'cancelled' as const, phase: 'Cancelled', updatedAt: Date.now() };
}
