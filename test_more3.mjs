const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const candidates = [
  { name: 'LightNovelPub',    url: 'https://www.lightnovelpub.com/novel/shadow-slave-19072354' },
  { name: 'WuxiaWorld.eu',    url: 'https://wuxiaworld.eu/novel/martial-peak' },
  { name: 'FastNovel',        url: 'https://fastnovel.net/martial-peak-8/' },
  { name: 'NovelFull.net',    url: 'https://novelfull.net/martial-peak.html' },
  { name: 'NovelBin.me',      url: 'https://novelbin.me/novel-book/martial-peak' },
  { name: 'BoxNovel.net',     url: 'https://boxnovel.net/novel/martial-peak' },
  { name: 'NovelFull.com',    url: 'https://novelfull.com/martial-peak.html' },
  { name: 'ReadNovelFull.me', url: 'https://readnovelfull.me/martial-peak' },
  { name: 'ZinNovel',         url: 'https://zinnovel.com/manga/martial-peak/' },
  { name: 'Baka-Tsuki',       url: 'https://www.baka-tsuki.org/project/index.php?title=High_School_DxD' },
  { name: 'Syosetu',          url: 'https://ncode.syosetu.com/n2267be/' },
  { name: 'KakaoPage',        url: 'https://page.kakao.com/content/50866481' },
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
