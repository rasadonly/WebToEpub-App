/*
  Parses novels from readallnovel.online.

  The novel page server-renders the FULL chapter list: /novel/<slug>
  has every /novel/<slug>/chapter/<n> link (verified live: A Court Of
  Lost Stars, 1,232 chapters, contiguous 1..1232). Chapter prose lives
  in the .reader-content div of the chapter page.

  NOTE: the site's search API (/api.php?endpoint=search, /api/search)
  404s server-side, so there is no dedicated server search here — the
  generic engine search covers it.
*/
"use strict";

parserFactory.register("readallnovel.online", () => new ReadAllNovelParser());

class ReadAllNovelParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/\/novel\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = ReadAllNovelParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the readallnovel.online novel slug from URL: ${dom.baseURI}\nExpected a URL like readallnovel.online/novel/<slug>`);
        }
        this.novelSlug = slug;
        let titleEl = dom.querySelector("h1");
        let title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) {
            let t = dom.querySelector("title");
            title = t ? t.textContent.replace(/\s*[–-]\s*Read.*$/i, "").trim() : "";
        }
        this.title = title || slug.replace(/-/g, " ");
        let desc = dom.querySelector("meta[name='description']");
        this.description = desc ? (desc.getAttribute("content") || "").trim() : "";
        this.author = "";
        return;
    }

    async getChapterUrls() {
        // The novel page already holds the full chapter list.
        let chapters = [];
        let seen = new Set();
        let re = new RegExp("/novel/" + this.novelSlug + "/chapter/(\\d+)(?:[/?#]|$)", "i");
        for (let a of document.querySelectorAll("a[href]")) {
            let href = a.getAttribute("href") || "";
            let m = href.match(re);
            if (!m) continue;
            let abs = new URL(href, "https://readallnovel.online").href;
            if (seen.has(abs)) continue;
            seen.add(abs);
            chapters.push({
                sourceUrl: abs,
                title: (a.textContent || "").trim() || ("Chapter " + m[1])
            });
        }
        if (chapters.length === 0) {
            throw new Error("ReadAllNovel: no chapters found for this novel");
        }
        chapters.sort((x, y) => {
            let nx = parseInt((x.sourceUrl.match(/\/chapter\/(\d+)/) || [0, 0])[1], 10);
            let ny = parseInt((y.sourceUrl.match(/\/chapter\/(\d+)/) || [0, 0])[1], 10);
            return nx - ny;
        });
        return chapters;
    }

    findContent(dom) {
        return dom.querySelector(".reader-content") || Parser.findConstrutedContent(dom);
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
