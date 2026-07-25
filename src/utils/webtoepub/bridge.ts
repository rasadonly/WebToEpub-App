import { CORS_PROXY_LIST } from '../localWorker';

/**
 * Bridge to the vendored WebToEpub engine (public/webtoepub/index.html).
 *
 * We load the full engine inside a hidden same-origin iframe so all ~380
 * self-registering parsers keep working exactly as they do upstream, then
 * drive it programmatically from our React UI via contentWindow globals.
 */

export interface EngineChapter {
  id: string;
  url: string;
  title: string;
}

export interface EngineMetadata {
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  fileName?: string;
  coverUrl?: string;
  tocUrl?: string;
}

// Minimal type describing the globals we touch inside the iframe.
type EngineWindow = Window & {
  main?: {
    onLoadAndAnalyseButtonClick: () => Promise<void>;
    fetchContentAndPackEpub: () => Promise<void>;
    getPackEpubButton: () => HTMLButtonElement;
    getUserPreferences: () => unknown;
    resetUI: () => void;
  };
  parser?: {
    state: {
      webPages: Map<string, { sourceUrl: string; title: string; isIncludeable?: boolean }>;
      chapterListUrl?: string;
    };
    setPagesToFetch: (
      chapters: Array<{ sourceUrl: string; title: string; isIncludeable?: boolean }>
    ) => void;
    onStartCollecting?: () => void;
  };
  parserFactory?: {
    parsers: Map<string, unknown>;
    fetch?: (url: string, dom?: Document) => unknown;
  };
  util?: {
    sleepController: AbortController;
  };
  HttpClient?: {
    wrapFetch: (url: string) => Promise<{ responseXML?: Document; responseText?: string }>;
  };
  SiteSearchEngine?: {
    search: (
      query: string,
      startIndex?: number,
      targetResultCount?: number,
      includeSecondary?: boolean,
      onProgress?: (site: string, status: string) => void,
      onResults?: (results: EngineSearchResult[]) => void
    ) => Promise<{ results: EngineSearchResult[]; nextIndex: number }>;
  };
  workInProgress?: boolean;
  HFLibrary?: {
    getTelegramCatalog: () => Promise<HFBookEntry[]>;
    getCatalog: () => Promise<HFBookEntry[]>;
    downloadBook: (epubPath: string, repoId: string) => Promise<Blob>;
    getCoverUrl: (coverPath: string, repoId: string) => Promise<string>;
  };
  ArchiveLibrary?: new () => ArchiveLibraryInstance;
  MegaLibrary?: new () => MegaLibraryInstance;
  mega?: { File: { fromURL: (url: string) => Promise<MegaNode> } };
};

export interface HFBookEntry {
  id: string;
  title: string;
  author?: string;
  description?: string;
  epubPath: string;
  coverPath?: string;
  uploadedAt?: string;
  size?: number;
  repoId: string;
}

interface ArchiveLibraryInstance {
  loadRoot: () => Promise<void>;
  folders: Record<string, Array<{ name: string; path: string; size: number; url: string }>>;
}

interface MegaLibraryInstance {
  epubFiles: MegaNode[];
}

interface MegaNode {
  name?: string;
  directory?: boolean;
  children?: MegaNode[];
  size?: number;
  loadAttributes: () => Promise<void>;
  downloadBuffer: () => Promise<ArrayBuffer>;
}

export interface EngineSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface EnginePackProgress {
  current: number;
  total: number;
  message: string;
}


let iframe: HTMLIFrameElement | null = null;
let readyPromise: Promise<EngineWindow> | null = null;

const HF_OLD_REPO_ID = 'Amono5667/webtoepub-library';
const HF_CATALOG_FILE = 'catalog.json';

function withTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
}

function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const encodedSuffixes = ['?url=', '?quest=', '&url='];
  const needsEncoding = encodedSuffixes.some((suffix) => proxyBase.endsWith(suffix));
  return needsEncoding ? proxyBase + encodeURIComponent(targetUrl) : proxyBase + targetUrl;
}

