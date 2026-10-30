"use strict";

parserFactory.register("quanben.io", () => new QuanbenParser());

class QuanbenParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocQuanben: book pages are shells; the list page shows only
        // head+tail chapter blocks, but chapter URLs are purely sequential
        // /n/{slug}/{N}.html, so synthesize the middle from the tail's max.
        // (Also: a book URL with a trailing slash used to build a "//list.html"
        // URL, which every proxy route rejects.)
        let base = dom.baseURI.replace(/\/$/, "");
        if (!base.endsWith("/list.html")) {
            dom = (await HttpClient.wrapFetch(base + "/list.html")).responseXML;
            base = dom.baseURI.replace(/\/$/, "");
        }
        let slug = null;
        try {
            slug = new URL(dom.baseURI).pathname.match(/\/n\/([a-z0-9-]+)/i)?.[1];
        } catch (e) { /* fall through to the legacy selector */ }
        if (slug) {
            let origin = new URL(dom.baseURI).origin;
            let titled = new Map();
            let max = 0;
            for (let a of dom.querySelectorAll("a[href]")) {
                let m = a.href.match(new RegExp(`/n/${slug}/(\\d+)\\.html$`));
                if (m) {
                    let n = parseInt(m[1], 10);
                    if (!titled.has(n)) {
                        titled.set(n, util.hyperLinkToChapter(a));
                    }
                    if (max < n) {
                        max = n;
                    }
                }
            }
            if (0 < max) {
                let chapters = [];
                for (let n = 1; n <= max; ++n) {
                    chapters.push(titled.get(n) || {
                        sourceUrl: `${origin}/n/${slug}/${n}.html`,
                        title: `Chapter ${n}`
                    });
                }
                return chapters;
            }
        }
        return [...dom.querySelectorAll("div.box li a")]
            .map(a => util.hyperLinkToChapter(a));
    }

    findContent(dom) {
        return dom.querySelector("div#content");
    }

    extractTitleImpl(dom) {
        let span = dom.querySelector("span[itemprop='name']");
        return span === null ? null : span.textContent;
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1.headline");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div[itemscope]");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.description")];
    }
}
