"use strict";

/**
 * SiteSearchEngine - Custom search engine that queries novel sites directly.
 * 
 * Optimizations:
 *   - Races all proxies simultaneously (Promise.any) instead of sequential fallback
 *   - Strips <script>/<link>/<style> tags from proxied HTML to prevent resource loading
 *   - Caches site config arrays (no re-creation per call)
 *   - 6-second per-proxy timeout via AbortController
 *   - Caps results per site to 20 to prevent UI flooding
 *   - Progressive rendering via onResults callback
 */
class SiteSearchEngine {

    /** Max results to keep per individual site */
    static MAX_RESULTS_PER_SITE = 20;

    /** Timeout per proxy attempt in ms */
    static PROXY_TIMEOUT_MS = 6000;

    // ─── Site Configurations (cached) ────────────────────────────────────

    static _primarySites = null;
    static _secondarySites = null;

    static get PRIMARY_SITES() {
        if (!SiteSearchEngine._primarySites) {
            SiteSearchEngine._primarySites = SiteSearchEngine._buildPrimarySites();
        }
        return SiteSearchEngine._primarySites;
    }

    static get SECONDARY_SITES() {
        if (!SiteSearchEngine._secondarySites) {
            SiteSearchEngine._secondarySites = SiteSearchEngine._buildSecondarySites();
        }
        return SiteSearchEngine._secondarySites;
    }

