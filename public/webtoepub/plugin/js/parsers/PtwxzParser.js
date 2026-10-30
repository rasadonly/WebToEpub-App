"use strict";

parserFactory.register("piaotia.com", () => new PtwxzParser());

class PtwxzParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let tocUrl = dom.querySelector("#content table tbody tr td table caption a").href;
        let tocDom = await this.fetchChapter(tocUrl);
        let table = tocDom.querySelector("div.centent");
        return util.hyperlinksToChapterList(table);
    }

    findContent(dom) {
        // Backend bodyPiaotia: the prose has no container — it lives as
        // direct body children between the toplink and bottomlink markers.
        // Slice that region (cloned, so the source dom stays intact); the
        // existing denylist cleanup still runs on the result.
        let top = dom.querySelector("div.toplink");
        let bottom = dom.querySelector("div.bottomlink");
        if (top != null && bottom != null) {
            let container = dom.createElement("div");
            let node = top.nextSibling;
            while (node != null && node !== bottom) {
                container.appendChild(node.cloneNode(true));
                node = node.nextSibling;
            }
            if (0 < container.childNodes.length) {
                return container;
            }
        }
        return dom.querySelector("body");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("#content table table table h1");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "#guild, #shop, .toplink, table, #feit2, #Commenddiv, .bottomlink");
        super.removeUnwantedElementsFromContentElement(element);
    }

    async fetchChapter(url) {
        // site does not tell us gbk is used to encode text
        let options = { makeTextDecoder: () => new TextDecoder("gbk") };
        return (await HttpClient.wrapFetch(url, options)).responseXML;
    }

    findCoverImageUrl(dom) {
        return util.extractImgSrc(dom.querySelector("#content table table a:not([tiptitle]) img")) ?? null;
    }
}
