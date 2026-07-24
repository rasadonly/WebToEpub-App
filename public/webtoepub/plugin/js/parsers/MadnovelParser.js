"use strict";

parserFactory.register("madnovel.com", () => new MadnovelParser());
parserFactory.register("novelbuddy.com", () => new MadnovelParser());
parserFactory.register("novelbuddy.io", () => new MadnovelParser());

class MadnovelParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let menu = dom.querySelector(".chapter-list, ul.divide-y.divide-border");
        if (menu == null) { return []; }

        let linkSet = new Set();
        let includeLink = function(link) {
            let text = link.innerText || link.textContent;
            if (util.isNullOrEmpty(text) || util.isNullOrEmpty(link.href)) {
                return false;
            }
            let href = util.normalizeUrlForCompare(link.href);
            if (linkSet.has(href)) {
                return false;
            }
            linkSet.add(href);
            return true;
        };

        return util.getElements(menu, "a", a => includeLink(a))
            .map(link => {
                let titleElement = link.querySelector("strong, span.truncate");
                let title = titleElement ? (titleElement.innerText || titleElement.textContent) : (link.innerText || link.textContent);
                return {
                    sourceUrl: link.href,
                    title: title.trim(),
                    newArc: null
                };
            })
            .reverse();
    }

    findContent(dom) {
        return dom.querySelector(".content-inner, #chapter-content, .chapter-content, #article, .reading-content, .novel-reader-content, .novel-tts-content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }

    extractAuthor(dom) {
        let authorLabel = [...dom.querySelectorAll("a[href*='authors']")].map(x => x.textContent.trim());
        return (authorLabel.length === 0) ? super.extractAuthor(dom) : authorLabel.join(", ");
    }

    extractSubject(dom) {
        let tags = [...dom.querySelectorAll("a[href*='genres']")];
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, ".ads-banner, .content-inner > br");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("#chapter__content h1, .chapter-title, h1");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".img-cover, img.object-cover, .book-cover img");
    }

    getInformationEpubItemChildNodes(dom) {
        let summary = dom.querySelector(".section-body.summary, .line-clamp-4, .summary p");
        return summary ? [summary] : [];
    }
}
