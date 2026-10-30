"use strict";

parserFactory.register("nineheavens.org", () => new NineHeavensParser());

class NineHeavensParser extends Parser { 
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocNineHeavens: the single-page list is incomplete; the
        // full list paginates as ?tab=chapters&page=n with /chapter-N-/
        // links. Walk pages until one adds nothing new, dedupe, sort.
        let byUrl = new Map();
        let menu = dom.querySelector("ol.chapter-group__list");
        if (menu) {
            for (let ch of util.hyperlinksToChapterList(menu)) {
                if (!byUrl.has(ch.sourceUrl)) {
                    byUrl.set(ch.sourceUrl, ch);
                }
            }
        }
        let base = dom.baseURI.replace(/\/?$/, "/");
        for (let page = 1; page <= 60; ++page) {
            let pageDom;
            try {
                pageDom = (await HttpClient.wrapFetch(`${base}?tab=chapters&page=${page}`)).responseXML;
            } catch (e) {
                break;
            }
            let found = 0;
            for (let a of pageDom.querySelectorAll("a")) {
                let href = a.href || "";
                if (/\/chapter-\d+-/.test(href) && !byUrl.has(href)) {
                    byUrl.set(href, util.hyperLinkToChapter(a));
                    ++found;
                }
            }
            if (!found) {
                break;
            }
        }
        let num = (c) => parseInt((c.sourceUrl || "").match(/chapter-(\d+)/)?.[1] || "0", 10);
        return [...byUrl.values()].sort((a, b) => num(a) - num(b));
    }

    findContent(dom) {
        return dom.querySelector("article.chapter__article");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.story__identity-title");
    }


    extractDescription(dom) {
        return dom.querySelector("section.story__summary").textContent.trim();
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "div.chapter__actions, a.chapter__story-link, em.chapter__author, footer.chapter__footer");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "figure.story__thumbnail");
    }

    async fetchChapter(url) {
        return (await HttpClient.wrapFetch(url)).responseXML;
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("section.story__summary")];
    }
}
