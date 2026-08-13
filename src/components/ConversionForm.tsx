import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { SUPPORTED_SITES, getSiteConfig, extractDomain } from '@/utils/siteConfigs';
import { NovelSite, EpubMetadata } from '@/types';
import { BookOpen, Globe, Settings, Hash, Type, List, Search, Sparkles, ArrowRight, ExternalLink, X, BookOpenCheck, MoreVertical, Library as LibraryIcon, BookMarked, Download, MessagesSquare, Wand2 } from 'lucide-react';
import { engineSearch, cancelSearch, engineLoadMetadata, EngineSearchResult } from '@/utils/webtoepub/bridge';
import { LiveStats } from '@/components/LiveStats';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// Lazy load modals so heavy dependencies (epubjs, supabase) aren't in the initial bundle
const AdminPanel = lazy(() => import('./AdminPanel').then(m => ({ default: m.AdminPanel })));
const SupportedSites = lazy(() => import('./SupportedSites').then(m => ({ default: m.SupportedSites })));
const LiveReaderModal = lazy(() => import('./LiveReaderModal').then(m => ({ default: m.LiveReaderModal })));
const LibraryModal = lazy(() => import('./LibraryModal').then(m => ({ default: m.LibraryModal })));
const EpubReaderModal = lazy(() => import('./EpubReaderModal').then(m => ({ default: m.EpubReaderModal })));
const ForumModal = lazy(() => import('./ForumModal').then(m => ({ default: m.ForumModal })));



interface ConversionFormProps {
  onSubmit: (data: ConversionFormData) => void;
  isConverting: boolean;
  hasFetchedChapters?: boolean;
}

export interface ConversionFormData {
  tocUrl: string;
  tocSelector: string;
  contentSelector: string;
  metadata: EpubMetadata;
  chapterRange: {
    start: number;
    end: number;
    useAll: boolean;
  };
  fontFamily: string;
  includeIndex: boolean;
  editableUrls: boolean;
}