async function fetchTextWithProxyFallback(url: string, timeoutMs = 15_000): Promise<string> {
  try {
    const direct = await withTimeout(url, { cache: 'no-store' }, timeoutMs);
    if (direct.ok) return await direct.text();
  } catch {
    /* CORS or network failure — try proxies below */
  }

  let lastError: unknown = null;
  const preferred = [...CORS_PROXY_LIST].sort((a, b) => {
    const score = (u: string) => (u.includes('corsproxy.io') ? 0 : u.includes('allorigins') ? 1 : 2);
    return score(a.url) - score(b.url);
  });

  for (const proxy of preferred) {
    try {
      const response = await withTimeout(buildProxyUrl(proxy.url, url), { cache: 'no-store' }, timeoutMs);
      if (!response.ok) {
        lastError = new Error(`${proxy.name} returned ${response.status}`);
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All library proxies failed');
}

async function fetchJsonWithProxyFallback<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const text = await fetchTextWithProxyFallback(url, timeoutMs);
  return JSON.parse(text) as T;
}

function makeHfFileUrl(repoId: string, path: string): string {
  return `https://huggingface.co/datasets/${repoId}/resolve/main/${path}`;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([buffer], { type: mimeType });
}

function ensureIframe(): Promise<EngineWindow> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<EngineWindow>((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = '/webtoepub/plugin/popup.html?wte=1';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.left = '-10000px';
    el.style.top = '-10000px';
    el.style.width = '1024px';
    el.style.height = '768px';
    el.style.border = '0';
    el.style.pointerEvents = 'none';

    const failTimer = window.setTimeout(() => {
      reject(new Error('WebToEpub engine failed to load within 30s'));
    }, 30_000);

    el.addEventListener('load', () => {
      // Give the deferred scripts time to run and register parsers.
      const win = el.contentWindow as EngineWindow | null;
      if (!win) {
        window.clearTimeout(failTimer);
        reject(new Error('Iframe has no contentWindow'));
        return;
      }
      // Inject our free AI proxy endpoint so AiClient uses Lovable AI Gateway
      // instead of Pollinations for search fallback and selector autocomplete.
      try {
        const supaUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
        const anon = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || '';
        if (supaUrl) {
          (win as unknown as Record<string, unknown>).LOVABLE_AI_ENDPOINT = `${supaUrl}/functions/v1/ai-parse`;
          if (anon) (win as unknown as Record<string, unknown>).LOVABLE_AI_ANON_KEY = anon;
          (win as unknown as Record<string, unknown>).LOVABLE_AI_MODEL = 'google/gemini-2.5-flash';
        }
      } catch { /* ignore */ }
      const started = Date.now();
      const poll = () => {
        const ready = (win as unknown as { __WTE_READY?: boolean }).__WTE_READY;
        if (ready && win.main && win.parserFactory) {
          window.clearTimeout(failTimer);
          resolve(win);
          return;
        }
        if (Date.now() - started > 25_000) {
          window.clearTimeout(failTimer);
          reject(new Error('Engine globals never appeared'));
          return;
        }
        window.setTimeout(poll, 100);
      };
      poll();
    });


    document.body.appendChild(el);
    iframe = el;
  });

  return readyPromise;
}

function setInput(win: EngineWindow, id: string, value: string) {
  const doc = win.document;
  const el = doc.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function waitForParser(win: EngineWindow, timeoutMs = 60_000) {
  const started = Date.now();
  const winAny = win as unknown as {
    ErrorLog?: { queue?: unknown[]; showErrorMessage?: (m: unknown) => void };
    __WTE_LAST_ERROR?: string | null;
  };
  // Reset any prior captured error and hook ErrorLog so failures surface fast.
  winAny.__WTE_LAST_ERROR = null;
  try {
    const el = winAny.ErrorLog;
    if (el && el.showErrorMessage && !(el as { __WTE_HOOKED?: boolean }).__WTE_HOOKED) {
      const original = el.showErrorMessage.bind(el);
      el.showErrorMessage = (msg: unknown) => {
        try {
          const text =
            typeof msg === 'string'
              ? msg
              : (msg as { message?: string; toString?: () => string })?.message ||
                String(msg);
          winAny.__WTE_LAST_ERROR = text;
        } catch { /* ignore */ }
        return original(msg);
      };
      (el as { __WTE_HOOKED?: boolean }).__WTE_HOOKED = true;
    }
    // Also clear any queued messages from a prior run.
    if (el && Array.isArray(el.queue)) el.queue.length = 0;
  } catch { /* ignore */ }

  while (Date.now() - started < timeoutMs) {
    const p = win.parser;
    if (p && p.state && p.state.webPages && p.state.webPages.size > 0) return p;

    // Bail out immediately if the engine reported an error.
    const err =
      winAny.__WTE_LAST_ERROR ||
      (Array.isArray(winAny.ErrorLog?.queue) && winAny.ErrorLog!.queue!.length > 0
        ? (() => {
            const m = winAny.ErrorLog!.queue![0] as
              | string
              | { message?: string; toString?: () => string };
            return typeof m === 'string' ? m : m?.message || String(m);
          })()
        : null);
    if (err) {
      throw new Error(String(err).slice(0, 500));
    }

    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(
    'Timed out waiting for chapter list. The site may be blocked by Cloudflare/anti-bot protection, or is not supported.'
  );
}

/**
 * Load the TOC URL through the engine and return the discovered chapter list.
 */
export async function engineFetchToc(url: string): Promise<EngineChapter[]> {
  const win = await ensureIframe();
  if (!win.main) throw new Error('Engine not ready');

  // Reset previous state
  try {
    win.main.resetUI();
  } catch {
    /* ignore */
  }

  setInput(win, 'startingUrlInput', url);
  await win.main.onLoadAndAnalyseButtonClick();
  const parser = await waitForParser(win);

  const chapters: EngineChapter[] = [];
  let i = 0;
  parser.state.webPages.forEach(page => {
    chapters.push({
      id: `${i}-${page.sourceUrl}`,
      url: page.sourceUrl,
      title: (page.title || `Chapter ${i + 1}`).trim(),
    });
    i++;
  });
  return chapters;
}

/**
 * Streaming version of engineFetchToc.
 * Fires onBatch() each time the engine discovers new chapters so the UI
 * can show them appearing live, exactly like the Live Reader.
 */
export async function engineFetchTocLive(
  url: string,
  onBatch: (chapters: EngineChapter[]) => void,
  timeoutMs = 60_000
): Promise<EngineChapter[]> {
  const win = await ensureIframe();
  if (!win.main) throw new Error('Engine not ready');

  try { win.main.resetUI(); } catch { /* ignore */ }
  setInput(win, 'startingUrlInput', url);

  // Hook error log so failures surface immediately.
  const winAny = win as unknown as {
    ErrorLog?: { queue?: unknown[]; showErrorMessage?: (m: unknown) => void; __WTE_HOOKED?: boolean };
    __WTE_LAST_ERROR?: string | null;
  };
  winAny.__WTE_LAST_ERROR = null;
  try {
    const el = winAny.ErrorLog;
    if (el?.showErrorMessage && !el.__WTE_HOOKED) {
      const orig = el.showErrorMessage.bind(el);
      el.showErrorMessage = (msg: unknown) => {
        try {
          winAny.__WTE_LAST_ERROR =
            typeof msg === 'string' ? msg : (msg as { message?: string })?.message || String(msg);
        } catch { /* ignore */ }
        return orig(msg);
      };
      el.__WTE_HOOKED = true;
    }
    if (el && Array.isArray(el.queue)) el.queue.length = 0;
  } catch { /* ignore */ }

  // Start the engine click WITHOUT blocking — we will poll in parallel.
  const enginePromise = win.main.onLoadAndAnalyseButtonClick();

  const seen = new Set<string>();
  const all: EngineChapter[] = [];
  const started = Date.now();
  let lastSize = 0;
  let stableTicks = 0;

  // Poll every 300 ms, streaming new chapters as they appear.
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 300));

    // Bail on engine error.
    const err = winAny.__WTE_LAST_ERROR ||
      (Array.isArray(winAny.ErrorLog?.queue) && (winAny.ErrorLog!.queue!.length > 0)
        ? (() => {
            const m = winAny.ErrorLog!.queue![0] as string | { message?: string };
            return typeof m === 'string' ? m : m?.message || String(m);
          })()
        : null);
    if (err) throw new Error(String(err).slice(0, 500));

    const p = win.parser;
    const size = p?.state?.webPages?.size ?? 0;

    if (size > 0) {
      const batch: EngineChapter[] = [];
      let idx = 0;
      p!.state.webPages.forEach(page => {
        if (!seen.has(page.sourceUrl)) {
          seen.add(page.sourceUrl);
          const ch: EngineChapter = {
            id: `${all.length + batch.length}-${page.sourceUrl}`,
            url: page.sourceUrl,
            title: (page.title || `Chapter ${all.length + batch.length + 1}`).trim(),
          };
          batch.push(ch);
        }
        idx++;
      });

      if (batch.length > 0) {
        all.push(...batch);
        onBatch(batch);
      }

      // Stable = size unchanged for 3 consecutive polls (~900ms). Engine is done.
      if (size === lastSize) {
        stableTicks++;
        if (stableTicks >= 3) break;
      } else {
        stableTicks = 0;
        lastSize = size;
      }
    }
  }

  // Await the engine promise so any thrown errors surface.
  try { await enginePromise; } catch { /* errors already captured above */ }

  if (all.length === 0) {
    throw new Error(
      'Timed out waiting for chapter list. The site may be blocked by Cloudflare/anti-bot protection, or is not supported.'
    );
  }

  return all;
}





