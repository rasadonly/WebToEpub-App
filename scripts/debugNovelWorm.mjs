import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Mock Browser Environment ---
const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = jsdom.window;
global.document = jsdom.window.document;
global.DOMParser = jsdom.window.DOMParser;
global.TextDecoder = jsdom.window.TextDecoder;
global.navigator = jsdom.window.navigator;
global.chrome = {
    i18n: { getMessage: (key) => key },
    runtime: { id: "test-id" }
};
global.Secrets = {
    POLLINATIONS_API_KEY: "sk_tefNMUnvpQbdOVYRgthdUFLBnvhrnxAW"
};

// --- Load Project Files ---
const loadFile = (relPath) => {
    const content = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    vm.runInThisContext(content);
};

loadFile('../plugin/js/Util.js');
loadFile('../plugin/js/HttpClient.js');
loadFile('../plugin/js/AiClient.js');

async function debugNovelWorm() {
    const testUrl = "https://www.novelworm.com/The-Apocalyptic-Queens-Werewolf-Journey583437/000001";
    console.log(`--- Debugging NovelWorm: ${testUrl} ---`);

    try {
        HttpClient.enableCorsProxy = true;
        // Using the same default proxy
        HttpClient.corsProxyUrl = HttpClient.CORS_PROXIES[0].url;
        console.log(`Using Proxy: ${HttpClient.corsProxyUrl}`);

        console.log("Fetching Page...");
        const xhr = await HttpClient.wrapFetch(testUrl);
        const html = xhr.responseText || xhr.responseXML.documentElement.outerHTML;

        console.log(`Fetched HTML length: ${html.length}`);
        if (html.length < 500) {
            console.log("HTML Preview:", html);
        }

        console.log("\nCalling AI for selectors...");
        const selectors = await AiClient.fetchAiSelectors(html, testUrl);
        console.log("AI Selectors:", JSON.stringify(selectors, null, 2));

        if (selectors && selectors.content) {
            const dom = new DOMParser().parseFromString(html, "text/html");
            const content = dom.querySelector(selectors.content);
            if (content) {
                console.log("✅ SUCCESS: Content element found!");
                console.log("Content Preview:", content.textContent.trim().substring(0, 200));
            } else {
                console.log(`❌ ERROR: Content element NOT FOUND for selector: "${selectors.content}"`);
            }
        } else {
            console.log("❌ ERROR: AI failed to return selectors.");
        }

    } catch (e) {
        console.error("Debug Crashed:", e);
    }
}

debugNovelWorm();
