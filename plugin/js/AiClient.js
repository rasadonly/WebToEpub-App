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
}
