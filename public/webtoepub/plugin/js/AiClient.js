"use strict";

/**
 * AiClient - Interacts with Pollinations AI for search fallbacks and parser autocompletion.
 */
class AiClient { // eslint-disable-line no-unused-vars
    static MODEL = "nova-fast"; // Cost-efficient and fast

    // Pre-compiled regexes for performance
    static REGEX_SCRIPT = /<script\b(?![^>]*\btype=['"]?(?:application\/ld\+json|__NUXT__)['"]?)[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
    static REGEX_STYLE = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;
    static REGEX_SVG = /<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi;
    static REGEX_NOSCRIPT = /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi;
    static REGEX_COMMENT = /<!--[\s\S]*?-->/g;
    static REGEX_SPACE = /\s+/g;

    // Noise attributes that bloat the token budget but don't help the model
    // identify structure/selectors. class/id/href/title are deliberately kept.
    static REGEX_INLINE_STYLE = /\s+style\s*=\s*("[^"]*"|'[^']*')/gi;
    static REGEX_EVENT_HANDLER = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi;
    static REGEX_DATA_ATTR = /\s+data-[\w-]+\s*=\s*("[^"]*"|'[^']*')/gi;
    static REGEX_ARIA_ATTR = /\s+(?:aria-[\w-]+|role)\s*=\s*("[^"]*"|'[^']*')/gi;
    static REGEX_RESPONSIVE_IMG = /\s+(?:srcset|sizes|loading|decoding)\s*=\s*("[^"]*"|'[^']*')/gi;
    // Inline base64 data: URIs are enormous — replace with a short placeholder.
    static REGEX_DATA_URI = /\s+(src|href)\s*=\s*("data:[^"]*"|'data:[^']*')/gi;

    static _extractJson(text) {
        text = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/ig, "$1");
        let objStart = text.indexOf("{");
        let arrStart = text.indexOf("[");
        let startIndex = -1;
        if (objStart !== -1 && arrStart !== -1) startIndex = Math.min(objStart, arrStart);
        else if (objStart !== -1) startIndex = objStart;
        else if (arrStart !== -1) startIndex = arrStart;
        if (startIndex === -1) return text;

        let objEnd = text.lastIndexOf("}");
        let arrEnd = text.lastIndexOf("]");
        let endIndex = Math.max(objEnd, arrEnd);

        if (endIndex !== -1 && endIndex > startIndex) {
            return text.substring(startIndex, endIndex + 1);
        }
        return text;
    }

    static _apiKey() {
        return typeof Secrets !== "undefined" ? Secrets.POLLINATIONS_API_KEY : null;
    }

    /** Endpoint override injected by the host app (Lovable AI Gateway proxy). */
    static _endpoint() {
        try {
            if (typeof window !== "undefined" && window.LOVABLE_AI_ENDPOINT) {
                return window.LOVABLE_AI_ENDPOINT;
            }
        } catch (e) { /* ignore */ }
        return "https://gen.pollinations.ai/v1/chat/completions";
    }

    /** Resolve a possibly-relative href against a base URL. */
    static _resolveUrl(base, href) {
        if (!href) return href;
        if (/^https?:\/\//i.test(href)) return href;
        try {
            return new URL(href, base).href;
        } catch (e) {
            return href;
        }
    }

    /** Parse model output into JSON, tolerating prose/fences. Returns undefined on failure. */
    static _tryParse(raw) {
        if (!raw) return undefined;
        try {
            return JSON.parse(AiClient._extractJson(raw));
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Single chat completion. Returns the raw message string, or null on error /
     * missing key. Uses a low temperature for stable, extractable output.
     */
    static async _chatRaw(system, user, temperature = 0) {
        const nvKey = typeof Secrets !== "undefined" && Secrets.NVIDIA_API_KEY ? Secrets.NVIDIA_API_KEY : "";
        const pollKey = typeof Secrets !== "undefined" && Secrets.POLLINATIONS_API_KEY ? Secrets.POLLINATIONS_API_KEY : "sk_tefNMUnvpQbdOVYRgthdUFLBnvhrnxAW";

        try {
            // Try NVIDIA API First
            let res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${nvKey}`
                },
                body: JSON.stringify({
                    model: "meta/llama-3.1-70b-instruct",
                    temperature,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: user }
                    ],
                    stream: false
                })
            });

            if (!res.ok) {
                console.warn("[AiClient] NVIDIA API failed, falling back to Pollinations:", res.status);
                // Fallback to Pollinations API
                res = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${pollKey}`
                    },
                    body: JSON.stringify({
                        model: "nova-fast",
                        temperature,
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: user }
                        ],
                        stream: false
                    })
                });
            }

