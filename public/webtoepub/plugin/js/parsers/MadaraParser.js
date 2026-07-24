"use strict";

parserFactory.register("listnovel.com", () => new MadaraParser());
parserFactory.register("novelnice.com", () => new NovelniceParser());
//dead url
parserFactory.register("readwebnovel.xyz", () => new MadaraParser());
parserFactory.register("wuxiaworld.site", () => new MadaraParser());
//dead url
parserFactory.register("pery.info", () => new MadaraParser());
parserFactory.register("morenovel.net", () => new MadaraParser());
parserFactory.register("nightcomic.com", () => new MadaraParser());
//dead url
parserFactory.register("webnovel.live", () => new MadaraParser());
//dead url
parserFactory.register("noveltrench.com", () => new MadaraParser());
parserFactory.register("mangasushi.net", () => new MadaraParser());
//dead url
parserFactory.register("mangabob.com", () => new MadaraParser());
parserFactory.register("greenztl2.com", () => new MadaraVariantParser());

parserFactory.register("indratranslations.com", () => new KdtnovelsParser());
parserFactory.register("kdtnovels.com", () => new KdtnovelsParser());

parserFactory.registerRule(
    (url, dom) => MadaraParser.isMadaraTheme(dom) * 0.6,
    () => new MadaraParser()
);

class MadaraParser extends WordpressBaseParser {
    constructor() {
        super();
    }

    static isMadaraTheme(dom) {
        return 0 < dom.querySelectorAll("li.wp-manga-chapter a").length;
    }

