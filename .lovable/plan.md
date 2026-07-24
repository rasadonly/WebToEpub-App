
## Goal

Replace our current homemade backend (`src/utils/localWorker.ts`, `src/utils/readability.ts`, `src/utils/epubGenerator.ts`, `src/utils/siteConfigs.ts`) with the real WebToEpub engine from `github.com/rasadonly/WebToEpub-App`, while keeping our existing React UI (`ConversionForm`, `ChapterManager`, `AdminPanel`, `SupportedSites`, hero/search look).

## Approach

The WebToEpub codebase is ~380 non-modular global-scope JS files (no ESM, no bundler). Rewriting it into TS is not realistic. Instead we vendor the JS as-is and load it in the browser, then call its globals from a thin TypeScript bridge.

### 1. Vendor the engine

Copy these directories from the upstream repo into `public/webtoepub/` so Vite serves them as static assets (no bundling):

- `plugin/js/**` — Parser, ParserFactory, HttpClient, EpubPacker, EpubItem, EpubMetaInfo, ImageCollector, Imgur, UIText, Util, ErrorLog, ChromePolyfill, UserPreferences, Secrets, plus the full `parsers/` folder (~380 sites).
- `plugin/dompurify/`, `plugin/@zip.js/` — required libraries.
- `plugin/css/` skipped (we keep our own UI).

### 2. Loader + bridge (`src/utils/webtoepub/`)

- `loader.ts` — one-time async loader that appends `<script>` tags for every file, preserving the exact order used by the upstream `popup.html` (base classes before subclasses; parsers last). Waits for each to load. Exposes a `ready` promise.
- `bridge.ts` — TypeScript wrapper around the engine's globals:
  - `getParser(url)` → uses `parserFactory.fetch(url, dom)` on a fetched TOC page.
  - `fetchToc(url)` → returns `ChapterItem[]` via `parser.getChapterUrls`.
  - `fetchChapter(url, parser)` → returns cleaned HTML via `parser.fetchChapter`.
  - `buildEpub(metadata, chapters)` → drives `EpubPacker` and returns a `Blob` with correct EPUB mimetype.
- Overrides `ChromePolyfill` no-op paths and points `HttpClient` at the proxy list already in use (our Cloudflare worker as primary, plus their built-in fallbacks).

### 3. Rewire the UI hook

Rewrite `src/hooks/useEpubConverter.ts` to call the bridge instead of `localWorker`. Public shape (`fetchChapters`, `generateFromChapters`, `ChapterItem`, progress log) stays identical so `ConversionForm.tsx`, `ChapterManager.tsx`, and `Index.tsx` need zero changes.

### 4. Supported sites list

`SupportedSites.tsx` currently reads from our hand-maintained `siteConfigs.ts`. Switch it to read from `parserFactory` after load (`parserFactory.parsers` map keys) so the list auto-reflects all ~380 supported domains. Admin-panel custom sites remain layered on top via a small local override registry.

### 5. Files removed / replaced

- Remove: `src/utils/localWorker.ts`, `src/utils/readability.ts`, `src/utils/epubGenerator.ts`.
- Keep and slim down: `src/utils/siteConfigs.ts` (only used now for admin-panel custom-site overrides).
- Untouched: `index.html` hero styles, Tailwind config, all components.

## Technical notes

- Vite serves `/webtoepub/plugin/js/...` directly; scripts share one global scope like the original extension.
- Load order is derived by parsing the upstream `plugin/popup.html` at import-copy time and saving the ordered list as `public/webtoepub/manifest.json`.
- EPUB `application/epub+zip` mimetype rule (Android `.epub.zip` fix) is already handled correctly by `EpubPacker.js`.
- Total added weight ~2 MB gzipped, all lazy-loaded on first "Fetch" click, cached by the browser.
- Admin-panel custom parsers are registered at runtime with `parserFactory.register(host, () => new DefaultParser(...))` using the stored selectors.

## Out of scope

- No Cloud/Supabase — pure client-side, same as today.
- No UI changes.
- Reading-list sync, TTS, live-reader, search-engine UI, and other extension-only features are not wired up (their scripts are loaded but the UI surface stays ours).

## Risks

- ~380 script tags on first load is heavy but only runs once per session.
- Some parsers rely on extension-only APIs (declarativeNetRequest, cookies); those specific sites may still fail — same limitation as the upstream web-app mode.
