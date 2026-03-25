const testUrl = "https://novelebook.com/a-man-like-none-other/r812638.html";
const proxy = "https://nexuspage-extractor.prasadghanwat123.workers.dev/?url=";

async function checkChapter() {
    try {
        const response = await fetch(proxy + encodeURIComponent(testUrl));
        if (response.ok) {
            const text = await response.text();
            process.stdout.write(text);
        }
    } catch (e) { }
}

checkChapter();
