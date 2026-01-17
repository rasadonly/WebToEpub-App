"use strict";

parserFactory.register("lorenovels.com", () => new LoreNovelsParser());

class LoreNovelsParser extends Parser {
    constructor() {
        super();
    }

    getChapterUrls(dom) {
        const toc = dom.querySelector("ul.wp-block-latest-posts__list");
        if (!toc) {
            return Promise.resolve([]);
        }

        const items = [...toc.querySelectorAll(
            "a.wp-block-latest-posts__post-title"
        )];

        return Promise.resolve(this.buildChapterList(items));
    }

    buildChapterList(items) {
        return items
            .reverse() // newest → oldest → reading order
            .map(a => ({
                sourceUrl: a.href,
                title: a.textContent.trim()
            }));
    }

    extractContent(dom) {
        const content = this.findContent(dom);
        if (!content) {
            return null;
        }

        const title = this.findChapterTitle(dom);
        if (title) {
            content.prepend(title.cloneNode(true));
        }

        this.removeUnwantedElementsFromContentElement(content);
        return content;
    }

    findContent(dom) {
        return dom.querySelector("div.entry-content.wp-block-post-content");
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeElements(
            element.querySelectorAll(
                "div.wp-block-buttons"
            )
        );
    }
}