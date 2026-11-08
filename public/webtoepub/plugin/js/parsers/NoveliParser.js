/*
  Parses novels from noveli.to ("Novelito").

  The site is a Vite SPA, so the novel/chapter pages carry no usable
  HTML — TOC and chapter text come from its open REST API instead,
  exactly like JadeScrollsParser does. No login is needed.
  The chapter-content endpoint returns 403 to plain requests
  ("automated scraping agents are strictly prohibited"), so the
  browser's own User-Agent is what lets the call through.

  - Novel meta:    GET /api/novels/<slug>
  - Chapter list:  GET /api/novels/<slug>/chapters (all chapters in
    one call; limit/offset are ignored)
  - Chapter text:  GET /api/novels/<slug>/chapters/<chapter-slug>
    The prose is in `paragraphs` (a list of {id, text, html}), NOT
    in content/raw_content/compressed_content (all null). The first
    paragraphs are reader-settings UI that leaked into the list
    ("Provided by Noveli.to", "Settings", "Font Size", "A", "16px",
    "Font Family", "Background Color") plus a support footer at the
    end — filtered by exact text. Paragraphs also carry zero-width
    characters (U+200B/U+200C/U+200D), stripped here.

  NOTE: a chapter slug's embedded number is the SOURCE site's number
  and does NOT match noveli's chapter_number (ch. 500's slug says
  503), so chapters are always fetched by slug, never by parsed
  number.
*/
"use strict";

parserFactory.register("noveli.to", () => new NoveliParser());

class NoveliParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/\/novel\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    static chapterSlugFromUrl(url) {
        let m = String(url || "").match(/\/novel\/[^/?#]+\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = NoveliParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the noveli novel slug from URL: ${dom.baseURI}\nExpected a URL like noveli.to/novel/<slug>`);
        }
        let novel = (await HttpClient.fetchJson("https://noveli.to/api/novels/" + encodeURIComponent(slug))).json?.data;
        if (!novel || !novel.title) {
            throw new Error(`Noveli: novel not found for slug "${slug}"`);
        }
        this.novelSlug = slug;
        this.title = novel.title || "";
        this.author = novel.author || "";
        this.description = String(novel.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        let cover = novel.cover_image || "";
        this.img = cover
            ? (cover.startsWith("http") ? cover : "https://noveli.to" + (cover.startsWith("/") ? "" : "/") + cover)
            : "";
        return;
    }

    async getChapterUrls() {
        let data = (await HttpClient.fetchJson(
            "https://noveli.to/api/novels/" + encodeURIComponent(this.novelSlug) + "/chapters"
        )).json;
        let items = data?.chapters || [];
        if (items.length === 0) {
            throw new Error("Noveli: no chapters found for this novel");
        }
        let chapters = [];
        for (let ch of items) {
            if (!ch?.slug) continue;
            chapters.push({
                sourceUrl: "https://noveli.to/novel/" + this.novelSlug + "/" + ch.slug,
                title: ch.title || ("Chapter " + (ch.chapter_number ?? chapters.length + 1))
            });
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
        let novelSlug = NoveliParser.novelSlugFromUrl(url);
        let chapterSlug = NoveliParser.chapterSlugFromUrl(url);
        if (!novelSlug || !chapterSlug) {
            throw new Error(`Could not extract the noveli novel/chapter slug from URL: ${url}\nExpected a URL like noveli.to/novel/<novel-slug>/<chapter-slug>`);
        }
        let data = (await HttpClient.fetchJson(
            "https://noveli.to/api/novels/" + encodeURIComponent(novelSlug) +
            "/chapters/" + encodeURIComponent(chapterSlug)
        )).json;
        let paragraphs = data?.chapter?.paragraphs || [];
        let texts = NoveliParser.cleanParagraphs(paragraphs);
        if (texts.length === 0) {
            throw new Error("Noveli: this chapter has no readable content");
        }
        return this.buildChapter(data, url, texts);
    }

    // Reader-settings UI that leaks into the chapter `paragraphs` list,
    // plus the support footer. Matched on exact trimmed text.
    static cleanParagraphs(paragraphs) {
        const JUNK = new Set([
            "Provided by Noveli.to",
            "Settings",
            "Font Size",
            "A",
            "16px",
            "Font Family",
            "Background Color",
            "If you want to support more free releases please read on Noveli.to"
        ]);
        let out = [];
        for (let p of paragraphs || []) {
            let t = (typeof p === "string") ? p : (p?.text || "");
            // Strip zero-width characters used as invisible watermarking.
            t = t.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
            if (t && !JUNK.has(t)) out.push(t);
        }
        return out;
    }

    buildChapter(data, url, texts) {
        let newDoc = Parser.makeEmptyDocForContent(url);
        let title = newDoc.dom.createElement("h1");
        title.textContent = data?.chapter?.title || "";
        newDoc.content.appendChild(title);
        for (let text of texts) {
            let p = newDoc.dom.createElement("p");
            p.appendChild(newDoc.dom.createTextNode(text));
            newDoc.content.appendChild(p);
        }
        return newDoc.dom;
    }
}
