/*
  Parses novels from novelping.com.

  Laravel site. The novel page only renders the first 30 chapters;
  the full list comes from GET /ajax/chapter-archive?novelId=<slug>
  (verified live: A Foodie Transmigrated into the Palace, all 1,648
  chapters in one call). Chapter prose lives in .chr-c.
*/
"use strict";

parserFactory.register("novelping.com", () => new NovelPingParser());

class NovelPingParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/\/book\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = NovelPingParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the novelping.com book slug from URL: ${dom.baseURI}\nExpected a URL like novelping.com/book/<slug>`);
        }
        this.novelSlug = slug;
        let titleEl = dom.querySelector("h1");
        let title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) {
            let t = dom.querySelector("title");
            title = t ? t.textContent.replace(/\s*[|–-]\s*NovelPing.*$/i, "").trim() : "";
        }
        this.title = title || slug.replace(/-/g, " ");
        let desc = dom.querySelector("meta[name='description']");
        this.description = desc ? (desc.getAttribute("content") || "").trim() : "";
        let authorMeta = dom.querySelector("meta[property='og:novel:author']");
        this.author = authorMeta ? (authorMeta.getAttribute("content") || "").trim() : "";
        return;
    }

    async getChapterUrls() {
        // NOTE: the chapter-archive response is an HTML fragment whose
        // chapter links live inside <template> elements, which
        // querySelectorAll does not traverse — so fetch the raw HTML and
        // extract the links with a regex instead of parsing a DOM.
        let html = (await HttpClient.fetchText(
            "https://novelping.com/ajax/chapter-archive?novelId=" + encodeURIComponent(this.novelSlug)
        )).text || "";
        let chapters = [];
        let seen = new Set();
        let anchorRe = new RegExp(
            "<a[^>]*href=\"([^\"]*/book/" + this.novelSlug + "/chapter-(\\d+)-[^\"]*)\"[^>]*>",
            "gi"
        );
        let m;
        while ((m = anchorRe.exec(html)) !== null) {
            let abs = new URL(m[1], "https://novelping.com").href;
            if (seen.has(abs)) continue;
            seen.add(abs);
            let titleAttr = m[0].match(/title="([^"]*)"/i);
            chapters.push({
                sourceUrl: abs,
                title: (titleAttr ? titleAttr[1].trim() : "") || ("Chapter " + m[2])
            });
        }
        if (chapters.length === 0) {
            throw new Error("NovelPing: no chapters found for this book");
        }
        chapters.sort((x, y) => {
            let nx = parseInt((x.sourceUrl.match(/\/chapter-(\d+)-/) || [0, 0])[1], 10);
            let ny = parseInt((y.sourceUrl.match(/\/chapter-(\d+)-/) || [0, 0])[1], 10);
            return nx - ny;
        });
        return chapters;
    }

    findContent(dom) {
        return dom.querySelector(".chr-c") || dom.querySelector("#chapter") || Parser.findConstrutedContent(dom);
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
}
