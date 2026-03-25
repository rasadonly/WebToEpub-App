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

async function testAiSelectors() {
    console.log("--- Testing AI Selector Prediction ---");

    const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Chapter 1: The Beginning - My Novel</title></head>
        <body>
            <nav><ul><li>Home</li><li>Library</li></ul></nav>
            <div class="header">
                <h1 class="entry-title">Chapter 1: The Beginning</h1>
            </div>
            <div class="content-area">
                <div class="novel-content">
                    <p>It was a dark and stormy night...</p>
                    <p>Suddenly, a bolt of lightning struck the tower.</p>
                </div>
            </div>
            <div class="sidebar">
                <div class="ads">Buy our merch!</div>
                <div class="social">Share on Twitter</div>
            </div>
            <div class="footer">Copyright 2026</div>
        </body>
        </html>
    `;
    const url = "https://example.com/chapter-1";

    console.log(`URL: ${url}`);
    console.log("Calling AiClient.fetchAiSelectors...");

    try {
        const results = await AiClient.fetchAiSelectors(mockHtml, url);
        console.log("\n--- Predicted Selectors ---");
        console.log(JSON.stringify(results, null, 2));

        if (results && results.content && results.title) {
            console.log("\n✅ AI Selector Prediction is WORKING!");
        } else {
            console.log("\n❌ AI Selector Prediction FAILED (Missing critical selectors).");
        }
    } catch (e) {
        console.error("Test Crashed:", e);
    }
}

testAiSelectors();
