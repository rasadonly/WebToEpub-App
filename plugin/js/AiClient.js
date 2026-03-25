"use strict";

/**
 * AiClient - Interacts with Pollinations AI for search fallbacks.
 */
class AiClient {
    static MODEL = "nova-fast"; // Cost-efficient and fast

    /**
     * Use AI to extract search results from HTML when manual parsing fails.
     * @param {string} html 
     * @param {string} query 
     * @param {string} baseUrl 
     * @returns {Promise<Array>}
     */
    static async fetchAiResults(html, query, baseUrl) {
        const apiKey = typeof Secrets !== "undefined" ? Secrets.POLLINATIONS_API_KEY : null;
        if (!apiKey) {
            console.warn("[AiClient] No API key found in Secrets.js");
            return [];
        }

        // Limit HTML size to save tokens/pollen
        const simplifiedHtml = html.substring(0, 10000);

        const prompt = `
Extract search results for the novel search query "${query}" from the following HTML snippet.
Base URL: ${baseUrl}

Return a JSON array of objects with "title", "url", and "snippet". 
Ensure URLs are absolute. If the site is unavailable or no results found, return an empty array [].

HTML Snippet:
${simplifiedHtml}
`;

        try {
            const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: AiClient.MODEL,
                    messages: [
                        { role: "system", content: "You are a specialized data extractor for web novel search results. Output ONLY valid JSON." },
                        { role: "user", content: prompt }
                    ],
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.status}`);
            }

            const data = await response.json();
            const aiText = data.choices[0]?.message?.content || "[]";

            // Extract JSON from possible markdown wrapping
            const jsonMatch = aiText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            const results = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);

            console.log(`[AiClient] Successfully extracted ${results.length} results via AI.`);
            return results;
        } catch (e) {
            console.error("[AiClient] Failed to fetch AI results:", e);
            return [];
        }
    }

    /**
     * Use AI to identify CSS selectors for chapter content, title, and removal list.
     * @param {string} html 
     * @param {string} url
     * @returns {Promise<Object>}
     */
    static async fetchAiSelectors(html, url) {
        const apiKey = typeof Secrets !== "undefined" ? Secrets.POLLINATIONS_API_KEY : null;
        if (!apiKey) return null;

        const simplifiedHtml = html.substring(0, 15000);

        const prompt = `
Analyze the following HTML from ${url} and identify the CSS selectors for a web novel chapter.
1. "content": The main element containing the story text.
2. "title": The element containing the chapter title.
3. "remove": A comma-separated list of selectors for elements to remove (ads, social buttons, nav).

Return ONLY a JSON object with keys "content", "title", and "remove".

HTML Snippet:
${simplifiedHtml}
`;

        try {
            const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: AiClient.MODEL,
                    messages: [
                        { role: "system", content: "You are a web scraping expert focusing on web novels. Output ONLY valid JSON." },
                        { role: "user", content: prompt }
                    ],
                    stream: false
                })
            });

            if (!response.ok) throw new Error(`AI API error: ${response.status}`);

            const data = await response.json();
            const aiText = data.choices[0]?.message?.content || "{}";
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            const results = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);

            console.log(`[AiClient] Successfully predicted selectors via AI:`, results);
            return results;
        } catch (e) {
            console.error("[AiClient] Failed to predict selectors:", e);
            return null;
        }
    }
}
