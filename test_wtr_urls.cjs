const https = require('https');
const crypto = require('crypto').webcrypto;

async function decryptWtrlabBody(encryptedStr) {
    if (typeof encryptedStr !== "string") return encryptedStr;
    let isArray = false;
    let dataStr = encryptedStr;
    if (dataStr.startsWith("arr:")) {
        isArray = true;
        dataStr = dataStr.substring(4);
    } else if (dataStr.startsWith("str:")) {
        dataStr = dataStr.substring(4);
    } else {
        return encryptedStr;
    }

    let parts = dataStr.split(":");
    if (parts.length < 3) return encryptedStr;
    
    let iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
    let tag = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    let cipherB64 = parts.slice(2).join(":"); 
    let cipher = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    
    let combined = new Uint8Array(cipher.length + tag.length);
    combined.set(cipher);
    combined.set(tag, cipher.length);
    
    let rawKey = new TextEncoder().encode("IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru".slice(0, 32));
    let cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
    let decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, cryptoKey, combined);
    let decodedStr = new TextDecoder().decode(decrypted);
    
    return isArray ? JSON.parse(decodedStr) : decodedStr;
}

function fetchJsonPost(url, data) {
    return new Promise((resolve, reject) => {
        let reqData = JSON.stringify(data);
        let req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqData)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    console.error("JSON PARSE ERROR", body.substring(0, 200));
                    resolve(null);
                }
            });
        }).on('error', reject);
        req.write(reqData);
        req.end();
    });
}

async function run() {
    let raw_id = "85752";
    
    console.log("=== Testing Chapter 1 (AI) ===");
    let chap1Data = await fetchJsonPost('https://wtr-lab.com/api/reader/get', {
        translate: "ai",
        language: "en",
        raw_id: raw_id,
        chapter_no: "1",
        retry: false,
        force_retry: false
    });
    console.log("Chap1 Code:", chap1Data?.code);
    let body1 = chap1Data?.data?.data?.body;
    if (body1) {
        if (typeof body1 === "string") {
            console.log("Chap1 body is encrypted string, decrypting...");
            body1 = await decryptWtrlabBody(body1);
        }
        console.log("Chap1 Body elements:", Array.isArray(body1) ? body1.length : typeof body1);
        if (Array.isArray(body1)) console.log("First element:", body1[0]);
    } else {
        console.log("No body in Chap 1 AI.");
    }
    
    console.log("\n=== Testing Chapter 25 (WebPlus) ===");
    let chap135Data = await fetchJsonPost('https://wtr-lab.com/api/reader/get', {
        translate: "webplus",
        language: "en",
        raw_id: raw_id,
        chapter_no: "25",
        retry: false,
        force_retry: false
    });
    console.log("Chap25 Code:", chap135Data?.code);
    let body135 = chap135Data?.data?.data?.body;
    if (body135) {
        if (typeof body135 === "string") {
            console.log("Chap25 body is encrypted string, decrypting...");
            body135 = await decryptWtrlabBody(body135);
        }
        console.log("Chap25 Body elements:", Array.isArray(body135) ? body135.length : typeof body135);
        if (Array.isArray(body135)) console.log("First element:", body135[0]);
    } else {
        console.log("No body in Chap 25 WebPlus.", chap135Data);
    }
}
run();
