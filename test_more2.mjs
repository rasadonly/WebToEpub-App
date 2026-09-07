const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const candidates = [
  { name: 'Neovel',           url: 'https://neoread.neovel.io/book/8381/EN/the-beginning-after-the-end' },
  { name: 'Quotev',           url: 'https://www.quotev.com/story/13531995/The-Beginning-After-The-End' },
  { name: 'WuxiaWorld.co',    url: 'https://www.wuxiaworld.co/The-Beginning-After-The-End/' },
  { name: 'ReadNovelFull',    url: 'https://readnovelfull.com/the-beginning-after-the-end.html' },
  { name: 'NovelTrench',      url: 'https://noveltrench.com/manga/the-beginning-after-the-end/' },
  { name: 'AllNovelFull',     url: 'https://allnovelfull.com/the-beginning-after-the-end.html' },
  { name: 'NovelUpdates',     url: 'https://www.novelupdates.com/series/the-beginning-after-the-end/' },
  { name: 'VipNovel',         url: 'https://vipnovel.com/vipnovel/the-beginning-after-the-end/' },
  { name: 'Comrademao',       url: 'https://comrademao.com/mtl/the-beginning-after-the-end/' },
  { name: 'WNMTL',            url: 'https://www.wnmtl.org/book/2292-the-beginning-after-the-end' },
  { name: 'Daocaoren',        url: 'https://www.daocaorenshuwu.com/book/the-beginning-after-the-end/' },
  { name: 'Uukanshu',         url: 'https://uukanshu.com/b/70659/' },
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

for (let i = 0; i < candidates.length; i += 3) {
  await Promise.all(candidates.slice(i, i + 3).map(testSite));
}