/**
 * Regenerate the engine's pagesToFetch from the user's selected/reordered
 * chapter list, then trigger fetch+pack+download.
 */
export async function enginePackEpub(
  orderedChapters: EngineChapter[],
  metadata: EngineMetadata,
  onProgress?: (p: EnginePackProgress) => void
): Promise<void> {
  const win = await ensureIframe();
  if (!win.main) throw new Error('Engine not ready');

  // If the engine parser hasn't been initialized (because we used the fast path),
  // we must initialize it now so the engine knows how to pack the EPUB for this site.
  if (!win.parser && metadata.tocUrl) {
    try { win.main.resetUI(); } catch { /* ignore */ }
    setInput(win, 'startingUrlInput', metadata.tocUrl);
    await win.main.onLoadAndAnalyseButtonClick();
    await waitForParser(win);
  }

  if (!win.parser) throw new Error('Engine has no active parser');

  // Apply metadata to the engine's form fields
  if (metadata.title) setInput(win, 'titleInput', metadata.title);
  if (metadata.author) setInput(win, 'authorInput', metadata.author);
  if (metadata.description) setInput(win, 'descriptionInput', metadata.description);
  if (metadata.language) setInput(win, 'languageInput', metadata.language);
  const fileName =
    metadata.fileName ||
    (metadata.title ? `${metadata.title}.epub` : 'novel.epub');
  setInput(win, 'fileNameInput', fileName);

  // Replace the engine's pagesToFetch with our ordered selection.
  const rebuilt = orderedChapters.map(c => ({
    sourceUrl: c.url,
    title: c.title,
    isIncludeable: true,
  }));
  win.parser.setPagesToFetch(rebuilt);

  // Also sync the DOM checkboxes so any UI-driven filter agrees with us.
  try {
    const doc = win.document;
    doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-chapter-url]').forEach(
      cb => {
        cb.checked = true;
      }
    );
  } catch {
    /* ignore – table may not have data attributes in this build */
  }

  // ── Intercept the engine's Download.save() so the blob is triggered from
  // the main window, not the hidden iframe. Some browsers refuse to allow
  // programmatic downloads initiated from an offscreen/hidden iframe.
  // We patch URL.createObjectURL inside the iframe: when the engine calls it
  // with an EPUB blob we capture it, revoke the original URL, and trigger the
  // download from the parent window instead.
  const iframeWin = win as unknown as Window & { URL: typeof URL };
  const origCreateObjectURL = iframeWin.URL.createObjectURL.bind(iframeWin.URL);
  let downloadIntercepted = false;
  iframeWin.URL.createObjectURL = (obj: Blob | MediaSource): string => {
    // Cross-realm `instanceof Blob` fails if the Blob was created inside the iframe.
    // Instead, we duck-type check for Blob properties (size and type).
    if (!downloadIntercepted && obj && typeof (obj as Blob).size === 'number' &&
        ((obj as Blob).type === 'application/epub+zip' || (obj as Blob).type === 'application/zip' || (obj as Blob).size > 5000)) {
      downloadIntercepted = true;
      // Restore immediately so the engine can still use it for other things.
      iframeWin.URL.createObjectURL = origCreateObjectURL;
      // Trigger the download from the main window context.
      const blob = obj as Blob;
      setTimeout(() => {
        const a = document.createElement('a');
        const url = URL.createObjectURL(new Blob([blob], { type: blob.type || 'application/epub+zip' }));
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, 0);
      // Return a dummy URL so the engine's own anchor click doesn't error.
      return origCreateObjectURL(new Blob([], { type: 'text/plain' }));
    }
    return origCreateObjectURL(obj);
  };

  // Poll the engine's <progress id="fetchProgress"> element and forward it.
  let pollTimer: number | null = null;
  if (onProgress) {
    const doc = win.document;
    pollTimer = window.setInterval(() => {
      const bar = doc.getElementById('fetchProgress') as HTMLProgressElement | null;
      const msg = doc.getElementById('progressString');
      if (bar) {
        onProgress({
          current: Number(bar.value) || 0,
          total: Number(bar.max) || orderedChapters.length,
          message: msg?.textContent || '',
        });
      }
    }, 500);
  }

  try {
    // Hook ErrorLog so we can extract the specific error if it fails
    const winAny = win as any;
    if (winAny.ErrorLog && Array.isArray(winAny.ErrorLog.queue)) {
      winAny.ErrorLog.queue.length = 0;
    }

    // Click the pack button to invoke the engine's full pipeline
    // (fetchContent → EpubPacker.assemble → Download.save).
    const btn = win.main.getPackEpubButton();
    if (!btn) throw new Error('Pack button not found in engine');
    btn.dataset.libclick = 'no';
    await win.main.fetchContentAndPackEpub.call(btn);

    if (!downloadIntercepted) {
      let errStr = 'EPUB generation failed before completion. Check if the site is blocking access.';
      if (winAny.ErrorLog && Array.isArray(winAny.ErrorLog.queue) && winAny.ErrorLog.queue.length > 0) {
        const msg = winAny.ErrorLog.queue[0];
        errStr = typeof msg === 'string' ? msg : msg?.message || String(msg);
      }
      throw new Error(errStr);
    }
  } finally {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    // Always restore the original URL.createObjectURL
    if (iframeWin.URL.createObjectURL !== origCreateObjectURL) {
      iframeWin.URL.createObjectURL = origCreateObjectURL;
    }
  }
}

