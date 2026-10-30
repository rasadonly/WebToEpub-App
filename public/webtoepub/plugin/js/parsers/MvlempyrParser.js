"use strict";

parserFactory.registerDeadSite("mvlempyr.com", () => new MvlempyrParser());
parserFactory.register("mvlempyr.io", () => new MvlempyrParser());

class MvlempyrParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 1000;
    }

    async getChapterUrls(dom) {
        // Backend tocMvlempyr: the Webflow book page carries only
        // #novel-code; chapters live in a backend WordPress whose tag id
        // is 7^code mod 1999999997 (the site's own JS computes it the same
        // way). Try the API first; fall back to the legacy synthesis.
        let code = null;
        let codeEl = dom.querySelector("#novel-code");
        if (codeEl) {
            code = codeEl.textContent.match(/^\s*(\d+)/)?.[1] || null;
        }
        if (!code) {
            for (let s of dom.querySelectorAll("script")) {
                let m = s.textContent.match(/novel-code[^0-9]{0,20}(\d{3,})/);
                if (m) {
                    code = m[1];
                    break;
                }
            }
        }
        if (code) {
            try {
                let list = await this.fetchMvlempyrChapters(dom, code);
                if (0 < list.length) {
                    return list;
                }
            } catch (e) { /* fall through to legacy */ }
        }
        return this.legacyChapterUrls(dom);
    }

    async fetchMvlempyrChapters(dom, code) {
        let tag = 1n;
        const base = 7n;
        const mod = 1999999997n;
        let exp = BigInt(code);
        let b = base % mod;
        while (exp > 0n) {
            if (exp & 1n) {
                tag = (tag * b) % mod;
            }
            b = (b * b) % mod;
            exp >>= 1n;
        }
        let origin = new URL(dom.baseURI).origin;
        let byNum = new Map();
        for (let page = 1; page <= 12; ++page) {
            let data = await HttpClient.fetchJson(
                `https://chap.heliosarchive.online/wp-json/wp/v2/posts?tags=${tag}&per_page=500&page=${page}`);
            if (!Array.isArray(data) || 0 === data.length) {
                break;
            }
            for (let p of data) {
                let n = parseInt(p?.acf?.chapter_number ?? "", 10);
                if (!n) {
                    continue;
                }
                byNum.set(n, {
                    sourceUrl: `${origin}/chapter/${code}-${n}`,
                    title: String(p?.acf?.ch_name || `Chapter ${n}`)
                });
            }
        }
        return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    }

    legacyChapterUrls(dom) {
        let imgLink = dom.querySelector("div.novel-image-wrapper img").src;
        let slug = imgLink.split("/").pop().split(".")[0];
        let chapterCount = parseInt(dom.querySelector("div#chapter-count").textContent)?parseInt(dom.querySelector("div#chapter-count").textContent):-1;
        let chapterTitles = [...dom.querySelectorAll("a.chapter-item h3")].map((el) => el.textContent.replace(/^\d+\.\s*/, ""));

        if (chapterCount == -1) {
            let regex = new RegExp("numberOfChapters.*?,");
            let regex2 = new RegExp("[0-9]+");
            let script = [...dom.scripts].map(a => a.outerHTML);
            chapterCount = parseInt(script.filter(a => a.match(regex))?.[0].match(regex)?.[0].match(regex2)?.[0]);
        }
        let chapterList = [];

        for (let i = 1; i <= chapterCount; i++) {
            let link = `https://www.mvlempyr.io/chapter/${slug}-${i}`;
            if (chapterTitles[i-1] == undefined) {
                chapterList.push({
                    sourceUrl: link,
                    title: "[placeholder]",
                });
            }
            else {
                chapterList.push({
                    sourceUrl: link,
                    title: chapterTitles[i-1],
                });
            }
        }
        return chapterList;
    }


    findContent(dom) {
        return (
            dom.querySelector("div#chapter") || dom.querySelector("#chapter-content")
        );
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.novel-title");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("div.mobileauthorname");
        return authorLabel?.textContent ?? super.extractAuthor(dom);
    }

    findChapterTitle(dom) {
        return dom.querySelector("#span-28-1305853").textContent;
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.novel-image-wrapper");
    }

    getInformationEpubItemChildNodes(dom) {
        let epubDescription = ([...dom.querySelectorAll("div.synopsis")]);
        return epubDescription.map(e => e.innerHTML.replace(/<br><br>/g, "\n\n").replace(/<br>/g, "\n"));
    }
  
    extractSubject(dom) {
        let tags = ([...dom.querySelectorAll("div.genere-tagslist a")]);
        let regex = new RegExp("^#");
        return tags.map(e => e.textContent.trim().replace(regex, "")).join(", ");
    }
}
