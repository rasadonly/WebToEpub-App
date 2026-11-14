/*
  Parses novels from novelroll.com.

  Laravel Livewire site. The novel page only renders the first/last
  few chapters; the full list is paginated at /book/<slug>?toc (page 1)
  and ?toc&page=2..N, 1,000 chapters per page (verified live: Chaotic
  Sword God, 4,038 chapters across 5 pages). A real chapter link is
  /book/<slug>/chapter-<n>-<title>; the unreleased "forecast" chapter
  is just /book/<slug>/chapter-<n> with no title slug, so requiring the
  trailing hyphen after the number excludes it. Chapter prose lives in
  article.prose.
*/
"use strict";

parserFactory.register("novelroll.com", () => new NovelRollParser());

class NovelRollParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 500;
    }

    static novelSlugFromUrl(url) {
        let m = String(url || "").match(/\/book\/([^/?#]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async loadEpubMetaInfo(dom) {
        let slug = NovelRollParser.novelSlugFromUrl(dom.baseURI);
        if (!slug) {
            throw new Error(`Could not extract the novelroll.com book slug from URL: ${dom.baseURI}\nExpected a URL like novelroll.com/book/<slug>`);
        }
        this.novelSlug = slug;
        let titleEl = dom.querySelector("h1");
        let title = titleEl ? titleEl.textContent.trim() : "";
        if (!title) {
            let t = dom.querySelector("title");
            title = t ? t.textContent.replace(/\s*[|–-]\s*NovelRoll.*$/i, "").trim() : "";
        }
        this.title = title || slug.replace(/-/g, " ");
        let desc = dom.querySelector("meta[name='description']");
        this.description = desc ? (desc.getAttribute("content") || "").trim() : "";
        this.author = "";
        return;
    }

    async getChapterUrls() {
        let base = "https://novelroll.com/book/" + this.novelSlug;
        let chapters = [];
        let seen = new Set();
        let collect = (dom) => {
            let added = 0;
            let re = new RegExp("/book/" + this.novelSlug + "/chapter-(\\d+)(?:-|[/?#]|$)", "i");
            for (let a of dom.querySelectorAll("a[href]")) {
                let href = a.getAttribute("href") || "";
                let m = href.match(re);
                if (!m) continue;
                // The unreleased "forecast" link reads "When will Chapter N
                // come out ?" and its list entry carries class
                // text-secondary — skip both forms. No-title chapter links
                // (e.g. /chapter-2249) are real chapters, so they stay.
                let text = (a.textContent || "").trim();
                let cls = a.getAttribute("class") || "";
                if (/when will chapter \d+ come out/i.test(text)) continue;
                if (/\btext-secondary\b/i.test(cls)) continue;
                let abs = new URL(href, "https://novelroll.com").href;
                if (seen.has(abs)) continue;
                seen.add(abs);
                chapters.push({
                    sourceUrl: abs,
                    title: text || ("Chapter " + m[1])
                });
                added++;
            }
            return added;
        };
        let firstDom = (await HttpClient.fetchHtml(base + "?toc")).responseXML;
        collect(firstDom);
        // Read the max page from the pagination links (?toc&page=N).
        let maxPage = 1;
        for (let a of firstDom.querySelectorAll("a[href]")) {
            let href = a.getAttribute("href") || "";
            let m = href.match(/[?&]page=(\d+)/i);
            if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
        }
        for (let p = 2; p <= maxPage; p++) {
            let dom = (await HttpClient.fetchHtml(base + "?toc&page=" + p)).responseXML;
            collect(dom);
        }
        if (chapters.length === 0) {
            throw new Error("NovelRoll: no chapters found for this book");
        }
        chapters.sort((x, y) => {
            let nx = parseInt((x.sourceUrl.match(/\/chapter-(\d+)-/) || [0, 0])[1], 10);
            let ny = parseInt((y.sourceUrl.match(/\/chapter-(\d+)-/) || [0, 0])[1], 10);
            return nx - ny;
        });
        return chapters;
    }

    findContent(dom) {
        return dom.querySelector("article.prose") || Parser.findConstrutedContent(dom);
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