    static _buildPrimarySites() {
        return [
            {
                name: "NovelFull",
                hostname: "novelfull.com",
                searchUrl: (q) => `https://novelfull.com/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".list-truyen .row");
                    if (items.length === 0) items = dom.querySelectorAll(".archive .list-truyen-item-wrap");
                    for (let item of items) {
                        let a = item.querySelector(".truyen-title a") || item.querySelector("h3 a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".text-primary") || item.querySelector(".author");
                            results.push({
                                title: a.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://novelfull.com", a.getAttribute("href")),
                                snippet: snippet ? snippet.textContent.trim() : "",
                                source: "NovelFull"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "RoyalRoad",
                hostname: "royalroad.com",
                searchUrl: (q) => `https://www.royalroad.com/fictions/search?title=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".fiction-list-item");
                    for (let item of items) {
                        let a = item.querySelector("h2.fiction-title a") || item.querySelector("a.font-red-sunglo") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".margin-bottom-10 p") || item.querySelector(".hidden-content");
                            results.push({
                                title: a.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://www.royalroad.com", a.getAttribute("href")),
                                snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                                source: "RoyalRoad"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "FreeWebNovel",
                hostname: "freewebnovel.com",
                searchUrl: (q) => `https://freewebnovel.com/search/?searchkey=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".li-row");
                    if (items.length === 0) items = dom.querySelectorAll(".col-content .li");
                    for (let item of items) {
                        let a = item.querySelector("h3.tit a") || item.querySelector(".tit a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".txt") || item.querySelector("p");
                            results.push({
                                title: a.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://freewebnovel.com", a.getAttribute("href")),
                                snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                                source: "FreeWebNovel"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "NovelHall",
                hostname: "novelhall.com",
                searchUrl: (q) => `https://www.novelhall.com/index.php?s=list&search=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".book-img-text ul li");
                    if (items.length === 0) items = dom.querySelectorAll(".section2 ul li");
                    for (let item of items) {
                        let a = item.querySelector("h3 a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".intro") || item.querySelector("p");
                            results.push({
                                title: a.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://www.novelhall.com", a.getAttribute("href")),
                                snippet: snippet ? snippet.textContent.trim() : "",
                                source: "NovelHall"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "NovelFire",
                hostname: "novelfire.net",
                searchUrl: (q) => `https://novelfire.net/ajax/searchLive?inputContent=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-item");
                    if (items.length === 0) items = dom.querySelectorAll("li");
                    for (let item of items) {
                        let a = item.querySelector("a");
                        if (a && a.href) {
                            let titleEl = item.querySelector(".novel-title") || item.querySelector("h3") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://novelfire.net", a.getAttribute("href")),
                                snippet: "",
                                source: "NovelFire"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "ScribbleHub",
                hostname: "scribblehub.com",
                searchUrl: (q) => `https://www.scribblehub.com/?s=${encodeURIComponent(q)}&post_type=fictionposts`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".search_main_box");
                    if (items.length === 0) items = dom.querySelectorAll(".search_body .search_row");
                    for (let item of items) {
                        let a = item.querySelector(".search_title a") || item.querySelector("a");
                        if (a && a.href) {
                            let snippet = item.querySelector(".search_genre") || item.querySelector(".fdi");
                            results.push({
                                title: a.textContent.trim(),
                                url: a.href,
                                snippet: snippet ? snippet.textContent.trim() : "",
                                source: "ScribbleHub"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "Archive of Our Own",
                hostname: "archiveofourown.org",
                searchUrl: (q) => `https://archiveofourown.org/works/search?work_search%5Bquery%5D=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll("li.work");
                    for (let item of items) {
                        let a = item.querySelector(".heading a:first-child");
                        if (a && a.href) {
                            let fandomEl = item.querySelector(".fandoms");
                            results.push({
                                title: a.textContent.trim(),
                                url: SiteSearchEngine.resolveUrl("https://archiveofourown.org", a.getAttribute("href")),
                                snippet: fandomEl ? fandomEl.textContent.trim() : "",
                                source: "AO3"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "WuxiaWorld",
                hostname: "wuxiaworld.com",
                searchUrl: (q) => `https://www.wuxiaworld.com/novels/search?query=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-item, .MuiGrid-item, article");
                    for (let item of items) {
                        let a = item.querySelector("a[href*='/novel/']") || item.querySelector("a");
                        if (a && a.href) {
                            let titleEl = item.querySelector("h4, h3, .novel-title") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: a.href,
                                snippet: "",
                                source: "WuxiaWorld"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "WTR-Lab",
                hostname: "wtr-lab.com",
                searchUrl: (q) => `https://wtr-lab.com/en/search?query=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-item, .search-item, .card");
                    for (let item of items) {
                        let a = item.querySelector("a[href*='/novel/']") || item.querySelector("a");
                        if (a && a.href) {
                            let titleEl = item.querySelector("h5, h4, .title, .novel-title") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: a.href,
                                snippet: "",
                                source: "WTR-Lab"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "NovelGo",
                hostname: "novelgo.id",
                searchUrl: (q) => `https://novelgo.id/?s=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-list .novel-item, .listupd .bs, article");
                    for (let item of items) {
                        let a = item.querySelector("a");
                        if (a && a.href) {
                            let titleEl = item.querySelector(".novel-title, .ntitle, h2, h3") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: a.href,
                                snippet: "",
                                source: "NovelGo"
                            });
                        }
                    }
                    return results;
                }
            }
        ];
    }

    static _buildSecondarySites() {
        return [
            {
                name: "NovelBin",
                hostname: "novelbin.com",
                searchUrl: (q) => `https://novelbin.com/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, "https://novelbin.com", "NovelBin")
            },
            {
                name: "NovelNext",
                hostname: "novelnext.com",
                searchUrl: (q) => `https://novelnext.com/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => SiteSearchEngine.parseNovelFullStyle(dom, "https://novelnext.com", "NovelNext")
            },
            {
                name: "LightNovelWorld",
                hostname: "lightnovelworld.co",
                searchUrl: (q) => `https://www.lightnovelworld.co/search?keyword=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".novel-item, .search-item, .novel-list .novel-entry");
                    for (let item of items) {
                        let a = item.querySelector("a[href*='/novel/']") || item.querySelector("a");
                        if (a && a.href) {
                            let titleEl = item.querySelector("h4, h3, .novel-title") || a;
                            results.push({
                                title: titleEl.textContent.trim(),
                                url: a.href,
                                snippet: "",
                                source: "LightNovelWorld"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "FanFiction.net",
                hostname: "www.fanfiction.net",
                searchUrl: (q) => `https://www.fanfiction.net/search/?keywords=${encodeURIComponent(q)}&type=story`,
                parseResults: (dom) => {
                    let results = [];
                    let items = dom.querySelectorAll(".z-list");
                    for (let item of items) {
                        let a = item.querySelector("a.stitle");
                        if (a && a.href) {
                            let snippet = item.querySelector(".z-indent .z-padtop") || item.querySelector(".z-padtop");
                            results.push({
                                title: a.textContent.trim(),
                                url: a.href,
                                snippet: snippet ? snippet.textContent.trim().substring(0, 150) : "",
                                source: "FanFiction.net"
                            });
                        }
                    }
                    return results;
                }
            },
            {
                name: "ReadLightNovel",
                hostname: "readlightnovel.me",
                searchUrl: (q) => `https://readlightnovel.me/search/autocomplete?dataType=json&query=${encodeURIComponent(q)}`,
                parseResults: (dom) => {
                    let results = [];
                    let links = dom.querySelectorAll("a");
                    for (let a of links) {
                        if (a.href && a.href.includes("readlightnovel")) {
                            results.push({
                                title: a.textContent.trim(),
                                url: a.href,
                                snippet: "",
                                source: "ReadLightNovel"
                            });
                        }
                    }
                    return results;
                }
            }
        ];
    }

    // ─── Shared Parsers ──────────────────────────────────────────────────

    static parseNovelFullStyle(dom, baseUrl, sourceName) {
        let results = [];
        let items = dom.querySelectorAll(".list-truyen .row, .archive .list-truyen-item-wrap, .list .row");
        for (let item of items) {
            let a = item.querySelector(".truyen-title a") || item.querySelector("h3 a") || item.querySelector("a");
            if (a && a.href) {
                let snippet = item.querySelector(".text-primary") || item.querySelector(".author");
                results.push({
                    title: a.textContent.trim(),
                    url: SiteSearchEngine.resolveUrl(baseUrl, a.getAttribute("href")),
                    snippet: snippet ? snippet.textContent.trim() : "",
                    source: sourceName
                });
            }
        }
        return results;
    }

    static resolveUrl(base, href) {
        if (!href) return base;
        if (href.startsWith("http://") || href.startsWith("https://")) return href;
        try {
            return new URL(href, base).href;
        } catch (e) {
            return base + (href.startsWith("/") ? "" : "/") + href;
        }
    }

    // ─── Network Layer ───────────────────────────────────────────────────

    /**
     * Strip <script>, <link>, <style>, <iframe> tags from HTML text
     * to prevent the browser from loading remote resources when parsed.
     */
    static sanitizeHtml(html) {
        return html.replace(/<(script|link|style|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "")
            .replace(/<(script|link|style|iframe)[^>]*\/?\s*>/gi, "");
    }

    /**
     * Race all proxies simultaneously — return HTML from the first one that responds.
     * Falls back gracefully if all fail (returns null).
     */
    static async fetchViaProxy(url) {
        let proxies = (typeof HttpClient !== "undefined" && HttpClient.CORS_PROXIES)
            ? HttpClient.CORS_PROXIES
            : [];

        if (proxies.length === 0) return null;

        // Build one racing promise per proxy
        let proxyPromises = proxies.map(proxy => {
            let controller = new AbortController();
            let timeoutId = setTimeout(() => controller.abort(), SiteSearchEngine.PROXY_TIMEOUT_MS);
            let fetchUrl = proxy.url + encodeURIComponent(url);

            return fetch(fetchUrl, { credentials: "omit", signal: controller.signal })
                .then(async (response) => {
                    clearTimeout(timeoutId);
                    if (!response.ok) throw new Error(`${response.status}`);
                    return await response.text();
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    throw err; // rethrow so Promise.any skips this one
                });
        });

        try {
            // Promise.any resolves with the FIRST successful promise
            return await Promise.any(proxyPromises);
        } catch (e) {
            // AggregateError — all proxies failed
            return null;
        }
    }

    /**
     * Fetch, sanitize, parse a single site's search results.
     */
    static async fetchSiteResults(site, query) {
        try {
            let url = site.searchUrl(query);
            let html = await SiteSearchEngine.fetchViaProxy(url);

            if (!html) {
                return [];
            }

            // Sanitize to prevent resource loading side-effects
            html = SiteSearchEngine.sanitizeHtml(html);

            let dom = new DOMParser().parseFromString(html, "text/html");
            let base = dom.createElement("base");
            base.href = url;
            dom.head.appendChild(base);

            let results = site.parseResults(dom);
            // Cap per-site results
            if (results.length > SiteSearchEngine.MAX_RESULTS_PER_SITE) {
                results = results.slice(0, SiteSearchEngine.MAX_RESULTS_PER_SITE);
            }
            return results;
        } catch (error) {
            console.warn(`[SiteSearch] Error on ${site.name}:`, error.message);
            return [];
        }
    }

    // ─── Search Orchestrator ─────────────────────────────────────────────

    /**
     * Search all sites in parallel with progressive rendering.
     *
     * @param {string} query
     * @param {function} onProgress - (siteName, status) => void
     * @param {boolean} includeSecondary
     * @param {function} onResults  - (resultsSoFar, completed, total) => void
     * @returns {Promise<Array>}
     */
    static async search(query, onProgress, includeSecondary = false, onResults) {
        let sites = [...SiteSearchEngine.PRIMARY_SITES];
        if (includeSecondary) {
            sites = sites.concat(SiteSearchEngine.SECONDARY_SITES);
        }

        if (onProgress) onProgress("Starting", `Searching ${sites.length} sites...`);

        let merged = [];
        let seenUrls = new Set();
        let completedCount = 0;

        let mergeResults = (siteResults) => {
            for (let r of siteResults) {
                let key = SiteSearchEngine.normalizeUrl(r.url);
                if (!seenUrls.has(key)) {
                    seenUrls.add(key);
                    merged.push(r);
                }
            }
        };

        let promises = sites.map(async (site) => {
            if (onProgress) onProgress(site.name, "searching");
            let results = await SiteSearchEngine.fetchSiteResults(site, query);
            completedCount++;
            mergeResults(results);
            if (onProgress) onProgress(site.name, `done (${results.length})`);
            if (onResults) onResults([...merged], completedCount, sites.length);
            return results;
        });

        await Promise.all(promises);
        return merged;
    }

    // ─── Utilities ───────────────────────────────────────────────────────

    static normalizeUrl(url) {
        try {
            let u = new URL(url);
            return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
        } catch (e) {
            return url;
        }
    }

    static getAllSiteNames() {
        let primary = SiteSearchEngine.PRIMARY_SITES.map(s => ({ name: s.name, primary: true }));
        let secondary = SiteSearchEngine.SECONDARY_SITES.map(s => ({ name: s.name, primary: false }));
        return [...primary, ...secondary];
    }
}
