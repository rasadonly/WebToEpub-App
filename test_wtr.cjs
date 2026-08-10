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
    console.log("Chapters length:", chapters?.chapters?.length);
    if (chapters?.chapters?.length > 0) {
        let first = chapters.chapters[0];
        console.log("First chapter id:", first.id, "order:", first.order);
        
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
                'Content-Length': reqData.length
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log("Reader API response:");
                try {
                    let json = JSON.parse(data);
                    console.log("Keys:", Object.keys(json));
                    if (json.data && json.data.data) {
                        console.log("Body typeof:", typeof json.data.data.body);
                        console.log("Body prefix:", String(json.data.data.body).substring(0, 50));
                    } else {
                        console.log("Raw:", data.substring(0, 500));
                    }
                } catch(e) {
                    console.log("Not JSON:", data.substring(0, 500));
                }
            });
        });
        req.write(reqData);
        req.end();
    }
}
run();
