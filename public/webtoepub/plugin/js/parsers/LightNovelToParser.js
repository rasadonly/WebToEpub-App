/*
  Parses novels from lightnovel.to.

  The site is Next.js. Novel pages are server-rendered, so the title
  and description come from the page itself, and chapter prose lives
  in the `.ln-prose` div of the chapter page. But the novel page only
  renders 16 chapters (first 4 + last 12) — the full list comes from
  the site's own open chapters API, which its "Show all" button calls:

  - Chapter list:  GET /api/novel-chapters?slug=<slug>
    Returns {chapters: [{id, slug, number, title}]} — all chapters
    in one call, no login needed (verified live: 216 chapters for
    Ascendance of a Bookworm).
  - Chapter text:  the chapter page's `.ln-prose` div (server HTML).

  NOTE: the site's /api/search endpoint exists but returns
  {"total":0,"results":[]} for every query (verified in a real
  browser too), so server search parses the /search?q=... page
  instead. That lives on the server side, not here.
*/
"use strict";

parserFactory.register("lightnovel.to", () => new LightNovelToParser());

class LightNovelToParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/\/novel\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = LightNovelToParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the lightnovel.to novel slug from URL: ${dom.baseURI}\nExpected a URL like lightnovel.to/novel/<slug>`);
        }
        this.novelSlug = slug;
        // The novel page is server-rendered: title and description are
        // in the page. Fall back to the URL slug if the page is bare.
        let titleEl = dom.querySelector("h1");
        let title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) {
            let t = dom.querySelector("title");
            title = t ? t.textContent.replace(/\s*[–-]\s*Read Online Free.*$/i, "").trim() : "";
        }
        this.title = title || slug.replace(/-/g, " ");
        let desc = dom.querySelector("meta[name='description']");
        this.description = desc ? (desc.getAttribute("content") || "").trim() : "";
        this.author = "";
        return;
    }

    async getChapterUrls() {
        let data = (await HttpClient.fetchJson(
            "https://lightnovel.to/api/novel-chapters?slug=" + encodeURIComponent(this.novelSlug)
        )).json;
        let items = Array.isArray(data) ? data : (data?.chapters || []);
        if (items.length === 0) {
            throw new Error("LightNovel.to: no chapters found for this novel");
        }
        let chapters = [];
        for (let ch of items) {
            if (!ch?.slug) continue;
            chapters.push({
                sourceUrl: "https://lightnovel.to/novel/" + this.novelSlug + "/" + ch.slug,
                title: ch.title || ("Chapter " + (ch.number ?? chapters.length + 1))
            });
        }
        return chapters;
    }

    findContent(dom) {
        return dom.querySelector(".ln-prose") || Parser.findConstrutedContent(dom);
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
