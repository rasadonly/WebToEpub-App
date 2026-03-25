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

async function testAi() {
    console.log("--- Testing AI Fallback ---");

    const mockHtml = `
        <html>
            <body>
                <div class="search-result">
                    <a href="/novel/shadow-slave">Shadow Slave</a>
                    <p>A novel about a young man in a nightmare world.</p>
                </div>
                <div class="search-result">
                    <a href="/novel/lord-of-the-mysteries">Lord of the Mysteries</a>
                    <p>Steampunk and mystery in a Victorian-style world.</p>
                </div>
            </body>
        </html>
    `;
    const query = "shadow slave";
    const baseUrl = "https://example-novel-site.com";

    console.log(`Query: ${query}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log("Calling AiClient.fetchAiResults...");

    try {
        const results = await AiClient.fetchAiResults(mockHtml, query, baseUrl);
        console.log("\n--- AI Results ---");
        console.log(JSON.stringify(results, null, 2));

        if (results.length > 0 && results[0].title && results[0].url) {
            console.log("\n✅ AI Fallback is WORKING!");
        } else {
            console.log("\n❌ AI Fallback FAILED (No results or missing data).");
        }
    } catch (e) {
        console.error("Test Crashed:", e);
    }
}

testAi();
