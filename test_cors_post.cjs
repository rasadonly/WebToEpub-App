const http = require('http');

async function testCors() {
    const fetchUrl = "https://wtr-lab.com/api/reader/get";
    const body = JSON.stringify({
        "translate": "webplus",
        "language": "en",
        "raw_id": "85752",
        "chapter_no": "25",
        "retry": false,
        "force_retry": false
    });

    try {
        const resp = await fetch(fetchUrl, {
            method: "OPTIONS",
            headers: {
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type"
            }
        });

        console.log("Status:", resp.status);
        console.log("CORS Headers:");
        for (let [key, val] of resp.headers.entries()) {
            if (key.toLowerCase().includes('access-control')) {
                console.log(key, val);
            }
        }
    } catch (e) {
        console.error("Error", e);
    }
}

testCors();
