import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

const guides = [
  {
    slug: 'royal-road',
    name: 'Royal Road',
    domain: 'royalroad.com',
    emoji: '👑',
    description: 'The largest English-language web serial platform. Almost every novel has a proper table of contents page.',
    steps: [
      'Go to the novel\'s main page on Royal Road (e.g. royalroad.com/fiction/12345)',
      'Copy the full URL from your browser address bar',
      'Paste it into LinkToEpub and click Fetch Chapters',
      'Select your chapter range (optional) and click Generate EPUB',
    ],
    tip: 'Royal Road URLs look like royalroad.com/fiction/NUMBERS — make sure you\'re on the main fiction page, not a chapter page.',
  },
  {
    slug: 'novelbin',
    name: 'NovelBin',
    domain: 'novelbin.com',
    emoji: '📖',
    description: 'Large Chinese-translated web novel site with thousands of titles.',
    steps: [
      'Find the novel you want on NovelBin',
      'Open its main novel page (not a chapter)',
      'Copy the URL from your browser',
      'Paste into LinkToEpub and generate your EPUB',
    ],
    tip: 'NovelBin sometimes has multiple mirror domains. If one fails, try novelbin.me or novelbin.net.',
  },
  {
    slug: 'novelfull',
    name: 'NovelFull',
    domain: 'novelfull.com',
    emoji: '📚',
    description: 'One of the most popular English translation sites for Chinese and Korean web novels.',
    steps: [
      'Navigate to the novel\'s main page on NovelFull',
      'Copy the URL (should end in .html or /novel-name)',
      'Paste it into LinkToEpub',
      'Generate and download your EPUB',
    ],
    tip: 'NovelFull chapter counts can be very large. Use the Chapter Range selector to download specific arcs.',
  },
  {
    slug: 'scribblehub',
    name: 'Scribble Hub',
    domain: 'scribblehub.com',
    emoji: '✍️',
    description: 'Community fiction platform popular for original English web novels and fanfiction.',
    steps: [
      'Go to the series page on ScribbleHub',
      'Copy the series URL (e.g. scribblehub.com/series/12345/title/)',
      'Paste into LinkToEpub',
      'Fetch chapters and generate your EPUB',
    ],
    tip: 'Make sure you use the /series/ URL, not a chapter or author page.',
  },
  {
    slug: 'wtr-lab',
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    emoji: '🧪',
    description: 'Machine-translated Chinese web novel site with a massive catalog.',
    steps: [
      'Find your novel on WTR-LAB',
      'Open the novel\'s main page',
      'Copy the URL and paste it into LinkToEpub',
      'WTR-LAB fetches slowly — allow extra time for large novels',
    ],
    tip: 'WTR-LAB chapters are fetched gently to avoid rate-limiting. Large novels may take 2–3 minutes.',
  },
  {
    slug: 'webnovel',
    name: 'WebNovel (Qidian)',
    domain: 'webnovel.com',
    emoji: '🐉',
    description: 'Official Qidian English platform with both free and premium chapters.',
    steps: [
      'Go to the book page on WebNovel',
      'Copy the URL (e.g. webnovel.com/book/title_12345)',
      'Paste into LinkToEpub',
      'Only free/unlocked chapters will be downloaded',
    ],
    tip: 'LinkToEpub can only download chapters that are freely available. Premium-locked chapters are skipped.',
  },
];

export default function GuidePage() {
  useEffect(() => {
    document.title = 'Web Novel Conversion Guides — LinkToEpub';
    trackPageView('/guide');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-10 max-w-4xl">
        {/* Breadcrumb */}
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Guides</span>
        </nav>

        <h1 className="text-3xl font-bold mb-3">Web Novel to EPUB Conversion Guides</h1>
        <p className="text-muted-foreground mb-10 text-lg">
          Step-by-step instructions for converting novels from the most popular web novel sites into EPUB format for your e-reader.
        </p>

        <div className="grid gap-8">
          {guides.map(guide => (
            <div key={guide.slug} id={guide.slug} className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{guide.emoji}</span>
                <div>
                  <h2 className="text-xl font-semibold">{guide.name}</h2>
                  <a
                    href={`https://${guide.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {guide.domain} ↗
                  </a>
                </div>
              </div>

              <p className="text-muted-foreground mb-4">{guide.description}</p>

              <h3 className="font-medium mb-2 text-sm uppercase tracking-wide text-muted-foreground">Steps</h3>
              <ol className="space-y-2 mb-4">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  <span className="font-semibold">💡 Tip:</span> {guide.tip}
                </p>
              </div>

              <div className="mt-4">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  Convert a {guide.name} novel →
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Fallback for unlisted sites */}
        <div className="mt-10 bg-card border border-border rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">My site isn't listed here</h2>
          <p className="text-muted-foreground mb-4">
            LinkToEpub supports <strong>380+ sites</strong> in total — far more than the guides above.
            Most sites just need the novel's main table-of-contents URL pasted directly.
            If your site isn't in the guides, try it anyway — it probably works.
          </p>
          <p className="text-muted-foreground text-sm">
            For sites that aren't explicitly supported, our AI parser automatically detects the content structure and extracts the chapters.
          </p>
          <Link to="/sites" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            Browse all 380+ supported sites →
          </Link>
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
