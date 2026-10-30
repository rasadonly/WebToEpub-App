"use strict";

parserFactory.register("wuxiaworld.eu", () => new WuxiaworldeuParser());
parserFactory.register("wuxia.click", () => new WuxiaworldeuParser());

class WuxiaworldeuParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        // The /api/chapters/ endpoint 404s on wuxia.click, so fall back to the
        // backend tocWuxiaClick walk: the book page's inline ?page=N pagination,
        // /chapter/{slug}-{n} links sorted by number. Each page is reported
        // through chapterUrlsUI, so a TOC-scan timeout still keeps the pages
        // collected so far instead of falling back to the heuristic.
        let host = new URL(dom.baseURI).host;
        try {
            let tocUrl = dom.baseURI.replace("/novel/", "/api/chapters/") + "/";
            let json = (await HttpClient.fetchJson(tocUrl)).json;
            if (Array.isArray(json) && 0 < json.length) {
                return json.map(j => this.toChapter(j, host));
            }
        } catch (e) {
            // fall through to the pagination walk
        }
        let pageUrl = new URL(dom.baseURI);
        let slug = pageUrl.pathname.split("/").filter(Boolean).pop();
        let base = `${pageUrl.origin}/novel/${slug}`;
        let byNum = new Map();
        let collect = (d) => {
            let pageChapters = [];
            for (let a of d.querySelectorAll("a[href]")) {
                if (!a.href.includes(`/chapter/${slug}-`)) {
                    continue;
                }
                let m = a.href.match(/-(\d+)\/?$/);
                let n = m ? parseInt(m[1], 10) : 0;
                if (n) {
                    // Last occurrence wins, like backend tocWuxiaClick; only
                    // newly seen numbers are reported as progress.
                    let ch = util.hyperLinkToChapter(a);
                    if (!byNum.has(n)) {
                        pageChapters.push(ch);
                    }
                    byNum.set(n, ch);
                }
            }
            if (0 < pageChapters.length) {
                chapterUrlsUI?.showTocProgress?.(pageChapters);
            }
        };
        collect(dom);
        let maxPage = 1;
        for (let a of dom.querySelectorAll("a[href]")) {
            let m = a.href.match(/[?&]page=(\d+)/);
            if (m) {
                maxPage = Math.max(maxPage, parseInt(m[1], 10));
            }
        }
        for (let p = 2; p <= Math.min(maxPage, 80); ++p) {
            let nextDom = (await HttpClient.wrapFetch(`${base}?page=${p}`)).responseXML;
            collect(nextDom);
        }
        return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    }

    toChapter(json, host) {
        return ({
            sourceUrl:  `https://${host}/chapter/${json.novSlugChapSlug}`,
            title: json.title
        });
    }

    findContent(dom) {
        return dom.querySelector("#chapterText")?.parentElement?.parentElement;
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h5");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "div.mantine-Group-root, div.mantine-Container-root");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.mantine-Image-imageWrapper");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll(".mantine-Spoiler-root")];
    }
}
