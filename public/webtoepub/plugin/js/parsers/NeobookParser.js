"use strict";

parserFactory.register("neobook.org", () => new NeobookParser());

class NeobookParser extends Parser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocNeobook: book/reader pages embed a `var data` state
        // object; build /reader/?book=&chapter={token} URLs from its
        // chapters[] sorted by `sort`. Fall back to the legacy list.
        try {
            let script = [...dom.querySelectorAll("script")]
                .filter(s => s.textContent.includes("var data = "))
                .map(s => s.textContent)[0];
            if (script) {
                let json = util.locateAndExtractJson(script, "var data = ");
                let chapters = json?.chapters;
                if (Array.isArray(chapters) && 0 < chapters.length) {
                    let book = null;
                    let origin = null;
                    try {
                        let u = new URL(dom.baseURI);
                        book = u.pathname.match(/\/book\/([^/]+)/)?.[1] || u.searchParams.get("book");
                        origin = u.origin;
                    } catch (e) { /* fall through */ }
                    if (book && origin) {
                        return chapters.slice()
                            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
                            .map(c => ({
                                sourceUrl: `${origin}/reader/?book=${book}&chapter=${c.token}`,
                                title: c.title || `Chapter ${c.sort}`
                            }));
                    }
                }
            }
        } catch (e) { /* fall through to legacy list */ }
        let menu = dom.querySelector("div#book-about-chapters");
        return util.hyperlinksToChapterList(menu);
    }

    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("div.book-title");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.book-cover-wrapper");
    }

    async fetchChapter(url) {
        let rawHTML = (await HttpClient.fetchHtml(url)).responseXML;
        let json = this.extractJson(rawHTML);
        return this.buildChapter(json, url);
    }

    extractJson(rawHTML) {
        let prefix = "var data = ";
        let script = [...rawHTML.querySelectorAll("script")]
            .filter(s => s.textContent.includes(prefix))
            .map(s => s.textContent)[0];
        return util.locateAndExtractJson(script, prefix);
    }

    buildChapter(json, url) {
        // Backend bodyNeobook: select the chapter whose token matches the
        // URL param AND loaded === "1" (the old code took the first chapter
        // with any html, i.e. usually chapter 1 regardless of request).
        let token = null;
        try {
            token = new URL(url).searchParams.get("chapter");
        } catch (e) { /* fall through */ }
        let chapter = json.chapters
            .filter(c => c?.token === token && String(c.loaded) === "1" && (c?.data?.html || c?.html))[0]
            || json.chapters.filter(c => c?.data?.html != null)[0];
        let newDoc = Parser.makeEmptyDocForContent(url);
        let title = newDoc.dom.createElement("h1");
        title.textContent = chapter.data?.title || chapter.title;
        newDoc.content.appendChild(title);
        let content = util.sanitize(chapter.data?.html || chapter.html);
        util.moveChildElements(content.body, newDoc.content);
        return newDoc.dom;
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("#book-about-description")];
    }
}
