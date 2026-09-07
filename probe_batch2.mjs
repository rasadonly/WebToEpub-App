const BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';

const sites = [
  // MTL / aggregators
  { name: 'LNMTL',             url: 'https://lnmtl.com/novel/the-beginning-after-the-end' },
  { name: 'NovelOnlineFree',   url: 'https://novelonlinefree.com/novel/the_beginning_after_the_end' },
  { name: 'WebFic',            url: 'https://www.webfic.com/novel/the-beginning-after-the-end-1' },
  { name: 'Libread',           url: 'https://libread.org/libread/the-beginning-after-the-end-8' },
  // Platform / app
  { name: 'HiNovel',           url: 'https://hinovel.com/book/23495.html' },
  { name: 'Inkitt',            url: 'https://www.inkitt.com/stories/fantasy/786591' },
  { name: 'Fizzo (Fictum)',    url: 'https://fizzo.org/novel/the-beginning-after-the-end-1' },
  // Translation blogs / fan-hosted
  { name: 'Volare Novels',     url: 'https://www.volarenovels.com/novel/bringing-the-farm-to-live-in-another-world' },
  { name: 'GravityTales',      url: 'https://gravitytales.com/novel/warlock-of-the-magus-world' },
  { name: 'WuxiaWorld.eu',     url: 'https://wuxiaworld.eu/novel/martial-peak/' },
  // More scanlation Madara sites
  { name: 'DragonHolic',       url: 'https://dragonholic.com/novel/the-beginning-after-the-end/' },
  { name: 'ReaperScans',       url: 'https://reaperscans.com/series/the-beginning-after-the-end/' },
  { name: 'AsuraScans',        url: 'https://asura.gg/comic/the-beginning-after-the-end/' },
  // Novel aggregators
  { name: 'NovelHunter',       url: 'https://novelhunter.com/novel/martial-peak' },
  { name: 'WuxiaWorld.online', url: 'https://wuxiaworld.online/novel/martial-peak/' },
  { name: 'ReadFreeLightNovel',url: 'https://readfreewebnovel.net/novel/the-beginning-after-the-end-1' },
  { name: 'NovelMao',          url: 'https://novelmao.com/novel/the-beginning-after-the-end' },
  { name: 'FicWad',            url: 'https://ficwad.com/a/5' },
  { name: 'Litnet',            url: 'https://litnet.com/en/book/the-beginning-after-the-end-b263424' },
  { name: 'WebNovels.com',     url: 'https://webnovels.com/novel/the-beginning-after-the-end' },
];

async function probe({ name, url }) {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND}/api/toc?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(18000) });
    const elapsed = Date.now() - start;
    if (!res.ok) { console.log(`❌ ${name.padEnd(20)} HTTP ${res.status} (${elapsed}ms)`); return; }
    const data = await res.json();
    const count = data.chapters?.length ?? 0;
    const title = (data.meta?.title || '').slice(0,35);
    const icon = count > 0 ? '✅' : '⚠️ ';
    console.log(`${icon} ${name.padEnd(20)} ${count} ch  "${title}"  (${elapsed}ms)`);
  } catch (e) {
    console.log(`❌ ${name.padEnd(20)} ${e.message?.slice(0,45)} (${Date.now()-start}ms)`);
  }
}

for (let i = 0; i < sites.length; i += 4) {
  await Promise.all(sites.slice(i, i+4).map(probe));
}
