"use strict";

parserFactory.register("ontimestory.eu", () => new OntimestoryParser());

class OntimestoryParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocOntimestory: take only the series page's own dated
        // chapter posts, scoped to the series slug (the old unscoped
        // article-links sweep pulled site-wide furniture), fragments
        // stripped, sorted by chapter key.
        let series = "";
        try {
            series = new URL(dom.baseURI).pathname.split("/").filter(Boolean).pop() || "";
        } catch (e) { /* fall through to legacy list */ }
        if (!series) {
            return [...dom.querySelectorAll("article p a")]
                .map(a => util.hyperLinkToChapter(a));
        }
        let escaped = series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let re = new RegExp(escaped + "-chapter-[\\d]");
        let seen = new Set();
        let out = [];
        for (let a of dom.querySelectorAll("a")) {
            let href = (a.href || "").split("#")[0];
            if (!re.test(href) || seen.has(href)) {
                continue;
            }
            seen.add(href);
            out.push({ sourceUrl: href, title: (a.textContent || "").trim() });
        }
        let key = (c) => (c.sourceUrl.match(/-chapter-([\d-]+)\/?$/)?.[1] || "0")
            .split("-").map(n => parseInt(n, 10));
        out.sort((a, b) => {
            let ka = key(a);
            let kb = key(b);
            for (let i = 0; i < Math.max(ka.length, kb.length); ++i) {
                let d = (ka[i] || 0) - (kb[i] || 0);
                if (d) {
                    return d;
                }
            }
            return 0;
        });
        return out;
    }

    findContent(dom) {
        return dom.querySelector("div.post-content, div.entry-content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.page-title");
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1.post-title, .entry-title");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "article");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("article p")]
            .filter(p => p.querySelector("a") === null);
    }
}
