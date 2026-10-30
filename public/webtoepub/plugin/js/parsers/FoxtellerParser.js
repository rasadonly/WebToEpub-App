"use strict";

parserFactory.register("foxteller.com", () => new FoxtellerParser());

class FoxtellerParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        return [...dom.querySelectorAll(".card li a")]
            .map(link => util.hyperLinkToChapter(link));
    }

    findContent(dom) {
        return Parser.findConstrutedContent(dom);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("div.novel-title h2");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "figure.novel-featureimg");
    }

    async fetchChapter(url) {
        let chapterDom = (await HttpClient.wrapFetch(url)).responseXML;
        let content = (await this.fetchContentForChapter(chapterDom));
        let newDoc = Parser.makeEmptyDocForContent(url);
        let header = chapterDom.querySelector("div.page-header h3");
        if (header !== null) {
            let headerNode = newDoc.dom.createElement("h1");
            headerNode.textContent = header.textContent;
            newDoc.content.appendChild(headerNode);
        }
        newDoc.content.appendChild(content.querySelector("article"));
        return newDoc.dom;        
    }

    async fetchContentForChapter(dom) {
        // Backend bodyFoxteller: the chapter page carries let d (novel id)
        // and let e (chapter id) plus a CSRF token; the prose comes from a
        // POST to /aux_dem. Verified live through the CORS proxy: the
        // CSRF token alone suffices, no session cookies needed.
        // (The old novel_id'/chapter_id' read from dom.head.innerText is
        // dead in browsers — head has no innerText — so read the full
        // page HTML instead.)
        let html = dom.documentElement ? dom.documentElement.outerHTML : "";
        let d = (html.match(/let d\s*=\s*'(\d+)'/) || [])[1];
        let e = (html.match(/let e\s*=\s*'(\d+)'/) || [])[1];
        if (!d || !e) {
            // Legacy variable names, still present on some pages.
            d = (html.match(/novel_id'\s*:\s*'([\w\s]+)'/) || [])[1];
            e = (html.match(/chapter_id'\s*:\s*'([\w\s]+)'/) || [])[1];
        }
        if (d && e) {
            let csrf = (html.match(/name="csrf-token" content="([^"]+)"/) || [])[1];
            let options = {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    ...(csrf ? { "X-CSRF-TOKEN": csrf } : {})
                },
                body: JSON.stringify({x1: d, x2: e})
            };
            try {
                let res = await HttpClient.fetchJson("https://www.foxteller.com/aux_dem", options);
                let json = (res && res.json) ? res.json : res;
                if (json && json.aux) {
                    let decoded = this.decodeFoxteller(json);
                    if (200 < decoded.length) {
                        return util.sanitize("<article>" + decoded + "</article>");
                    }
                }
            } catch (err) { /* fall through to article fallback */ }
        }
        // Fallback: a server-rendered article on the chapter page itself.
        let article = dom.querySelector("article");
        if (article !== null) {
            return util.sanitize("<article>" + article.innerHTML + "</article>");
        }
        throw new Error("Foxteller chapter content unavailable");
    }

    decodeFoxteller(json) {
        var n = json.aux.replace(/%Ra&/g, "A").replace(/%Rc&/g, "B").replace(/%Rb&/g, "C").replace(/%Rd&/g, "D").replace(/%Rf&/g, "E").replace(/%Re&/g, "F");
        return decodeURIComponent(Array.prototype.map.call(atob(n), function(e) {
            return "%" + ("00" + e.charCodeAt(0).toString(16)).slice(-2);
        }).join(""));   
    }    

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.novel-description")];
    }
}
