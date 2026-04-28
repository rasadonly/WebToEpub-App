"use strict";

/*
  KofiParser.js
  Parser for Ko-fi posts
*/

parserFactory.register("ko-fi.com", () => new KofiParser());
parserFactory.registerManualSelect("Ko-fi", () => new KofiParser());

class KofiParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 3000;
    }

    /**
     * returns promise with the URLs of the chapters to fetch
     * @param {Document} dom 
     * @returns {Promise<Chapter[]>}
     */
    async getChapterUrls(dom) {
        const url = new URL(dom.baseURI);
        
        // If it's a individual post page
        if (url.pathname.includes("/post/")) {
            // First, see if there are links to other chapters in the content
            let content = this.findContent(dom);
            if (content) {
                // Look for links that look like chapter links
                let links = util.hyperlinksToChapterList(content);
                // If there are many links (e.g., more than 2), it might be a table of contents post
                if (links.length > 2) {
                    return links;
                }
            }
            // Otherwise, treat as a single chapter
            return [{
                sourceUrl: dom.baseURI,
                title: this.extractTitleImpl(dom)
            }];
        }

        // Handle profile/posts list pages
        // Selectors for posts in the feed
        let postLinks = [...dom.querySelectorAll("a[href*='/post/']")];
        if (postLinks.length > 0) {
            // Deduplicate and map
            let seen = new Set();
            let chapters = [];
            for (let a of postLinks) {
                let href = a.href;
                if (!seen.has(href)) {
                    seen.add(href);
                    // Find a title within the link or nearby
                    let title = a.querySelector("h2, h3, .post-title")?.textContent.trim() || a.textContent.trim();
                    if (!title || title.length < 2) continue; // Skip empty/short ones
                    chapters.push({
                        sourceUrl: href,
                        title: title
                    });
                }
            }
            return chapters;
        }

        // Default: return current page
        return [{
            sourceUrl: dom.baseURI,
            title: this.extractTitleImpl(dom)
        }];
    }

    /**
     * returns the element holding the story content
     * @param {Document} dom 
     */
    findContent(dom) {
        // Ko-fi uses .article-body for the main post content
        return dom.querySelector(".article-body") || dom.querySelector(".article-host") || dom.querySelector("#post-container");
    }

    /**
     * title of the story
     * @param {Document} dom 
     */
    extractTitleImpl(dom) {
        let titleElement = dom.querySelector(".article-title h1") || dom.querySelector("h1") || dom.querySelector(".post-title");
        return titleElement ? titleElement.textContent.trim() : super.extractTitleImpl(dom);
    }

    /**
     * author of the story
     * @param {Document} dom 
     */
    extractAuthor(dom) {
        let authorLabel = dom.querySelector(".nav-profile-title") || 
                        dom.querySelector(".post-name-row a") || 
                        dom.querySelector("a[href*='/home/profile'] span") ||
                        dom.querySelector(".author-name");
        return authorLabel ? authorLabel.textContent.trim() : super.extractAuthor(dom);
    }

    /**
     * Optional: cover image
     * @param {Document} dom 
     */
    findCoverImageUrl(dom) {
        // Try to get the post's main image if it exists
        return util.getFirstImgSrc(dom, ".article-image, .post-main-image, #post-container img");
    }

    /**
     * Individual chapter title
     * @param {Document} dom 
     */
    findChapterTitle(dom) {
        return this.extractTitleImpl(dom);
    }
}