export default function ConversionForm({ onSubmit, isConverting, hasFetchedChapters }: ConversionFormProps) {
  const { toast } = useToast();

  // Listen for modal-open events dispatched by the NavBar
  useEffect(() => {
    const h = (e: Event) => {
      const name = (e as CustomEvent).detail;
      if (name === 'supported-sites') setSupportedOpen(true);
      else if (name === 'library') setLibraryOpen(true);
      else if (name === 'forum') setForumOpen(true);
      else if (name === 'epub-reader') setEpubReaderOpen(true);
      else if (name === 'admin') setAdminOpen(true);
      else if (name === 'live-reader') openLiveReader(undefined);
    };
    window.addEventListener('open-modal', h);
    return () => window.removeEventListener('open-modal', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tocUrl, setTocUrl] = useState('');
  const [tocSelector, setTocSelector] = useState('');
  const [contentSelector, setContentSelector] = useState('');
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [metadata, setMetadata] = useState<EpubMetadata>({
    title: '',
    author: 'Unknown Author',
    language: 'en',
    description: ''
  });
  const [chapterRange, setChapterRange] = useState({
    start: 1,
    end: 999,
    useAll: true
  });
  const [fontFamily, setFontFamily] = useState('Georgia');
  const [includeIndex, setIncludeIndex] = useState(false);
  const [editableUrls, setEditableUrls] = useState(false);

  // Search state (when the user types a query instead of a URL)
  const [searchResults, setSearchResults] = useState<EngineSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [lastQuery, setLastQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('epub-recent-searches');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });


  // Live Reader state
  const [liveReaderOpen, setLiveReaderOpen] = useState(false);
  const [liveReaderUrl, setLiveReaderUrl] = useState<string | undefined>(undefined);
  const openLiveReader = (u?: string) => {
    setLiveReaderUrl(u && u.trim() ? u.trim() : undefined);
    setLiveReaderOpen(true);
  };

  // Menu-controlled dialogs
  const [supportedOpen, setSupportedOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [epubReaderOpen, setEpubReaderOpen] = useState(false);
  const [forumOpen, setForumOpen] = useState(false);

  // "Load & Analyse" state — auto-fetches book metadata like WebToEpub
  const [isAnalysing, setIsAnalysing] = useState(false);
  // Remembers what auto-fill wrote, so we never clobber a value the user typed.
  const autoFilledRef = useRef<Partial<EpubMetadata>>({});
  const analysedUrlRef = useRef<string>('');

  const isUrlLike = (s: string) => /^https?:\/\//i.test(s.trim());

  /** Drops tracking params (utm_*, ref, fbclid…) that break some parsers. */
  const cleanUrl = (raw: string) => {
    try {
      const u = new URL(raw.trim());
      [...u.searchParams.keys()].forEach(k => {
        if (/^(utm_|fbclid|gclid|ref|source|share)/i.test(k)) u.searchParams.delete(k);
      });
      return u.href.replace(/\?$/, '');
    } catch {
      return raw.trim();
    }
  };

  /** Fills a metadata field only when it's empty or still holds an auto value. */
  const mergeAuto = (info: Partial<EpubMetadata>) => {
    setMetadata(prev => {
      const next = { ...prev };
      (Object.keys(info) as (keyof EpubMetadata)[]).forEach(key => {
        const value = info[key];
        if (!value) return;
        const current = prev[key];
        if (!current || current === autoFilledRef.current[key]) {
          (next[key] as string) = value as string;
          (autoFilledRef.current[key] as string) = value as string;
        }
      });
      return next;
    });
  };

  const analyse = async (rawUrl: string, silent: boolean) => {
    const url = cleanUrl(rawUrl);
    if (!url || !isUrlLike(url)) {
      if (!silent) {
        toast({
          title: 'Enter a URL first',
          description: 'Paste the novel\'s table-of-contents URL to load its metadata.',
          variant: 'destructive',
        });
      }
      return;
    }
    setIsAnalysing(true);
    try {
      const info = await engineLoadMetadata(url);
      mergeAuto({
        title: info.title || '',
        author: info.author && info.author !== '<unknown>' ? info.author : '',
        language: info.language || 'en',
        description: info.description || '',
        fileName: info.fileName || '',
        coverUrl: info.coverUrl || '',
      });
      if (!silent) {
        toast({
          title: 'Metadata loaded',
          description: info.title ? `Detected: ${info.title}` : 'Fields populated from the page.',
        });
      }
    } catch (err) {
      // Fall back to the slug in the URL so the title box is never empty.
      const slugTitle = extractTitleFromUrl(url);
      if (slugTitle) mergeAuto({ title: slugTitle });
      if (!silent) {
        toast({
          title: 'Load & Analyse failed',
          description: err instanceof Error ? err.message : 'Could not fetch metadata for this URL.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsAnalysing(false);
    }
  };

  const handleLoadAnalyse = () => analyse(tocUrl, false);

  // Auto-grab the book title (and the rest of the metadata) as soon as a valid
  // link is pasted or typed — no button press needed, works for any site.
  useEffect(() => {
    const url = cleanUrl(tocUrl);
    if (!isUrlLike(url) || url === analysedUrlRef.current) return;
    const timer = window.setTimeout(() => {
      analysedUrlRef.current = url;
      // Instant slug-based guess, then the real title once the engine answers.
      const slugTitle = extractTitleFromUrl(url);
      if (slugTitle) mergeAuto({ title: slugTitle });
      void analyse(url, true);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocUrl]);



  /** Normalise a string for fuzzy comparison. */
  const norm = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/[’'`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  /** Score a search result against the query (higher = more relevant). */
  const scoreResult = (r: EngineSearchResult, query: string): number => {
    const q = norm(query);
    const words = q.split(' ').filter(w => w.length > 1);
    const title = norm(r.title);
    const snippet = norm(r.snippet || '');
    const url = norm(r.url || '');
    let score = 0;

    if (title === q) score += 120;
    else if (title.startsWith(q)) score += 70;
    else if (title.includes(q)) score += 45;

    const matchedInTitle = words.filter(w => title.includes(w));
    score += matchedInTitle.length * 10;
    // All query words present in the title is a strong signal
    if (words.length > 0 && matchedInTitle.length === words.length) score += 25;
    // Prefer tight titles over long ones stuffed with extra words
    const titleWords = title.split(' ').filter(Boolean).length;
    if (titleWords > 0) score += Math.max(0, 12 - Math.abs(titleWords - words.length) * 2);

    score += words.filter(w => snippet.includes(w)).length * 3;
    score += words.filter(w => url.includes(w)).length * 2;

    if (r.snippet) score += 2;
    // Penalise if nothing matched at all
    if (matchedInTitle.length === 0 && !snippet.includes(q)) score -= 50;
    return score;
  };

  const rankResults = (list: EngineSearchResult[], query: string) =>
    list
      .map(r => ({ r, s: scoreResult(r, query) }))
      .filter(({ s }) => s > -10)
      .sort((a, b) => b.s - a.s)
      .map(({ r }) => r);

  const pushRecentSearch = (q: string) => {
    const next = [q, ...recentSearches.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    setRecentSearches(next);
    try { localStorage.setItem('epub-recent-searches', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const runSearch = async (query: string) => {
    setIsSearching(true);
    setSearchResults([]);
    setSourceFilter('all');
    setSearchProgress({ done: 0, total: 0 });
    setSearchStatus('Searching supported sites…');
    setLastQuery(query);
    pushRecentSearch(query);
    const currentQuery = query;
    try {
      const seen = new Set<string>();
      await engineSearch(
        query,
        (partial) => {
          setSearchResults(prev => {
            const merged = [...prev];
            for (const r of partial) {
              if (!seen.has(r.url)) {
                seen.add(r.url);
                merged.push(r);
              }
            }
            return rankResults(merged, currentQuery);
          });
        },
        (site, status, progress) => {
          if (progress) setSearchProgress({ done: progress.done, total: progress.total });
          setSearchStatus(`${site}: ${status}`);
        }
      );
      setSearchStatus('');
    } catch (err) {
      if (err instanceof Error && err.message === '__cancelled__') {
        // silent — user picked a result or cleared
      } else {
        toast({
          title: 'Search failed',
          description: err instanceof Error ? err.message : 'Try pasting a URL instead.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSearching(false);
    }
  };

  /** Stop searching but keep whatever results we already collected. */
  const stopSearch = () => {
    cancelSearch();
    setIsSearching(false);
    setSearchStatus('');
  };

  const clearSearch = () => {
    cancelSearch();
    setIsSearching(false);
    setSearchResults([]);
    setSearchStatus('');
    setSearchProgress({ done: 0, total: 0 });
    setSourceFilter('all');
    setLastQuery('');
  };


  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of searchResults) {
      const src = r.source || 'other';
      counts.set(src, (counts.get(src) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [searchResults]);

  const filteredResults = useMemo(
    () => (sourceFilter === 'all' ? searchResults : searchResults.filter(r => (r.source || 'other') === sourceFilter)),
    [searchResults, sourceFilter]
  );


  // Load saved settings from localStorage
  useEffect(() => {
    const domain = extractDomain(tocUrl);
    if (domain) {
      const saved = localStorage.getItem(`epub-converter-${domain}`);
      if (saved) {
        const config = JSON.parse(saved);
        setTocSelector(config.tocSelector || '');
        setContentSelector(config.contentSelector || '');
      }
    }
  }, [tocUrl]);

  // Auto-detect site and apply config
  useEffect(() => {
    if (tocUrl) {
      const config = getSiteConfig(tocUrl);
      if (config) {
        setSelectedSite(config.name);
        setTocSelector(config.tocSelector);
        setContentSelector(config.contentSelector);
        
        // Extract title from URL if possible
        const urlTitle = extractTitleFromUrl(tocUrl);
        if (urlTitle && !metadata.title) {
          setMetadata(prev => ({ ...prev, title: urlTitle }));
        }
      }
    }
  }, [tocUrl]);

  const handleSiteSelect = (siteName: string) => {
    const site = SUPPORTED_SITES.find(s => s.name === siteName);
    if (site) {
      setSelectedSite(siteName);
      setTocSelector(site.tocSelector);
      setContentSelector(site.contentSelector);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const value = tocUrl.trim();
    if (!value) {
      toast({
        title: "Enter a URL or search term",
        description: "Paste a novel's table-of-contents URL, or type a novel name to search.",
        variant: "destructive"
      });
      return;
    }

    // If it's not a URL, run a search instead of trying to fetch
    if (!isUrlLike(value)) {
      runSearch(value);
      return;
    }

    // Save settings to localStorage
    const domain = extractDomain(value);
    if (domain) {
      localStorage.setItem(`epub-converter-${domain}`, JSON.stringify({
        tocSelector,
        contentSelector
      }));
    }

    onSubmit({
      tocUrl: value,
      tocSelector,
      contentSelector,
      metadata,
      chapterRange,
      fontFamily,
      includeIndex,
      editableUrls
    });
  };

  const [showAdvanced, setShowAdvanced] = useState(false);
  const trimmed = tocUrl.trim();
  const hasUrl = trimmed.length > 0 && isUrlLike(trimmed);
  const hasQuery = trimmed.length > 0 && !isUrlLike(trimmed);

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Suspense fallback={null}>
        {liveReaderOpen && (
          <LiveReaderModal
            open={liveReaderOpen}
            url={liveReaderUrl}
            onClose={() => setLiveReaderOpen(false)}
          />
        )}
      </Suspense>
      <form onSubmit={handleSubmit} className="space-y-10">
        {/* Search-engine style hero */}
        <div className="flex flex-col items-center justify-center gap-5 sm:gap-8 pt-4 sm:pt-10">
          {/* Wordmark */}
          <div className="text-center space-y-2 sm:space-y-3 px-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-[11px] sm:text-xs text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Web novels, beautifully bound
            </div>
            <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-none">
              <span className="text-foreground">Link</span>
              <span className="text-primary">To</span>
              <span className="text-foreground">Epub</span>
              <span className="text-primary">.</span>
            </h1>
          </div>

          {/* Pill search */}
          <div className="w-full max-w-2xl px-1">
            <div className="group relative flex items-center rounded-full bg-card border border-border shadow-search transition-smooth focus-within:border-primary/40 focus-within:shadow-glow">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground absolute left-4 sm:left-5 pointer-events-none" />
              <Input
                id="toc-url"
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={tocUrl}
                onChange={(e) => setTocUrl(e.target.value)}
                placeholder="Paste TOC URL or search a novel…"
                className="h-12 sm:h-14 md:h-16 pl-11 sm:pl-14 pr-24 sm:pr-32 md:pr-36 text-base md:text-lg rounded-full border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                disabled={isConverting || isSearching || trimmed.length === 0}
                className="absolute right-1.5 sm:right-2 h-9 sm:h-10 md:h-12 rounded-full px-3 sm:px-5 md:px-6 bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
              >
                {isConverting || isSearching ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                    <span className="hidden md:inline">{isSearching ? 'Searching' : 'Working'}</span>
                  </>
                ) : (
                  <>
                    <span className="hidden sm:inline">{hasQuery ? 'Search' : 'Fetch'}</span>
                    {hasQuery ? <Search className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </>
                )}
              </Button>
            </div>
            <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-xs text-muted-foreground">
              <span>Paste a TOC or chapter URL to convert, or type a novel name to search.</span>
              {hasUrl && (
                <button
                  type="button"
                  onClick={() => openLiveReader(trimmed)}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <BookOpenCheck className="w-3.5 h-3.5" /> Read live instead
                </button>
              )}
            </div>

            {/* How to use */}
            {!isSearching && searchResults.length === 0 && !isConverting && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3 text-left">
                {[
                  { n: '1', t: 'Paste or search', d: 'Drop a table-of-contents or chapter link, or type a novel name to search supported sites.' },
                  { n: '2', t: 'Pick chapters', d: 'Review the detected title and author, then select a range, reorder or remove chapters.' },
                  { n: '3', t: 'Get your EPUB', d: 'Convert and download a clean EPUB, or open it in the built-in reader.' },
                ].map((s) => (
                  <div key={s.n} className="rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{s.n}</span>
                      <span className="text-xs font-semibold text-foreground">{s.t}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{s.d}</p>
                  </div>
                ))}
              </div>
            )}



            {/* Recent searches */}
            {!isSearching && searchResults.length === 0 && recentSearches.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mr-1">Recent</span>
                {recentSearches.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => { setTocUrl(q); runSearch(q); }}
                    className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-smooth"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {!isSearching && lastQuery && searchResults.length === 0 && (
              <Card className="mt-4 p-4 text-center text-sm text-muted-foreground border border-border">
                No results for “{lastQuery}”. Try a shorter title, or paste the novel's TOC URL directly.
              </Card>
            )}

            {/* Search results */}
            {(searchResults.length > 0 || isSearching) && (

              <Card className="mt-4 p-3 bg-card border border-border animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="px-2 py-1 mb-1 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-0 truncate">
                      {isSearching
                        ? <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block shrink-0" /><span className="truncate">{searchStatus || 'Searching…'}</span></span>
                        : `${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'}${lastQuery ? ` for “${lastQuery}”` : ''}`
                      }
                    </span>
                    <button
                      type="button"
                      onClick={isSearching ? stopSearch : clearSearch}
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> {isSearching ? 'Stop' : 'Clear'}
                    </button>

                  </div>

                  {isSearching && searchProgress.total > 0 && (
                    <div className="space-y-1">
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.min(100, (searchProgress.done / searchProgress.total) * 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground/80">
                        {searchProgress.done} / {searchProgress.total} sites searched · {searchResults.length} found
                      </div>
                    </div>
                  )}

                  {sourceCounts.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                      <button
                        type="button"
                        onClick={() => setSourceFilter('all')}
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-smooth ${sourceFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                      >
                        All {searchResults.length}
                      </button>
                      {sourceCounts.map(([src, count]) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => setSourceFilter(src)}
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-smooth ${sourceFilter === src ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                        >
                          {src} {count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-border">
                  {filteredResults.map((r) => (

                    <div
                      key={r.url}
                      className="group flex items-center gap-2 px-2 sm:px-3 py-2 hover:bg-muted/60 rounded-md transition-smooth animate-in fade-in slide-in-from-bottom-1 duration-200"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setTocUrl(r.url);
                          if (r.title && !metadata.title) {
                            setMetadata(prev => ({ ...prev, title: r.title }));
                          }
                          clearSearch();
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="font-medium text-sm leading-snug line-clamp-2 sm:truncate">
                          {r.title || 'Untitled'}
                        </div>
                        {r.snippet && (
                          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.snippet}</div>
                        )}
                        <div className="mt-1 flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider max-w-[45%] truncate">
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{r.source}</span>
                          </span>
                          <span className="text-[11px] text-muted-foreground/80 truncate">{r.url}</span>
                        </div>
                      </button>

                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          type="button"
                          title="Convert to EPUB"
                          aria-label="Convert to EPUB"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTocUrl(r.url);
                            const newMeta = r.title && !metadata.title
                              ? { ...metadata, title: r.title }
                              : metadata;
                            if (r.title && !metadata.title) setMetadata(newMeta);
                            clearSearch();
                            const domain = extractDomain(r.url);
                            if (domain) {
                              localStorage.setItem(`epub-converter-${domain}`, JSON.stringify({ tocSelector, contentSelector }));
                            }
                            onSubmit({
                              tocUrl: r.url,
                              tocSelector,
                              contentSelector,
                              metadata: newMeta,
                              chapterRange,
                              fontFamily,
                              includeIndex,
                              editableUrls,
                            });
                          }}
                          className="h-9 w-9 sm:w-auto sm:px-3 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-smooth inline-flex items-center justify-center gap-1 text-xs"
                        >
                          <Download className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">EPUB</span>
                        </button>
                        <button
                          type="button"
                          title="Read live"
                          aria-label="Read live"
                          onClick={(e) => { e.stopPropagation(); clearSearch(); openLiveReader(r.url); }}
                          className="h-9 w-9 sm:w-auto sm:px-3 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-smooth inline-flex items-center justify-center gap-1 text-xs"
                        >
                          <BookOpenCheck className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Read</span>
                        </button>
                      </div>
                    </div>

                  ))}
                  {isSearching && (
                    /* Skeleton rows — one per site still loading */
                    Array.from({ length: searchResults.length === 0 ? 4 : 2 }).map((_, i) => (
                      <div key={`skel-${i}`} className="px-3 py-3 flex items-center gap-3 animate-pulse">
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-muted rounded w-3/5" />
                          <div className="h-2.5 bg-muted/70 rounded w-4/5" />
                        </div>
                        <div className="h-5 w-16 bg-muted rounded-full" />
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </div>


          {/* Modal triggers via custom events from the NavBar */}


          {/* Menu-controlled dialogs (headless triggers, loaded lazily) */}
          <Suspense fallback={null}>
            {supportedOpen && <SupportedSites open={supportedOpen} onOpenChange={setSupportedOpen} hideTrigger />}
            {adminOpen && <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} hideTrigger />}
            {libraryOpen && <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />}
            {epubReaderOpen && <EpubReaderModal open={epubReaderOpen} onClose={() => setEpubReaderOpen(false)} />}
            {forumOpen && <ForumModal open={forumOpen} onClose={() => setForumOpen(false)} />}
          </Suspense>


        </div>




        {/* Settings card — hidden once chapters are loaded; ChapterManager handles the rest */}
        {hasUrl && !hasFetchedChapters && (
          <Card className="p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* Load & Analyse — auto-fetches title, author, language, cover, description */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
              <div className="text-xs sm:text-sm text-muted-foreground">
                Auto-fetch book details (title, author, language, cover, description) from the URL.
              </div>
              <Button
                type="button"
                onClick={handleLoadAnalyse}
                disabled={isAnalysing || isConverting}
                variant="secondary"
                className="gap-2 shrink-0"
              >
                {isAnalysing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current/40 border-t-current rounded-full animate-spin" />
                    Analysing…
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Load & Analyse
                  </>
                )}
              </Button>
            </div>

            {/* Title (required, kept visible) */}
            <div className="space-y-2">
              <Label htmlFor="title">Book Title *</Label>
              <Input
                id="title"
                value={metadata.title}
                onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Novel Title"
                required
              />
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="text-sm text-primary hover:underline"
            >
              {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
            </button>

            {showAdvanced && (
              <div className="space-y-6">
                {/* Site Selection */}
                <div className="space-y-2">
                  <Label htmlFor="site-select" className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Supported Sites (Optional)
                  </Label>
                  <Select value={selectedSite} onValueChange={handleSiteSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a site for auto-configuration" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_SITES.map(site => (
                        <SelectItem key={site.domain} value={site.name}>
                          {site.name} ({site.domain})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Selectors */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="toc-selector" className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      Chapter Links Selector *
                    </Label>
                    <Input
                      id="toc-selector"
                      value={tocSelector}
                      onChange={(e) => setTocSelector(e.target.value)}
                      placeholder="a[href*='chapter']"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="content-selector">Chapter Content Selector *</Label>
                    <Input
                      id="content-selector"
                      value={contentSelector}
                      onChange={(e) => setContentSelector(e.target.value)}
                      placeholder=".chapter-content"
                      required
                    />
                  </div>
                </div>

                {/* Chapter Range */}
                <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    Chapter Selection
                  </h3>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="use-all-chapters"
                      checked={chapterRange.useAll}
                      onCheckedChange={(checked) => setChapterRange(prev => ({ ...prev, useAll: checked }))}
                    />
                    <Label htmlFor="use-all-chapters">Convert all chapters</Label>
                  </div>
                  {!chapterRange.useAll && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="start-chapter">Start Chapter</Label>
                        <Input
                          id="start-chapter"
                          type="number"
                          min="1"
                          value={chapterRange.start}
                          onChange={(e) => setChapterRange(prev => ({ ...prev, start: parseInt(e.target.value) || 1 }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-chapter">End Chapter</Label>
                        <Input
                          id="end-chapter"
                          type="number"
                          min="1"
                          value={chapterRange.end}
                          onChange={(e) => setChapterRange(prev => ({ ...prev, end: parseInt(e.target.value) || 999 }))}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Font */}
                <div className="space-y-2">
                  <Label htmlFor="font-family" className="flex items-center gap-2">
                    <Type className="w-4 h-4" />
                    Font Family
                  </Label>
                  <Select value={fontFamily} onValueChange={setFontFamily}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Georgia">Georgia (Default)</SelectItem>
                      <SelectItem value="Merriweather">Merriweather</SelectItem>
                      <SelectItem value="Crimson Text">Crimson Text</SelectItem>
                      <SelectItem value="Libre Baskerville">Libre Baskerville</SelectItem>
                      <SelectItem value="Source Serif Pro">Source Serif Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Metadata */}
                <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <List className="w-4 h-4" />
                    Book Metadata
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="author">Author</Label>
                    <Input
                      id="author"
                      value={metadata.author}
                      onChange={(e) => setMetadata(prev => ({ ...prev, author: e.target.value }))}
                      placeholder="Author Name"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="language">Language</Label>
                      <Input
                        id="language"
                        value={metadata.language}
                        onChange={(e) => setMetadata(prev => ({ ...prev, language: e.target.value }))}
                        placeholder="en"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fileName">Filename</Label>
                      <Input
                        id="fileName"
                        value={metadata.fileName || ''}
                        onChange={(e) => setMetadata(prev => ({ ...prev, fileName: e.target.value }))}
                        placeholder="novel.epub"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coverUrl">Cover Image URL</Label>
                    <Input
                      id="coverUrl"
                      value={metadata.coverUrl || ''}
                      onChange={(e) => setMetadata(prev => ({ ...prev, coverUrl: e.target.value }))}
                      placeholder="https://…/cover.jpg"
                    />
                    {metadata.coverUrl && (
                      <div className="mt-2 w-24 shrink-0" style={{ aspectRatio: '2/3', minHeight: '144px' }}>
                        <img
                          src={metadata.coverUrl}
                          alt="Cover preview"
                          width={96}
                          height={144}
                          className="h-full w-full rounded border border-border object-cover"
                          onError={(e) => ((e.currentTarget.parentElement!.style.display = 'none'))}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      value={metadata.description}
                      onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Brief description of the novel..."
                      rows={3}
                    />
                  </div>
                </div>

                <Suspense fallback={null}>
                  <div className="flex flex-wrap gap-2 justify-center pt-2">
                    <SupportedSites />
                    <AdminPanel />
                  </div>
                </Suspense>
              </div>
            )}

            <Button
              type="submit"
              disabled={isConverting}
              aria-label={isConverting ? 'Working, please wait' : hasFetchedChapters ? 'Generate EPUB' : 'Fetch Chapters'}
              className="w-full bg-gradient-primary hover:shadow-glow transition-smooth text-lg py-6"
            >
              {isConverting ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Working...
                </div>
              ) : hasFetchedChapters ? (
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Generate EPUB
                </div>
              ) : (
                'Fetch Chapters'
              )}
            </Button>
          </Card>
        )}
      </form>
    </div>
  );
}

function extractTitleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = (segments[segments.length - 1] || '')
      .replace(/\.(x?html?|php|aspx?|jsp)$/i, '');

    // Clean up the segment
    return lastSegment
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}