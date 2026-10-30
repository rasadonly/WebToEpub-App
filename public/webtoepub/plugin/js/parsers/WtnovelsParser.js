"use strict";

parserFactory.register("wtnovels.com", () => new WtnovelsParser());

class WtnovelsParser extends WordpressBaseParser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        // Backend tocWtNovels: book pages embed only first+latest links;
        // the complete list is server-rendered at /novels/{slug}/chapters/.
        // Try that first; fall back to the legacy pagination walk.
        let slug = null;
        try {
            slug = new URL(dom.baseURI).pathname.match(/\/novels\/([a-z0-9-]+)/i)?.[1];
        } catch (e) { /* fall through */ }
        if (slug) {
            try {
                let origin = new URL(dom.baseURI).origin;
                let chDom = (await HttpClient.wrapFetch(`${origin}/novels/${slug}/chapters/`)).responseXML;
                let re = new RegExp(`/novels/${slug}/[^/]+-chapter-\\d+-`);
                let seen = new Set();
                let out = [];
                for (let a of chDom.querySelectorAll("a")) {
                    let href = a.href || "";
                    if (!re.test(href) || seen.has(href)) {
                        continue;
                    }
                    seen.add(href);
                    out.push({
                        sourceUrl: href,
                        title: (a.textContent || "").trim(),
                        isIncludeable: a.querySelector(".chapter-paid-points") == null
                    });
                }
                let num = (c) => parseInt((c.sourceUrl || "").match(/-chapter-(\d+)-/)?.[1] || "0", 10);
                out.sort((a, b) => num(a) - num(b));
                if (0 < out.length) {
                    return out;
                }
            } catch (e) { /* fall through to legacy */ }
        }
        let tocPage1chapters = this.extractPartialChapterList(dom);
        let urlsOfTocPages  = this.getUrlsOfTocPages(dom);
        return (await this.getChaptersFromAllTocPages(tocPage1chapters,
            this.extractPartialChapterList,
            urlsOfTocPages,
            chapterUrlsUI
        )).reverse();
    }

    extractPartialChapterList(dom) {
        return [...dom.querySelectorAll("div.chapters-list a")]
            .map(link => ({
                sourceUrl: link.href,
                title: link.querySelector("h3").textContent,
                isIncludeable: link.querySelector(".chapter-paid-points") == null
            }));
    }

    getUrlsOfTocPages(dom) {
        let tocUrls = [];
        let link = [...dom.querySelectorAll("nav.cgl-pagination a.cgl-page")].pop()?.href;
        if (link) {
            let splitUrl = link.split("/");
            if (splitUrl.length >= 7) {
                let maxPage = parseInt(splitUrl[6]);
                for (let i = 2; i <= maxPage; ++i) {
                    splitUrl[6] = i;
                    tocUrls.push(splitUrl.join("/"));
                }
            }
        }
        return tocUrls;
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.novel-title");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".novel-header");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll(".novel-summary-initial")];
    }
}
