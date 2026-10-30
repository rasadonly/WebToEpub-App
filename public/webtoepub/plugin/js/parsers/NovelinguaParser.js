"use strict";

parserFactory.register("novelingua.com", () => new NovelinguaParser());

class NovelinguaParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let chapters = [...dom.querySelectorAll(".pagelayer-text-holder a")]
            .map(a => util.hyperLinkToChapter(a));
        // Backend tocNovelingua: long series keep their newest tail on a
        // sibling /{series}-front/ page, linked from the main page. Merge
        // it when present, then sort by -chapter-N (extras first).
        let frontHref = [...dom.querySelectorAll("a")]
            .map(a => a.getAttribute("href"))
            .find(h => h && /\/[a-z0-9-]+-front\/?$/i.test(h));
        if (frontHref) {
            try {
                let frontUrl = new URL(frontHref, dom.baseURI).href;
                let frontDom = (await HttpClient.wrapFetch(frontUrl)).responseXML;
                let seen = new Set(chapters.map(c => c.sourceUrl));
                for (let a of frontDom.querySelectorAll(".pagelayer-text-holder a")) {
                    let ch = util.hyperLinkToChapter(a);
                    if (!seen.has(ch.sourceUrl)) {
                        chapters.push(ch);
                        seen.add(ch.sourceUrl);
                    }
                }
            } catch (e) { /* tail stays partial */ }
        }
        let num = (c) => {
            let m = (c.sourceUrl || "").match(/-chapter-(\d+)/);
            return m ? parseInt(m[1], 10) : -1;
        };
        chapters.sort((a, b) => num(a) - num(b));
        return chapters;
    }

    findContent(dom) {
        // More specific selectors are not consistently reliable even though these have more junk than I'd like
        return dom.querySelector(".entry-content") ||
            dom.querySelector("article");
    }

    customRawDomToContentStep(chapter, content) {
        this.cleanup(content);
    }

    cleanInformationNode(node) {
        this.cleanup(node);
    }

    cleanup(content) {
        content.querySelectorAll("*").forEach(element => {
            element.removeAttribute("dir");
            util.replaceSemanticInlineStylesWithTags(element, true);
            if (element.id?.startsWith("docs-internal-guid-")) {
                element.removeAttribute("id");
            }
        });
    }

    // title of the story (not title of each chapter)
    extractTitleImpl(dom) {
        return dom.querySelector(".pagelayer-heading-holder h2");
    }

    findChapterTitle(dom) {
        let canonical = dom.querySelector("link[rel='canonical']").href.split("/");
        let title = canonical.pop();
        if (title === "") {
            title = canonical.pop();
        }
        title = title.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
        return title;
    }

    findCoverImageUrl(dom) {
        let img = dom.querySelector("img.pagelayer-img");
        return (img === null) ? img : img.src;
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeElements(element.querySelectorAll(
            "style, .pagelayer-btn-holder, .pagelayer-share, .pagelayer-image_slider, .pagelayer-embed"));
        super.removeUnwantedElementsFromContentElement(element);
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll(".entry-content .pagelayer-text-holder")];
    }
}