/**
 * Abort an in-flight fetch/pack. Signals the engine's shared sleepController;
 * the fetch loop checks it between chapters and unwinds cleanly.
 */
export async function engineAbort(): Promise<void> {
  if (!readyPromise) return;
  const win = await readyPromise;
  try {
    win.util?.sleepController.abort();
  } catch {
    /* ignore */
  }
}

/**
 * Returns the list of hostnames the engine has parsers for.
 * Useful for the "Supported Sites" screen to auto-populate.
 */
export async function engineListSupportedHosts(): Promise<string[]> {
  const win = await ensureIframe();
  const factory = win.parserFactory;
  if (!factory) return [];
  return Array.from(factory.parsers.keys()) as string[];
}

/**
 * Search novel sites via the engine's SiteSearchEngine.
 * Streams partial results; callbacks stop firing after cancelSearch().
 */
let searchCancelToken = 0;
export function cancelSearch() {
  searchCancelToken++;
}

export async function engineSearch(
  query: string,
  onResults?: (results: EngineSearchResult[]) => void,
  onProgress?: (site: string, status: string) => void
): Promise<EngineSearchResult[]> {
  const win = await ensureIframe();
  const SSE: any = (win as any).SiteSearchEngine;
  if (!SSE) throw new Error('Search engine not ready');
  const myToken = ++searchCancelToken;
  const isLive = () => myToken === searchCancelToken;

  // Iterate ALL sites (primary + secondary) ourselves — the engine's
  // built-in `search()` stops early after ~10 sites / 20 results.
  const sites: any[] = [...(SSE.PRIMARY_SITES || []), ...(SSE.SECONDARY_SITES || [])];
  if (isLive()) onProgress?.('Starting', `Searching ${sites.length} sites...`);

  const seen = new Set<string>();
  const results: EngineSearchResult[] = [];

  // Fire ALL sites in parallel — each request goes to a different domain,
  // so there's no per-host rate-limit risk. Results stream in as they arrive.
  await Promise.all(
    sites.map(async (site: any) => {
      if (!isLive()) return;
      onProgress?.(site.name, 'searching');
      let siteResults: EngineSearchResult[] = [];
      try {
        siteResults = await SSE.fetchSiteResults(site, query);
      } catch {
        if (isLive()) onProgress?.(site.name, 'failed');
        return;
      }
      if (!isLive()) return;
      onProgress?.(site.name, `found ${siteResults.length}`);
      const fresh: EngineSearchResult[] = [];
      for (const r of siteResults) {
        const key = SSE.normalizeUrl(r.url);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(r);
          fresh.push(r);
        }
      }
      if (fresh.length && isLive()) onResults?.(fresh);
    })
  );
  if (!isLive()) throw new Error('__cancelled__');
  return results;
}

