import { useEffect, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { engineListSupportedHosts } from '@/utils/webtoepub/bridge';
import { trackPageView, trackSitesOpened } from '@/utils/analytics';

// Top featured sites with descriptions for SEO value
const FEATURED_SITES: { domain: string; description: string; emoji: string }[] = [
  { domain: 'royalroad.com', description: 'Largest English web serial platform — original stories, LitRPG, isekai.', emoji: '👑' },
  { domain: 'novelbin.com', description: 'Huge catalog of translated Chinese and Korean web novels.', emoji: '📖' },
  { domain: 'novelfull.com', description: 'Popular English translations of Xianxia and cultivation novels.', emoji: '📚' },
  { domain: 'scribblehub.com', description: 'Community fiction platform for original English stories.', emoji: '✍️' },
  { domain: 'wtr-lab.com', description: 'Machine-translated Chinese novel site with massive catalog.', emoji: '🧪' },
  { domain: 'webnovel.com', description: 'Qidian English — official translations, free chapters available.', emoji: '🐉' },
  { domain: 'novelfire.net', description: 'Clean, fast novel reader with broad translation coverage.', emoji: '🔥' },
  { domain: 'freewebnovel.com', description: 'Free translated novels, frequently updated.', emoji: '🆓' },
  { domain: 'lightnovelworld.co', description: 'Light novels and translations from Japan, Korea, China.', emoji: '🌏' },
  { domain: 'fanfiction.net', description: 'The original fanfiction archive — millions of stories.', emoji: '💬' },
  { domain: 'archiveofourown.org', description: 'AO3 — community-run fanfiction archive, all fandoms.', emoji: '🏛️' },
  { domain: 'parahumans.wordpress.com', description: 'Worm and Ward by Wildbow — acclaimed superhero serials.', emoji: '🦸' },
];

export default function SitesPage() {
  const [allHosts, setAllHosts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = '380+ Supported Web Novel Sites — LinkToEpub';
    trackPageView('/sites');
    trackSitesOpened();

    engineListSupportedHosts()
      .then(list => setAllHosts(list.sort()))
      .catch(() => setAllHosts([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? allHosts.filter(h => h.includes(search.trim().toLowerCase()))
    : allHosts;

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-10 max-w-5xl">
        {/* Breadcrumb */}
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Supported Sites</span>
        </nav>

        <h1 className="text-3xl font-bold mb-3">Supported Web Novel Sites</h1>
        <p className="text-muted-foreground text-lg mb-8">
          LinkToEpub supports <strong>{allHosts.length || '380'}+</strong> web novel and fiction sites. 
          Paste any table-of-contents URL from these sites to generate a clean, device-ready EPUB.
        </p>

        {/* Featured sites */}
        <h2 className="text-xl font-semibold mb-4">Popular Sites</h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 mb-10">
          {FEATURED_SITES.map(site => (
            <div key={site.domain} className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{site.emoji}</span>
                <a
                  href={`https://${site.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sm hover:text-primary transition-colors"
                >
                  {site.domain} ↗
                </a>
              </div>
              <p className="text-xs text-muted-foreground">{site.description}</p>
              <Link
                to="/"
                className="mt-2 inline-block text-xs text-primary hover:underline"
              >
                Convert this site →
              </Link>
            </div>
          ))}
        </div>

        {/* Full list with search */}
        <h2 className="text-xl font-semibold mb-3">All Supported Sites</h2>
        <input
          type="search"
          placeholder="Search sites… e.g. novelbin"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-4 px-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading site list…</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">{filtered.length} sites{search ? ` matching "${search}"` : ''}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filtered.map(host => (
                <a
                  key={host}
                  href={`https://${host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary transition-colors truncate"
                  title={host}
                >
                  {host}
                </a>
              ))}
            </div>
          </>
        )}

        {/* CTA */}
        <div className="mt-12 bg-primary/5 border border-primary/20 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold mb-2">Ready to convert?</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Paste a table-of-contents URL from any of the sites above and get a clean EPUB in seconds.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Start Converting →
          </Link>
        </div>

        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to converter
          </Link>
        </div>
      </div>
    </div>
  );
}
