/*
  Parses novels from webnovelfree.com.

  WordPress site. The novel page lists "Num Chapters: N" and a "Read
  now" link ?Chapter=1-<hash>; each chapter page links to the next
  chapter as ?Chapter=<n>-<hash> (a per-chapter hash, not derivable),
  so the chapter list is built by following that chain from chapter 1.
  Chapter prose lives in .entry-content.reader-content. Note: direct
  fetches from datacenter IPs get HTTP 403 — the server reaches the
  site through its proxies (see CF_PROTECTED), and the browser engine
  here runs on the user's own connection, which the site accepts.
*/
"use strict";

parserFactory.register("webnovelfree.com", () => new WebNovelFreeParser());

class WebNovelFreeParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/webnovelfree\.com\/([^/?#]+)\/?/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = WebNovelFreeParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the webnovelfree.com novel slug from URL: ${dom.baseURI}\nExpected a URL like webnovelfree.com/<slug>/`);
        }
        this.novelSlug = slug;
        let titleEl = dom.querySelector("h1") || dom.querySelector(".entry-title");
        let title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) {
            let t = dom.querySelector("title");
            title = t ? t.textContent.trim() : "";
        }
        this.title = title || slug.replace(/-/g, " ");
        let desc = dom.querySelector("meta[name='description']");
        this.description = desc ? (desc.getAttribute("content") || "").trim() : "";
        let authorEl = dom.querySelector("tr.authors td.value");
        this.author = authorEl ? authorEl.textContent.trim() : "";
        return;
    }

    async getChapterUrls() {
        let novelUrl = "https://webnovelfree.com/" + this.novelSlug + "/";
        // Total chapters from the info table ("Num Chapters: N").
        let total = 0;
        let numEl = document.querySelector(".num-chapters .value");
        if (numEl) total = parseInt((numEl.textContent || "").replace(/[^0-9]/g, ""), 10) || 0;
        // First chapter from the "Read now" link (?Chapter=1-<hash>).
        let first = null;
        for (let a of document.querySelectorAll("a[href]")) {
            let href = a.getAttribute("href") || "";
            let m = href.match(/\?Chapter=(\d+)-([0-9a-f]+)/i);
            if (m) { first = { num: parseInt(m[1], 10), hash: m[2] }; break; }
        }
        if (!first) {
            throw new Error("WebNovelFree: no chapters found for this novel");
        }
        let chapters = [];
        let seen = new Set();
        let cur = first;
        // Follow the next-chapter chain. Sequential by nature (each step
        // needs the previous page's next link).
        while (cur) {
            let chapterUrl = novelUrl + "?Chapter=" + cur.num + "-" + cur.hash;
            if (seen.has(chapterUrl)) break;
            seen.add(chapterUrl);
            chapters.push({ sourceUrl: chapterUrl, title: "Chapter " + cur.num });
            if (total && chapters.length >= total) break;
            if (chapters.length > 10000) break;
            let next = null;
            try {
                let dom = (await HttpClient.fetchHtml(chapterUrl)).responseXML;
                for (let a of dom.querySelectorAll("a[href]")) {
                    let href = a.getAttribute("href") || "";
                    let m = href.match(/\?Chapter=(\d+)-([0-9a-f]+)/i);
                    if (m && parseInt(m[1], 10) === cur.num + 1) {
                        next = { num: parseInt(m[1], 10), hash: m[2] };
                        break;
                    }
                }
            } catch (e) {
                break;
            }
            cur = next;
        }
        if (chapters.length === 0) {
            throw new Error("WebNovelFree: no chapters found for this novel");
        }
        return chapters;
    }

    findContent(dom) {
        return dom.querySelector(".entry-content.reader-content") || Parser.findConstrutedContent(dom);
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
