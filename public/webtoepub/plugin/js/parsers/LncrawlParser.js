/*
  Parses novels from lncrawl.bitanon.dev (a hosted Lightnovel Crawler).

  The site is a React SPA, so the novel/chapter pages carry no usable
  HTML — TOC and chapter text come from its REST API instead, exactly
  like JadeScrollsParser does. The API needs auth, which the server
  injects at the /api/proxy (from the server-held lncrawl login), so
  the credential never reaches the browser.

  Only the existing catalogue is used: search the catalogue at
  /api/novels, list chapters at /api/novel/{id}/chapters, read one
  chapter at /api/chapter/{id}/read. The slow cross-source search
  job is never started.
*/
"use strict";

parserFactory.register("lncrawl.bitanon.dev", () => new LncrawlParser());

class LncrawlParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelIdFromUrl(url) {
        let m = String(url || "").match(/\/novel\/([0-9a-f-]{36})/i);
        return m ? m[1] : null;
    }

    static chapterIdFromUrl(url) {
        let m = String(url || "").match(/\/read\/([0-9a-f-]{36})/i);
        return m ? m[1] : null;
    }

    async loadEpubMetaInfo(dom) {
        let novelId = LncrawlParser.novelIdFromUrl(dom.baseURI);
        if (!novelId) {
            throw new Error(`Could not extract the lncrawl novel id from URL: ${dom.baseURI}\nExpected a URL like lncrawl.bitanon.dev/novel/<uuid>`);
        }
        let novel = (await HttpClient.fetchJson("https://lncrawl.bitanon.dev/api/novel/" + novelId)).json;
        if (!novel || !novel.id) {
            throw new Error(`Lncrawl: novel not found for id "${novelId}" (it may not be in the catalogue yet)`);
        }
        this.novelId = novel.id;
        this.title = novel.title || "";
        this.author = novel.authors || "";
        this.description = novel.synopsis || "";
        this.img = novel.cover_url || "";
        return;
    }

    async getChapterUrls() {
        let chapters = [];
        let offset = 0;
        let limit = 100;
        for (;;) {
            let data = (await HttpClient.fetchJson(
                "https://lncrawl.bitanon.dev/api/novel/" + this.novelId +
                "/chapters?offset=" + offset + "&limit=" + limit
            )).json;
            let items = data?.items || [];
            for (let ch of items) {
                if (!ch?.id) continue;
                chapters.push({
                    sourceUrl: "https://lncrawl.bitanon.dev/read/" + ch.id,
                    title: ch.title || ("Chapter " + (ch.serial ?? chapters.length + 1))
                });
            }
            offset += items.length;
            let total = (typeof data?.total === "number") ? data.total : null;
            if (items.length === 0) break;
            if (total !== null && offset >= total) break;
            if (total === null && items.length < limit) break;
        }
        if (chapters.length === 0) {
            throw new Error("Lncrawl: no chapters found for this novel");
        }
        return chapters;
    }

    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    extractTitleImpl() {
        return this.title;
    }

    extractAuthor() {
        return this.author;
    }

    extractDescription() {
        return (this.description || "").trim();
    }

    findCoverImageUrl() {
        return this.img;
    }

    async fetchChapter(url) {
        let chapterId = LncrawlParser.chapterIdFromUrl(url);
        if (!chapterId) {
            throw new Error(`Could not extract the lncrawl chapter id from URL: ${url}\nExpected a URL like lncrawl.bitanon.dev/read/<uuid>`);
        }
        let data = (await HttpClient.fetchJson(
            "https://lncrawl.bitanon.dev/api/chapter/" + chapterId + "/read"
        )).json;
        let content = data?.content || "";
        if (!content.trim()) {
            throw new Error("Lncrawl: this chapter has no readable content yet — open it once in the lncrawl reader, or use Fetch Latest on the novel page, then try again");
        }
        return this.buildChapter(data, url, content);
    }

    buildChapter(data, url, content) {
        let newDoc = Parser.makeEmptyDocForContent(url);
        let title = newDoc.dom.createElement("h1");
        title.textContent = data?.chapter?.title || "";
        newDoc.content.appendChild(title);
        if (/<(p|br|div|span)[\s>]/.test(content)) {
            let clean = util.sanitize(content);
            util.moveChildElements(clean.body, newDoc.content);
        } else {
            // Plain prose text: one <p> per blank-line-separated paragraph.
            for (let para of content.split(/\n\s*\n/)) {
                para = para.trim();
                if (!para) continue;
                let p = newDoc.dom.createElement("p");
                for (let line of para.split("\n")) {
                    if (p.childNodes.length > 0) p.appendChild(newDoc.dom.createElement("br"));
                    p.appendChild(newDoc.dom.createTextNode(line.trim()));
                }
                newDoc.content.appendChild(p);
            }
        }
        return newDoc.dom;
    }
}
