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
    if (chapters?.chapters?.length > 100) {
        let chap = chapters.chapters[100];
        console.log("Checking webplus for chapter", chap.order);
        
        let reqData = JSON.stringify({
            translate: "webplus",
            language: "en",
            raw_id: "123",
            chapter_no: chap.order.toString(),
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
                let json = JSON.parse(data);
                console.log("Webplus Code:", json.code);
                if (json.data && json.data.data) {
                    console.log("Body exists:", !!json.data.data.body);
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