export interface EngineBookInfo {
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  language: string;
  fileName: string;
}

/** Read the currently-loaded book's metadata from engine DOM inputs. */
export async function engineGetBookInfo(): Promise<EngineBookInfo> {
  const win = await ensureIframe();
  const doc = win.document;
  const val = (id: string) =>
    (doc.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value?.trim() || '';
  return {
    title: val('titleInput'),
    author: val('authorInput'),
    description: val('descriptionInput'),
    coverUrl: val('coverImageUrlInput'),
    language: val('languageInput'),
    fileName: val('fileNameInput'),
  };
}

/**
 * Run the WebToEpub "Load & Analyse" flow for a URL and return the parser's
 * detected metadata (title, author, language, filename, cover, description).
 * This mirrors what happens when a user clicks the button in WebToEpub.
 */
export async function engineLoadMetadata(url: string): Promise<EngineBookInfo> {
  const win = await ensureIframe();
  if (!win.main) throw new Error('Engine not ready');
  try { win.main.resetUI(); } catch { /* ignore */ }
  setInput(win, 'startingUrlInput', url);
  await win.main.onLoadAndAnalyseButtonClick();
  await waitForParser(win);
  return engineGetBookInfo();
}

export interface EngineChapterContent {
  title: string;
  html: string;
}

/**
 * Fetch a single chapter through the engine, extract clean content,
 * and return sanitized HTML ready to render inline in our React reader.
 */
export async function engineFetchChapter(
  url: string,
  chapterTitle?: string
): Promise<EngineChapterContent> {
  const win = await ensureIframe();
  if (!win.parserFactory || !win.HttpClient) throw new Error('Engine not ready');

  // 1) Fetch the raw page (HttpClient handles the proxy chain).
  const xhr = await win.HttpClient.wrapFetch(url);
  let dom: Document | null = xhr.responseXML || null;
  if (!dom && xhr.responseText) {
    dom = new DOMParser().parseFromString(xhr.responseText, 'text/html');
  }
  if (!dom) throw new Error('Failed to load chapter');

  // 2) Pick a parser for this URL and extract the content element.
  type ParserLike = {
    findContent?: (d: Document) => Element | null;
    removeUnwantedElementsFromContentElement?: (el: Element) => void;
    findChapterTitle?: (d: Document) => Element | string | null;
  };
  let parser: ParserLike | null = null;
  try {
    parser = win.parserFactory.fetch?.(url, dom) as ParserLike;
  } catch {
    /* fall through */
  }

  let contentEl: Element | null = null;
  if (parser?.findContent) {
    try { contentEl = parser.findContent(dom); } catch { /* ignore */ }
  }
  if (!contentEl) contentEl = dom.body;

  // 3) Extract title from parser or dom.
  let title = chapterTitle || '';
  if (!title && parser?.findChapterTitle) {
    try {
      const t = parser.findChapterTitle(dom);
      if (t) title = (t instanceof Element ? t.textContent : String(t))?.trim() || '';
    } catch { /* ignore */ }
  }
  if (!title) title = dom.title || 'Chapter';

  // 4) Sanitize a clone so we don't mutate parser state.
  const clone = contentEl.cloneNode(true) as Element;
  try { parser?.removeUnwantedElementsFromContentElement?.(clone); } catch { /* ignore */ }
  clone
    .querySelectorAll(
      "script,style,iframe,object,embed,form,input,button,select,textarea,noscript,nav,header,footer,[class*='ad-'],[id*='ad-'],[class*='banner'],[class*='share']"
    )
    .forEach((el) => el.remove());
  // Remove inline event handlers.
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  return { title, html: clone.innerHTML };
}

/** Tear down – mainly for tests. */
export function _resetEngine() {
  if (iframe) iframe.remove();
  iframe = null;
  readyPromise = null;
}

// ─────────────────────────────────────────────────────────────
// Library bridges — call the vendored HFLibrary / ArchiveLibrary
// / MegaLibrary classes directly and return plain data so the
// React UI never touches the WebToEpub popup DOM.
// ─────────────────────────────────────────────────────────────

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  description: string;
  coverUrl?: string;
  size?: number;
  uploadedAt?: string;
  /** Opaque handle we pass back to library functions to trigger downloads. */
  handle: unknown;
  source: 'telegram' | 'hf' | 'mega' | 'archive';
}

