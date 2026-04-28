"use strict";

/*
  KofiParser.js
  Parser for Ko-fi posts and galleries
*/

console.log("[WebToEpub] KofiParser v2.5 Loaded (Universal Feed Scan)");

parserFactory.register("ko-fi.com", () => new KofiParser());
parserFactory.registerManualSelect("Ko-fi", () => new KofiParser());

class KofiParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 3000;
    }

    /**
     * Collect all <a> elements from the document including those inside:
     *  - live shadow roots (node.shadowRoot)
     *  - unupgraded <template shadowrootmode> fragments
     */
    _collectLinks(root) {
        let results = [];
        if (!root || !root.querySelectorAll) return results;

        for (let a of root.querySelectorAll("a")) {
            let hrefRaw = a.getAttribute("href") || "";
            let text = a.textContent.trim() || a.getAttribute("title") || "";
            results.push({ hrefRaw, text });
        }

        // Recurse into live shadow roots
        for (let el of root.querySelectorAll("*")) {
            if (el.shadowRoot) {
                results.push(...this._collectLinks(el.shadowRoot));
            }
        }

        // Recurse into unupgraded <template shadowrootmode> content fragments
        for (let tmpl of root.querySelectorAll("template[shadowrootmode]")) {
            if (tmpl.content) {
                results.push(...this._collectLinks(tmpl.content));
            }
        }

        return results;
    }

    /**
     * Returns promise with the URLs of the chapters to fetch
     */
    async getChapterUrls(dom) {
        let baseUrl = this.state.chapterListUrl || dom.baseURI;
        if (typeof HttpClient !== "undefined" && HttpClient.unproxyUrl) {
            baseUrl = HttpClient.unproxyUrl(baseUrl);
        }

        let allLinks = this._collectLinks(dom);
        let chapters = [];
        let seen = new Set();

        const processLink = (hrefRaw, text) => {
            if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:")) return;
            try {
                let url = new URL(hrefRaw, baseUrl);
                let pathname = url.pathname.toLowerCase();
                if (pathname.includes("/post/") || pathname.includes("/gallery/")) {
                    let normalized = util.normalizeUrlForCompare(url.href);
                    if (!seen.has(normalized)) {
                        seen.add(normalized);
                        if (text.length < 2 || /^(more|next|previous|prev|support|share|gallery|donate|home|close)$/i.test(text)) {
                            return;
                        }
                        chapters.push({ sourceUrl: url.href, title: text });
                    }
                }
            } catch (e) { /* ignore */ }
        };

        for (let { hrefRaw, text } of allLinks) {
            processLink(hrefRaw, text);
        }

        // FALLBACK 1: Regex Deep Scan on initial DOM
        if (chapters.length < 2) {
            this._regexScan(dom, baseUrl, chapters, seen);
        }

        // FALLBACK 2: AJAX Feed Discovery (Fetches creator's recent posts list)
        if (chapters.length < 5) {
            await this._fetchRecentPosts(dom, baseUrl, chapters, seen);
        }

        if (chapters.length > 0) {
            return chapters;
        }

        return [{ sourceUrl: baseUrl, title: this.extractTitle(dom) }];
    }

    /** Aggressive fetch for creator's post feed */
    async _fetchRecentPosts(dom, baseUrl, chapters, seen) {
        let buttonId = null;
        for (let script of dom.querySelectorAll("script")) {
            let match = script.textContent.match(/buttonId:\s*['"]([a-zA-Z0-9-]+)['"]/);
            if (match) {
                buttonId = match[1];
                break;
            }
        }

        if (buttonId) {
            try {
                let feedUrl = `https://ko-fi.com/Buttons/LoadRecentPosts?buttonId=${buttonId}`;
                let xhr = await HttpClient.wrapFetch(feedUrl);
                if (xhr && xhr.responseXML) {
                    this._regexScan(xhr.responseXML, baseUrl, chapters, seen);
                }
            } catch (e) { /* ignore */ }
        }
    }

    _regexScan(dom, baseUrl, chapters, seen) {
        const html = dom.documentElement.innerHTML;
        const regex = /https:\/\/ko-fi\.com\/(post|gallery)\/[a-zA-Z0-9-]+/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            let href = match[0];
            let normalized = util.normalizeUrlForCompare(href);
            if (!seen.has(normalized)) {
                seen.add(normalized);
                let slug = href.split("/").pop();
                let titleParts = slug.split("-");
                if (titleParts.length > 1) titleParts.pop(); 
                let title = titleParts.join(" ").replace(/_/g, " ").trim();
                chapters.push({ sourceUrl: href, title: title || slug });
            }
        }
    }

    findContent(dom) {
        let fromScripts = this._scanScriptsForContent(dom);
        if (fromScripts) return fromScripts;

        let articleHost = dom.querySelector(".article-host");
        if (articleHost) {
            if (articleHost.shadowRoot) return articleHost.shadowRoot.querySelector(".fr-view, .article-body") || articleHost.shadowRoot;
            let tmpl = articleHost.querySelector("template[shadowrootmode]");
            if (tmpl && tmpl.content) return tmpl.content.querySelector(".fr-view, .article-body") || tmpl.content;
        }

        return dom.querySelector(".article-body, #post-container, .post-content-container, .post-body, .p-post-content, article") || dom.body;
    }

    _scanScriptsForContent(dom) {
        for (let script of dom.querySelectorAll("script")) {
            const text = script.textContent;
            if (text.includes("article-body") || text.includes("shadowDom.innerHTML")) {
                const match = text.match(/innerHTML\s*\+?=\s*['"](.*?)['"];/s) || text.match(/['"](<div class=".*?article-body.*?">.*?)['"];/s);
                if (match) {
                    let html = match[1].replace(/\\(['"/])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '');
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
                    const content = doc.querySelector(".article-body") || doc.body.firstChild;
                    if (content && content.textContent.trim().length > 50) return content;
                }
            }
        }
        return null;
    }

    extractTitleImpl(dom) {
        if (dom.title === "403 Forbidden" || dom.title === "Just a moment...") return "Blocked by Cloudflare (Use Active Tab)";
        let titleElement = dom.querySelector(".article-title h1, h1, .post-title, .breakall, title");
        return titleElement ? titleElement.textContent.trim() : super.extractTitleImpl(dom);
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector(".nav-profile-title, .post-name-row a, a[href*='/home/profile'] span, .author-name");
        return authorLabel ? authorLabel.textContent.trim() : super.extractAuthor(dom);
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".article-image, .post-main-image, #post-container img, a.label-hires");
    }

    isCustomError(ret) {
        if (!ret || !ret.title) return false;
        return ret.title === "403 Forbidden" || ret.title === "Just a moment..." || (ret.querySelector && ret.querySelector("#challenge-running") !== null);
    }

    setCustomErrorResponse(url, wrapOptions, ret) {
        let hostname = new URL(url).hostname;
        let errorMessage = `Blocked by Cloudflare on ${hostname}. Solve the captcha in the proxy tab then try again.`;
        return { url, wrapOptions, response: ret, errorMessage };
    }
}