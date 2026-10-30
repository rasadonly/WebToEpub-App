"use strict";

parserFactory.register("m.88xiaoshuo.net", () => new _88xiaoshuoParser());
parserFactory.register("m.ilwxs.com", () => new _88xiaoshuoParser());
parserFactory.register("ilwxs.com", () => new _88xiaoshuoParser());
parserFactory.register("m.ttshu8.com", () => new _88xiaoshuoParser());
parserFactory.register("ttshu8.com", () => new _88xiaoshuoParser());
parserFactory.register("m.xpaoshuba.com", () => new _88xiaoshuoParser());
parserFactory.register("xpaoshuba.com", () => new _88xiaoshuoParser());

class _88xiaoshuoParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let changedomurl = dom.baseURI;
        if (changedomurl.includes("https://www.")) {
            changedomurl = changedomurl.replace("https://www.","https://m.");
        }
        if (changedomurl != dom.baseURI) {
            dom = (await HttpClient.fetchHtml(changedomurl)).responseXML;
        }
        let chapters = await this.getChapterUrlsFromMultipleTocPages(dom,
            this.extractPartialChapterList,
            this.getUrlsOfTocPages,
            chapterUrlsUI
        );
        // Backend tocXpaoshuba: the desktop catalog serves newest-first
        // with a latest block ahead of it; when (nearly) all titles carry
        // 第N章 numbers, sort ascending outright. The 90% guard leaves
        // correctly ordered mobile lists untouched.
        let chapNo = (t) => parseInt((String(t).match(/第\s*(\d+)\s*章/) || [])[1] || "0", 10);
        let numbered = chapters.filter(c => chapNo(c.title) > 0).length;
        if (numbered >= Math.max(10, chapters.length * 0.9)) {
            chapters.sort((a, b) => chapNo(a.title) - chapNo(b.title));
        }
        return chapters;
    }

    getUrlsOfTocPages(dom) {
        let lastPagespan = [...dom.querySelectorAll(".caption > span > a")];
        let lastPage = null;
        for (let node of lastPagespan) {
            if (node.innerText == "尾页" || node.innerText == "Last page") {
                lastPage = node;
            }
        }
        let urls = [];
        if (lastPage) {
            const lastPageNumber = parseInt(lastPage.href.substring(lastPage.href.search(/_[0-9]+\/?$/)).replace("_", "").replace("/", ""));
            const baseUrl = lastPage.baseURI.replace(/_[0-9]+\/$/, "").replace(/\/$/, "");
            for (let i = 2; i <= lastPageNumber; i++) {
                urls.push(`${baseUrl}_${i}`);
            }
        }
        return urls;
    }

    extractPartialChapterList(dom) {
        let chapterList = dom.querySelector(".read");
        return [...chapterList.querySelectorAll("a")].map(a => util.hyperLinkToChapter(a));
    }

    findContent(dom) {
        return dom.querySelector("div.content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector(".name");
    }

    extractAuthor(dom) {
        let element = dom.querySelector("#maininfo a[href*=\"author\"], .author a");
        return (element === null) ? "" : element.textContent;
    }

    findChapterTitle(dom) {
        let element = dom.querySelector(".headline");
        return (element === null) ? null : element.textContent;
    }

    async fetchChapter(url) {
        return this.walkPagesOfChapter(url, this.moreChapterTextUrl);
    }

    moreChapterTextUrl(dom) {
        let isNextPageOfChapter = (link) => link.href.includes("_") && link.textContent == "下一页";
        let nextUrl = [...dom.querySelectorAll(".pager a")]
            .filter(isNextPageOfChapter)
            .map(a => a.href)
            .pop();
        return nextUrl ?? null;
    }

    findCoverImageUrl(dom) {
        return util.extractImgSrc(dom.querySelector(".box_con img, .detail > img")) ?? null;
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("#maininfo, .detail")];
    }

    extractDescription(dom) {
        let element = dom.querySelector("#intro");
        return (element === null) ? null : element.textContent;
    }
}