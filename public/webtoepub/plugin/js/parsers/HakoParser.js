"use strict";

parserFactory.register("ln.hako.vn", () => new HakoParser());

class HakoParser extends Parser {
    constructor() {
        super();
    }

    async getChapterUrls(dom) {
        // Backend tocHako: same selector list on the book page.
        return [...dom.querySelectorAll(".chapter-name a, .list-chapters a, .chapter_list a, ul.list-chapters li a")]
            .map(link => util.hyperLinkToChapter(link));
    }

    async fetchChapter(url) {
        let chapterDom = (await HttpClient.wrapFetch(url)).responseXML;
        let newDoc = Parser.makeEmptyDocForContent(url);
        let header = chapterDom.querySelector("h1");
        if (header !== null) {
            let headerNode = newDoc.dom.createElement("h1");
            headerNode.textContent = header.textContent;
            newDoc.content.appendChild(headerNode);
        }
        // Protected chapters: #chapter-c-protected carries data-c (JSON
        // array of "NNNN<base64>" chunks), data-k (key) and data-s
        // (scheme) — same decoder as backend bodyHako.
        let content = null;
        let prot = chapterDom.querySelector("#chapter-c-protected");
        if (prot !== null) {
            let decoded = this.decodeProtected(prot);
            if (decoded !== null) {
                let wrapper = newDoc.dom.createElement("div");
                wrapper.setAttribute("id", "chapter-content");
                wrapper.innerHTML = decoded;
                content = wrapper;
            }
        }
        if (content === null) {
            content = chapterDom.querySelector("#chapter-content, .long-text, .chapter-content");
        }
        if (content === null) {
            throw new Error("Hako chapter content unavailable");
        }
        newDoc.content.appendChild(content);
        return newDoc.dom;
    }

    decodeProtected(prot) {
        try {
            let rawC = prot.getAttribute("data-c");
            if (!rawC) {
                return null;
            }
            let scheme = prot.getAttribute("data-s") || "";
            let key = prot.getAttribute("data-k") || "";
            let chunks = JSON.parse(rawC);
            let parts = chunks
                .slice()
                .sort((a, b) => parseInt(a.slice(0, 4), 10) - parseInt(b.slice(0, 4), 10))
                .map(c => this.base64ToBytes(c.slice(4)));
            let text;
            if (scheme === "xor_shuffle" && key) {
                text = parts.map(buf => {
                    let out = new Uint8Array(buf.length);
                    for (let i = 0; i < buf.length; i++) {
                        out[i] = buf[i] ^ key.charCodeAt(i % key.length);
                    }
                    return this.bytesToUtf8(out);
                }).join("");
            } else if (scheme === "base64_reverse") {
                let joined = parts.map(b => this.bytesToBinary(b)).join("");
                let reversed = joined.split("").reverse().join("");
                text = this.bytesToUtf8(this.base64ToBytes(reversed));
            } else {
                text = parts.map(b => this.bytesToUtf8(b)).join("");
            }
            if (text && text.replace(/<[^>]+>/g, "").trim().length > 200) {
                return text;
            }
        } catch (e) { /* fall through to selector extraction */ }
        return null;
    }

    base64ToBytes(b64) {
        // Lenient like Node's Buffer.from(s, 'base64'): ignore strays and
        // re-pad, so a chunk split mid-quantum still decodes instead of
        // throwing in the browser's strict atob.
        let clean = b64.replace(/[^A-Za-z0-9+/=]/g, "").replace(/=+$/, "");
        while (clean.length % 4 !== 0) {
            clean += "=";
        }
        let bin = atob(clean);
        let out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    }

    bytesToBinary(bytes) {
        let s = "";
        for (let b of bytes) {
            s += String.fromCharCode(b);
        }
        return s;
    }

    bytesToUtf8(bytes) {
        if (typeof TextDecoder !== "undefined") {
            return new TextDecoder("utf-8").decode(bytes);
        }
        // Fallback: percent-decode trick.
        return decodeURIComponent(Array.prototype.map.call(bytes, function(b) {
            return "%" + ("00" + b.toString(16)).slice(-2);
        }).join(""));
    }

    findContent(dom) {
        return dom.querySelector("#chapter-content, .long-text, .chapter-content");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1");
    }
}
