const https = require('https');

function fetchJsonPost(url, text) {
    return new Promise((resolve, reject) => {
        let reqData = "q=" + encodeURIComponent(text);
        let req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(reqData)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve(body);
            });
        }).on('error', reject);
        req.write(reqData);
        req.end();
    });
}

async function run() {
    let url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t";
    let text = "你好，世界！".repeat(500); // long text
    let res = await fetchJsonPost(url, text);
    console.log(res.substring(0, 100));
}
run();
