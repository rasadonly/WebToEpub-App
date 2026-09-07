const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const candidates = [
  { name: 'Wattpad',          url: 'https://www.wattpad.com/story/112668579-the-beginning-after-the-end' },
  { name: 'SpaceBattles',     url: 'https://forums.spacebattles.com/threads/the-wandering-inn-fantasy-slice-of-life.676645/' },
  { name: 'SufficientVelocity',url: 'https://forums.sufficientvelocity.com/threads/the-wandering-inn-fantasy-slice-of-life.53676/' },
  { name: 'AsianHobbyist',    url: 'https://www.asianhobbyist.com/series/martial-peak/' },
  { name: 'FictionPress',     url: 'https://www.fictionpress.com/s/2961893/1/Mother-of-Learning' },
  { name: 'Tapas',            url: 'https://tapas.io/series/tbate/info' },
  { name: 'WebfictionGuide',  url: 'http://webfictionguide.com/listings/the-wandering-inn/' },
  { name: 'MoonQuill',        url: 'https://moonquill.com/book/the-wandering-inn' },
  { name: 'Neovel',           url: 'https://neoread.neovel.io/book/8381/EN/the-beginning-after-the-end' }
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
