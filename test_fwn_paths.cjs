const jsdom = require("jsdom");
const { JSDOM } = jsdom;

async function fetchPage(url) {
  const proxyUrl = "https://thingproxy.freeboard.io/fetch/" + url;
  try {
    const response = await fetch(proxyUrl);
    return await response.text();
  } catch (e) {
    return "";
  }
}

async function check(url) {
  const h = await fetchPage(url);
  const dom = new JSDOM(h);
  const doc = dom.window.document;
  let chs = Array.from(doc.querySelectorAll('#idData li > a')).length;
  if (chs === 0) chs = Array.from(doc.querySelectorAll('.m-newest2 a, .chapter-list a')).length;
  console.log(url, "=> chapters:", chs);
  
  if (chs > 0) {
    const firstTitle = doc.querySelectorAll('#idData li > a')[0]?.title || 
                       doc.querySelectorAll('.m-newest2 a, .chapter-list a')[0]?.textContent.trim();
    console.log("  First chapter:", firstTitle);
  }
}

(async () => {
  await check("https://freewebnovel.com/novel/against-the-gods");
  await check("https://freewebnovel.com/novel/against-the-gods?page=2");
  await check("https://freewebnovel.com/novel/against-the-gods/2");
  await check("https://freewebnovel.com/novel/against-the-gods/2.html");
})();
