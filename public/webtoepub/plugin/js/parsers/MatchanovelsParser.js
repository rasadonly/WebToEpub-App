"use strict";

parserFactory.register("matchanovels.com", () => new MatchanovelsParser());

class MatchanovelsParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        let base = (dom.baseURI || "").match(/^(https?:\/\/[^/]+\/novela\/[^/?#]+)/i)?.[1];
        let html = dom.documentElement.outerHTML.replace(/\\"/g, "\"");
        let chapters = [];
        let i = html.indexOf("\"capitulos\":[");
        if (base && i >= 0) {
            let seg = html.slice(i, i + 400000);
            for (let m of seg.matchAll(/\["(\d+)","[^"]*",(true|false),(null|"(?:[^"\\]|\\.)*")/g)) {
                if (m[2] === "true") continue;
                let name = m[3] === "null" ? "" : m[3].slice(1, -1);
                chapters.push({
                    sourceUrl: `${base}/capitulo/${m[1]}`,
                    title: name ? `Capítulo ${m[1]} - ${name}` : `Capítulo ${m[1]}`
                });
            }
        }
        if (chapters.length === 0) {
            chapters = [...dom.querySelectorAll("a[href*='/capitulo/']")].map(a => util.hyperLinkToChapter(a));
        }
        let seen = new Set();
        return chapters.filter(c => !seen.has(c.sourceUrl) && seen.add(c.sourceUrl))
            .sort((a, b) => Number(a.sourceUrl.split("/").pop()) - Number(b.sourceUrl.split("/").pop()));
    }

    findContent(dom) {
        return dom.querySelector(".mn-lector");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }

    extractLanguage() {
        return "es";
    }
}
