const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const candidates = [
  { name: 'WTR-LAB',          url: 'https://www.wtr-lab.com/en/serie-3914/i-am-the-fated-villain' },
  { name: 'NovelCool',        url: 'https://www.novelcool.com/novel/Martial-Peak.html' },
  { name: 'Ranobe',           url: 'https://ranobes.top/novels/1083994-shadow-slave-v299446.html' },
  { name: 'LightNovelPub',    url: 'https://www.lightnovelpub.com/novel/shadow-slave-19072354' },
  { name: 'PandaNovel',       url: 'https://www.panda-novel.com/details/shadow-slave(680)' },
  { name: 'WuxiaWorld.site',  url: 'https://wuxiaworld.site/novel/martial-peak/' },
  { name: 'ReadLightNovel.me',url: 'https://readlightnovel.me/martial-peak' },
  { name: 'NovelKite',        url: 'https://www.novelkite.com/novel/martial-peak' },
  { name: 'NovelHall',        url: 'https://www.novelhall.com/Martial-Peak-10024/' },
  { name: 'Foxaholic',        url: 'https://www.foxaholic.com/novel/the-villain-wants-to-live/' },
  { name: 'Chrysanthemum',    url: 'https://chrysanthemumgarden.com/novel-tl/tcf/' },
  { name: 'NovelBuddy',       url: 'https://novelbuddy.com/novel/martial-peak' },
  { name: 'NovelTranslate',   url: 'https://www.noveltranslate.com/novel/martial-peak/' },
  { name: 'CrescentMoon',     url: 'https://crescentmoon.blog/the-villain-wants-to-live/' },
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
