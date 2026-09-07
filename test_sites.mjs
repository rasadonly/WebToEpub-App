// Test TOC fetching for candidate sites
// Run: node server/test_sites.mjs
const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const candidates = [
  // Current featured sites
  { name: 'Royal Road',       url: 'https://www.royalroad.com/fiction/10073/the-wandering-inn' },
  { name: 'NovelBin',         url: 'https://novelbin.com/b/martial-peak' },
  { name: 'NovelFull',        url: 'https://novelfull.com/martial-peak.html' },
  { name: 'ScribbleHub',      url: 'https://www.scribblehub.com/series/1183/mother-of-learning/' },
  { name: 'WTR-LAB',          url: 'https://www.wtr-lab.com/en/serie-3914/i-am-the-fated-villain' },
  { name: 'WebNovel',         url: 'https://www.webnovel.com/book/martial-peak_13923529905743305' },
  { name: 'NovelFire',        url: 'https://novelfire.net/novel/martial-peak' },
  { name: 'FreeWebNovel',     url: 'https://freewebnovel.com/martial-peak.html' },
  { name: 'LightNovelWorld',  url: 'https://www.lightnovelworld.co/novel/martial-peak-264' },
  { name: 'AO3',              url: 'https://archiveofourown.org/works/454922' },
  { name: 'FanFiction.net',   url: 'https://www.fanfiction.net/s/5782108/1/Harry-Potter-and-the-Methods-of-Rationality' },
  { name: 'Parahumans (Worm)',url: 'https://parahumans.wordpress.com/table-of-contents/' },
  // Additional candidates to test as replacements
  { name: 'NovelUpdates (NF)',url: 'https://www.novelpub.com/novel/martial-peak-06040313' },
  { name: 'KKGamer',          url: 'https://www.kknovels.com/novel/martial-peak/' },
  { name: 'NovelCool',        url: 'https://www.novelcool.com/novel/Martial-Peak.html' },
  { name: 'MTLNovel',         url: 'https://www.mtlnovel.com/martial-peak/' },
  { name: 'BoxNovel',         url: 'https://boxnovel.com/novel/martial-peak/' },
  { name: 'ReadLightNovel',   url: 'https://readlightnovel.me/martial-peak' },
];

async function testSite({ name, url }) {
  const start = Date.now();
  try {
    const res = await fetch(
      `${BACKEND}/api/toc?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(20000) }
    );
    const elapsed = Date.now() - start;
    if (!res.ok) {
      console.log(`❌ ${name.padEnd(20)} HTTP ${res.status}  (${elapsed}ms)  ${url}`);
      return;
    }
    const data = await res.json();
    const count = data.chapters?.length ?? 0;
    const title = data.meta?.title || '';
    if (count > 0) {
      console.log(`✅ ${name.padEnd(20)} ${count} chapters  "${title.slice(0,40)}"  (${elapsed}ms)`);
    } else {
      console.log(`⚠️  ${name.padEnd(20)} 0 chapters  (${elapsed}ms)  ${url}`);
    }
  } catch (e) {
    const elapsed = Date.now() - start;
    console.log(`❌ ${name.padEnd(20)} ERROR: ${e.message?.slice(0,60)}  (${elapsed}ms)`);
  }
}

console.log('Testing TOC fetching for all candidate sites...\n');
// Run 3 at a time to avoid hammering the backend
for (let i = 0; i < candidates.length; i += 3) {
  await Promise.all(candidates.slice(i, i + 3).map(testSite));
}
console.log('\nDone.');
