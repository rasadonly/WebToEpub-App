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
import { BookOpen, Globe, Settings, Hash, Type, List, Search, Sparkles, ArrowRight, ExternalLink, X } from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { SupportedSites } from './SupportedSites';
import { engineSearch, EngineSearchResult } from '@/utils/webtoepub/bridge';

interface ConversionFormProps {
  onSubmit: (data: ConversionFormData) => void;
  isConverting: boolean;
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

export default function ConversionForm({ onSubmit, isConverting }: ConversionFormProps) {
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

  const isUrlLike = (s: string) => /^https?:\/\//i.test(s.trim());

  const runSearch = async (query: string) => {
    setIsSearching(true);
    setSearchResults([]);
    setSearchStatus('Searching supported sites…');
    try {
      const seen = new Set<string>();
      await engineSearch(
        query,
        (partial) => {
          setSearchResults(prev => {
            const merged = [...prev];
            for (const r of partial) {
              if (!seen.has(r.url)) { seen.add(r.url); merged.push(r); }
            }
            return merged;
          });
        },
        (site, status) => setSearchStatus(`${site}: ${status}`)
      );
      setSearchStatus('');
    } catch (err) {
      toast({
        title: 'Search failed',
        description: err instanceof Error ? err.message : 'Try pasting a URL instead.',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
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
    
    if (!tocUrl) {
      toast({
        title: "Missing URL",
        description: "Please enter a novel table-of-contents URL.",
        variant: "destructive"
      });
      return;
    }


    // Save settings to localStorage
    const domain = extractDomain(tocUrl);
    if (domain) {
      localStorage.setItem(`epub-converter-${domain}`, JSON.stringify({
        tocSelector,
        contentSelector
      }));
    }

    onSubmit({
      tocUrl,
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
  const hasUrl = tocUrl.trim().length > 0;

  return (
    <div className="w-full max-w-5xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-10">
        {/* Search-engine style hero */}
        <div className="flex flex-col items-center justify-center gap-8 pt-6 md:pt-10">
          {/* Wordmark */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Web novels, beautifully bound
            </div>
            <h1 className="font-display text-6xl md:text-7xl font-extrabold tracking-tight leading-none">
              <span className="text-foreground">Link</span>
              <span className="text-primary">2</span>
              <span className="text-foreground">Epub</span>
              <span className="text-primary">.</span>
            </h1>
          </div>

          {/* Pill search */}
          <div className="w-full max-w-2xl">
            <div className="group relative flex items-center rounded-full bg-card border border-border shadow-search transition-smooth focus-within:border-primary/40 focus-within:shadow-glow">
              <Search className="w-5 h-5 text-muted-foreground absolute left-5 pointer-events-none" />
              <Input
                id="toc-url"
                type="url"
                value={tocUrl}
                onChange={(e) => setTocUrl(e.target.value)}
                placeholder="Paste a novel's table-of-contents URL…"
                required
                autoFocus
                className="h-14 md:h-16 pl-14 pr-32 md:pr-36 text-base md:text-lg rounded-full border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button
                type="submit"
                disabled={isConverting || !hasUrl}
                className="absolute right-2 h-10 md:h-12 rounded-full px-5 md:px-6 bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
              >
                {isConverting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                    <span className="hidden md:inline">Working</span>
                  </>
                ) : (
                  <>
                    <span className="hidden md:inline">Fetch</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Works with Novelhall, Novelfull, NovelBin, FreeWebNovel, NovelFire, NovGo, NovelBuddy, NovelArrow &amp; WTR-LAB
            </p>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 justify-center">
            <SupportedSites />
            <AdminPanel />
          </div>

          {/* Sites grid — only before URL entered */}
          {!hasUrl && (
            <div className="w-full pt-4">
              <div className="mb-4 flex items-end justify-between px-1">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Supported sites
                </h2>
                <span className="text-xs text-muted-foreground">{SUPPORTED_SITES.length} available</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {SUPPORTED_SITES.map(site => (
                  <button
                    key={site.domain}
                    type="button"
                    onClick={() => handleSiteSelect(site.name)}
                    className="group text-left rounded-xl border border-border bg-card p-4 shadow-card hover:border-primary/40 hover:-translate-y-0.5 transition-smooth"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-smooth">
                        <Globe className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-display font-semibold text-sm truncate">{site.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{site.domain}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>



        {/* Reveal the rest only after URL is entered */}
        {hasUrl && (
          <Card className="p-6 bg-gradient-card shadow-card border-0 space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
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