import { useState, useEffect } from 'react';
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
import { AdminPanel } from './AdminPanel';
import { SupportedSites } from './SupportedSites';
import { engineSearch, cancelSearch, engineLoadMetadata, EngineSearchResult } from '@/utils/webtoepub/bridge';
import { LiveReaderModal } from './LiveReaderModal';
import { LibraryModal } from './LibraryModal';
import { EpubReaderModal } from './EpubReaderModal';
import { ForumModal } from './ForumModal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';



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

  const handleLoadAnalyse = async () => {
    const url = tocUrl.trim();
    if (!url || !isUrlLike(url)) {
      toast({
        title: 'Enter a URL first',
        description: 'Paste the novel\'s table-of-contents URL to load its metadata.',
        variant: 'destructive',
      });
      return;
    }
    setIsAnalysing(true);
    try {
      const info = await engineLoadMetadata(url);
      setMetadata(prev => ({
        title: info.title || prev.title,
        author: info.author && info.author !== '<unknown>' ? info.author : prev.author,
        language: info.language || prev.language || 'en',
        description: info.description || prev.description || '',
        fileName: info.fileName || prev.fileName,
        coverUrl: info.coverUrl || prev.coverUrl,
      }));
      toast({
        title: 'Metadata loaded',
        description: info.title ? `Detected: ${info.title}` : 'Fields populated from the page.',
      });
    } catch (err) {
      toast({
        title: 'Load & Analyse failed',
        description: err instanceof Error ? err.message : 'Could not fetch metadata for this URL.',
        variant: 'destructive',
      });
    } finally {
      setIsAnalysing(false);
    }
  };


  const isUrlLike = (s: string) => /^https?:\/\//i.test(s.trim());

  /** Score a search result against the query (higher = more relevant). */
  const scoreResult = (r: EngineSearchResult, query: string): number => {
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(w => w.length > 1);
    const title = (r.title || '').toLowerCase();
    const snippet = (r.snippet || '').toLowerCase();
    const url = (r.url || '').toLowerCase();
    let score = 0;

    if (title === q) score += 100;
    if (title.startsWith(q)) score += 60;
    if (title.includes(q)) score += 40;
    const matchedInTitle = words.filter(w => title.includes(w));
    score += matchedInTitle.length * 8;
    const matchedInSnippet = words.filter(w => snippet.includes(w));
    score += matchedInSnippet.length * 3;
    const matchedInUrl = words.filter(w => url.includes(w));
    score += matchedInUrl.length * 1;
    // Penalise if nothing matched at all
    if (matchedInTitle.length === 0 && matchedInSnippet.length === 0) score -= 50;
    return score;
  };

  const runSearch = async (query: string) => {
    setIsSearching(true);
    setSearchResults([]);
    setSearchStatus('Searching supported sites…');
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
            // Sort by relevance score descending; filter score < -10
            return merged
              .map(r => ({ r, s: scoreResult(r, currentQuery) }))
              .filter(({ s }) => s > -10)
              .sort((a, b) => b.s - a.s)
              .map(({ r }) => r);
          });
        },
        (site, status) => setSearchStatus(`${site}: ${status}`)
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

  const clearSearch = () => {
    cancelSearch();
    setIsSearching(false);
    setSearchResults([]);
    setSearchStatus('');
  };

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
      <LiveReaderModal
        open={liveReaderOpen}
        url={liveReaderUrl}
        onClose={() => setLiveReaderOpen(false)}
      />
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
              <span className="text-primary">2</span>
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
                type="url"
                inputMode="url"
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

            {/* Search results */}
            {(searchResults.length > 0 || isSearching) && (
              <Card className="mt-4 p-3 bg-card border border-border animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {isSearching
                      ? <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block" />{searchStatus || 'Searching…'}</span>
                      : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`
                    }
                  </span>
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> Clear
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-border">
                  {searchResults.map((r) => (
                    <div
                      key={r.url}
                      className="group flex items-stretch gap-1 hover:bg-muted/60 rounded-md transition-smooth animate-in fade-in slide-in-from-bottom-1 duration-200"
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
                        className="flex-1 text-left px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{r.title || 'Untitled'}</div>
                            {r.snippet && (
                              <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.snippet}</div>
                            )}
                            <div className="text-[11px] text-muted-foreground/80 truncate mt-1">{r.url}</div>
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                            <ExternalLink className="w-3 h-3" /> {r.source}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Convert to EPUB"
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
                        className="shrink-0 px-3 my-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-smooth inline-flex items-center gap-1 text-xs"
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">EPUB</span>
                      </button>
                      <button
                        type="button"
                        title="Read live"
                        onClick={(e) => { e.stopPropagation(); clearSearch(); openLiveReader(r.url); }}
                        className="shrink-0 px-3 my-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-smooth inline-flex items-center gap-1 text-xs"
                      >
                        <BookOpenCheck className="w-4 h-4" />
                        <span className="hidden sm:inline">Read</span>
                      </button>
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


          {/* Quick actions — fixed to top-right like Google/Bing account menu */}
          <div className="fixed top-3 right-3 md:top-4 md:right-4 z-50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="More options"
                  className="h-10 w-10 rounded-full bg-card/70 backdrop-blur border border-border shadow-sm hover:bg-card hover:shadow-md transition-smooth"
                >
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-52">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSupportedOpen(true); }}>
                  <Globe className="w-4 h-4 mr-2" /> Supported Sites
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openLiveReader(hasUrl ? trimmed : undefined); }}>
                  <BookOpenCheck className="w-4 h-4 mr-2" /> Live Reader
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setAdminOpen(true); }}>
                  <Settings className="w-4 h-4 mr-2" /> Admin
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setLibraryOpen(true); }}>
                  <LibraryIcon className="w-4 h-4 mr-2" /> Library
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setEpubReaderOpen(true); }}>
                  <BookMarked className="w-4 h-4 mr-2" /> EPUB Reader
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setForumOpen(true); }}>
                  <MessagesSquare className="w-4 h-4 mr-2" /> Community Forum
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>


          {/* Menu-controlled dialogs (headless triggers) */}
          <SupportedSites open={supportedOpen} onOpenChange={setSupportedOpen} hideTrigger />
          <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} hideTrigger />
          <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
          <EpubReaderModal open={epubReaderOpen} onClose={() => setEpubReaderOpen(false)} />
          <ForumModal open={forumOpen} onClose={() => setForumOpen(false)} />


        </div>




        {/* Settings card — hidden once chapters are loaded; ChapterManager handles the rest */}
        {hasUrl && !hasFetchedChapters && (
          <Card className="p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
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

                <div className="flex flex-wrap gap-2 justify-center pt-2">
                  <SupportedSites />
                  <AdminPanel />
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={isConverting}
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
    const lastSegment = segments[segments.length - 1];
    
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