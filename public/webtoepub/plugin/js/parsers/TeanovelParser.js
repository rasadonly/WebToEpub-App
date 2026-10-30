"use strict";

parserFactory.register("teanovel.com", () => new TeanovelParser());
//dead url
parserFactory.register("teanovel.net", () => new TeanovelParser());

class TeanovelParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocTeanovel: the full list is a first-party JSON endpoint
        // keyed by the book slug. The HTML chapter-list page renders only a
        // slice (~18 links), so it is only a degraded fallback.
        let url = new URL(dom.baseURI);
        let storyName = url.pathname.split("/").filter(Boolean).pop();
        try {
            let json = (await HttpClient.fetchJson(
                `${url.origin}/api/novel/chapter-list?slug=${encodeURIComponent(storyName)}`)).json;
            let rows = Array.isArray(json?.data) ? json.data : [];
            if (0 < rows.length) {
                return rows.slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map(c => ({
                        sourceUrl: `${url.origin}/novel/${storyName}/${c.order}`,
                        title: c.title || `Chapter ${c.order}`
                    }));
            }
        } catch (e) {
            // fall through to the HTML chapter-list page
        }
        let tocUrl = `${url.origin}/novel/${storyName}/chapter-list`;
        let chapterDom = (await HttpClient.fetchHtml(tocUrl)).responseXML;
        return [...chapterDom.querySelectorAll("a.flex")]
            .map(a => this.linkToChapter(a))
            .filter(a => a.title);
    }

    linkToChapter(link) {
        return ({
            sourceUrl:  link.href,
            title: link.querySelector("p.text-sm")?.innerText?.trim(),
        });
    }

    findContent(dom) {
        return dom.querySelector("div.prose");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "flex");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1");
    }

    findCoverImageUrl(dom) {
        return util.extractImgSrc(dom.querySelector("main img"));
    }
    getInformationEpubItemChildNodes(dom) {
        return [dom.querySelector("article")];
    }
}
