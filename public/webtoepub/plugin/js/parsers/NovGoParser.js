"use strict";

/*
  novgo.net (and aliases) list their chapters in a <select> that is loaded
  through /ajax-chapter-option?novelId=<id>, not as links in the TOC page.
  The generic NovelfullParser therefore finds no chapters (works for the EPUB
  path because that uses the dedicated worker/back-end route), so register a
  dedicated parser here. reregister() is used because NovelfullParser.js claims
  novgo.net first.
*/

class NovGoParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 1000;
    }

    // Chapter URLs may live on alias hostnames; keep this parser for all of them.
    async addParsersToPages(pagesToFetch) {
        for (let page of pagesToFetch) {
            page.parser = this;
        }
    }

    static findNovelId(dom, html) {
        let el = dom.querySelector("[data-novel-id]");
        let id = el ? el.getAttribute("data-novel-id") : null;
        if (!id && html) {
            let m = html.match(/novelId["'\s:=]+["']?(\d+)/);
            id = m ? m[1] : null;
        }
        if (!id) {
            let rating = dom.querySelector("#rating");
            id = rating ? rating.getAttribute("data-novel-id") : null;
        }
        return id;
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let baseUrl = dom.baseURI;
        let origin = new URL(baseUrl).origin;
        let html = dom.documentElement ? dom.documentElement.outerHTML : "";
        let novelId = NovGoParser.findNovelId(dom, html);

        if (novelId != null) {
            let optionsDom = (await HttpClient.wrapFetch(
                origin + "/ajax-chapter-option?novelId=" + novelId
            )).responseXML;
            if (optionsDom != null) {
                let chapters = [...optionsDom.querySelectorAll("option[value]")]
                    .map(o => ({
                        sourceUrl: new URL(o.getAttribute("value"), origin).href,
                        title: (o.textContent || "").trim(),
                        newArc: null
                    }))
                    .filter(c => !util.isNullOrEmpty(c.sourceUrl));
                if (0 < chapters.length) {
                    if (chapterUrlsUI) {
                        chapterUrlsUI.showTocProgress(chapters);
                    }
                    return chapters;
                }
            }
        }

        // Fallback: chapter links rendered directly on the page.
        let links = [...dom.querySelectorAll(".list-chapter a, #list-chapter a, .chapter-list a")];
        return links.map(a => ({
            sourceUrl: a.href,
            title: (a.getAttribute("title") || a.textContent || "").trim(),
            newArc: null
        }));
    }

    findContent(dom) {
        return dom.querySelector("#chapter-content, #chr-content, .chapter-content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h3.title, h1.title, .book h3");
    }

    extractAuthor(dom) {
        let author = dom.querySelector("a[href*='author']");
        return author === null ? super.extractAuthor(dom) : author.textContent.trim();
    }

    findChapterTitle(dom) {
        return dom.querySelector(".chapter-title, a.chapter-title, h2 span.chapter-text, h4 a.chapter-title");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".book, .books, .book-img");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element,
            "ins, div.ads, .adsbygoogle, script, iframe, .unlock-buttons, #chapter-nav-top, #chapter-nav-bottom");
        super.removeUnwantedElementsFromContentElement(element);
    }
}

for (let host of ["novgo.net", "novgo.com", "novgo.org"]) {
    parserFactory.reregister(host, () => new NovGoParser());
}
parserFactory.registerManualSelect("NovGo", () => new NovGoParser());
