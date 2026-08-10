import { simplifyHtml } from './src/aiParser.js';
import fetch from 'node-fetch'; // assuming fetch is global in Node 18+

const html = `
<html>
<body>
  <div class="chapter-title">Chapter 1: The Beginning</div>
  <div class="chapter-content">
    <p>This is the story.</p>
    <div class="ads">Ad here</div>
  </div>
</body>
</html>
`;

async function run() {
    const NV_KEY = process.env.NVIDIA_API_KEY;
    const system = "You are a web-scraping expert. Output ONLY valid JSON.";
    const user = `Given this web-novel CHAPTER page, identify CSS selectors.
URL: https://example.com/chapter-1

Return JSON: {"content":"selector for the element holding the story text","title":"selector for the chapter title","remove":"comma separated selectors of junk inside content (ads, nav, share, comments)"}
Prefer a single specific selector for "content". Never return "body".

HTML:
${simplifyHtml(html).slice(0, 30000)}`;

    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${NV_KEY}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-70b-instruct",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
    });
    const text = await res.text();
    console.log("Response:", text);
}
run();
