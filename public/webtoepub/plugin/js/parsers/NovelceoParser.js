"use strict";

parserFactory.register("novelceo.com", () => new NovelceoParser());

class NovelceoParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocNovelCeo: the chapter list comes from the
        // /ajax/chapter-archive endpoint, not the book page.
        let slug = null;
        try {
            slug = new URL(dom.baseURI).pathname.split("/").filter(Boolean).pop();
        } catch (e) { /* fall through to page fallback */ }
        if (slug) {
            try {
                let origin = new URL(dom.baseURI).origin;
                let archDom = (await HttpClient.wrapFetch(
                    `${origin}/ajax/chapter-archive?novelId=${encodeURIComponent(slug)}`)).responseXML;
                let seen = new Set();
                let out = [];
                for (let a of archDom.querySelectorAll("a")) {
                    let href = a.href || "";
                    if (!/\/chapter-\d+/.test(href) || seen.has(href)) {
                        continue;
                    }
                    seen.add(href);
                    out.push(util.hyperLinkToChapter(a));
                }
                if (0 < out.length) {
                    return out;
                }
            } catch (e) { /* fall through to page fallback */ }
        }
        // Fallback: chapter links on the opened page itself.
        let seen = new Set();
        let out = [];
        for (let a of dom.querySelectorAll("a")) {
            let href = a.href || "";
            if (!/\/chapter-\d+/.test(href) || seen.has(href)) {
                continue;
            }
            seen.add(href);
            out.push(util.hyperLinkToChapter(a));
        }
        return out;
    }

    findContent(dom) {
        // Verified on a live chapter page: prose lives in div.chr-c.
        return dom.querySelector("div.chr-c")
            || dom.querySelector("#chr-content, .chapter-content");
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }
}
