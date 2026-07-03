# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebToEpub is a Chrome/Firefox extension (Manifest V3) that converts web novels and other web pages into EPUB files. This is a **fork** of upstream [dteviot/WebToEpub](https://github.com/dteviot/WebToEpub) that adds a **standalone web-app mode** (`index.html`, deployed to GitHub Pages) plus a rotating **CORS-proxy** system so the app can fetch cross-origin content from a plain browser tab instead of an extension.

The same JavaScript in `plugin/js/` runs in three contexts:
- **Extension popup** — loaded via `plugin/popup.html` (has `chrome.*` APIs).
- **Web-app / website mode** — loaded via top-level `index.html` (no extension APIs; `plugin/js/ChromePolyfill.js` stubs them, and cross-origin fetches go through a CORS proxy).
- **Unit tests** — loaded via `unitTest/Tests.html`.

Code must not assume `chrome.*` is available — guard extension-only calls (see `main.js`, which marks such paths "no-op in website mode").

## Commands

```sh
npm install            # install deps; postinstall copies zip.js + DOMpurify into plugin/
npm run lint           # build packed.js AND run eslint (this is the primary build)
npm run lint:fix       # auto-fix eslint issues in plugin/js
npm run build          # just pack (eslint/pack.js) without linting
npm test               # serve unitTest/Tests.html via http-server (QUnit)
npm run web-ext        # validate the built .xpi with web-ext
npm run release        # node eslint/release.js
./build.sh             # produce a minified extension in dist/ (terser)
```

Lint is considered passing when output ends with `Wrote Zip to disk; Done in XXXs.`. `npm run lint` produces three artifacts in `eslint/`: the Firefox `.xpi`, the Chrome `.zip`, and `packed.js` (concatenated JS — **do not edit `packed.js` by hand**).

### Running tests

- `npm test` opens `unitTest/Tests.html` (QUnit) in a browser. Per CONTRIBUTING.md, tests are easiest to run under Firefox.
- To run a **single test/module**, use QUnit's UI filter box or append `?module=<ModuleName>` / `?filter=<text>` to the Tests.html URL.
- Each parser has a matching `unitTest/Utest*Parser.js`; new parsers should add one, registered in `unitTest/Tests.html`.

### Web-app mode locally

`index.html` is a static page — serve the repo root with any static server (e.g. `npx http-server`) and open `index.html`. GitHub Pages deploys it from the `main` branch (`.github/workflows/pages.yml` copies `index.html` + `plugin/` into `_site`).

## Architecture

### Parser system (the core extensibility point)

Every supported site has one parser in `plugin/js/parsers/` (~380 files). All extend the `Parser` base class in `plugin/js/Parser.js` and **self-register at load time** against a global singleton:

```js
parserFactory.register("royalroad.com", () => new RoyalRoadParser());
```

- `plugin/js/ParserFactory.js` defines the `parserFactory` global (`let parserFactory = new ParserFactory()` at the bottom). It strips leading `www.` and de-dupes registrations. Besides `register(host, ctor)` there are `registerRule` (DOM predicate), `registerUrlRule` (URL predicate), `registerManualSelect` (dropdown), and `registerDeadSite`.
- Parsers are **not** auto-discovered. Each new parser file must be added as a `<script src="js/parsers/Xyz.js">` tag in **`plugin/popup.html`** (extension) and, if it should work in web-app mode, in **`index.html`** too. `eslint/pack.js` derives its file list by parsing the `<script>` tags out of the HTML, so a parser missing from the HTML is invisible to the build.
- Common base parsers to extend instead of `Parser` directly: `WordpressBaseParser`, `MadaraParser`, and the generic `DefaultParser` (used when no host matches).

Key `Parser` methods a subclass typically overrides: `getChapterUrls(dom)`, `findContent(dom)`, `extractTitleImpl`/`extractAuthor`, `findCoverImageUrl(dom)`, `getInformationEpubItemChildNodes(dom)`, and `removeUnwantedElementsFromContentElement`.

### EPUB generation pipeline

1. `main.js` orchestrates the popup/app flow: pick parser → fetch chapter list → user selects chapters/cover → pack.
2. `ImageCollector.js` + `Imgur.js` gather and process images.
3. `EpubItem.js` / `EpubItemSupplier.js` model the chapters and assets.
4. `EpubPacker.js` (with `EpubMetaInfo.js`) builds the EPUB zip via `@zip.js/zip.js`. `dompurify` sanitizes chapter HTML.

### Networking & CORS proxy (fork-specific)

`plugin/js/HttpClient.js` centralizes all fetching through `wrapFetch` / `wrapFetchImpl`. In web-app mode direct cross-origin fetches are blocked by the browser, so requests are routed through a CORS proxy. HttpClient maintains a list of proxies, **races/falls back** between them (`proxyRacePromise`), applies per-proxy timeouts, and has site-specific special-cases (e.g. ko-fi is blacklisted on corsproxy.io). Proxy selection is user-configurable in the UI (`index.html` "CORS PROXY" control). See `DEPLOY_PROXY.md` for hosting a private `cors-anywhere` instance.

`FetchCache` (in `Parser.js`) de-dupes/caches fetches for sites that pack multiple chapters into one page.

### Cloudflare Worker (fork-specific)

`workers/stats-worker.mjs` (config `workers/wrangler.toml`, deployed with `wrangler`) is a stats backend backed by a KV namespace. Client side is `HFStatsLibrary.js` / `HFLibrary.js`. Various `Library*.js` files (`ArchiveLibrary`, `MegaLibrary`, `HFLibrary`) handle reading-list storage/sync backends.

## Conventions & gotchas

- Most files start with `"use strict";` (a few helper/scratch files like `FootnoteExtractor.js` omit it). eslint config lives in `eslint/.eslintrc.js`; unused top-level classes are silenced with `// eslint-disable-line no-unused-vars` because everything shares one global scope (no ES modules — files are concatenated, not imported).
- There is no bundler at runtime. Load order in the HTML files matters; base classes must appear before subclasses.
- Cache-busting `?v=YYYYMMDD_vN` query strings on some `<script>` tags are stripped by `pack.js` (`src.split("?")[0]`) — keep them in sync when you change a versioned file.
- Duplicated `LiveReaderUI*.js` variants (`_old`, `_v1`, `_prelazy`) are historical; `LiveReaderUI.js` is the current one. It is loaded by a separate entry point, `plugin/live-reader.html` (a 4th HTML context alongside popup / web-app / unit-test), not by `popup.html` or `index.html`.
- The repo root contains many ad-hoc `test_*.js/html` scratch files and a `scratch/` dir — these are experiments, not the QUnit suite (which lives in `unitTest/`).

## Contributing (from CONTRIBUTING.md)

- New behavior must be user-toggleable and **off by default** (users dislike silent behavior changes).
- Ensure existing unit tests pass and eslint is clean before a PR.
- Add your name to the `contributors` section of `package.json` and the Credits section of `readme.md`.
- Upstream PRs target the `ExperimentalTab` branch and expect rebased commits. (This fork currently develops on branches like `web-app-cors-proxy`.)