async function fetchHFBooks(mode: 'telegram' | 'hf'): Promise<LibraryBook[]> {
  const repoId = mode === 'telegram' ? HF_OLD_REPO_ID : HF_OLD_REPO_ID;
  const list = await fetchJsonWithProxyFallback<HFBookEntry[]>(
    makeHfFileUrl(repoId, HF_CATALOG_FILE),
    12_000
  );
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => ({
      id: item.id,
      title: item.title || 'Untitled',
      author: item.author || '',
      description: item.description || '',
      size: item.size,
      uploadedAt: item.uploadedAt,
      handle: { epubPath: item.epubPath, repoId: item.repoId || repoId },
      source: mode,
    }))
    .sort((a, b) => {
      const aTime = Date.parse(a.uploadedAt || '');
      const bTime = Date.parse(b.uploadedAt || '');
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

export const libraryGetTelegram = () => fetchHFBooks('telegram');
export const libraryGetPublic = () => fetchHFBooks('hf');

export async function libraryDownloadHF(handle: unknown): Promise<Blob> {
  const { epubPath, repoId } = handle as { epubPath: string; repoId: string };
  const url = makeHfFileUrl(repoId || HF_OLD_REPO_ID, epubPath);
  const response = await withTimeout(url, { cache: 'no-store' }, 25_000);
  if (!response.ok) throw new Error(`Failed to download book: ${response.status}`);
  if (!epubPath.toLowerCase().endsWith('.txt')) return await response.blob();
  return base64ToBlob(await response.text(), 'application/epub+zip');
}

// ── Archive.org ────────────────────────────────────────────
const ARCHIVE_XML = 'https://archive.org/download/offtllnls/offtllnls_files.xml';
const ARCHIVE_DL_BASE = 'https://archive.org/download/offtllnls/';
let archiveCache: LibraryBook[] | null = null;

export async function libraryGetArchive(): Promise<LibraryBook[]> {
  if (archiveCache) return archiveCache;
  const xmlText = await fetchTextWithProxyFallback(ARCHIVE_XML, 20_000);
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Archive.org XML unavailable');
  const books: LibraryBook[] = [];
  const fileNodes = doc.getElementsByTagName('file');
  for (let i = 0; i < fileNodes.length; i++) {
    const node = fileNodes[i];
    const fmt = node.getElementsByTagName('format')[0];
    if (!fmt || fmt.textContent !== 'EPUB') continue;
    const nameAttr = node.getAttribute('name');
    if (!nameAttr) continue;
    const parts = nameAttr.split('/');
    if (parts.length < 2) continue;
    const folder = parts[0];
    const fileName = parts.slice(1).join('/');
    const sizeNode = node.getElementsByTagName('size')[0];
    const size = sizeNode ? parseInt(sizeNode.textContent || '0', 10) : 0;
    const url = ARCHIVE_DL_BASE + encodeURIComponent(folder) + '/' + encodeURIComponent(fileName);
    books.push({
      id: nameAttr,
      title: fileName.replace(/\.epub$/i, ''),
      author: folder,
      description: '',
      size,
      handle: { url },
      source: 'archive',
    });
  }
  books.sort((a, b) => a.title.localeCompare(b.title));
  archiveCache = books;
  return books;
}

export async function libraryDownloadArchive(handle: unknown): Promise<Blob> {
  const { url } = handle as { url: string };
  try {
    const direct = await withTimeout(url, { cache: 'no-store' }, 25_000);
    if (direct.ok) return await direct.blob();
  } catch {
    /* try proxy below */
  }
  const text = await fetchTextWithProxyFallback(url, 25_000);
  return new Blob([text], { type: 'application/epub+zip' });
}

// ── Mega ────────────────────────────────────────────────────
const megaFiles = new Map<string, MegaNode>();
export async function libraryGetMega(folderUrl: string): Promise<LibraryBook[]> {
  const win = await ensureIframe();
  if (!win.mega) throw new Error('Mega SDK not loaded in engine');
  const folder = await win.mega.File.fromURL(folderUrl);
  await folder.loadAttributes();
  const found: MegaNode[] = [];
  const walk = (n: MegaNode) => {
    if (!n.children) return;
    for (const c of n.children) {
      if (c.directory) walk(c);
      else if (c.name?.toLowerCase().endsWith('.epub')) found.push(c);
    }
  };
  walk(folder);
  megaFiles.clear();
  const out: LibraryBook[] = [];
  found.forEach((f, i) => {
    const id = `mega-${i}`;
    megaFiles.set(id, f);
    out.push({
      id,
      title: (f.name || 'Untitled').replace(/\.epub$/i, ''),
      author: '',
      description: '',
      size: f.size,
      handle: { id },
      source: 'mega',
    });
  });
  return out;
}

export async function libraryDownloadMega(handle: unknown): Promise<Blob> {
  const { id } = handle as { id: string };
  const file = megaFiles.get(id);
  if (!file) throw new Error('Mega file no longer available – reload the folder.');
  const buf = await file.downloadBuffer();
  return new Blob([buf], { type: 'application/epub+zip' });
}

