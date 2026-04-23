"use strict";

/**
 * SearchEngineAPI — thin adapter between UI and search backends.
 * Supports custom site search (SiteSearchEngine) and traditional engines (DDG, Bing, Google, Yandex).
 */
class SearchEngineAPI {
    static async search(query, engine, onProgress, startIndex = 0, onResults) {
        if (engine === "custom") {
            return await SiteSearchEngine.search(query.trim(), startIndex, 10, false, onProgress, onResults);
        }
        if (engine === "custom_all") {
            return await SiteSearchEngine.search(query.trim(), startIndex, 10, true, onProgress, onResults);
        }
        let searchQuery = query.trim() + " novel chapter";
        let results = [];
        switch (engine) {
            case "duckduckgo": results = await SearchEngineAPI.searchDuckDuckGo(searchQuery); break;
            case "bing": results = await SearchEngineAPI.searchBing(searchQuery); break;
            case "google": results = await SearchEngineAPI.searchGoogle(searchQuery); break;
            case "yandex": results = await SearchEngineAPI.searchYandex(searchQuery); break;
            default: throw new Error("Unknown search engine: " + engine);
        }
        return { results, nextIndex: -1 }; // Traditional engines don't easily paginate in this POC
    }

    static async searchDuckDuckGo(query) {
        let dom = await SearchEngineAPI.fetchDom("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query));
        let results = [];
        let nodes = dom.querySelectorAll(".result");
        if (nodes.length === 0) nodes = dom.querySelectorAll(".result__body");
        if (nodes.length === 0) nodes = dom.querySelectorAll("tr");
        for (let node of nodes) {
            let a = node.querySelector(".result__title a") || node.querySelector("a.result__a") || node.querySelector("a[href*='&uddg=']");
            let snippet = node.querySelector(".result__snippet") || node.querySelector(".snippet");
            if (a && a.href && a.href.includes("uddg=")) {
                results.push({
                    title: a.textContent.trim(),
                    url: SearchEngineUI.extractRealUrl(a.href),
                    snippet: snippet ? snippet.textContent.trim() : ""
                });
            }
        }
        return results;
    }

    static async searchBing(query) {
        let dom = await SearchEngineAPI.fetchDom("https://www.bing.com/search?q=" + encodeURIComponent(query));
        let results = [];
        let nodes = dom.querySelectorAll(".b_algo");
        if (nodes.length === 0) nodes = dom.querySelectorAll("li.b_algo");
        for (let node of nodes) {
            let a = node.querySelector("h2 a") || node.querySelector("a");
            let snippet = node.querySelector(".b_caption p") || node.querySelector(".b_algoSlug") || node.querySelector(".b_lineclamp3");
            if (a && a.href && !a.href.startsWith("javascript:") && a.href.includes("http")) {
                results.push({
                    title: a.textContent.trim(),
                    url: a.href,
                    snippet: snippet ? snippet.textContent.trim() : ""
                });
            }
        }
        return results;
    }

    static async searchGoogle(query) {
        let dom = await SearchEngineAPI.fetchDom("https://www.google.com/search?q=" + encodeURIComponent(query));
        let results = [];
        let nodes = dom.querySelectorAll("div.g");
        if (nodes.length === 0) nodes = dom.querySelectorAll("div.MjjYud");
        for (let node of nodes) {
            let a = node.querySelector("a");
            let titleNode = node.querySelector("h3") || node.querySelector("span[role='heading']");
            if (a && a.href && a.href.includes("http") && (titleNode || a.textContent.length > 10)) {
                let snippetText = "";
                let snippetNodes = node.querySelectorAll("div[style*='-webkit-line-clamp']");
                if (snippetNodes.length > 0) {
                    snippetText = snippetNodes[snippetNodes.length - 1].textContent.trim();
                } else {
                    let textDiv = node.querySelector("div[data-sncf]") || node.querySelector(".VwiC3b");
                    if (textDiv) snippetText = textDiv.textContent.trim();
                }
                results.push({
                    title: titleNode ? titleNode.textContent.trim() : a.textContent.trim(),
                    url: a.href,
                    snippet: snippetText
                });
            }
        }
        return results;
    }

    static async searchYandex(query) {
        let dom = await SearchEngineAPI.fetchDom("https://yandex.com/search/?text=" + encodeURIComponent(query));
        let results = [];
        let nodes = dom.querySelectorAll("li.serp-item");
        for (let node of nodes) {
            let a = node.querySelector("h2 a[href]");
            let snippetNode = node.querySelector(".organic__content-wrapper");
            if (a) {
                results.push({
                    title: a.textContent.trim(),
                    url: a.href,
                    snippet: snippetNode ? snippetNode.textContent.trim() : ""
                });
            }
        }
        return results;
    }

    static async fetchDom(url) {
        let response = await HttpClient.fetchHtml(url);
        if (!response || !response.responseXML) {
            return document.implementation.createHTMLDocument();
        }
        return response.responseXML;
    }
}

/**
 * SearchEngineUI — handles the search UI, event binding, and result rendering.
 * 
 * Optimizations:
 *   - Uses DocumentFragment for batch DOM operations
 *   - Debounces progressive renders (max once per 300ms)
 *   - Separates badge into its own span (not inside the link text)
 */
class SearchEngineUI {
    static VERSION = "1.2.0";

