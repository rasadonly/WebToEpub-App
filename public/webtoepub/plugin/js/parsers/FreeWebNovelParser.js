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

    async getChapterUrls(dom, chapterUrlsUI) {
        let menu = dom.querySelector("ul#idData");
        let chapters = util.hyperlinksToChapterList(menu);

        let totalPage = 1;
        let indexSelect = dom.querySelector("#indexselect");
        if (indexSelect) {
            totalPage = indexSelect.querySelectorAll("option").length;
        } else {
            for (let script of [...dom.querySelectorAll("script")]) {
                let match = /totalPage:\s*(\d+)/.exec(script.textContent);
                if (match) {
                    totalPage = parseInt(match[1]);
                    break;
                }
            }
        }

        if (1 < totalPage) {
            chapterUrlsUI?.showTocProgress?.(chapters);
            let urlObj = new URL(dom.baseURI);
            urlObj.search = "";
            urlObj.hash = "";
            let baseNovelUrl = urlObj.toString();

            let fetchTocPage = async (url) => {
                // Some proxies mangle JSON responses, so try both paths.
                try {
                    let response = await HttpClient.fetchJson(url);
                    if (response?.json?.html) {
                        return response.json.html;
                    }
                } catch (e) {
                    // fall through to raw fetch
                }
                let xhr = await HttpClient.wrapFetch(url);
                let raw = xhr.responseText ?? "";
                try {
                    let parsed = JSON.parse(raw);
                    return parsed?.html || "";
                } catch (e) {
                    return raw.includes("<li") ? raw : "";
                }
            };

            for (let page = 2; page <= totalPage; ++page) {
                await this.rateLimitDelay();
                let url = `${baseNovelUrl}?ajax=chapters&page=${page}`;
                let html = null;
                for (let attempt = 0; attempt < 3 && !html; ++attempt) {
                    try {
                        html = await fetchTocPage(url);
                    } catch (e) {
                        console.error("Failed to fetch TOC page: " + page, e);
                    }
                }
                if (!html) {
                    continue;
                }
                let tempDom = new DOMParser().parseFromString(html, "text/html");
                util.setBaseTag(url, tempDom);
                let partialChapters = util.hyperlinksToChapterList(tempDom);
                if (0 < partialChapters.length) {
                    chapterUrlsUI?.showTocProgress?.(partialChapters);
                    chapters = chapters.concat(partialChapters);
                }
            }

        }
        return chapters;
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
    removeUnwantedElementsFromContentElement(content) {
        util.removeChildElementsMatchingSelector(content, "p sub");
        super.removeUnwantedElementsFromContentElement(content);
    }
}