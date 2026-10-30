"use strict";

parserFactory.register("tomotranslations.com", () => new TomotranslationsParser());

class TomotranslationsParser extends Parser {
    constructor() {
        super();
    }

    getChapterUrls(dom) {
        // Backend tocTomoTranslations: chapters are dated WP posts living
        // on BOTH tomotranslations.com and tomotranslations.wordpress.com
        // (same-host scoping dropped the early ones). Collect page-wide
        // dated chapter links from both hosts, deduped.
        let seen = new Set();
        let out = [];
        for (let a of dom.querySelectorAll("a")) {
            let href = a.href || "";
            if (!/\/(19|20)\d{2}\//.test(href)) {
                continue;
            }
            if (!/tomotranslations\.(wordpress\.)?com/.test(href)) {
                continue;
            }
            if (!/chapter/i.test(href)) {
                continue;
            }
            if (seen.has(href)) {
                continue;
            }
            seen.add(href);
            out.push(util.hyperLinkToChapter(a));
        }
        if (0 < out.length) {
            return Promise.resolve(out);
        }
        let menu = dom.querySelector("section.entry");
        return Promise.resolve(util.hyperlinksToChapterList(menu));
    }

    findContent(dom) {
        return dom.querySelector("section.entry");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.title");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "div.taxonomies");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1.title");
    }
}
