"use strict";

parserFactory.register("novelhi.com", () => new NovelhiParser());

class NovelhiParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let tocUrl = dom.querySelector("div.bookChapter a.fr");
        let tocDom = (await HttpClient.wrapFetch(tocUrl)).responseXML;
        return [...tocDom.querySelectorAll("div.dirList a")]
            .map(a => NovelhiParser.LinkToChapter(a, dom.baseURI));
    }

    static LinkToChapter(link, baseURI) {
        let sourceUrl = link.getAttribute("href") || link.href;
        if (sourceUrl && !sourceUrl.startsWith("http")) {
            sourceUrl = new URL(sourceUrl, baseURI).href;
        }
        return {
            sourceUrl: sourceUrl,
            title: link.querySelector("span")?.textContent?.trim() || link.textContent.trim()
        };
    }

    async fetchChapter(url) {
        let dom = (await HttpClient.wrapFetch(url)).responseXML;
        // Backend bodyNovelHi: the chapter page is a "Loading chapter..."
        // shell; the prose comes from a tokenized JSON endpoint, ROT13'd.
        // Fetch it and plant the decoded prose where findContent looks.
        try {
            let pathEl = dom.querySelector("#chapterContentPath");
            let tokenEl = dom.querySelector("#chapterContentToken");
            let path = pathEl?.value || pathEl?.getAttribute("value");
            let token = tokenEl?.value || tokenEl?.getAttribute("value");
            if (path && token) {
                let ep = new URL(path, url).href + (path.includes("?") ? "&" : "?")
                    + "token=" + encodeURIComponent(token);
                let data = await HttpClient.fetchJson(ep);
                let content = data?.data?.content;
                if (content) {
                    let target = dom.querySelector("#readcontent #showReading")
                        || dom.querySelector("#showReading")
                        || dom.querySelector("#readcontent");
                    if (target) {
                        target.innerHTML = NovelhiParser.rot13(content);
                    }
                }
            }
        } catch (e) { /* fall through to the shell */ }
        return dom;
    }

    static rot13(s) {
        return s.replace(/[a-zA-Z]/g, c =>
            String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
    }

    findContent(dom) {
        return dom.querySelector("#readcontent #showReading");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("div.tit h1");
    }

    findChapterTitle(dom) {
        return dom.querySelector("#readcontent .book_title h1");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.bookCover");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.intro_txt")];
    }

    cleanInformationNode(node) {
        util.removeChildElementsMatchingSelector(node, "a");        
        return node;
    }    
}
