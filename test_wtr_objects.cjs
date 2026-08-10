const https = require('https');
const crypto = require('crypto').webcrypto;

async function decryptWtrlabBody(encryptedStr) {
    if (typeof encryptedStr !== "string") return encryptedStr;
    let isArray = false, dataStr = encryptedStr;
    if (dataStr.startsWith("arr:")) { isArray = true; dataStr = dataStr.substring(4); }
    else if (dataStr.startsWith("str:")) dataStr = dataStr.substring(4);
    else return encryptedStr;
    let parts = dataStr.split(":");
    if (parts.length < 3) return encryptedStr;
    let iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
    let tag = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    let cipherB64 = parts.slice(2).join(":");
    let cipher = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    let combined = new Uint8Array(cipher.length + tag.length);
    combined.set(cipher); combined.set(tag, cipher.length);
    let rawKey = new TextEncoder().encode("IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru".slice(0, 32));
    let cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
    let decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, cryptoKey, combined);
    let decodedStr = new TextDecoder().decode(decrypted);
    return isArray ? JSON.parse(decodedStr) : decodedStr;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = ''; res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function run() {
    let chapters = await fetchJson('https://wtr-lab.com/api/chapters/123');
    for (let i = 0; i < 3; i++) {
        let first = chapters.chapters[i];
        let reqData = JSON.stringify({ translate: "webplus", language: "en", raw_id: "123", chapter_no: first.order.toString(), retry: false, force_retry: false });
        await new Promise(resolve => {
            let req = https.request('https://wtr-lab.com/api/reader/get', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqData) } }, (res) => {
                let data = ''; res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    let json = JSON.parse(data);
                    if (json.data && json.data.data) {
                        let decrypted = await decryptWtrlabBody(json.data.data.body);
                        let hasObjects = false;
                        if (Array.isArray(decrypted)) {
                            hasObjects = decrypted.some(item => typeof item !== 'string');
                            if (hasObjects) console.log(`Chapter ${i} has objects!`, decrypted.filter(item => typeof item !== 'string').slice(0, 2));
                        }
                        console.log(`Chapter ${i}: Array length: ${decrypted.length}, hasObjects: ${hasObjects}`);
                    }
                    resolve();
                });
            });
            req.write(reqData); req.end();
        });
    }
}
run();
