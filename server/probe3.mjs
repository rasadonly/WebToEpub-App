const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  return r.text();
}

// Show 400 chars around a keyword
function snip(html, kw) {
  const i = html.indexOf(kw);
  if (i < 0) return `  "${kw}" NOT FOUND`;
  return '  ' + html.slice(Math.max(0,i-100), i+300).replace(/\n/g,' ').replace(/\s+/g,' ');
}

// NovelCool - find chapter link structure
const ncHtml = await getText('https://www.novelcool.com/novel/Martial-Peak.html');
console.log('\n=== NOVELCOOL ===');
console.log(snip(ncHtml, 'chapter-list'));
console.log(snip(ncHtml, 'chp-item'));
console.log(snip(ncHtml, '/read/Martial-Peak'));

// AllNovelFull
const anHtml = await getText('https://allnovelfull.com/the-beginning-after-the-end.html');
console.log('\n=== ALLNOVELFULL ===');
console.log(snip(anHtml, 'list-chapter'));
console.log(snip(anHtml, 'chapter-list'));
console.log(snip(anHtml, '/chapter-'));

// Syosetu TOC
const syoHtml = await getText('https://ncode.syosetu.com/n2267be/');
console.log('\n=== SYOSETU ===');
console.log(snip(syoHtml, 'novel_sublist'));
console.log(snip(syoHtml, 'chapter_title'));
console.log(snip(syoHtml, '/n2267be/'));

// WuxiaWorld.co
const wxHtml = await getText('https://wuxiaworld.co/The-Beginning-After-The-End/');
console.log('\n=== WUXIAWORLD.CO ===');
console.log(`  Length: ${wxHtml.length}`);
console.log(snip(wxHtml, 'chapter-list'));
console.log(snip(wxHtml, 'chapter-item'));
