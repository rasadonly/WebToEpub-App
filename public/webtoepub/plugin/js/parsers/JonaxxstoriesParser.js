"use strict";

parserFactory.register("jonaxxstories.com", () => new JonaxxstoriesParser());

class JonaxxstoriesParser extends WordpressBaseParser {
    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        // Backend tocJonaxxStories: chapters are dated WP posts under
        // /category/{book-slug}/ (10 per archive page, newest-first).
        let bookSlug = null;
        try {
            bookSlug = new URL(dom.baseURI).pathname.split("/").filter(Boolean).pop();
        } catch (e) { /* fall through to legacy */ }
        if (bookSlug) {
            try {
                let list = await this.fetchJonaxxChapters(dom, bookSlug);
                if (0 < list.length) {
                    return list;
                }
            } catch (e) { /* fall through to legacy */ }
        }
        return (await this.getChapterUrlsFromMultipleTocPages(dom,
            this.extractPartialChapterList,
            this.getUrlsOfTocPages,
            chapterUrlsUI
        )).reverse();
    }

    async fetchJonaxxChapters(dom, bookSlug) {
        let origin = new URL(dom.baseURI).origin;
        let esc = bookSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let postRe = new RegExp(`/\\d{4}/\\d{2}/\\d{2}/${esc}-`);
        let byUrl = new Map();
        let merge = (d) => {
            let added = 0;
            for (let a of d.querySelectorAll("a")) {
                let href = (a.href || "").split("#")[0];
                if (!postRe.test(href) || byUrl.has(href)) {
                    continue;
                }
                byUrl.set(href, { sourceUrl: href, title: (a.textContent || "").trim() });
                added++;
            }
            return added;
        };
        let firstDom = (await HttpClient.wrapFetch(`${origin}/category/${bookSlug}/`)).responseXML;
        merge(firstDom);
        let pages = 1;
        for (let a of firstDom.querySelectorAll("a")) {
            let m = (a.href || "").match(new RegExp(`/category/${esc}/page/(\\d+)`));
            if (m) {
                pages = Math.max(pages, parseInt(m[1], 10));
            }
        }
        for (let p = 2; p <= Math.min(pages, 60); p++) {
            let d;
            try {
                d = (await HttpClient.wrapFetch(`${origin}/category/${bookSlug}/page/${p}/`)).responseXML;
            } catch (e) {
                break;
            }
            if (!merge(d)) {
                break;
            }
        }
        let num = (x) => {
            let k = x.sourceUrl.match(/-kabanata-(\d+)/);
            if (k) {
                return parseInt(k[1], 10);
            }
            if (/wakas|epilog/i.test(x.sourceUrl)) {
                return Number.MAX_SAFE_INTEGER; // "Wakas" = finale
            }
            return 0; // prologue/special posts sort first, in path order
        };
        return [...byUrl.values()].sort((a, b) => num(a) - num(b) || a.sourceUrl.localeCompare(b.sourceUrl));
    }

    getUrlsOfTocPages(dom) {
        let urls = [];
        let lastLink = [...dom.querySelectorAll(".nav-links a:not(.next)")]
            .slice(-1);
        if (0 < lastLink.length)
        {
            let max = parseInt(lastLink[0].textContent);
            let href = lastLink[0].href;
            let index = href.lastIndexOf("/", href.length - 2);
            href = href.substring(0, index + 1);
            for (let i = 2; i <= max; ++i) {
                urls.push(href + i + "/");
            }
        }
        return urls;
    }

    extractPartialChapterList(dom) {
        return [...dom.querySelectorAll(".entry-title a")]
            .map(a => util.hyperLinkToChapter(a));
    }
}
