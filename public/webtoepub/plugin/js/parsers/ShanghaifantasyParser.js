"use strict";

parserFactory.register("shanghaifantasy.com", () => new ShanghaifantasyParser());

class ShanghaifantasyParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let category = this.extractCategory(dom);
        if (!category) {
            let novelLink = dom?.querySelector?.("a[href*='/novel/']")?.href;
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
        const perPage = 50;
        while (page <= 200) {
            let tocUrl = `https://shanghaifantasy.com/wp-json/fiction/v1/chapters?category=${category}&order=asc&page=${page}&per_page=${perPage}`;
            try {
                let res = await HttpClient.fetchJson(tocUrl);
                let json = res?.json;
                if (!Array.isArray(json) || json.length === 0) break;

                let pageUrls = this.buildChapterUrls(json);
                allChapters.push(...pageUrls);

                if (json.length < perPage) break;
                page++;
            } catch (err) {
                console.warn(`[Shanghaifantasy] Failed to fetch page ${page}:`, err);
                break;
            }
        }

        return allChapters.length > 0 ? allChapters : super.getChapterUrls(dom);
    }

    extractCategory(dom) {
        if (!dom) return null;

        // 1. Direct querySelector
        if (typeof dom.querySelector === "function") {
            let cat = dom.querySelector("ul#chapterList")?.getAttribute("data-cat") ||
                      dom.querySelector("[data-cat]")?.getAttribute("data-cat");
            if (cat && cat !== "undefined") return cat;

            // 2. Inspect inside <template> elements (.content document fragment)
            let templates = [...(dom.querySelectorAll("template") || [])];
            for (let t of templates) {
                if (t.content && typeof t.content.querySelector === "function") {
                    let tCat = t.content.querySelector("ul#chapterList")?.getAttribute("data-cat") ||
                               t.content.querySelector("[data-cat]")?.getAttribute("data-cat");
                    if (tCat && tCat !== "undefined") return tCat;
                }
            }
        }

        // 3. Regex search on full HTML string
        let htmlText = "";
        try {
            if (dom.documentElement) htmlText = dom.documentElement.outerHTML || dom.documentElement.innerHTML || "";
            else if (dom.body) htmlText = dom.body.innerHTML || "";
            else if (typeof dom === "string") htmlText = dom;
        } catch (e) {
            // ignore
        }

        let match = htmlText.match(/data-cat=["']?(\d+)["']?/i) ||
                    htmlText.match(/category=(\d+)/i);
        if (match && match[1]) return match[1];

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
