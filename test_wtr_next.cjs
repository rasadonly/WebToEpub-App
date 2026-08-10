const https = require('https');

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    let html = await fetchText('https://wtr-lab.com/en/novel/123/title/chapter-1');
    let match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (match) {
        let json = JSON.parse(match[1]);
        console.log("Next data magickey:", json.buildId);
        let data = json.props?.pageProps?.serie?.chapter_data?.data;
        if (data) {
            console.log("Body exists:", !!data.body);
            if (data.body) {
                console.log("Body type:", typeof data.body);
                if (Array.isArray(data.body)) {
                    console.log("Array length:", data.body.length);
                }
            }
        } else {
            console.log("No chapter_data.data in props:", Object.keys(json.props?.pageProps || {}));
        }
    } else {
        console.log("No NEXT DATA script found.");
    }
}
run();
