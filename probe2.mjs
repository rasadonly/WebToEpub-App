// Fetch raw HTML from key sites to inspect their TOC structure
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const PROXIES = [
  '',
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?key=ab3170e1&url=',
  'https://proxy.cors.sh/',
];

async function fetch2(url, proxy='') {
  const target = proxy ? (proxy.includes('?') ? proxy + encodeURIComponent(url) : proxy + url) : url;
  const r = await fetch(target, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function probe(name, url, hints) {
  for (const proxy of PROXIES) {
    try {
      const html = await fetch2(url, proxy);
      // Check for any of the hint selectors
      const found = hints.filter(h => html.includes(h));
      const redirect = html.includes('Redirecting') || html.includes('Loading...');
      console.log(`\n=== ${name} (proxy:${proxy ? 'yes':'direct'}) ===`);
      console.log(`  Length: ${html.length} | Redirect/JS: ${redirect}`);
      console.log(`  Hints found: ${found.join(', ') || 'NONE'}`);
      if (found.length > 0) break; // stop at first success
      if (!redirect) break; // if not redirecting, try next proxy won't help
    } catch(e) {
      console.log(`  ${name}: ${e.message}`);
    }
  }
}

await probe('LightNovelPub chapters', 
  'https://www.lightnovelpub.com/novel/shadow-slave-19072354/chapters',
  ['chapter-list', 'chapter-item', 'chp-item', 'li-row', '/chapter/', 'data-id']
);

await probe('LightNovelPub API',
  'https://www.lightnovelpub.com/api/novels/shadow-slave-19072354/chapters?page=1&sort=0',
  ['chapter', 'items', 'data', 'title']
);

await probe('NovelCool chapter list',
  'https://www.novelcool.com/chapter/Martial-Peak-Chapter-1.html',
  ['chapter-list', 'Chapter', 'href']
);

await probe('AllNovelFull chapters',
  'https://allnovelfull.com/the-beginning-after-the-end.html',
  ['chapter-list', 'ul.list-chapter', '.list-chapter']
);

await probe('WuxiaWorld.co chapter list',
  'https://wuxiaworld.co/The-Beginning-After-The-End/',
  ['chapter-list', 'Chapter', 'href', 'chapter-item']
);

await probe('FastNovel direct',
  'https://fastnovel.net/tbate-8/',
  ['chapter-list', 'chapter-item', 'href', 'data-id']
);

await probe('SB threadmarks',
  'https://forums.spacebattles.com/threads/worm.185764/threadmarks',
  ['ThreadmarkItem', 'li.block-body-el', 'threadmark']
);
