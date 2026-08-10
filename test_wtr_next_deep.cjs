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
        let serie = json.props?.pageProps?.serie;
        if (serie) {
            console.log("Serie keys:", Object.keys(serie));
            if (serie.chapter_data) {
                console.log("chapter_data keys:", Object.keys(serie.chapter_data));
            } else {
                console.log("No chapter_data");
            }
        }
    }
}
run();
