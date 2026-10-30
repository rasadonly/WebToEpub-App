"use strict";

parserFactory.register("shmtranslations.com", () => new ShmtranslationsParser());

class ShmtranslationsParser extends WordpressBaseParser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocShmTranslations: the series page links every chapter post,
        // but the entry-content sweep also picks up PV videos, quizzes and
        // other non-chapter posts. Keep only dated /chapter-{N}- posts,
        // deduped by path (hrefs mix www and bare hosts), sorted numerically.
        let byPath = new Map();
        for (let a of dom.querySelectorAll("a[href]")) {
            let p = null;
            try {
                p = new URL(a.href).pathname;
            } catch (e) {
                continue;
            }
            if (/\/chapter-\d+/.test(p) && !byPath.has(p)) {
                byPath.set(p, util.hyperLinkToChapter(a));
            }
        }
        let num = (x) => parseInt(new URL(x.sourceUrl).pathname.match(/chapter-(\d+)/)?.[1] || "0", 10);
        return [...byPath.values()].sort((a, b) => num(a) - num(b));
    }

    findContent(dom) {
        let content = super.findContent(dom);
        if (content !== null) {
            return content;
        }

        // site changed 2019-10-27.  Look for new content and clean
        content = dom.querySelector("article");
        if (content !== null) {
            ShmtranslationsParser.cleanLaterContent(content);
        }
        return content;
    }

    findChapterTitle(dom) {
        return dom.querySelector(".entry-title");
    }

    static cleanLaterContent(content) {
        let junk = [...content.querySelectorAll("span[style='color: #ffffff;']")]
            .map(s => s.parentElement)
            .filter(p => p.tagName.toLowerCase() === "p")
            .concat([...content.querySelectorAll("footer, div.awac-wrapper")]);
        util.removeElements(junk);
    }
}
