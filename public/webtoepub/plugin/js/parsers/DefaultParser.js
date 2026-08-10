/*
  Parser used when can't match a parser for the document
*/
"use strict";

parserFactory.registerManualSelect(
    "Default", 
    () => new DefaultParser()
);

class DefaultParser extends Parser {
    constructor() {
        super();
        this.siteConfigs = new DefaultParserSiteSettings();
        this.logic = null;
    }

    _getChaptersFromPage(dom, config, isFirstPage) {
        let testUrl = config ? config.testUrl : null;
        let allLinks = Array.from(dom.body.getElementsByTagName("a"));

        if (isFirstPage && util.isNullOrEmpty(testUrl)) {
            let getScore = (text) => {
                let s = 0;
                text = (text || "").trim().toLowerCase();
                if (/\b(chapter|ch|chap|vol|volume)\b/i.test(text)) s += 10;
                if (/\d+/.test(text)) s += 5;
                if (/\b(read|now|online|start|first|begin)\b/i.test(text)) s -= 10;
                return s;
            };

            for (let i = 0; i < allLinks.length; i++) {
                if (getScore(allLinks[i].innerText || allLinks[i].textContent) >= 10) {
                    let validBlock = false;
                    for (let j = 1; j <= 5 && (i + j) < allLinks.length; j++) {
                        if (getScore(allLinks[i + j].innerText || allLinks[i + j].textContent) >= 5) {
                            let pUrl = null, cUrl = null;
                            try {
                                pUrl = new URL(allLinks[i].href);
                                cUrl = new URL(allLinks[i + j].href);
                            } catch (e) {}

                            if (pUrl && cUrl && pUrl.hostname === cUrl.hostname && pUrl.pathname.length > 5) {
                                let pDir = pUrl.pathname.substring(0, pUrl.pathname.lastIndexOf('/'));
                                let cDir = cUrl.pathname.substring(0, cUrl.pathname.lastIndexOf('/'));
                                let pBase = pUrl.pathname.replace(/\d+/g, '');
                                let cBase = cUrl.pathname.replace(/\d+/g, '');

                                if ((pDir === cDir && pDir.length > 1) || (pBase === cBase && pBase.length > 10)) {
                                    validBlock = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (validBlock) {
                        testUrl = allLinks[i].href;
                        if (config) config.testUrl = testUrl;
                        break;
                    }
                }
            }
        }

        if (util.isNullOrEmpty(testUrl)) {
            return util.hyperlinksToChapterList(dom.body);
        }

        let host = "";
        let prefixPath = "";
        try {
            let parsedTestUrl = new URL(testUrl);
            host = parsedTestUrl.hostname;
            let pathParts = parsedTestUrl.pathname.split("/").filter(p => p !== "");
            if (pathParts.length >= 2) {
                prefixPath = "/" + pathParts.slice(0, 2).join("/");
            }
        } catch (e) {
            // fallback
        }

        let firstChapterLinkIndex = -1;
        if (isFirstPage) {
            let targetUrl = util.normalizeUrlForCompare(testUrl);
            let matchIndices = [];
            for (let i = 0; i < allLinks.length; i++) {
                if (util.normalizeUrlForCompare(allLinks[i].href) === targetUrl) {
                    matchIndices.push(i);
                }
            }

            if (matchIndices.length > 0) {
                let bestIndex = matchIndices[0];
                let bestScore = -999;
                for (let idx of matchIndices) {
                    let text = allLinks[idx].innerText || allLinks[idx].textContent || "";
                    text = text.trim().toLowerCase();
                    let score = 0;
                    if (/\b(chapter|ch|chap|vol|volume)\b/i.test(text)) score += 10;
                    if (/\d+/.test(text)) score += 5;
                    if (/\b(read|now|online|start|first|begin)\b/i.test(text)) score -= 10;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = idx;
                    } else if (score === bestScore) {
                        bestIndex = idx;
                    }
                }
                firstChapterLinkIndex = bestIndex;
            }
        }

        let filteredLinks = allLinks;
        if (isFirstPage && firstChapterLinkIndex >= 0) {
            filteredLinks = allLinks.slice(firstChapterLinkIndex);
        }

        let finalLinks = filteredLinks.filter(link => {
            try {
                let u = new URL(link.href, dom.baseURI);
                if (host && u.hostname !== host) return false;
                if (prefixPath && !u.pathname.startsWith(prefixPath)) return false;

                // Filter out links pointing back to TOC URL itself
                let normLink = util.normalizeUrlForCompare(link.href);
                let normToc = util.normalizeUrlForCompare(dom.baseURI);
                if (normLink === normToc) return false;

                return true;
            } catch (e) {
                return false;
            }
        });

        let tempDiv = dom.createElement("div");
        for (let link of finalLinks) {
            tempDiv.appendChild(link.cloneNode(true));
        }

        return util.hyperlinksToChapterList(tempDiv);
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let hostName = util.extractHostName(dom.baseURI);
        let config = this.siteConfigs.getConfigForSite(hostName) || {};
        let chapters = this._getChaptersFromPage(dom, config, true);
        let logic = this.siteConfigs.constructFindContentLogicForSite(hostName);

        let findNextPageUrl = logic.findNextPageUrl;
        if (!findNextPageUrl) {
            findNextPageUrl = (doc, currentUrl) => {
                let allLinks = Array.from(doc.getElementsByTagName("a"));
                let nextLink = allLinks.find(a => {
                    let text = (a.innerText || a.textContent || "").trim().toLowerCase();
                    return /^next( page)?\s*(›|»|>|&gt;)?$|^(›|»|>|&gt;)$/i.test(text);
                });
                if (nextLink && nextLink.href) {
                    try {
                        let u = new URL(nextLink.href, currentUrl);
                        if (u.href !== currentUrl) return u.href;
                    } catch(e) {}
                }
                return null;
            };
        }

        let maxPages = 100; // Limit to 100 pages to avoid infinite loops
        let pageCount = 1;
        let currentUrl = dom.baseURI;
        let currentDom = dom;
        let pageUrlSets = [];

        while (currentDom != null && pageCount <= maxPages) {
            let pageChapters = this._getChaptersFromPage(currentDom, config, pageCount === 1);
            let pageUrls = new Set(pageChapters.map(c => c.sourceUrl));
            pageUrlSets.push(pageUrls);

            // Add chapters from current page (skip first page as it's already added)
            if (pageCount > 1) {
                chapters = chapters.concat(pageChapters);
            }

            if (chapterUrlsUI) {
                chapterUrlsUI.showTocProgress(chapters);
            }

            let nextUrl = findNextPageUrl(currentDom, currentUrl);
            if (!nextUrl || nextUrl === currentUrl) {
                break;
            }

            await this.rateLimitDelay();
            currentUrl = nextUrl;
            try {
                let xhr = await HttpClient.wrapFetch(currentUrl);
                currentDom = xhr.responseXML;
                if (!currentDom) {
                    let html = xhr.responseText || "";
                    if (html) {
                        currentDom = new DOMParser().parseFromString(html, "text/html");
                    } else {
                        break;
                    }
                }
            } catch (e) {
                console.warn("[DefaultParser] Failed to fetch next TOC page:", e);
                break;
            }
            pageCount++;
        }

        // Filter out common links (appearing on >1 page)
        if (pageCount > 1) {
            let commonUrls = new Set();
            for (let url of chapters.map(c => c.sourceUrl)) {
                let appearanceCount = 0;
                for (let pageSet of pageUrlSets) {
                    if (pageSet.has(url)) appearanceCount++;
                }
                if (appearanceCount > 1) commonUrls.add(url);
            }
            chapters = chapters.filter(ch => !commonUrls.has(ch.sourceUrl));
        }

        return chapters;
    }

    static _looksEmpty(content) {
        return content == null || (content.textContent || "").trim().length < 30;
    }

    /**
     * Fetch the chapter, and if the configured (or heuristic) selectors find no
     * usable text, ask the AI for selectors for this host BEFORE findContent()
     * runs — findContent() itself is synchronous, so the async work has to
     * happen here. Selectors are saved per host, so only the first failing
     * chapter pays the AI round-trip.
     */
    async fetchChapter(url) {
        let dom = await super.fetchChapter(url);
        try {
            let hostName = util.extractHostName(dom.baseURI || url);
            let logic = this.siteConfigs.constructFindContentLogicForSite(hostName);
            if (DefaultParser._looksEmpty(logic.findContent(dom)) && typeof AiClient !== "undefined") {
                await this.autoConfigureWithAi(hostName, dom, url);
            }
        } catch (e) {
            console.warn("[DefaultParser] AI auto-config skipped:", e);
        }
        return dom;
    }

    /** One AI selector lookup per host, shared between concurrent chapters. */
    async autoConfigureWithAi(hostName, dom, url) {
        let pending = DefaultParser._aiCache.get(hostName);
        if (!pending) {
            let html = dom.documentElement ? dom.documentElement.outerHTML : "";
            pending = AiClient.fetchAiSelectors(html, dom.baseURI || url)
                .then((sel) => {
                    if (sel && sel.content) {
                        this.siteConfigs.saveSiteConfig(
                            hostName,
                            sel.content,
                            sel.title || "",
                            sel.remove || "",
                            dom.baseURI || url,
                            ""
                        );
                        console.log("[DefaultParser] AI auto-config saved for", hostName, sel);
                    }
                    return sel;
                })
                .catch((e) => {
                    console.warn("[DefaultParser] AI selector lookup failed:", e);
                    return null;
                });
            DefaultParser._aiCache.set(hostName, pending);
        }
        return pending;
    }

    findContent(dom) {
        let hostName = util.extractHostName(dom.baseURI);
        this.logic = this.siteConfigs.constructFindContentLogicForSite(hostName);
        let content = this.logic.findContent(dom);
        if (DefaultParser._looksEmpty(content)) {
            // AI config may have landed after this parser instance cached logic.
            let fresh = this.siteConfigs.constructFindContentLogicForSite(hostName);
            let retry = fresh.findContent(dom);
            if (!DefaultParser._looksEmpty(retry)) {
                this.logic = fresh;
                return retry;
            }
            // Final heuristic: densest non-navigational text block on the page.
            let dense = DefaultParser.findContentByDensity(dom);
            if (dense != null) {
                return dense;
            }
        }
        return content;
    }

    /** Pick the element with the most paragraph text and fewest links. */
    static findContentByDensity(dom) {
        let best = null;
        let bestScore = 0;
        for (let el of dom.querySelectorAll("div, article, section, main, td")) {
            let text = (el.textContent || "").trim();
            if (text.length < 400) continue;
            let links = el.querySelectorAll("a");
            let linkLen = 0;
            for (let a of links) linkLen += (a.textContent || "").length;
            let score = text.length * (1 - Math.min(linkLen / text.length, 0.9))
                + el.querySelectorAll("p, br").length * 40
                - links.length * 20;
            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }
        return best;
    }


    populateUI(dom) {
        super.populateUI(dom);
        let hostname = util.extractHostName(dom.baseURI);
        DefaultParserUI.setupDefaultParserUI(hostname, this);
    }

    // override default (keep nearly everything, may be wanted)
    removeUnwantedElementsFromContentElement(element) {
        util.removeElements(element.querySelectorAll("script[src], iframe"));
        util.removeComments(element);
        util.removeUnwantedWordpressElements(element);
        util.removeMicrosoftWordCrapElements(element);
        this.logic.removeUnwanted(element);
    }

    findChapterTitle(dom) {
        return this.logic.findChapterTitle(dom);
    }
}
