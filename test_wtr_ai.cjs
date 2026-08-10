const https = require('https');

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
            translate: "ai",
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
            res.on('end', () => {
                console.log("AI translation response:");
                let json = JSON.parse(data);
                console.log("Keys:", Object.keys(json));
                if (json.data && json.data.data) {
                    console.log("Body exists:", !!json.data.data.body);
                    console.log("Body type:", typeof json.data.data.body);
                    if (Array.isArray(json.data.data.body)) {
                        console.log("Array length:", json.data.data.body.length);
                        console.log("First element:", json.data.data.body[0]);
                    } else {
                        console.log("Body string:", String(json.data.data.body).substring(0, 100));
                    }
                } else {
                    console.log("Error or no data:", data.substring(0, 200));
                }
            });
        });
        req.write(reqData);
        req.end();
    }
}
run();
