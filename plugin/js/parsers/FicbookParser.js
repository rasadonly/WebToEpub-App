"use strict";

parserFactory.register("ficbook.net", () => new FicbookParser());

class FicbookParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let links = [...dom.querySelectorAll("a.part-link")];
        if (links.length == 0) {
            return [{
                sourceUrl: dom.baseURI, 
                title: dom.querySelector("#part_content > div.title-area.text-center.word-break > h2").textContent
            }];
        }
        let chapters = [];
        for (let link of links) {
            chapters.push({
                sourceUrl: link.href,
                title: link.innerText
            });
            chapterUrlsUI.showTocProgress(chapters);
        }
        return chapters;
    }

    findCoverImageUrl(dom) {
        return dom.querySelector("meta[property='og:image']").getAttribute("content");
    }
    // find the node(s) holding the story content
    findContent(dom) {
        return dom.querySelector("#content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.heading[itemprop='name']");
    }

    extractAuthor(dom) {
        let author = dom.querySelector("a.creator-username")?.innerText;
        return author ?? super.extractAuthor(dom);
    }

    extractLanguage(dom) {
        return dom.querySelector("html").getAttribute("lang");
    }

    extractSubject(dom) {
        let tags = ([...dom.querySelectorAll("div.description strong, div.description a")]);
        return tags.map(e => e.textContent).join(", ");
    }

    extractDescription(dom) {
        return dom.querySelector("meta[name='description']")?.textContent;
    }

    findChapterTitle(dom) {
        return dom.querySelector("#part_content h2[itemprop='headline']");
    }
}
