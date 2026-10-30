const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

// Next 20 popular sites - test and probe HTML structure
const sites = [
  { name: 'SpaceBattles',       url: 'https://forums.spacebattles.com/threads/worm.185764/reader/' },
  { name: 'SufficientVelocity', url: 'https://forums.sufficientvelocity.com/threads/mother-of-learning.2052/reader/' },
  { name: 'QuestionableQuest',  url: 'https://forum.questionablequesting.com/threads/pokemon-mystery-dungeon-liberation.10003/reader/' },
  { name: 'Syosetu',            url: 'https://ncode.syosetu.com/n2267be/' },
  { name: 'AsianFanfics',       url: 'https://www.asianfanfics.com/story/view/1488682' },
  { name: 'ComradeMao',         url: 'https://comrademao.com/mtl/the-beginning-after-the-end/' },
  { name: 'WuxiaWorld.co',      url: 'https://wuxiaworld.co/The-Beginning-After-The-End/the-beginning-after-the-end-chapter-list.html' },
  { name: 'Chrysanthemum',      url: 'https://chrysanthemumgarden.com/novel-tl/tcf/' },
  { name: 'FastNovel',          url: 'https://fastnovel.net/tbate-8/' },
  { name: 'NovelKite',          url: 'https://www.novelkite.com/novel/martial-peak' },
  { name: 'NovelCool',          url: 'https://www.novelcool.com/novel/Martial-Peak.html' },
  { name: 'AllNovelFull',       url: 'https://allnovelfull.com/the-beginning-after-the-end.html' },
  { name: 'WoopRead',           url: 'https://woopread.com/series/the-beginning-after-the-end/' },
  { name: 'NovelPassion',       url: 'https://novelpassion.net/novel/the-beginning-after-the-end/' },
  { name: 'LightNovelPub (LP)', url: 'https://www.lightnovelpub.com/novel/shadow-slave-19072354/chapters' },
  { name: 'BestLightNovel',     url: 'https://bestlightnovel.com/novel_detail_803376' },
  { name: 'NovelTranslate',     url: 'https://www.noveltranslate.com/novel/martial-peak/' },
  { name: 'WuxiaWorld.eu',      url: 'https://wuxiaworld.eu/novel/martial-peak/chapters' },
  { name: 'ReadNovelFull.me',   url: 'https://readnovelfull.me/martial-peak' },
  { name: 'NovelTop1',          url: 'https://noveltop1.org/novel/the-beginning-after-the-end' },
];

async function probe({ name, url }) {
  const start = Date.now();
  try {
    const res = await fetch(
      `${BACKEND}/api/toc?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(20000) }
    );
    const elapsed = Date.now() - start;
    if (!res.ok) { console.log(`❌ ${name.padEnd(22)} HTTP ${res.status} (${elapsed}ms)`); return; }
    const data = await res.json();
    const count = data.chapters?.length ?? 0;
    const title = data.meta?.title || '';
    const icon = count > 0 ? '✅' : '⚠️ ';
    console.log(`${icon} ${name.padEnd(22)} ${count} chapters  "${title.slice(0,35)}"  (${elapsed}ms)  ${url}`);
  } catch (e) {
    console.log(`❌ ${name.padEnd(22)} ${e.message?.slice(0,50)} (${Date.now()-start}ms)`);
  }
}

for (let i = 0; i < sites.length; i += 4) {
  await Promise.all(sites.slice(i, i+4).map(probe));
}
