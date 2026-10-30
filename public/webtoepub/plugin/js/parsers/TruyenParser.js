"use strict";

parserFactory.register("truyennhabo.com", () => new TruyenParser());

class TruyenParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocTruyenNhabo: series are Blogger labels; enumerate the
        // label feed, keeping 'Chapter NN' posts in numeric order. The old
        // #clwd widget read is kept as a fallback for pages that carry it
        // (it renders on none of the sampled home/label/post pages).
        let pageUrl = new URL(dom.baseURI);
        let label = null;
        let labelMatch = pageUrl.pathname.match(/\/search\/label\/([^/]+)/);
        if (labelMatch) {
            label = decodeURIComponent(labelMatch[1]);
        } else {
            let labelled = dom.querySelector("[data-label]");
            if (labelled) {
                label = labelled.getAttribute("data-label");
            } else {
                let title = dom.querySelector("title")?.textContent || "";
                label = title.match(/^(.+?)\s*-\s*Chapter/i)?.[1]?.trim() || null;
            }
        }
        if (label) {
            let out = [];
            for (let startIndex = 1; startIndex <= 2000; startIndex += 500) {
                let feedUrl = `https://www.truyennhabo.com/feeds/posts/default/-/${encodeURIComponent(label)}?alt=json&max-results=500&start-index=${startIndex}`;
                let json = null;
                try {
                    json = (await HttpClient.fetchJson(feedUrl)).json;
                } catch (e) {
                    break;
                }
                let entries = json?.feed?.entry || [];
                if (0 === entries.length) {
                    break;
                }
                for (let e of entries) {
                    let title = e.title?.$t || "";
                    let href = (e.link || []).find((l) => l.rel === "alternate")?.href;
                    let num = title.match(/chapter\s*(\d+)/i)?.[1];
                    if (href && num) {
                        out.push({ sourceUrl: href, title: title, n: parseInt(num, 10) });
                    }
                }
                if (entries.length < 500) {
                    break;
                }
            }
            if (0 < out.length) {
                return out.sort((a, b) => a.n - b.n)
                    .map(({ sourceUrl, title }) => ({ sourceUrl, title }));
            }
        }
        const chapterLinks = [...dom.querySelectorAll("#clwd ul a")];
        const chapterTitles = [...dom.querySelectorAll("#clwd span.block")];
        const chapterUrls = [];
        for (let i = 0; i < chapterLinks.length; i++) {
            const chapterLink = chapterLinks[i];
            const chapterTitle = chapterTitles[i];
            chapterUrls.push({
                sourceUrl: chapterLink.href,
                title: chapterTitle ? chapterTitle.textContent : "",
            });
        }
        return chapterUrls.reverse();
    }

    findContent(dom) {
        return (
            dom.querySelector("article.blog")
        );
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("#extra-info dd");
        return authorLabel?.textContent ?? super.extractAuthor(dom);
    }

    findChapterTitle(dom) {
        return dom.querySelector("header h1");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.auto-rows-max");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div#synopsis")];
    }

    removeUnwantedElementsFromContentElement(element) {
        let mark = element.querySelector("a");
        mark.remove();
        super.removeUnwantedElementsFromContentElement(element);
    }

}



