import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Mock Browser Environment ---
global.Secrets = {
    POLLINATIONS_API_KEY: "sk_tefNMUnvpQbdOVYRgthdUFLBnvhrnxAW"
};

// --- Load AiClient ---
const aiClientContent = fs.readFileSync(path.join(__dirname, '../plugin/js/AiClient.js'), 'utf8');
vm.runInThisContext(aiClientContent);

async function testAiSelectorsRefined() {
    console.log("--- Testing Refined AI Selector Prediction ---");

    const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Chapter 100: The Climax - Epic Novel</title>
            <style>.ads { color: red; }</style>
            <script>console.log("noisy script");</script>
        </head>
        <body>
            <header><h1>Epic Novel</h1></header>
            <nav id="top-nav"><ul><li>Link 1</li></ul></nav>
            <main>
                <div class="breadcrumb">Home > Novel > Chapter 100</div>
                <article class="chapter-container">
                    <h2 class="title-selector">Chapter 100: The Climax</h2>
                    <div id="chapter-content-body">
                        <p>The hero stood before the beast.</p>
                        <p>This is the story content.</p>
                    </div>
                </article>
            </main>
            <aside class="sidebar-ads">
                <div class="ad-slot">Cheap Gold!</div>
                <div class="social-share">Share now</div>
            </aside>
            <footer>Contact us at help@example.com</footer>
            <script>window.analytics = true;</script>
            <svg> noisy svg </svg>
        </body>
        </html>
    `;
    const url = "https://epicnovel.com/chapter-100";

    console.log(`URL: ${url}`);
    console.log("Original HTML size:", mockHtml.length);

    const simplified = AiClient.simplifyHtml(mockHtml);
    console.log("Simplified HTML size:", simplified.length);
    console.log("Simplified HTML Preview:", simplified.substring(0, 500));

    console.log("\nCalling AiClient.fetchAiSelectors...");

    try {
        const results = await AiClient.fetchAiSelectors(mockHtml, url);
        console.log("\n--- Predicted Selectors (Refined) ---");
        console.log(JSON.stringify(results, null, 2));

        if (results && results.content && results.title) {
            console.log("\n✅ Refined AI Selector Prediction is WORKING!");
        } else {
            console.log("\n❌ Refined AI Selector Prediction FAILED.");
        }
    } catch (e) {
        console.error("Test Crashed:", e);
    }
}

testAiSelectorsRefined();
