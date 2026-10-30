"use strict";

parserFactory.register("snoutandco.ca", () => new SnoutandcoParser());

class SnoutandcoParser extends Parser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocSnoutAndCo: the directory is JS-built, so the static
        // list is incomplete; the book URL carries ?folder=, and
        // /{folder}/chapters.json lists every chapter (filename URLs).
        let folder = null;
        try {
            folder = new URL(dom.baseURI).searchParams.get("folder");
        } catch (e) { /* fall through */ }
        if (folder) {
            try {
                let origin = new URL(dom.baseURI).origin;
                let json = await HttpClient.fetchJson(`${origin}/${folder}/chapters.json`);
                let chapters = json?.chapters;
                if (Array.isArray(chapters) && 0 < chapters.length) {
                    let chapterList = chapters.map(c => ({
                        sourceUrl: `${origin}/${folder}/chapters/${c.filename}`,
                        title: c.title || c.filename
                    }));
                    SnoutandcoParser.titles = new Map();
                    chapterList.forEach(l => SnoutandcoParser.titles.set(l.sourceUrl, l.title));
                    return chapterList;
                }
            } catch (e) { /* fall through to legacy list */ }
        }
        let menu = dom.querySelector("ul.list-group");
        let chapterList = util.hyperlinksToChapterList(menu);

        // save titles to add back when fetch chapter content
        SnoutandcoParser.titles = new Map();
        chapterList.forEach(l => SnoutandcoParser.titles.set(l.sourceUrl, l.title));

        return chapterList;
    }

    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1#book-title");
    }

    async fetchChapter(url) {
        let params = new URL(url).searchParams;
        let folder = params.get("folder");
        let chapter = params.get("chapter");
        // New TOC URLs are path-based (/{folder}/chapters/{filename}) and
        // are already the .txt content URL; legacy URLs carry ?folder=&chapter=.
        let contentUrl = (folder && chapter)
            ? `https://snoutandco.ca/${folder}/chapters/${chapter}`
            : url;
        let contentText = (await HttpClient.fetchText(contentUrl));
        return this.buildChapter(contentText, url);
    }

    buildChapter(contentText, url) {
        let newDoc = Parser.makeEmptyDocForContent(url);
        let title = newDoc.dom.createElement("h1");
        title.textContent = SnoutandcoParser.titles.get(url);
        newDoc.content.appendChild(title);
        Parser.addTextToChapterContent(newDoc, contentText);
        return newDoc.dom;
    }
}
