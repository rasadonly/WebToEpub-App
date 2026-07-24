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
  title: string;
  author: string;
  description: string;
  language?: string;
  fileName?: string;
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
  };
  util?: {
    sleepController: AbortController;
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
};

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
  // Poll for parser to be created and webPages populated.
  while (Date.now() - started < timeoutMs) {
    const p = win.parser;
    if (p && p.state && p.state.webPages && p.state.webPages.size > 0) return p;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for chapter list. The site may not be supported.');
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
 * Regenerate the engine's pagesToFetch from the user's selected/reordered
 * chapter list, then trigger fetch+pack+download.
 */
export async function enginePackEpub(
  orderedChapters: EngineChapter[],
  metadata: EngineMetadata,
  onProgress?: (p: EnginePackProgress) => void
): Promise<void> {
  const win = await ensureIframe();
  if (!win.main || !win.parser) throw new Error('Engine has no active parser');

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
    // Click the pack button to invoke the engine's full pipeline
    // (fetchContent → EpubPacker.assemble → Download.save).
    const btn = win.main.getPackEpubButton();
    if (!btn) throw new Error('Pack button not found in engine');
    btn.dataset.libclick = 'no';
    await win.main.fetchContentAndPackEpub.call(btn);
  } finally {
    if (pollTimer !== null) window.clearInterval(pollTimer);
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
  if (!win.SiteSearchEngine) throw new Error('Search engine not ready');
  const myToken = ++searchCancelToken;
  const isLive = () => myToken === searchCancelToken;
  const { results } = await win.SiteSearchEngine.search(
    query,
    0,
    20,
    true,
    (site, status) => { if (isLive()) onProgress?.(site, status); },
    (partial) => { if (isLive()) onResults?.(partial); }
  );
  if (!isLive()) throw new Error('__cancelled__');
  return results;
}

/** Tear down – mainly for tests. */
export function _resetEngine() {
  if (iframe) iframe.remove();
  iframe = null;
  readyPromise = null;
}
