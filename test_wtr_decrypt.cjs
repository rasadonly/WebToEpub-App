const https = require('https');
const crypto = require('crypto').webcrypto;

async function decryptWtrlabBody(encryptedStr) {
    if (typeof encryptedStr !== "string") {
        return encryptedStr;
    }
    
    let isArray = false;
    let dataStr = encryptedStr;
    if (dataStr.startsWith("arr:")) {
        isArray = true;
        dataStr = dataStr.substring(4);
    } else if (dataStr.startsWith("str:")) {
        dataStr = dataStr.substring(4);
    } else {
        return encryptedStr; // Not encrypted or unknown format
    }

    let parts = dataStr.split(":");
    if (parts.length < 3) return encryptedStr;
    
    let iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
    let tag = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    let cipherB64 = parts.slice(2).join(":"); // Handle possible colons in base64 padding
    let cipher = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    
    // GCM ciphertext = cipher_bytes + tag_bytes
    let combined = new Uint8Array(cipher.length + tag.length);
    combined.set(cipher);
    combined.set(tag, cipher.length);
    
    let rawKey = new TextEncoder().encode("IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru".slice(0, 32));
    let cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
    let decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, cryptoKey, combined);
    let decodedStr = new TextDecoder().decode(decrypted);
    
    return isArray ? JSON.parse(decodedStr) : decodedStr;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    let chapters = await fetchJson('https://wtr-lab.com/api/chapters/123');
    if (chapters?.chapters?.length > 0) {
        let first = chapters.chapters[0];
        
        let reqData = JSON.stringify({
            translate: "webplus",
            language: "en",
            raw_id: "123",
            chapter_no: first.order.toString(),
            retry: false,
            force_retry: false
        });
        
        let req = https.request('https://wtr-lab.com/api/reader/get', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                let json = JSON.parse(data);
                if (json.data && json.data.data) {
                    let decrypted = await decryptWtrlabBody(json.data.data.body);
                    console.log("Decrypted type:", Array.isArray(decrypted) ? 'Array' : typeof decrypted);
                    if (Array.isArray(decrypted)) {
                        console.log("Array length:", decrypted.length);
                        console.log("First element:", decrypted[0]);
                    } else {
                        console.log("Decrypted:", String(decrypted).substring(0, 500));
                    }
                }
            });
        });
        req.write(reqData);
        req.end();
    }
}
run();
