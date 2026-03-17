"use strict";

class SearchEngineAPI {
    static async search(query, engine) {
        // Appending 'novel' or 'chapter' helps hone in on the right results when using general search engines
        let searchQuery = query.trim() + " novel chapter";

        switch (engine) {
            case "duckduckgo": return await SearchEngineAPI.searchDuckDuckGo(searchQuery);
            case "bing": return await SearchEngineAPI.searchBing(searchQuery);
            case "google": return await SearchEngineAPI.searchGoogle(searchQuery);
            case "yandex": return await SearchEngineAPI.searchYandex(searchQuery);
            default: throw new Error("Unknown search engine");
        }
    }

    static async searchDuckDuckGo(query) {
        let url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
        let dom = await SearchEngineAPI.fetchDom(url);
        let results = [];
        let resultNodes = dom.querySelectorAll(".result__body");

        for (let node of resultNodes) {
            let a = node.querySelector(".result__title a");
            let snippet = node.querySelector(".result__snippet");
            if (a) {
                results.push({
                    title: a.textContent.trim(),
                    url: a.href,
                    snippet: snippet ? snippet.textContent.trim() : ""
                });
            }
        }
        return results;
    }

    static async searchBing(query) {
        let url = "https://www.bing.com/search?q=" + encodeURIComponent(query);
        let dom = await SearchEngineAPI.fetchDom(url);
        let results = [];
        let resultNodes = dom.querySelectorAll(".b_algo");

        for (let node of resultNodes) {
            let a = node.querySelector("h2 a");
            let snippet = node.querySelector(".b_caption p") || node.querySelector(".b_algoSlug");
            if (a) {
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
        let url = "https://www.google.com/search?q=" + encodeURIComponent(query);
        let dom = await SearchEngineAPI.fetchDom(url);
        let results = [];
        let resultNodes = dom.querySelectorAll("div.g");

        for (let node of resultNodes) {
            let a = node.querySelector("a");
            let titleNode = node.querySelector("h3");
            let snippetNodes = node.querySelectorAll("div[style*='-webkit-line-clamp']"); // Simple heuristic for modern google snippets

            if (a && titleNode) {
                let snippetText = "";
                if (snippetNodes.length > 0) {
                    snippetText = snippetNodes[snippetNodes.length - 1].textContent.trim();
                } else {
                    let textDiv = node.querySelector("div[data-sncf]");
                    if (textDiv) snippetText = textDiv.textContent.trim();
                }

                results.push({
                    title: titleNode.textContent.trim(),
                    url: a.href,
                    snippet: snippetText
                });
            }
        }
        return results;
    }

    static async searchYandex(query) {
        let url = "https://yandex.com/search/?text=" + encodeURIComponent(query);
        let dom = await SearchEngineAPI.fetchDom(url);
        let results = [];
        let resultNodes = dom.querySelectorAll("li.serp-item");

        for (let node of resultNodes) {
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
        return response.responseXML;
    }
}

class SearchEngineUI {
    static init() {
        SearchEngineUI.bindEvents();
    }

    static bindEvents() {
        const searchBtn = document.getElementById("searchEngineGoButton");
        const navBtn = document.getElementById("navSearchButton");

        if (searchBtn) {
            searchBtn.addEventListener("click", SearchEngineUI.onSearch);
        }

        if (navBtn) {
            navBtn.addEventListener("click", SearchEngineUI.toggleSearchSection);
        }
    }

    static toggleSearchSection() {
        let sections = ["inputSection", "advancedOptionsSection", "hiddenBibSection", "testSection", "imageSection", "outputSection", "readingListSection", "defaultParserSection"];
        for (let secId of sections) {
            let el = document.getElementById(secId);
            if (el) el.hidden = true;
        }

        let searchSec = document.getElementById("searchEngineSection");
        if (searchSec) {
            searchSec.hidden = false;
        }
    }

    static async onSearch() {
        const queryInput = document.getElementById("searchEngineQuery");
        const engineSelect = document.getElementById("searchEngineSelect");
        const statusSpan = document.getElementById("searchEngineStatus");
        const resultsTable = document.getElementById("searchEngineResultsTable");

        if (!queryInput || !engineSelect || !resultsTable || !queryInput.value.trim()) {
            return;
        }

        let query = queryInput.value.trim();
        let engine = engineSelect.value;
        statusSpan.textContent = "Searching through CORS proxy...";
        resultsTable.innerHTML = ""; // Clear old results

        try {
            document.getElementById("searchEngineGoButton").disabled = true;
            let results = await SearchEngineAPI.search(query, engine);
            let filteredResults = SearchEngineUI.filterSupportedResults(results);
            SearchEngineUI.renderResults(filteredResults);

            if (filteredResults.length === 0) {
                statusSpan.textContent = `No supported parsers found in top ${results.length} results.`;
            } else {
                statusSpan.textContent = `Found ${filteredResults.length} supported novel sites.`;
            }
        } catch (error) {
            statusSpan.textContent = "Search Error: " + error.message;
            console.error("Search fetch error", error);
        } finally {
            document.getElementById("searchEngineGoButton").disabled = false;
        }
    }

    static filterSupportedResults(results) {
        let supported = [];
        let parserMap = null;
        if (typeof parserFactory !== 'undefined') {
            parserMap = parserFactory.parsers;
        }

        if (!parserMap) return results; // fallback

        for (let res of results) {
            // Unproxy URL in case DDG/Google prepends wrappers
            let realUrl = SearchEngineUI.extractRealUrl(res.url);
            let hostName = "unknown";
            try {
                hostName = ParserFactory.hostNameForParserSelection(realUrl);
            } catch (e) { }

            if (parserMap.has(hostName)) {
                res.url = realUrl; // normalized
                supported.push(res);
            }
        }
        return supported;
    }

    // Some search engines add tracking wrappers to their URL results
    static extractRealUrl(url) {
        try {
            if (url.includes("duckduckgo.com/l/?uddg=")) {
                let u = new URL(url);
                return decodeURIComponent(u.searchParams.get("uddg"));
            }
        } catch (e) { }
        return url;
    }

    static renderResults(results) {
        const table = document.getElementById("searchEngineResultsTable");
        table.innerHTML = "";

        if (results.length === 0) {
            return;
        }

        let headerTr = document.createElement("tr");
        headerTr.innerHTML = "<th>Web Novel</th><th>Action</th>";
        table.appendChild(headerTr);

        for (let res of results) {
            let tr = document.createElement("tr");
            tr.className = "searchResultItem";

            let infoTd = document.createElement("td");
            let titleLink = document.createElement("a");
            titleLink.href = res.url;
            titleLink.target = "_blank";
            titleLink.textContent = res.title;
            titleLink.style.fontWeight = "bold";
            titleLink.style.fontSize = "1.1em";

            let urlDiv = document.createElement("div");
            urlDiv.className = "searchResultUrl";
            urlDiv.textContent = res.url;
            urlDiv.style.color = "#777";
            urlDiv.style.fontSize = "0.8em";
            urlDiv.style.marginBottom = "5px";

            let snipDiv = document.createElement("div");
            snipDiv.className = "searchResultSnippet";
            snipDiv.textContent = res.snippet;

            infoTd.appendChild(titleLink);
            infoTd.appendChild(urlDiv);
            infoTd.appendChild(snipDiv);
            tr.appendChild(infoTd);

            let actionTd = document.createElement("td");
            actionTd.style.verticalAlign = "middle";
            actionTd.style.textAlign = "center";

            let btn = document.createElement("button");
            btn.className = "expandedButton";
            btn.textContent = "Import to WebToEpub";
            btn.onclick = () => { SearchEngineUI.startImport(res.url); };
            actionTd.appendChild(btn);

            tr.appendChild(actionTd);
            table.appendChild(tr);
        }
    }

    static startImport(url) {
        document.getElementById("searchEngineSection").hidden = true;
        document.getElementById("inputSection").hidden = false;

        let startInput = document.getElementById("startingUrlInput");
        if (startInput) {
            startInput.value = url;
            // trigger auto load
            let loadBtn = document.getElementById("loadAndAnalyseButton");
            if (loadBtn) {
                loadBtn.click();
            }
        }
    }
}
