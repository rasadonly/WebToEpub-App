"use strict";

/**
 * SearchEngineAPI — thin adapter between UI and search backends.
 * Supports custom site search (SiteSearchEngine) and traditional engines (DDG, Bing, Google, Yandex).
 */
class SearchEngineAPI {
    static async search(query, engine, onProgress, onResults) {
        if (engine === "custom") {
            return await SiteSearchEngine.search(query.trim(), onProgress, false, onResults);
        }
        if (engine === "custom_all") {
            return await SiteSearchEngine.search(query.trim(), onProgress, true, onResults);
        }
        let searchQuery = query.trim() + " novel chapter";
        switch (engine) {
            case "duckduckgo": return await SearchEngineAPI.searchDuckDuckGo(searchQuery);
            case "bing": return await SearchEngineAPI.searchBing(searchQuery);
            case "google": return await SearchEngineAPI.searchGoogle(searchQuery);
            case "yandex": return await SearchEngineAPI.searchYandex(searchQuery);
            default: throw new Error("Unknown search engine: " + engine);
        }
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
            proxySelect.value = HttpClient.corsProxyUrl;
            proxySelect.addEventListener("change", () => {
                HttpClient.corsProxyUrl = proxySelect.value;
                HttpClient.enableCorsProxy = true;
            });
        }
    }

    static toggleSearchSection() {
        let sections = ["inputSection", "advancedOptionsSection", "hiddenBibSection", "testSection", "imageSection", "outputSection", "readingListSection", "defaultParserSection"];
        for (let id of sections) {
            let el = document.getElementById(id);
            if (el) el.hidden = true;
        }
        let searchSec = document.getElementById("searchEngineSection");
        if (searchSec) searchSec.hidden = false;
    }

    static async onSearch() {
        let queryInput = document.getElementById("searchEngineQuery");
        let engineSelect = document.getElementById("searchEngineSelect");
        let statusSpan = document.getElementById("searchEngineStatus");
        let resultsTable = document.getElementById("searchEngineResultsTable");

        if (!queryInput || !engineSelect || !resultsTable || !queryInput.value.trim()) return;

        // Always enable proxy for cross-domain
        if (typeof HttpClient !== "undefined") HttpClient.enableCorsProxy = true;

        let query = queryInput.value.trim();
        let engine = engineSelect.value;
        let isCustom = engine === "custom" || engine === "custom_all";

        resultsTable.innerHTML = "";
        statusSpan.textContent = isCustom ? "Searching supported novel sites..." : "Searching through CORS proxy...";

        try {
            document.getElementById("searchEngineGoButton").disabled = true;

            let onProgress = isCustom ? (siteName, status) => {
                statusSpan.textContent = `Searching ${siteName}... (${status})`;
            } : null;

            // Progressive rendering with debounce
            let onResults = isCustom ? (resultsSoFar, completed, total) => {
                SearchEngineUI.renderResultsDebounced(resultsSoFar);
                statusSpan.textContent = `Searching... ${completed}/${total} sites done, ${resultsSoFar.length} results`;
            } : null;

            let results = await SearchEngineAPI.search(query, engine, onProgress, onResults);

            // For non-custom engines, auto-fallback if no results
            let displayResults;
            if (isCustom) {
                displayResults = results;
            } else {
                if (results.length === 0) {
                    let alts = ["duckduckgo", "bing", "google", "yandex"].filter(e => e !== engine);
                    for (let alt of alts) {
                        statusSpan.textContent = `No results from ${engine}. Trying ${alt}...`;
                        results = await SearchEngineAPI.search(query, alt, null, null);
                        if (results.length > 0) { engine = alt; break; }
                    }
                }
                displayResults = SearchEngineUI.filterSupportedResults(results);
            }

            // Final render (always do a full render at the end)
            SearchEngineUI.renderResults(displayResults);

            if (results.length === 0) {
                statusSpan.textContent = isCustom
                    ? "No results found. Try a different search term."
                    : "No results from any engine. Try Custom search.";
            } else if (displayResults.length === 0) {
                statusSpan.textContent = `Found ${results.length} results, but none from supported novel sites.`;
            } else {
                statusSpan.textContent = `Found ${displayResults.length} results` +
                    (isCustom ? " from supported novel sites." : ` using ${engine}.`);
            }
        } catch (error) {
            statusSpan.textContent = "Search Error: " + error.message;
            console.error("Search error:", error);
        } finally {
            document.getElementById("searchEngineGoButton").disabled = false;
        }
    }

    /**
     * Debounced render — prevents excessive DOM thrashing during progressive updates.
     */
    static renderResultsDebounced(results) {
        let now = Date.now();
        if (now - SearchEngineUI._lastRenderTime < SearchEngineUI.RENDER_DEBOUNCE_MS) {
            // Schedule a deferred render if not already scheduled
            if (!SearchEngineUI._pendingRender) {
                SearchEngineUI._pendingRender = setTimeout(() => {
                    SearchEngineUI._pendingRender = null;
                    SearchEngineUI._lastRenderTime = Date.now();
                    SearchEngineUI.renderResults(results);
                }, SearchEngineUI.RENDER_DEBOUNCE_MS);
            }
            return;
        }
        SearchEngineUI._lastRenderTime = now;
        SearchEngineUI.renderResults(results);
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

    /**
     * Render results using DocumentFragment for efficient batch DOM insertion.
     */
    static renderResults(results) {
        let table = document.getElementById("searchEngineResultsTable");
        table.innerHTML = "";
        if (results.length === 0) return;

        let fragment = document.createDocumentFragment();

        // Header
        let headerTr = document.createElement("tr");
        headerTr.innerHTML = "<th>Web Novel</th><th>Action</th>";
        fragment.appendChild(headerTr);

        for (let res of results) {
            let tr = document.createElement("tr");
            tr.className = "searchResultItem";

            // Info cell
            let infoTd = document.createElement("td");

            let titleLink = document.createElement("a");
            titleLink.href = res.url;
            titleLink.target = "_blank";
            titleLink.textContent = res.title;
            titleLink.style.fontWeight = "bold";
            titleLink.style.fontSize = "1.1em";
            infoTd.appendChild(titleLink);

            // Source badge (outside the link for better accessibility)
            if (res.source) {
                let badge = document.createElement("span");
                badge.textContent = res.source;
                badge.className = "source-badge";
                badge.style.cssText = "display:inline-block;background:#a78bfa;color:#fff;padding:1px 6px;border-radius:3px;font-size:0.7em;margin-left:8px;vertical-align:middle;";
                infoTd.appendChild(badge);
            }

            let urlDiv = document.createElement("div");
            urlDiv.textContent = res.url;
            urlDiv.style.cssText = "color:#777;font-size:0.8em;margin:2px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px;";
            infoTd.appendChild(urlDiv);

            if (res.snippet) {
                let snipDiv = document.createElement("div");
                snipDiv.textContent = res.snippet;
                snipDiv.style.cssText = "color:#999;font-size:0.85em;";
                infoTd.appendChild(snipDiv);
            }

            tr.appendChild(infoTd);

            // Action cell
            let actionTd = document.createElement("td");
            actionTd.style.cssText = "vertical-align:middle;text-align:center;";
            let btn = document.createElement("button");
            btn.className = "expandedButton";
            btn.textContent = "Import to WebToEpub";
            btn.onclick = () => SearchEngineUI.startImport(res.url);
            actionTd.appendChild(btn);
            tr.appendChild(actionTd);

            fragment.appendChild(tr);
        }

        table.appendChild(fragment);
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