    async getChapterUrls(dom) {
        let chapters = [...dom.querySelectorAll("li.wp-manga-chapter a:not([title])")]
            .map(a => util.hyperLinkToChapter(a)).reverse();
        
        if (chapters.length > 0) {
            return chapters;
        }

        // Try extracting using AJAX if not found in static DOM (standard for Madara dynamic loading)
        try {
            let mangaId = dom.querySelector("input[name='manga_id'], #manga-chapters-holder[data-id], .wp-manga-action-btn[data-post]")?.value || 
                          dom.querySelector("#manga-chapters-holder")?.getAttribute("data-id") ||
                          dom.querySelector(".wp-manga-action-btn")?.getAttribute("data-post");
            
            if (!mangaId) {
                let scripts = [...dom.querySelectorAll("script")].map(s => s.textContent).join("\n");
                let match = scripts.match(/manga_id\s*:\s*["']?(\d+)["']?/) || 
                            scripts.match(/post_id\s*:\s*["']?(\d+)["']?/) ||
                            scripts.match(/mangaId\s*:\s*["']?(\d+)["']?/);
                if (match) {
                    mangaId = match[1];
                }
            }

            if (!mangaId) {
                let bodyClass = dom.body?.className || "";
                let match = bodyClass.match(/postid-(\d+)/) || bodyClass.match(/parent-manga-id-(\d+)/);
                if (match) {
                    mangaId = match[1];
                }
            }

            if (mangaId) {
                let baseUrl = dom.baseURI || this.state.chapterListUrl;
                let ajaxUrl = new URL("/wp-admin/admin-ajax.php", baseUrl).href;
                let response = await HttpClient.wrapFetch(ajaxUrl, {
                    fetchOptions: {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: `action=manga_get_chapters&manga=${mangaId}`
                    }
                });
                let ajaxDom = response.responseXML;
                if (!ajaxDom && response.responseText) {
                    ajaxDom = new DOMParser().parseFromString(response.responseText, "text/html");
                }
                if (ajaxDom) {
                    chapters = [...ajaxDom.querySelectorAll("li.wp-manga-chapter a:not([title])")]
                        .map(a => util.hyperLinkToChapter(a)).reverse();
                }
            }

            // Fallback: try direct ajax/chapters/ endpoint if admin-ajax didn't return chapters
            if (chapters.length === 0) {
                let baseUrl = dom.baseURI || this.state.chapterListUrl;
                let altAjaxUrl = baseUrl.replace(/\/?$/, "/ajax/chapters/");
                let response = await HttpClient.wrapFetch(altAjaxUrl, {
                    fetchOptions: {
                        method: "POST"
                    }
                });
                let ajaxDom = response.responseXML;
                if (!ajaxDom && response.responseText) {
                    ajaxDom = new DOMParser().parseFromString(response.responseText, "text/html");
                }
                if (ajaxDom) {
                    chapters = [...ajaxDom.querySelectorAll("li.wp-manga-chapter a:not([title])")]
                        .map(a => util.hyperLinkToChapter(a)).reverse();
                }
            }
        } catch (e) {
            console.warn("[WebToEpub] Madara AJAX chapter list extraction failed:", e);
        }

        return chapters;
    }

    findContent(dom) {
        let content =
            dom.querySelector(".reading-content .text-left") ||
            dom.querySelector("div.reading-content");

        for (let i of content.querySelectorAll("img")) {
            let data_src = i.getAttribute("data-src");
            if (!util.isNullOrEmpty(data_src) && util.isNullOrEmpty(i.src)) {
                i.src = data_src.trim();
            }
        }
        return content;
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("div.author-content a");
        return (authorLabel === null) ? super.extractAuthor(dom) : authorLabel.textContent;
    }
	
    extractSubject(dom) {
        let tags = [...dom.querySelectorAll("div .genres-content [rel='tag']")];
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    extractDescription(dom) {
        let descriptionElement = dom.querySelector(".summary__content");
        return descriptionElement === null ? "" : descriptionElement.textContent.trim();
    }
    
    removeUnwantedElementsFromContentElement(element) {
        util.removeChildElementsMatchingSelector(element, "div.addtoany_share_save_container, div.code-block");
        super.removeUnwantedElementsFromContentElement(element);
    }

    findChapterTitle(dom) {
        return dom.querySelector("ol.breadcrumb li.active, .wp-manga-chapter.reading a").textContent;
    }
 
    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.summary_image");
    }

    getInformationEpubItemChildNodes(dom) {
        let nodes = [...dom.querySelectorAll("div.summary__content")];
        if (nodes.length === 0) {
            nodes = [...dom.querySelectorAll("div.manga-summary p")];
        }
        if (nodes.length === 0) {
            nodes = [...dom.querySelectorAll("div.excerpt-content p")];
        }
        return nodes;
    }

    cleanInformationNode(node) {
        util.removeChildElementsMatchingSelector(node, "script");
    }
}

class MadaraVariantParser extends MadaraParser {
    async getChapterUrls(dom) {
        return [...dom.querySelectorAll("li.wp-manga-chapter a:not([title], [data-locked='1'])")]
            .map(a => this.hyperLinkToChapter(a)).reverse();
    }

    hyperLinkToChapter(link, newArc) {
        let retVal = util.hyperLinkToChapter(link, newArc);
        let uri = retVal.sourceUrl;
        if (!uri || link.attributes.href.value == "#") //search for alternate URLs if typical link fails
        {
            uri = null;
            if (link.dataset.link)
            {
                retVal.sourceUrl = link.dataset.link;
            }
            else
            {
                [...link.attributes].forEach(attr => {
                    try {
                        uri = new URL(attr.value);
                    } catch (_)
                    {
                        //Failed to detect URL in Attribute.
                    }
                });
                if (uri && uri.href)
                {
                    retVal.sourceUrl = uri.href;
                }
            }
        }

        return retVal;
    }
    
    findChapterTitle(dom) {
        return dom.querySelector(".main-col h1:not(.menu-title)").textContent;
    }
}

class KdtnovelsParser extends MadaraParser {
    findChapterTitle(dom) {
        return dom.querySelector("h3.chapter-name");
    }
}

class NovelniceParser extends MadaraParser {
    constructor() {
        super();
    }

    findContent(dom) {
        let content = dom.querySelector(".reading-content");
        if (content != null && content.textContent.trim().length > 0) {
            return content;
        }
        
        let textLeft = dom.querySelector(".text-left");
        if (textLeft != null && textLeft.textContent.trim().length > 0) {
            return textLeft;
        }

        let chapterContent = dom.querySelector(".chapter-content");
        if (chapterContent != null && chapterContent.textContent.trim().length > 0) {
            return chapterContent;
        }

        let entryContent = dom.querySelector(".entry-content");
        if (entryContent != null && entryContent.textContent.trim().length > 0) {
            return entryContent;
        }
        
        let chaContent = dom.querySelector(".cha-content");
        if (chaContent != null && chaContent.textContent.trim().length > 0) {
            return chaContent;
        }

        let idChapterContent = dom.querySelector("#chapter-content");
        if (idChapterContent != null && idChapterContent.textContent.trim().length > 0) {
            return idChapterContent;
        }

        let cBlogPost = dom.querySelector(".c-blog-post");
        if (cBlogPost != null && cBlogPost.textContent.trim().length > 0) {
            return cBlogPost;
        }

        return super.findContent(dom);
    }
}
