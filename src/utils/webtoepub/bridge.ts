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
  workInProgress?: boolean;
};

let iframe: HTMLIFrameElement | null = null;
let readyPromise: Promise<EngineWindow> | null = null;

function ensureIframe(): Promise<EngineWindow> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<EngineWindow>((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = '/webtoepub/plugin/popup.html';
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
        if (win.main && win.parserFactory) {
          window.clearTimeout(failTimer);
          try {
            // Suppress engine's stats/library noise in web-app mode.
            (win as unknown as { HFStatsLibrary?: unknown }).HFStatsLibrary = undefined;
          } catch {
            /* ignore */
          }
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
  metadata: EngineMetadata
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

  // Click the pack button to invoke the engine's full pipeline
  // (fetchContent → EpubPacker.assemble → Download.save).
  const btn = win.main.getPackEpubButton();
  if (!btn) throw new Error('Pack button not found in engine');
  btn.dataset.libclick = 'no';
  await win.main.fetchContentAndPackEpub.call(btn);
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

/** Tear down – mainly for tests. */
export function _resetEngine() {
  if (iframe) iframe.remove();
  iframe = null;
  readyPromise = null;
}
