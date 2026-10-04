"use strict";

parserFactory.register("shanghaifantasy.com", () => new ShanghaifantasyParser());

class ShanghaifantasyParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let category = this.extractCategory(dom);
        if (!category) {
            let novelLink = dom.querySelector("a[href*='/novel/']")?.href;
            if (novelLink) {
                try {
                    let novelDom = (await HttpClient.wrapFetch(novelLink)).responseXML;
                    category = this.extractCategory(novelDom);
                } catch (e) {
                    // ignore
                }
            }
        }

        if (!category) {
            return super.getChapterUrls(dom);
        }

        let allChapters = [];
        let page = 1;
        while (true) {
            let tocUrl = `https://shanghaifantasy.com/wp-json/fiction/v1/chapters?category=${category}&order=asc&page=${page}&per_page=100`;
            try {
                let res = await HttpClient.fetchJson(tocUrl);
                let json = res?.json;
                if (!Array.isArray(json) || json.length === 0) break;

                let pageUrls = this.buildChapterUrls(json);
                allChapters.push(...pageUrls);

                if (json.length < 100) break;
                page++;
            } catch (err) {
                break;
            }
        }

        return allChapters.length > 0 ? allChapters : super.getChapterUrls(dom);
    }

    extractCategory(dom) {
        if (!dom || typeof dom.querySelector !== "function") return null;
        let cat = dom.querySelector("ul#chapterList")?.getAttribute("data-cat");
        if (cat && cat !== "undefined") return cat;
        return null;
    }

    buildChapterUrls(json) {
        return json.map(a => ({
            title: a.title,
            sourceUrl: a.permalink 
        }));
    }

    findContent(dom) {
        let content = dom.querySelector("div.contenta");
        if (content) {
            let childCount = content.querySelectorAll("div, p").length;
            if (childCount > 3) return content;
        }
        return dom.querySelector("body > div.flex") || dom.querySelector("div.contenta");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("title")?.textContent ?? null;
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, ".patreon1, section, nav, button, template, #comments, footer, .hideme, .ai-viewports, .code-block, script, ins");

        for (let e of [...element.querySelectorAll("div")]) {
            e.removeAttribute(":style");
            e.removeAttribute(":class");
            e.removeAttribute("@click.outside");
        }

        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("title")?.textContent ?? null;
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".flex-col");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div#editdescription")];
    }
}
