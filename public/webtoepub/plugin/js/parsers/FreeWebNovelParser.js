"use strict";

parserFactory.register("freewebnovel.com", () => new FreeWebNovelComParser());
parserFactory.register("bednovel.com", () => new FreeWebNovelParser());
parserFactory.register("innnovel.com", () => new FreeWebNovelParser());
parserFactory.register("libread.com", () => new FreeWebNovelParser());
parserFactory.register("novellive.com", () => new NovelliveParser());
parserFactory.register("novellive.app", () => new NovelliveParser());
parserFactory.register("novellive.net", () => new NovelliveParser());
parserFactory.register("readwn.org", () => new NovelliveParser());

class FreeWebNovelParser extends Parser {

    constructor() {
        super();
        this.minimumThrottle = 1000;
    }

    async getChapterUrls(dom) {
        let menu = dom.querySelector("ul#idData");
        return util.hyperlinksToChapterList(menu);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.tit");
    }

    extractAuthor(dom) {
        return dom.querySelector("[title=Author]").parentNode.querySelector("a").textContent;
    }

    extractSubject(dom) {
        let tags = [...dom.querySelector("[title=Genre]").parentNode.querySelectorAll("a")];
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.pic");
    }

    findChapterTitle(dom) {
        return dom.querySelector("span.chapter");
    }

    findContent(dom) {
        return dom.querySelector("div#article") || dom.querySelector("div.txt");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.inner")];
    }
}

class NovelliveParser extends FreeWebNovelParser {

    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        return this.getChapterUrlsFromMultipleTocPages(dom,
            this.extractPartialChapterList,
            this.getUrlsOfTocPages,
            chapterUrlsUI
        );
    }

    getUrlsOfTocPages(dom) {
        // lastUrl should be example https://novellive.com/book/<some-novel-name>/<index>
        let lastUrl = [...dom.querySelectorAll(".page a.index-container-btn")]?.pop()?.href;
        let urls = [];
        if (lastUrl) {
            let parts = lastUrl.split(/%2F|\//);
            let lastIndexPageName = parts.pop();
            let lastIndex = parseInt(lastIndexPageName);
            let tocHasMultiplePages = !isNaN(lastIndex);
            if (tocHasMultiplePages) {
                let baseUrl = lastUrl.substring(0, lastUrl.length - lastIndexPageName.length);
                for (let i = 2; i <= lastIndex; ++i) {
                    urls.push(baseUrl + i);
                }
            }
        }
        return urls;
    }

    extractPartialChapterList(dom) {
        return [...dom.querySelector(".m-newest2").querySelectorAll("ul li a")]
            .map(a => util.hyperLinkToChapter(a));
    }
}

class FreeWebNovelComParser extends FreeWebNovelParser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        return this.getChapterUrlsFromMultipleTocPages(dom,
            this.extractPartialChapterList.bind(this),
            this.getUrlsOfTocPages.bind(this),
            chapterUrlsUI
        );
    }

    extractPartialChapterList(dom) {
        let menu = dom.querySelector("ul#idData") || dom.querySelector("div.m-newest2 ul.ul-list5") || dom.querySelector("div.m-newest2");
        if (menu) {
            return [...menu.querySelectorAll("li a")].map(a => util.hyperLinkToChapter(a));
        }
        return [];
    }

    getUrlsOfTocPages(dom) {
        let urls = [];
        let select = dom.querySelector("select#indexselect");
        if (select) {
            let options = [...select.querySelectorAll("option")];
            // The first option is the current page, skip it or include it?
            // getChapterUrlsFromMultipleTocPages assumes these are the *other* pages
            for (let i = 1; i < options.length; i++) {
                let val = options[i].getAttribute("value");
                if (val) {
                    urls.push(SiteSearchEngine.resolveUrl(dom.baseURI || "https://freewebnovel.com", val));
                }
            }
        }
        return urls;
    }

    removeUnwantedElementsFromContentElement(content) {
        util.removeChildElementsMatchingSelector(content, "p sub");
        super.removeUnwantedElementsFromContentElement(content);
    }
}