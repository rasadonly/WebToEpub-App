"use strict";

parserFactory.register("readingpia.me", () => new ReadingpiaParser());

class ReadingpiaParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        return [...dom.querySelectorAll(".content a:has(div)")]
            .map(link => this.linkToChapter(link)).reverse();
    }

    linkToChapter(link) {
        return ({
            sourceUrl:  link.href,
            title: link.querySelector("div span").textContent,
        });
    }

    findContent(dom) {
        let el = dom.querySelector("div#chapter-body")
            || dom.querySelector("div.chapter-body")
            || dom.querySelector("main > div:not(.advertisement):not(.promo-container):not(.comments):not([style])");
        // Backend bodyReadingpia: prose is interleaved with display:none
        // decoy blocks; strip them inside the container before extraction.
        if (el) {
            for (let decoy of el.querySelectorAll('[style*="display:none"], [style*="display: none"]')) {
                decoy.remove();
            }
        }
        return el;
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h2.novel-title");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector(".info-ans");
        return authorLabel?.textContent ?? super.extractAuthor(dom);
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.novel-cover");
    }

    getInformationEpubItemChildNodes(dom) {
        return [dom.querySelector(".novel-synopsis")];
    }

}