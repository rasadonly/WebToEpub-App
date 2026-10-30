"use strict";

parserFactory.register("woopread.com", () => new WoopreadParser());

class WoopreadParser extends Parser {
    constructor() {
        super();
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.text-3xl");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.relative .text-text-secondary")];
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("div.mb-4:nth-of-type(4) a");
        return (authorLabel === null) ? super.extractAuthor(dom) : authorLabel.textContent;
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.relative");
    }

    async getChapterUrls(dom) {
        // Backend tocWoopRead: the series page's RSC flight payload embeds the
        // complete chapter array. The rendered grid only shows a window of it
        // (12 of 38 on the verified book), so it is only a fallback.
        let pageUrl = new URL(dom.baseURI);
        let bookPath = pageUrl.pathname.replace(/\/$/, "");
        let raw = [...dom.querySelectorAll("script")]
            .map(s => s.textContent || "").join("\n")
            .replaceAll('\\"', '"');
        let byNum = new Map();
        for (let m of raw.matchAll(/"number":\s*(\d+)\s*,\s*"slug":\s*"(chapter-[^"]+)"/g)) {
            let n = parseInt(m[1], 10);
            if (!byNum.has(n)) {
                byNum.set(n, {
                    sourceUrl: `${pageUrl.origin}${bookPath}/${m[2]}`,
                    title: `Chapter ${n}`
                });
            }
        }
        for (let m of raw.matchAll(/"title":\s*"([^"]{1,120})"\s*,\s*"number":\s*(\d+)/g)) {
            let it = byNum.get(parseInt(m[2], 10));
            if (it) {
                it.title = m[1];
            }
        }
        if (0 < byNum.size) {
            return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        }

        const chapterLinks = [...dom.querySelectorAll("main.grow .notranslate .mt-8 .grid-cols-1 a")];
        const chapterTitles = [...dom.querySelectorAll("main.grow .line-clamp-2")];

        let chapterList = [];
        for (let i = 0; i < chapterLinks.length; i++) {
            chapterList.push({
                sourceUrl: chapterLinks[i].href,
                title: chapterTitles[i].textContent,
            });
        }

        return chapterList.reverse();
    }
    
    findChapterTitle(dom) {
        return dom.querySelector("h2.text-2xl");
    }

    findContent(dom) {
        return dom.querySelector("div[id^='chapter']");
    }
}
