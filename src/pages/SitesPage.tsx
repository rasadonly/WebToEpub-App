import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';
import { engineListSupportedHosts } from '@/utils/webtoepub/bridge';

const FEATURED: { domain: string; note: string }[] = [
  { domain: 'wtr-lab.com', note: 'Machine-translated Chinese novels, massive catalog' },
  { domain: 'novelcool.com', note: 'Huge collection of light novels and web novels' },
  { domain: 'ranobes.top', note: 'Fast, clean reader with good translation coverage' },
  { domain: 'allnovelfull.com', note: 'Xianxia, cultivation, Chinese translations' }
];

export default function SitesPage() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Supported Sites — LinkToEpub';
    trackPageView('/sites');
    engineListSupportedHosts()
      .then(list => setHosts(list.sort()))
      .catch(() => setHosts([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? hosts.filter(h => h.includes(search.trim().toLowerCase()))
    : hosts;

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Supported Sites</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">Supported Sites</h1>
        <p className="text-muted-foreground mb-8">
          {hosts.length ? hosts.length : '380'}+ sites work out of the box. Just paste the novel's main page URL — not a chapter link.
          If your site isn't in the list, paste it anyway. The AI fallback picks up most novel sites automatically.
        </p>

        <h2 className="text-lg font-semibold mb-3">Popular ones</h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 mb-10">
          {FEATURED.map(s => (
            <div key={s.domain} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
              <a
                href={`https://${s.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm hover:text-primary transition-colors"
              >
                {s.domain} ↗
              </a>
              <p className="text-xs text-muted-foreground mt-1">{s.note}</p>
              <Link to="/" className="mt-2 inline-block text-xs text-primary hover:underline">
                Convert →
              </Link>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold mb-3">Full list</h2>
        <input
          type="search"
          placeholder="Search… e.g. novelbin"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-3 px-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              {filtered.length} sites{search ? ` matching "${search}"` : ''}
            </p>
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

        <div className="mt-10 text-center">
          <Link to="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Back to converter →
          </Link>
        </div>
      </div>
    </div>
  );
}
