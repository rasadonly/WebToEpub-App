/*
  Parses files on sonako.org
*/
"use strict";

parserFactory.register("sonako.fandom.com", () => new SonakoParser());

//-----------------------------------------------------------------------------
// class SonakoImageCollector  (derives from ImageCollector)
//-----------------------------------------------------------------------------

class SonakoImageCollector extends BakaTsukiImageCollector {
    constructor() {
        super();
    }

    //  Assume all images can be found on a web page with URL
    //  http://sonako.wikia.com/wiki/File:{data-image-name}
    //  where {data-image-name} is data-image-name element of the img tag.
    //
    extractWrappingUrl(element) {
        let tagName = element.tagName.toLowerCase();
        if (tagName === "a") {
            return element.href;
        }
        let link = element.querySelector("a");
        if (link !== null) {
            return link.href;
        }
        let img = (tagName === "img") ? element : element.querySelector("img");
        let dataImageName = img.getAttribute("data-image-name");

        // ToDo, use utilresolveRelativeUrl() rather than string concatanation
        return (dataImageName === null) ? img.src : "http://sonako.wikia.com/wiki/File:" + dataImageName;
    }

    isImageWrapperElement(element) {
        return (element.tagName === "FIGURE") ||  super.isImageWrapperElement(element);
    }
}

//-----------------------------------------------------------------------------
// class SonakoParser
//-----------------------------------------------------------------------------

class SonakoParser extends BakaTsukiParser {
    constructor() {
        super(new SonakoImageCollector());
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        // Backend tocSonako: the series page's WIKITEXT (via the MW API)
        // is the authoritative ordered chapter listing — the rendered
        // page's links (BakaTsukiParser's old mechanism) are not.
        try {
            let list = await this.fetchSonakoChapters(dom);
            if (0 < list.length) {
                return list;
            }
        } catch (e) { /* fall through to legacy */ }
        try {
            return await super.getChapterUrls(dom, chapterUrlsUI);
        } catch (e) {
            return [];
        }
    }

    async fetchSonakoChapters(dom) {
        let origin = "https://sonako.fandom.com";
        let series = "";
        try {
            series = decodeURIComponent(new URL(dom.baseURI).pathname.split("/wiki/")[1] || "")
                .replace(/_/g, " ").trim();
        } catch (e) { /* fall through */ }
        if (!series) {
            return [];
        }
        let api = (params) => HttpClient.fetchJson(`${origin}/api.php?${params}`);
        let j = await api(`action=parse&page=${encodeURIComponent(series)}&prop=wikitext&format=json`);
        let wikitext = j?.parse?.wikitext?.["*"] || "";
        let sLow = series.toLowerCase();
        let esc = series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let volComp = new RegExp(`^${esc} (tập|vol\\.?|volume) \\d+(\\.\\d+)?$`, "i");
        let seen = new Set();
        let entries = [];
        for (let m of wikitext.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
            let title = m[1].replace(/_/g, " ").trim();
            if (!title || seen.has(title)) {
                continue;
            }
            if (/^(category|file|image|mediawiki|template|help|special|sonako|user|talk)/i.test(title)) {
                continue;
            }
            let low = title.toLowerCase();
            if (!(low.startsWith(sLow + ":") || low.startsWith(sLow + " "))) {
                continue;
            }
            if (/minh h[ọo]a/i.test(title)) {
                continue; // illustration pages
            }
            if (volComp.test(title)) {
                continue; // bare volume compilations
            }
            seen.add(title);
            entries.push(title);
        }
        // Existence filter — drop redlinks in batches of 40.
        let existing = new Set();
        for (let i = 0; i < entries.length; i += 40) {
            let batch = entries.slice(i, i + 40);
            let q = await api(`action=query&titles=${batch.map(encodeURIComponent).join("%7C")}&format=json`);
            let pages = q?.query?.pages || {};
            let normalized = new Map((q?.query?.normalized || []).map(n => [n.from, n.to]));
            let validTitles = new Set(Object.values(pages).filter(pg => !("missing" in pg)).map(pg => pg.title));
            for (let t of batch) {
                let norm = normalized.get(t) || t;
                if (validTitles.has(norm) || validTitles.has(t)) {
                    existing.add(t);
                }
            }
        }
        let kept = entries.filter(t => existing.has(t));
        let volOf = (t) => {
            let m = t.match(/(?:tập|vol\.?|volume)\s*(\d+(?:\.\d+)?)/i);
            return m ? parseFloat(m[1]) : Number.MAX_SAFE_INTEGER;
        };
        return kept
            .map((t, i) => ({ t, i }))
            .sort((a, b) => (volOf(a.t) - volOf(b.t)) || (a.i - b.i))
            .map(({ t }) => ({
                sourceUrl: `${origin}/vi/wiki/${encodeURIComponent(t.replace(/ /g, "_")).replace(/%3A/gi, ":")}`,
                title: t
            }));
    }

    extractTitleImpl(dom) {
        return dom.title;
    }

    extractLanguage(dom) {   // eslint-disable-line no-unused-vars
        // ToDo find language
        return "vi-VN";
    }

    extractSeriesInfo(dom, metaInfo) {   // eslint-disable-line no-unused-vars
        // This parser does not currently support this functionality
    }

    // find the node(s) holding the story content
    findContent(dom) {
        return dom.querySelector("div.mw-content-ltr");
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeElements(element.querySelectorAll("script, " +
            "noscript, " +

        // discard table of contents (will generate one from tags later)
            "div#toc-wrapper, " +
            "a.toc-link, " +

            "a.wikia-photogallery-add, " +
            "div.print-no"
        ));
        util.removeElements(util.getElements(element, "div", e => (e.id.startsWith("INCONTENT"))));


        util.removeComments(element);
        // hyperlinks that allow editing text
        util.removeElements(element.querySelectorAll("table, span.editsection"));

        // fix source for delay loaded image tags
        util.fixDelayLoadedImages(element, "data-src");
    }
}