            if (!res.ok) {
                console.warn("[AiClient] AI request failed:", res.status, await res.text());
                return null;
            }
            const json = await res.json();
            return json?.choices?.[0]?.message?.content || null;
        } catch (e) {
            console.error("[AiClient] Request failed:", e);
            return null;
        }
    }

    /**
     * Chat completion that must yield JSON. Tries once deterministically; on
     * unparseable output, retries once with a reinforced instruction and a touch
     * of temperature so the model can break out of a bad deterministic response.
     * Returns the parsed value, or null if both attempts fail.
     */
    static async _chatJson(system, user) {
        let parsed = AiClient._tryParse(await AiClient._chatRaw(system, user, 0));
        if (parsed !== undefined) return parsed;

        const strictSystem = system + " Respond with ONLY valid, minified JSON — no markdown, no commentary.";
        parsed = AiClient._tryParse(await AiClient._chatRaw(strictSystem, user, 0.35));
        return parsed !== undefined ? parsed : null;
    }

    /**
     * Use AI to extract search results from HTML when manual parsing fails.
     * @param {string} html 
     * @param {string} query 
     * @param {string} baseUrl 
     * @returns {Promise<Array>}
     */
    static async fetchAiResults(html, query, baseUrl) {
        const simplifiedHtml = AiClient.simplifyHtml(html).substring(0, 10000);

        const prompt = `
Extract search results for the novel search query "${query}" from the following HTML snippet.
Base URL: ${baseUrl}

Return a JSON array of objects with "title", "url", and "snippet".
Ensure URLs are absolute. If the site is unavailable or no results found, return an empty array [].

HTML Snippet:
${simplifiedHtml}
`;

        const parsed = await AiClient._chatJson(
            "You are a specialized data extractor for web novel search results. Output ONLY valid JSON.",
            prompt
        );

        // Normalize/validate: always return a clean array, resolving relative
        // URLs and dropping entries the model returned without a title or link.
        if (!Array.isArray(parsed)) return [];
        const seen = new Set();
        const results = [];
        for (const item of parsed) {
            if (!item || typeof item !== "object") continue;
            const title = String(item.title || "").trim();
            let url = String(item.url || item.link || "").trim();
            if (!title || !url) continue;
            url = AiClient._resolveUrl(baseUrl, url);
            if (seen.has(url)) continue;
            seen.add(url);
            results.push({ title, url, snippet: String(item.snippet || "").trim(), source: "AI" });
        }
        console.log(`[AiClient] Extracted ${results.length} valid results via AI.`);
        return results;
    }

    /**
     * Identify CSS selectors for chapter content, title, and removal list using AI.
     * @param {string} html 
     * @param {string} url
     * @returns {Promise<Object>}
     */
    static async fetchAiSelectors(html, url) {
        const simplifiedHtml = AiClient.simplifyHtml(html).substring(0, 30000);
        const prompt = `
You are helping a user autocomplete the "Default Parser" settings for WebToEpub.
URL: ${url}

Identify the best CSS selectors for:
1. "content": The main element holding the story text (e.g., ".chapter-inner", "#vortex-content").
2. "title": The element holding the chapter title (e.g., "h1.entry-title", ".chapter-header h2").
3. "remove": A comma-separated string of selectors for elements to EXCLUDE (social sharing, ads, "next chapter" buttons, comments).

Return ONLY a JSON object: {"content": "...", "title": "...", "remove": "..."}

HTML Structure:
${simplifiedHtml}
`;

        const parsed = await AiClient._chatJson(
            "You are a web parsing expert. Output ONLY valid JSON.",
            prompt
        );

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
        const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
        const remove = typeof parsed.remove === "string" ? parsed.remove.trim() : "";
        // Useless without at least a content or title selector.
        if (!content && !title) return null;
        console.log("[AiClient] Autocomplete selectors found:", { content, title, remove });
        return { content, title, remove };
    }

    /**
     * Detect the first chapter URL and site-level selectors from a TOC page.
     * @param {string} html 
     * @param {string} baseUrl 
     * @returns {Promise<Object>} {firstChapterUrl, novelTitle, author}
     */
    static async fetchAiFirstChapter(html, baseUrl) {
        const simplifiedHtml = AiClient.simplifyHtml(html).substring(0, 20000);
        const prompt = `
You are helping identify the first chapter link of a novel from its Table of Contents (TOC) page.
Base URL: ${baseUrl}

Identify:
1. "firstChapterUrl": The absolute URL of the very first chapter (e.g., Chapter 1).
2. "novelTitle": The title of the novel if clearly visible.
3. "author": The author name if clearly visible.
4. "nextPageCss": The CSS selector for the 'Next' pagination link to go to page 2 of the TOC. If there is no pagination, return an empty string.

Return ONLY a JSON object: {"firstChapterUrl": "...", "novelTitle": "...", "author": "...", "nextPageCss": "..."}

HTML Snippet:
${simplifiedHtml}
`;

        const parsed = await AiClient._chatJson(
            "You are a novel site expert. Output ONLY valid JSON.",
            prompt
        );

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const firstChapterUrl = String(parsed.firstChapterUrl || "").trim();
        // The caller can't proceed without a first-chapter link — signal failure.
        if (!firstChapterUrl) return null;
        return {
            firstChapterUrl: AiClient._resolveUrl(baseUrl, firstChapterUrl),
            novelTitle: String(parsed.novelTitle || "").trim(),
            author: String(parsed.author || "").trim(),
            nextPageCss: String(parsed.nextPageCss || "").trim()
        };
    }

    /**
     * Strips scripts, styles, and noise attributes to maximize meaningful
     * structure per token. Removes whole script, style, svg, noscript and
     * comment blocks, then drops token-wasting attributes (inline styles,
     * event handlers, data- and aria- attributes, role, responsive-image
     * hints, and huge base64 "data:" URIs) while keeping class, id, href and
     * title — the parts the model actually needs to identify selectors/links.
     */
    static simplifyHtml(html) {
        if (!html) return "";
        return html
            .replace(AiClient.REGEX_SCRIPT, "")
            .replace(AiClient.REGEX_STYLE, "")
            .replace(AiClient.REGEX_SVG, "")
            .replace(AiClient.REGEX_NOSCRIPT, "")
            .replace(AiClient.REGEX_COMMENT, "")
            .replace(AiClient.REGEX_INLINE_STYLE, "")
            .replace(AiClient.REGEX_EVENT_HANDLER, "")
            .replace(AiClient.REGEX_DATA_ATTR, "")
            .replace(AiClient.REGEX_ARIA_ATTR, "")
            .replace(AiClient.REGEX_RESPONSIVE_IMG, "")
            .replace(AiClient.REGEX_DATA_URI, " $1=\"\"")
            .replace(AiClient.REGEX_SPACE, " ")
            .trim();
    }
}
