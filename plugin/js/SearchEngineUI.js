"use strict";

/**
 * SearchEngineAPI — thin adapter between UI and search backends.
 * Supports custom site search (SiteSearchEngine) and traditional engines (DDG, Bing, Google, Yandex).
 */
class SearchEngineAPI {
    static async search(query, engine, onProgress, startIndex = 0) {
        if (engine === "custom") {
            return await SiteSearchEngine.search(query.trim(), startIndex, 10, false, onProgress);
        }
        if (engine === "custom_all") {
            return await SiteSearchEngine.search(query.trim(), startIndex, 10, true, onProgress);
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
    static VERSION = "1.1.0"; // Cache-buster version


    /** Minimum time between progressive re-renders (ms) */
    static RENDER_DEBOUNCE_MS = 300;
    static _lastRenderTime = 0;
    static _pendingRender = null;

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

    static async onSearch() {
        let queryInput = document.getElementById("searchEngineQuery");
        let engineSelect = document.getElementById("searchEngineSelect");
        let statusSpan = document.getElementById("searchEngineStatus");
        let resultsTable = document.getElementById("searchEngineResultsTable");

        if (!queryInput || !engineSelect || !resultsTable || !queryInput.value.trim()) return;

        // Reset state
        SearchEngineUI._currentQuery = queryInput.value.trim();
        SearchEngineUI._currentEngine = engineSelect.value;
        SearchEngineUI._nextIndex = 0;
        SearchEngineUI._allResults = [];
        SearchEngineUI._displayedCount = 0;

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
        let statusSpan = document.getElementById("searchEngineStatus");
        let isCustom = SearchEngineUI._currentEngine === "custom" || SearchEngineUI._currentEngine === "custom_all";

        let onProgress = isCustom ? (siteName, status) => {
            statusSpan.textContent = `Searching ${siteName}... (${status})`;
        } : null;

        let { results, nextIndex } = await SearchEngineAPI.search(
            SearchEngineUI._currentQuery,
            SearchEngineUI._currentEngine,
            onProgress,
            SearchEngineUI._nextIndex
        );

        SearchEngineUI._nextIndex = nextIndex;

        let displayResults;
        if (isCustom) {
            displayResults = SearchEngineUI.filterResultsByRelevancy(results, SearchEngineUI._currentQuery);
        } else {
            // For non-custom engines, auto-fallback if no results
            if (results.length === 0 && SearchEngineUI._nextIndex === 0) { // Only try fallback on first batch
                let alts = ["duckduckgo", "bing", "google", "yandex"].filter(e => e !== SearchEngineUI._currentEngine);
                for (let alt of alts) {
                    statusSpan.textContent = `No results from ${SearchEngineUI._currentEngine}. Trying ${alt}...`;
                    let fallbackResult = await SearchEngineAPI.search(SearchEngineUI._currentQuery, alt, null, 0);
                    if (fallbackResult.results.length > 0) {
                        SearchEngineUI._currentEngine = alt;
                        results = fallbackResult.results;
                        SearchEngineUI._nextIndex = fallbackResult.nextIndex;
                        break;
                    }
                }
            }
            displayResults = SearchEngineUI.filterResultsByRelevancy(SearchEngineUI.filterSupportedResults(results), SearchEngineUI._currentQuery);
        }

        SearchEngineUI.renderResults(displayResults, true);

        if (SearchEngineUI._allResults.length === 0) {
            statusSpan.textContent = "No results found.";
        } else {
            statusSpan.textContent = `Showing ${SearchEngineUI._allResults.length} results.`;
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
        } else {
            if (results) SearchEngineUI._allResults = SearchEngineUI._allResults.concat(results);
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
        const hasMoreLocal = SearchEngineUI._displayedCount < SearchEngineUI._allResults.length;
        const hasMoreRemote = SearchEngineUI._nextIndex !== -1;

        if (hasMoreLocal || hasMoreRemote) {
            const showMoreBtn = document.createElement("button");
            showMoreBtn.id = "showMoreResultsBtn";
            showMoreBtn.className = "show-more-btn";
            showMoreBtn.textContent = hasMoreLocal ? "Show More" : "Search More Sites...";
            showMoreBtn.onclick = () => {
                showMoreBtn.disabled = true;
                showMoreBtn.textContent = "Loading...";
                if (hasMoreLocal) {
                    SearchEngineUI.renderResults(null, true);
                } else {
                    SearchEngineUI.fetchNextBatch();
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