    /** Minimum time between progressive re-renders (ms) */
    static RENDER_DEBOUNCE_MS = 100;
    static _lastRenderTime = 0;
    static _pendingRender = null;

    /** Timer for debounced progress status writes */
    static _statusTimer = null;

    /**
     * Debounce high-frequency status bar updates (fires on every site during search).
     * Final/error messages bypass the debounce via direct assignment.
     */
    static _setProgressStatus(msg) {
        clearTimeout(SearchEngineUI._statusTimer);
        SearchEngineUI._statusTimer = setTimeout(() => {
            let el = document.getElementById("searchEngineStatus");
            if (el) el.textContent = msg;
        }, 50);
    }

    /**
     * Returns true when the input looks like a URL the user wants to import directly.
     */
    static isUrl(str) {
        return /^https?:\/\//i.test(str) || /^(?:www\.)[\w.-]+\.[a-z]{2,}/i.test(str);
    }

    static init() {
        SearchEngineUI.bindEvents();
    }

    static bindEvents() {
        let searchBtn = document.getElementById("searchEngineGoButton");
        let navBtn = document.getElementById("navSearchButton");
        let proxySelect = document.getElementById("corsProxySelect");
        let queryInput = document.getElementById("searchEngineQuery");

        if (searchBtn) searchBtn.addEventListener("click", SearchEngineUI.onSearch);
        if (navBtn) navBtn.addEventListener("click", SearchEngineUI.toggleSearchSection);

        // Enter key triggers search
        if (queryInput) {
            queryInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") SearchEngineUI.onSearch();
            });
        }

