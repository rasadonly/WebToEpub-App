async function fetchPage(url) {
  const proxyUrl = "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
  const resp = await fetch(proxyUrl);
  const data = await resp.json();
  return data.contents;
}

(async () => {
  const html2 = await fetchPage("https://freewebnovel.com/novel/against-the-gods?page=2");
  if (html2.includes("Chapter 41") || html2.includes("chapter-41")) {
    console.log("Page 2 works with ?page=2");
  } else {
    console.log("Page 2 does not have Chapter 41. It might not be ?page=2.");
    
    // Check if it's the exact same as page 1
    const html1 = await fetchPage("https://freewebnovel.com/novel/against-the-gods");
    if (html1.substring(0, 1000) === html2.substring(0, 1000)) {
      console.log("?page=2 returns the exact same HTML as page 1. Pagination has changed.");
    }
  }
})();
