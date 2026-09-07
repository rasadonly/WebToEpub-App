const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';
const sites = [
  { name: 'NovelOnlineFull',    url: 'https://novelonlinefull.com/novel/the_beginning_after_the_end' },
  { name: 'Wuxia.click',        url: 'https://wuxia.click/novel/the-beginning-after-the-end' },
  { name: 'FreeFull Novel',     url: 'https://freefullnovel.com/novel/the-beginning-after-the-end-1' },
  { name: 'NovelFull.me',       url: 'https://novelfull.me/the-beginning-after-the-end.html' },
  { name: 'BabelNovel',         url: 'https://babelnovel.com/books/the-beginning-after-the-end_2200271' },
  { name: 'NovelPlanet',        url: 'https://novelplanet.com/Novel/The-Beginning-After-The-End' },
  { name: 'WuxiaMania',         url: 'https://wuxiamania.com/novel/the-beginning-after-the-end' },
  { name: 'WNMTL',              url: 'https://www.wnmtl.org/book/2292-the-beginning-after-the-end' },
  { name: 'ReadLightNovelWeb',  url: 'https://readlightnovelweb.net/the-beginning-after-the-end/' },
  { name: 'NovelUpdates.cc',    url: 'https://www.novelupdates.cc/the-beginning-after-the-end' },
  { name: 'Storyonline.net',    url: 'https://storiesonline.net/s/43706/the-beginning-after-the-end' },
  { name: 'Novelhall.net',      url: 'https://www.novelhall.net/the-beginning-after-the-end-1/' },
  { name: 'NovelSky',           url: 'https://novelsky.com/novel/the-beginning-after-the-end' },
  { name: 'BooksRFree',         url: 'https://booksrfree.com/novel/the-beginning-after-the-end' },
  { name: 'Novelnext.com',      url: 'https://www.novelnext.com/novelnext/the-beginning-after-the-end/1' },
  { name: 'BakaNovel',          url: 'https://baka-novel.com/the-beginning-after-the-end' },
  { name: 'NovelHereOnline',    url: 'https://novelhereonline.com/novel/the-beginning-after-the-end' },
  { name: 'PixivNovel',         url: 'https://novel.pixiv.net/works/13286741' },
  { name: 'Jjwxc',              url: 'https://www.jjwxc.net/onebook.php?novelid=2609971' },
  { name: 'NovelUpdates.org',   url: 'https://novelupdates.org/novel/the-beginning-after-the-end' },
];

async function probe({ name, url }) {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND}/api/toc?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(16000) });
    const elapsed = Date.now() - start;
    if (!res.ok) { console.log(`❌ ${name.padEnd(22)} HTTP ${res.status} (${elapsed}ms)`); return; }
    const data = await res.json();
    const count = data.chapters?.length ?? 0;
    const title = (data.meta?.title || '').slice(0,32);
    console.log(`${count > 0 ? '✅' : '⚠️ '} ${name.padEnd(22)} ${count} ch  "${title}"  (${elapsed}ms)`);
  } catch (e) {
    console.log(`❌ ${name.padEnd(22)} ${e.message?.slice(0,40)} (${Date.now()-start}ms)`);
  }
}
for (let i = 0; i < sites.length; i += 4) await Promise.all(sites.slice(i, i+4).map(probe));
