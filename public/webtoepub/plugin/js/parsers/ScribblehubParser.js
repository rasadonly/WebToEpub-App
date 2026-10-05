"use strict";

parserFactory.register("scribblehub.com", () => new ScribblehubParser());

class ScribblehubParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 5000;
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let baseUrl = (dom.baseURI || "").split("?")[0];
        let cntToc = dom.querySelector("span.cnt_toc");
        let numChapters = cntToc ? parseInt((cntToc.textContent || "0").replace(/\D/g, "")) : 0;
        let firstPage = ScribblehubParser.getChapterUrlsFromTocPage(dom);

        // 1. Whole chapter list in one request (site's own "show all" call).
        if (!numChapters || firstPage.length < numChapters) {
            let all = await this.fetchAllChaptersAjax(dom, baseUrl);
            if (all.length > firstPage.length) {
                return all;
            }
        }

        // 2. Walk ?toc=N pages (15 chapters each). Retry a page that comes back
        //    empty (bot check / rate limit) instead of stopping early.
        let chapters = [...firstPage];
        let seen = new Set(chapters.map(c => c.sourceUrl));
        let maxPages = numChapters ? Math.ceil(numChapters / 15) + 1 : 300;
        for (let page = 2; page <= maxPages; page++) {
            if (numChapters && chapters.length >= numChapters) break;
            let found = [];
            for (let attempt = 0; attempt < 3 && found.length === 0; attempt++) {
                try {
                    if (attempt > 0) await util.sleep(1500 * attempt);
                    let pageDom = (await HttpClient.wrapFetch(`${baseUrl}?toc=${page}`)).responseXML;
                    found = ScribblehubParser.getChapterUrlsFromTocPage(pageDom);
                } catch (e) {
                    found = [];
                }
            }
            let fresh = found.filter(c => !seen.has(c.sourceUrl));
            if (fresh.length === 0) {
                if (!numChapters) break;
                continue;
            }
            fresh.forEach(c => seen.add(c.sourceUrl));
            chapters.push(...fresh);
            chapterUrlsUI?.showTocProgress?.(fresh);
        }
        return chapters.reverse();
    }

    async fetchAllChaptersAjax(dom, baseUrl) {
        let sid = (baseUrl.match(/\/series\/(\d+)/) || [])[1] ||
            dom.querySelector("#mypostid")?.getAttribute("value");
        if (!sid) return [];
        try {
            let body = `action=wi_getreleases_pagination&pagenum=-1&mypostid=${sid}`;
            let xhr = await HttpClient.wrapFetch("https://www.scribblehub.com/wp-admin/admin-ajax.php", {
                fetchOptions: {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                    body: body
                }
            });
            let links = ScribblehubParser.getChapterUrlsFromTocPage(xhr.responseXML);
            let seen = new Set();
            return links.filter(c => !seen.has(c.sourceUrl) && seen.add(c.sourceUrl)).reverse();
        } catch (e) {
            return [];
        }
    }

    static getChapterUrlsFromTocPage(dom) {
        if (!dom || typeof dom.querySelectorAll !== "function") return [];
        return [...dom.querySelectorAll("a.toc_a")]
            .map(a => util.hyperLinkToChapter(a));
    }

    findContent(dom) {
        return dom.querySelector("div.fic_row, div#chp_raw");
    }

    populateUIImpl() {
        document.getElementById("removeAuthorNotesRow").hidden = false;
    }

    extractTitleImpl(dom) {
        return dom.querySelector("div.fic_title");
    }

    extractAuthor(dom) {
        let author = dom.querySelector("span.auth_name_fic");
        return (author === null) ? super.extractAuthor(dom) : author.textContent;
    }
    
    extractSubject(dom) {
        let selector = "[property='genre']";
        if (!document.getElementById("lesstagsCheckbox").checked) {
            selector += ", .stag";
        }
        let tags = [...dom.querySelectorAll(selector)];
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    extractDescription(dom) {
        return this.extractDescriptionInternal(dom)?.innerText?.trim();
    }
    // unwrap the description from the readmore that you may get on mobile
    extractDescriptionInternal(dom) {
        let desc = dom.querySelector(".wi_fic_desc");
        if (desc != null) {
            desc.querySelectorAll(".dots, .morelink").forEach(e => e.remove());
            desc.querySelectorAll(".testhide").forEach(e => e.replaceWith(...e.childNodes));
        }

        return desc;
    }

    findChapterTitle(dom) {
        return dom.querySelector("div.chapter-title").textContent;
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.fic_image");
    }

    preprocessRawDom(webPageDom) {
        let content = this.findContent(webPageDom);

        this.tagAuthorNotesBySelector(content, ".wi_authornotes, .wi_news");

        // spoilers
        for (let element of content.querySelectorAll(".sp-wrap")) {
            element.querySelector(".sp-body>.spdiv")?.remove();

            let details = webPageDom.createElement("details");
            let summary = webPageDom.createElement("summary");
            summary.append(...element.querySelector(".sp-head").childNodes);
            details.append(summary);
            details.append(...element.querySelector(".sp-body").childNodes);

            element.replaceWith(details);
        }

        // anouncements
        for (let element of content.querySelectorAll(".wi_news_title")) {
            element.setAttribute("style", "font-weight: bold");
            element.querySelector(".fa-exclamation-triangle").replaceWith("⚠");
        }

        // author notes
        for (let element of content.querySelectorAll(".p-avatar-wrap")) {
            element.remove();
        }

    }

    getInformationEpubItemChildNodes(dom) {
        function cleanTag(tag, index, array) {
            let out = tag.ownerDocument.createElement("a");
            out.setAttribute("href", tag.getAttribute("href"));
            out.innerText = tag.innerText;
            return index < array.length -1 ? [out, ", "] : [out];
        }

        let info = [];

        info.push(dom.createElement("div").innerHTML = "<p><b>Synopsis</b></p>");
        let synopsis = this.extractDescriptionInternal(dom);
        if (synopsis) {
            info.push(...synopsis.childNodes);
        }

        let genre = dom.querySelectorAll(".wi_fic_genre a.fic_genre");
        if (genre.length > 0) {
            info.push(dom.createElement("div").innerHTML = "<p><b>Genre</b></p>");
            info.push(...[...genre].flatMap(cleanTag));
        }

        let fandom = dom.querySelectorAll(".wi_fic_genre a.stag");
        if (fandom.length > 0) {
            info.push(dom.createElement("div").innerHTML = "<p><b>Fandom</b></p>");
            info.push(...[...fandom].flatMap(cleanTag));
        }

        let tags = dom.querySelectorAll(".wi_fic_showtags a.stag");
        if (tags.length > 0) {
            info.push(dom.createElement("div").innerHTML = "<p><b>Tags</b></p>");
            info.push(...[...tags].flatMap(cleanTag));
        }
  
        return info;
    }
}
