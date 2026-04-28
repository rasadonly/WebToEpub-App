"use strict";

/*
  KofiParser.js
  Parser for Ko-fi posts
*/

console.log("[WebToEpub] KofiParser v2.2 Loaded");

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
     *
     * @param {Document|ShadowRoot|DocumentFragment|Element} root
     * @returns {{ hrefRaw: string, text: string }[]}
     */
    _collectLinks(root) {
        let results = [];

        if (!root || !root.querySelectorAll) return results;

        // Grab anchors at this level using the raw attribute
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
     * @param {Document} dom
     * @returns {Promise<Chapter[]>}
     */
    async getChapterUrls(dom) {
        let baseUrl = this.state.chapterListUrl || dom.baseURI;
        if (typeof HttpClient !== "undefined" && HttpClient.unproxyUrl) {
            baseUrl = HttpClient.unproxyUrl(baseUrl);
        }

        let allLinks = this._collectLinks(dom);
        let chapters = [];
        let seen = new Set();

        for (let { hrefRaw, text } of allLinks) {
            if (!hrefRaw || hrefRaw.startsWith("#")) continue;

            try {
                // Resolve relative hrefs against baseUrl
                let url = new URL(hrefRaw, baseUrl);
                let pathname = url.pathname.toLowerCase();

                if (pathname.includes("/post/")) {
                    let normalized = util.normalizeUrlForCompare(url.href);
                    if (!seen.has(normalized)) {
                        seen.add(normalized);
                        // Skip UI/navigation link text
                        if (text.length < 2 || /^(more|next|previous|prev|support|share|gallery|donate|home)$/i.test(text)) {
                            continue;
                        }
                        chapters.push({
                            sourceUrl: url.href,
                            title: text
                        });
                    }
                }
            } catch (e) {
                // ignore invalid URLs
            }
        }

        if (chapters.length < 2) {
            this._regexScan(dom, baseUrl, chapters, seen);
        }

        if (chapters.length > 0) {
            return chapters;
        }

        // Default: return current page
        return [{
            sourceUrl: baseUrl,
            title: this.extractTitle(dom)
        }];
    }

    /**
     * Regex fallback for when DOM search fails (matches the user's working curl script)
     */
    _regexScan(dom, baseUrl, chapters, seen) {
        const html = dom.documentElement.innerHTML;
        // Match /post/ followed by alphanumeric and dashes
        const regex = /https:\/\/ko-fi\.com\/[pP]ost\/[a-zA-Z0-9-]+/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            let href = match[0];
            let normalized = util.normalizeUrlForCompare(href);
            if (!seen.has(normalized)) {
                seen.add(normalized);
                // Guess title from the URL slug
                let slug = href.split("/").pop();
                let titleParts = slug.split("-");
                if (titleParts.length > 1) titleParts.pop(); 
                let title = titleParts.join(" ").replace(/_/g, " ").trim();
                
                chapters.push({
                    sourceUrl: href,
                    title: title || slug
                });
            }
        }
    }

    /**
     * Returns the element holding the story content.
     * @param {Document} dom
     */
    findContent(dom) {
        // Try live shadow root first
        let articleHost = dom.querySelector(".article-host");
        if (articleHost) {
            if (articleHost.shadowRoot) {
                return articleHost.shadowRoot.querySelector(".fr-view, .article-body")
                    || articleHost.shadowRoot;
            }
            let tmpl = articleHost.querySelector("template[shadowrootmode]");
            if (tmpl && tmpl.content) {
                return tmpl.content.querySelector(".fr-view, .article-body") || tmpl.content;
            }
        }

        return dom.querySelector(".article-body") ||
            dom.querySelector("#post-container") ||
            dom.querySelector(".post-content-container") ||
            dom.querySelector(".post-body") ||
            dom.querySelector(".article-body-container") ||
            dom.querySelector(".p-post-content") ||
            dom.querySelector("article") ||
            dom.body;
    }

    /**
     * Title of the story
     * @param {Document} dom
     */
    extractTitleImpl(dom) {
        if (dom.title === "403 Forbidden" || dom.title === "Just a moment...") {
            return "Blocked by Cloudflare (Use Active Tab)";
        }
        let titleElement = dom.querySelector(".article-title h1") ||
            dom.querySelector("h1") ||
            dom.querySelector(".post-title") ||
            dom.querySelector("title");
        return titleElement ? titleElement.textContent.trim() : super.extractTitleImpl(dom);
    }

    /**
     * Author of the story
     * @param {Document} dom
     */
    extractAuthor(dom) {
        let authorLabel = dom.querySelector(".nav-profile-title") ||
            dom.querySelector(".post-name-row a") ||
            dom.querySelector("a[href*='/home/profile'] span") ||
            dom.querySelector(".author-name");
        return authorLabel ? authorLabel.textContent.trim() : super.extractAuthor(dom);
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".article-image, .post-main-image, #post-container img");
    }

    findChapterTitle(dom) {
        return this.extractTitleImpl(dom);
    }

    /**
     * Detect if the response is a Cloudflare/403 block
     */
    isCustomError(ret) {
        if (!ret || !ret.title) return false;
        return ret.title === "403 Forbidden" ||
            ret.title === "Just a moment..." ||
            (ret.querySelector && ret.querySelector("#challenge-running") !== null);
    }

    /**
     * Provide a custom error response
     */
    setCustomErrorResponse(url, wrapOptions, ret) {
        let hostname = new URL(url).hostname;
        let errorMessage = `Blocked by Cloudflare on ${hostname}. Please open the proxy URL in a new tab, solve the captcha, then try again.`;

        return {
            url: url,
            wrapOptions: wrapOptions,
            response: ret,
            errorMessage: errorMessage
        };
    }
}