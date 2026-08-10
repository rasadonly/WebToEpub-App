import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

const guides = [
  {
    slug: 'royal-road',
    name: 'Royal Road',
    domain: 'royalroad.com',
    url_example: 'royalroad.com/fiction/12345/story-title',
    steps: [
      'Go to the novel\'s main fiction page — the one that shows the synopsis and chapter list.',
      'Copy the URL from your address bar. It should look like royalroad.com/fiction/XXXXX.',
      'Paste it into LinkToEpub and hit Fetch.',
      'Pick a chapter range if you only want part of the story, then Generate EPUB.',
    ],
    gotcha: 'Don\'t copy a chapter URL like /chapter/XXXXX. It needs to be the main fiction page.',
  },
  {
    slug: 'novelbin',
    name: 'NovelBin',
    domain: 'novelbin.com',
    url_example: 'novelbin.com/b/novel-title',
    steps: [
      'Find the novel on NovelBin and open its main page (not a chapter).',
      'Copy the URL.',
      'Paste into LinkToEpub.',
      'If it times out or returns no chapters, try the same novel on novelbin.me or novelbin.net — they\'re mirrors of the same site.',
    ],
    gotcha: 'NovelBin has several mirror domains. If one is slow or blocked, the others usually work.',
  },
  {
    slug: 'novelfull',
    name: 'NovelFull',
    domain: 'novelfull.com',
    url_example: 'novelfull.com/novel-title.html',
    steps: [
      'Open the novel\'s main page on NovelFull.',
      'Copy the URL (usually ends in .html).',
      'Paste into LinkToEpub and fetch.',
      'NovelFull novels can have 1000+ chapters — use the range selector to grab just the arc you want.',
    ],
    gotcha: 'Very long novels can take a few minutes to fetch. The progress bar shows where you are.',
  },
  {
    slug: 'scribblehub',
    name: 'Scribble Hub',
    domain: 'scribblehub.com',
    url_example: 'scribblehub.com/series/12345/story-name/',
    steps: [
      'Go to the series page — the one with the cover, synopsis, and chapter list.',
      'Copy the /series/ URL.',
      'Paste into LinkToEpub.',
      'Fetch and generate.',
    ],
    gotcha: 'The URL needs to be /series/ — not /read/ (that\'s a chapter URL).',
  },
  {
    slug: 'wtr-lab',
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    url_example: 'wtr-lab.com/novel-en/novel-title',
    steps: [
      'Find your novel on WTR-LAB and open its main page.',
      'Copy the URL.',
      'Paste into LinkToEpub. WTR-LAB is fetched slowly to avoid rate-limiting — give it a minute.',
    ],
    gotcha: 'Large novels on WTR-LAB can take 2–3 minutes. That\'s normal — the server is being polite to the site.',
  },
  {
    slug: 'webnovel',
    name: 'WebNovel',
    domain: 'webnovel.com',
    url_example: 'webnovel.com/book/title_1234567890',
    steps: [
      'Go to the book page on WebNovel.',
      'Copy the URL.',
      'Paste into LinkToEpub.',
      'Only unlocked chapters download. Premium chapters are skipped.',
    ],
    gotcha: 'WebNovel locks most chapters behind coins. Only the first N free chapters will be in your EPUB.',
  },
];

export default function GuidePage() {
  useEffect(() => {
    document.title = 'How-to Guide — LinkToEpub';
    trackPageView('/guide');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Guide</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">How to convert a web novel to EPUB</h1>
        <p className="text-muted-foreground mb-3">
          The short version: paste the novel's main page URL, fetch, generate. Most sites just work.
          Below are the specifics for the ones people ask about most.
        </p>
        <p className="text-muted-foreground mb-8 text-sm">
          Don't see your site? <Link to="/sites" className="text-primary hover:underline">Check the full site list</Link> — 380+ are supported.
          If it's not there either, paste it anyway. The AI fallback handles most novel sites automatically.
        </p>

        <div className="space-y-6">
          {guides.map(g => (
            <div key={g.slug} id={g.slug} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h2 className="text-lg font-semibold">{g.name}</h2>
                <a
                  href={`https://${g.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  {g.domain} ↗
                </a>
              </div>
              <p className="text-xs text-muted-foreground mb-3 font-mono bg-muted px-2 py-1 rounded">
                Example URL: {g.url_example}
              </p>
              <ol className="space-y-2 mb-4">
                {g.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="text-sm border-l-2 border-amber-400 pl-3 text-muted-foreground">
                {g.gotcha}
              </p>
              <Link to="/" className="mt-3 inline-block text-xs text-primary hover:underline">
                Convert a {g.name} novel →
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-1">Something not working?</h2>
          <p className="text-sm text-muted-foreground">
            If a URL fails to fetch, check that it's the novel's main page (not a chapter), try a different mirror domain if available,
            or try adding a specific CSS selector in the Advanced options. Most failures come from using a chapter URL instead of the TOC page.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to converter
          </Link>
        </div>
      </div>
    </div>
  );
}