        // Populate proxy dropdown
        if (proxySelect && typeof HttpClient !== "undefined") {
            proxySelect.innerHTML = "";
            for (let p of HttpClient.CORS_PROXIES) {
                let opt = document.createElement("option");
                opt.value = p.url;
                opt.textContent = p.name;
                proxySelect.appendChild(opt);
            }
            let customOpt = document.createElement("option");
            customOpt.value = "custom";
            customOpt.textContent = "Custom URL...";
            proxySelect.appendChild(customOpt);

            let proxyInput = document.getElementById("corsProxyInput");
            let enableCheckbox = document.getElementById("enableCorsProxyCheckbox");

            // Initial state
            let currentProxy = HttpClient.corsProxyUrl;
            let isKnownProxy = HttpClient.CORS_PROXIES.some(p => p.url === currentProxy);

            if (isKnownProxy) {
                proxySelect.value = currentProxy;
                if (proxyInput) proxyInput.style.display = "none";
            } else {
                proxySelect.value = "custom";
                if (proxyInput) {
                    proxyInput.style.display = "block";
                    proxyInput.value = currentProxy;
                }
            }

            if (enableCheckbox) enableCheckbox.checked = HttpClient.enableCorsProxy;

            proxySelect.addEventListener("change", () => {
                if (proxySelect.value === "custom") {
                    if (proxyInput) {
                        proxyInput.style.display = "block";
                        HttpClient.corsProxyUrl = proxyInput.value;
                    }
                } else {
                    if (proxyInput) proxyInput.style.display = "none";
                    HttpClient.corsProxyUrl = proxySelect.value;
                }
                HttpClient.enableCorsProxy = true;
                if (enableCheckbox) enableCheckbox.checked = true;
            });

            if (proxyInput) {
                proxyInput.addEventListener("input", () => {
                    if (proxySelect.value === "custom") {
                        HttpClient.corsProxyUrl = proxyInput.value;
                    }
                });
            }

            if (enableCheckbox) {
                enableCheckbox.addEventListener("change", () => {
                    HttpClient.enableCorsProxy = enableCheckbox.checked;
                });
            }
        }
    }

    static toggleSearchSection() {
        // Navigate to the standalone search page instead of just toggling sections
        window.location.href = "../index.html";
    }

    static _currentQuery = "";
    static _currentEngine = "";
    static _nextIndex = 0;
    // Guard: prevents concurrent fetchNextBatch calls which race on _displayedCount
    static _isFetching = false;

    static async onSearch() {
        let queryInput = document.getElementById("searchEngineQuery");
        let engineSelect = document.getElementById("searchEngineSelect");
        let statusSpan = document.getElementById("searchEngineStatus");
        let resultsTable = document.getElementById("searchEngineResultsTable");

        if (!queryInput || !engineSelect || !resultsTable || !queryInput.value.trim()) return;

        let rawQuery = queryInput.value.trim();

        // ── URL Detection: send directly to WebToEpub tool ─────────────
        if (SearchEngineUI.isUrl(rawQuery)) {
            let url = /^https?:\/\//i.test(rawQuery) ? rawQuery : "https://" + rawQuery;
            statusSpan.textContent = "Opening URL in WebToEpub...";
            if (document.getElementById("inputSection")) {
                // Already inside popup — just import
                SearchEngineUI.startImport(url);
            } else {
                // Standalone search page — navigate to popup with the URL
                window.location.href = "plugin/popup.html?mode=manual&url=" + encodeURIComponent(url);
            }
            return;
        }
        // ───────────────────────────────────────────────────────────────

        // Reset state
        SearchEngineUI._currentQuery = rawQuery;
        SearchEngineUI._currentEngine = engineSelect.value;
        SearchEngineUI._nextIndex = 0;
        SearchEngineUI._allResults = [];
        SearchEngineUI._displayedCount = 0;
        SearchEngineUI._renderedUrls = new Set();

        // Always enable proxy for cross-domain
        if (typeof HttpClient !== "undefined") HttpClient.enableCorsProxy = true;

        resultsTable.innerHTML = "";
        statusSpan.textContent = "Starting search...";
        console.log(`[SearchEngineUI v${SearchEngineUI.VERSION}] Starting search for: "${SearchEngineUI._currentQuery}"`);

        try {
            document.getElementById("searchEngineGoButton").disabled = true;
            await SearchEngineUI.fetchNextBatch();
        } catch (error) {
            statusSpan.textContent = "Search Error: " + error.message;
            console.error("Search error:", error);
        } finally {
            document.getElementById("searchEngineGoButton").disabled = false;
        }
    }

    static async fetchNextBatch() {
        // Prevent concurrent calls: two simultaneous fetches both increment
        // _displayedCount against the same _allResults array, pushing it ahead
        // of the array length so every future nextBatch slice is empty.
        if (SearchEngineUI._isFetching) return;
        SearchEngineUI._isFetching = true;

        let statusSpan = document.getElementById("searchEngineStatus");
        let isCustom = SearchEngineUI._currentEngine === "custom" || SearchEngineUI._currentEngine === "custom_all";

        // Max batches to auto-search when every batch returns 0 relevancy-filtered results.
        const MAX_AUTO_CONTINUE = 10;
        let autoContinueCount = 0;

        try {
            do {
                const resultsBefore = SearchEngineUI._allResults.length;

                let onProgress = isCustom ? (siteName, status) => {
                    SearchEngineUI._setProgressStatus(`Searching ${siteName}... (${status})`);
                } : null;

                let onResults = isCustom ? (newResults) => {
                    let filtered = SearchEngineUI.filterResultsByRelevancy(newResults, SearchEngineUI._currentQuery);
                    if (filtered.length > 0) {
                        SearchEngineUI.renderResults(filtered, true);
                    }
                } : null;

                let { results, nextIndex } = await SearchEngineAPI.search(
                    SearchEngineUI._currentQuery,
                    SearchEngineUI._currentEngine,
                    onProgress,
                    SearchEngineUI._nextIndex,
                    onResults
                );

                SearchEngineUI._nextIndex = nextIndex;

                if (!isCustom) {
                    let displayResults = SearchEngineUI.filterResultsByRelevancy(
                        SearchEngineUI.filterSupportedResults(results),
                        SearchEngineUI._currentQuery
                    );
                    SearchEngineUI.renderResults(displayResults, true);
                    break;
                }

                const resultsAfter = SearchEngineUI._allResults.length;
                const foundNewResults = resultsAfter > resultsBefore;

                if (foundNewResults || SearchEngineUI._nextIndex === -1) break;

                autoContinueCount++;
                SearchEngineUI._setProgressStatus(
                    `No matches yet — searching more sites... (${autoContinueCount}/${MAX_AUTO_CONTINUE})`
                );

            } while (autoContinueCount < MAX_AUTO_CONTINUE && SearchEngineUI._nextIndex !== -1);

        } finally {
            SearchEngineUI._isFetching = false;
            // Always refresh button state — runs even if an exception was thrown
            SearchEngineUI.renderResults(null, true);

            if (statusSpan) {
                if (SearchEngineUI._allResults.length === 0) {
                    statusSpan.textContent = "No results found. Try a different query or engine.";
                } else {
                    let shown = SearchEngineUI._displayedCount;
                    let total = SearchEngineUI._allResults.length;
                    let more = SearchEngineUI._nextIndex !== -1 ? " — more sites available" : "";
                    statusSpan.textContent = `Showing ${shown} of ${total} results${more}`;
                }
            }
        }
    }

    /**
     * Debounced render — prevents excessive DOM thrashing during progressive updates.
     */
    static renderResultsDebounced(results, query) {
        let now = Date.now();
        if (now - SearchEngineUI._lastRenderTime < SearchEngineUI.RENDER_DEBOUNCE_MS) {
            // Schedule a deferred render if not already scheduled
            if (!SearchEngineUI._pendingRender) {
                SearchEngineUI._pendingRender = setTimeout(() => {
                    SearchEngineUI._pendingRender = null;
                    SearchEngineUI._lastRenderTime = Date.now();
                    let filtered = SearchEngineUI.filterResultsByRelevancy(results, query);
                    SearchEngineUI.renderResults(filtered);
                }, SearchEngineUI.RENDER_DEBOUNCE_MS);
            }
            return;
        }
        SearchEngineUI._lastRenderTime = now;
        SearchEngineUI.renderResults(results);
    }

    /**
     * Filters results to only those containing all keywords of the query in their title.
     * @param {Array} results Array of result objects
     * @param {string} query The search query
     * @returns {Array} Filtered results
     */
    static filterResultsByRelevancy(results, query) {
        if (!query || !query.trim()) return results;
        let keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
        return results.filter(res => {
            let title = res.title.toLowerCase();
            return keywords.every(kw => title.includes(kw));
        });
    }

    static filterSupportedResults(results) {
        let parserMap = null;
        if (typeof parserFactory !== "undefined") parserMap = parserFactory.parsers;
        if (!parserMap) return results;

        let supported = [];
        for (let res of results) {
            let realUrl = SearchEngineUI.extractRealUrl(res.url);
            try {
                let hostName = ParserFactory.hostNameForParserSelection(realUrl);
                if (parserMap.has(hostName)) {
                    res.url = realUrl;
                    supported.push(res);
                }
            } catch (e) { /* skip */ }
        }
        return supported;
    }

    static extractRealUrl(url) {
        try {
            if (url.includes("duckduckgo.com/l/?uddg=")) {
                return decodeURIComponent(new URL(url).searchParams.get("uddg"));
            }
        } catch (e) { /* ignore */ }
        return url;
    }

    static _allResults = [];
    static _displayedCount = 0;
    static _renderedUrls = new Set();
    static RESULTS_PER_PAGE = 10;

    /**
     * Render results as modern cards using the defined search.css classes.
     * Implements pagination:
     *   - If local results are available, show them.
     *   - If not enough local results but _nextIndex exists, fetch more from source.
     */
    static renderResults(results, append = false) {
        const container = document.getElementById("searchEngineResultsTable");
        if (!container) return;

        if (!append) {
            container.innerHTML = "";
            SearchEngineUI._allResults = results || [];
            SearchEngineUI._displayedCount = 0;
            SearchEngineUI._renderedUrls = new Set();
            if (results) {
                results.forEach(r => SearchEngineUI._renderedUrls.add(typeof SiteSearchEngine !== "undefined" ? SiteSearchEngine.normalizeUrl(r.url) : r.url));
            }
        } else {
            if (results) {
                // Deduplicate incoming results against what's already rendered
                let uniqueNew = results.filter(r => {
                    let key = typeof SiteSearchEngine !== "undefined" ? SiteSearchEngine.normalizeUrl(r.url) : r.url;
                    if (SearchEngineUI._renderedUrls.has(key)) return false;
                    SearchEngineUI._renderedUrls.add(key);
                    return true;
                });
                SearchEngineUI._allResults = SearchEngineUI._allResults.concat(uniqueNew);
            }
        }

        // Batch to show now
        const nextBatch = SearchEngineUI._allResults.slice(
            SearchEngineUI._displayedCount,
            SearchEngineUI._displayedCount + SearchEngineUI.RESULTS_PER_PAGE
        );

        // Remove existing "Show More" button if it exists
        const existingShowMore = document.getElementById("showMoreResultsBtn");
        if (existingShowMore) existingShowMore.remove();

        if (nextBatch.length > 0) {
            const fragment = document.createDocumentFragment();
            for (const res of nextBatch) {
                const card = document.createElement("div");
                card.className = "searchResultItem";
                const row = document.createElement("div");
                row.className = "result-row";
                const info = document.createElement("div");
                info.className = "result-info";
                const titleWrap = document.createElement("div");
                titleWrap.className = "result-title-wrap";
                const titleLink = document.createElement("a");
                titleLink.href = res.url;
                titleLink.target = "_blank";
                titleLink.textContent = res.title;
                titleWrap.appendChild(titleLink);
                if (res.source) {
                    const badge = document.createElement("span");
                    badge.className = "source-badge";
                    badge.textContent = res.source;
                    titleWrap.appendChild(badge);
                }
                info.appendChild(titleWrap);
                const urlText = document.createElement("span");
                urlText.className = "searchResultUrl";
                urlText.textContent = res.url;
                info.appendChild(urlText);
                if (res.snippet) {
                    const snippet = document.createElement("div");
                    snippet.className = "searchResultSnippet";
                    snippet.textContent = res.snippet;
                    info.appendChild(snippet);
                }
                const action = document.createElement("div");
                action.className = "result-actions";
                const importBtn = document.createElement("button");
                importBtn.className = "import-btn";
                importBtn.textContent = "Import to WebToEpub";
                importBtn.onclick = () => {
                    if (document.getElementById("inputSection")) {
                        SearchEngineUI.startImport(res.url);
                    } else {
                        // Standalone search page (index.html), navigate to popup
                        window.location.href = "plugin/popup.html?mode=manual&url=" + encodeURIComponent(res.url);
                    }
                };
                action.appendChild(importBtn);
                row.appendChild(info);
                row.appendChild(action);
                card.appendChild(row);
                fragment.appendChild(card);
            }
            SearchEngineUI._displayedCount += nextBatch.length;
            container.appendChild(fragment);
        }

        // Decide if we show the "Show More" button
        // NOTE: do NOT snapshot hasMoreLocal/hasMoreRemote into closure variables here.
        // They must be re-evaluated at click time because state changes between
        // render and click (e.g. onResults fires more batches in the background).
        const hasMoreLocal = SearchEngineUI._displayedCount < SearchEngineUI._allResults.length;
        const hasMoreRemote = SearchEngineUI._nextIndex !== -1;

        if (hasMoreLocal || hasMoreRemote) {
            const showMoreBtn = document.createElement("button");
            showMoreBtn.id = "showMoreResultsBtn";
            showMoreBtn.className = "show-more-btn";
            showMoreBtn.textContent = hasMoreLocal ? "Show More" : "Search More Sites...";
            showMoreBtn.onclick = async () => {
                // Block concurrent fetches — prevents _displayedCount racing ahead of _allResults
                if (SearchEngineUI._isFetching) return;
                showMoreBtn.disabled = true;
                showMoreBtn.textContent = "Loading...";
                try {
                    if (SearchEngineUI._displayedCount < SearchEngineUI._allResults.length) {
                        // Buffered results exist — page them in immediately (no network needed)
                        SearchEngineUI.renderResults(null, true);
                    } else if (SearchEngineUI._nextIndex !== -1) {
                        // All buffered results shown — fetch next batch from more sites
                        await SearchEngineUI.fetchNextBatch();
                    }
                } catch (err) {
                    // Ensure the button is always recoverable even if fetchNextBatch throws
                    console.error("[SearchEngineUI] Load more failed:", err);
                    const statusSpan = document.getElementById("searchEngineStatus");
                    if (statusSpan) statusSpan.textContent = "Error loading more: " + err.message;
                    // Re-render to restore the button so the user can retry
                    SearchEngineUI.renderResults(null, true);
                }
            };
            container.appendChild(showMoreBtn);
        }
    }

    static startImport(url) {
        document.getElementById("searchEngineSection").hidden = true;
        document.getElementById("inputSection").hidden = false;
        let startInput = document.getElementById("startingUrlInput");
        if (startInput) {
            startInput.value = url;
            let loadBtn = document.getElementById("loadAndAnalyseButton");
            if (loadBtn) loadBtn.click();
        }
    }
}
