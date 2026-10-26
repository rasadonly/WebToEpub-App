import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Archive, Download, Search, BookOpen, CheckCircle2, RefreshCw, HardDriveDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { matchesLibrarySearch } from '@/utils/librarySearch';
import {
  LibraryBook,
  libraryGetArchive,
  libraryGetCommunity,
  libraryGetMyDownloads,
  libraryDownloadHF,
} from '@/utils/webtoepub/bridge';

interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'community' | 'my-downloads' | 'archive';

const INITIAL_VISIBLE = 80;
const LOAD_MORE = 80;

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'community', label: 'Community', icon: BookOpen },
  { id: 'my-downloads', label: 'My Books', icon: HardDriveDownload },
  { id: 'archive', label: 'Archive.org', icon: Archive },
];

function formatSize(bytes?: number) {
  if (!bytes) return '';
  const mb = bytes / 1_048_576;
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}

function titleToHue(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = Math.imul(31, hash) + title.charCodeAt(i) | 0;
  return Math.abs(hash) % 360;
}

/* ── Chapter info parsed out of raw archive titles ───────────
   Titles arrive like "Some Novel c1 1405 (2)" or "[@tag] X Ch 201 To End".
   The chapter part becomes a badge; the title itself is shown clean. */
interface ChapterInfo { label: string | null; cleanTitle: string }

function parseChapterInfo(rawTitle: string): ChapterInfo {
  let title = rawTitle.replace(/^\s*\[@?[^\]]*\]\s*/, '').trim();
  let label: string | null = null;
  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => string }[] = [
    { re: /\b(?:c|ch|chapters?)\.?\s*(\d+)\s*(?:to|until)\s*end\b/i, make: (m) => `Ch ${m[1]}–End` },
    { re: /\b(?:c|ch|chapters?)\.?\s*(\d+)\s*[-–~]\s*(\d+)\b/i, make: (m) => `Ch ${m[1]}–${m[2]}` },
    { re: /\bc(\d+)\s+(\d+)\b/i, make: (m) => `Ch ${m[1]}–${m[2]}` },
    { re: /\b(?:c|ch)\.?\s*(\d+)\b/i, make: (m) => (Number(m[1]) > 1 ? `Ch 1–${m[1]}` : 'Ch 1') },
  ];
  for (const { re, make } of patterns) {
    const m = title.match(re);
    if (m) {
      label = make(m);
      title = title.replace(re, ' ');
      break;
    }
  }
  if (!label && /\bcomplete[d]?\b/i.test(title)) label = 'Complete';
  title = title
    .replace(/\s*\((?:\d+)\)\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–:|]+$/, '')
    .trim();
  return { label, cleanTitle: title || rawTitle };
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Skeleton row placeholder ──────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border animate-pulse">
      <div className="w-10 h-10 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-muted rounded w-3/5" />
        <div className="h-3 bg-muted rounded w-1/4" />
      </div>
      <div className="h-8 w-20 bg-muted rounded-md shrink-0" />
    </div>
  );
}

/* ── Book card with download progress ──────────────────────── */
interface BookCardProps {
  book: LibraryBook;
  onDownload: (book: LibraryBook, onProgress: (pct: number) => void) => Promise<void>;
}

  const BookCard = memo(function BookCard({ book, onDownload }: BookCardProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const hue = titleToHue(book.title);
  const hueEnd = (hue + 40) % 360;

  const handleClick = async () => {
    if (state !== 'idle') return;
    setState('loading');
    setProgress(0);
    try {
      await onDownload(book, (pct) => setProgress(pct));
      setProgress(100);
      setState('done');
      setTimeout(() => { setState('idle'); setProgress(0); }, 2500);
    } catch {
      setState('idle');
      setProgress(0);
    }
  };

  const { label: chapterLabel, cleanTitle } = parseChapterInfo(book.title);
  const hasCover = Boolean(book.coverUrl) && !imgFailed;

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors min-w-0">
      {/* Compact monogram chip (no cover art in this library) */}
      <div
        className="w-10 h-10 shrink-0 rounded-lg relative overflow-hidden flex items-center justify-center"
        style={{ background: `linear-gradient(140deg, hsl(${hue}deg 45% 32%), hsl(${hueEnd}deg 50% 18%))` }}
      >
        {hasCover ? (
          <img
            src={book.coverUrl}
            alt={cleanTitle}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span aria-hidden="true" className="font-serif font-bold text-base text-white/85 select-none">
            {(cleanTitle.trim()[0] || '?').toUpperCase()}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-serif font-semibold text-sm leading-snug break-words line-clamp-none sm:line-clamp-1" title={book.title}>
          {cleanTitle}
        </h3>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground min-w-0">
          {chapterLabel && (
            <span className="shrink-0 px-1.5 py-px rounded bg-primary/10 text-primary font-semibold tabular-nums">
              {chapterLabel}
            </span>
          )}
          {book.author && <span className="truncate min-w-0">{book.author}</span>}
          {book.author && book.size !== undefined && <span aria-hidden="true">·</span>}
          {book.size !== undefined && <span className="shrink-0 tabular-nums">{formatSize(book.size)}</span>}
          {book.uploadedAt && <span aria-hidden="true">·</span>}
          {book.uploadedAt && <span className="shrink-0">{formatDate(book.uploadedAt)}</span>}
        </div>
        {state === 'loading' && (
          <div className="mt-1.5 w-full h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.max(progress, 3)}%` }}
            />
          </div>
        )}
      </div>

      {/* Button */}
      <Button
        size="sm"
        onClick={handleClick}
        disabled={state === 'loading'}
        aria-label={`Download ${book.title}`}
        className={cn(
          'shrink-0 text-[11px] font-semibold min-w-[4.75rem]',
          state === 'done' && 'bg-green-600 hover:bg-green-600 text-white',
        )}
        variant={state === 'loading' ? 'outline' : 'default'}
      >
        {state === 'loading' && progress > 0 && <span className="tabular-nums">{progress}%</span>}
        {state === 'loading' && progress === 0 && <RefreshCw className="w-3 h-3 animate-spin" />}
        {state === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
        {state === 'idle' && <Download className="w-3 h-3 mr-1" />}
        {state === 'done' ? 'Done' : state === 'idle' ? 'EPUB' : ''}
      </Button>
    </div>
  );
});

/* ── Main Library Modal ───────────────────────────────────── */
export function LibraryModal({ open, onClose }: LibraryModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('community');
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [query, setQuery] = useState('');
  const searchText = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  // Let the browser paint draft text immediately, without redrawing the library.
  const updateSearchDraft = (value: string) => {
    searchText.current = value;
    for (const input of [searchRef.current, mobileSearchRef.current]) {
      if (input && input.value !== value) input.value = value;
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 200);
  }, [open]);

  // Guards against stale tab loads: without this, a slow load for a tab the
  // user already left (e.g. Archive) can resolve after the current tab's load
  // and overwrite the list on screen — Archive books under the Community tab.
  const loadGen = useRef(0);
  const load = async (which: Tab) => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    setBooks([]);
    setVisibleCount(INITIAL_VISIBLE);
    try {
      let list: LibraryBook[] = [];
      if (which === 'community') {
        list = await libraryGetCommunity((fresh) => {
          if (loadGen.current === gen && tabRef.current === 'community') setBooks(fresh);
        });
      } else if (which === 'my-downloads') list = await libraryGetMyDownloads();
      else if (which === 'archive') list = await libraryGetArchive();
      if (loadGen.current !== gen) return; // a newer tab load started; don't overwrite it
      setBooks(list);
    } catch (e) {
      if (loadGen.current !== gen) return;
      setError((e as Error).message || 'Failed to load library');
    } finally {
      if (loadGen.current === gen) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [query, tab]);

  const handleDownload = useCallback(async (book: LibraryBook, onProgress: (pct: number) => void) => {
    if (book.source === 'archive') {
      const { url } = book.handle as { url: string };
      window.open(url, '_blank', 'noopener,noreferrer');
      toast({ title: 'Opening Archive.org', description: book.title });
      return;
    }
    try {
      const blob = await libraryDownloadHF(book.handle, onProgress);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/epub+zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book.title}.epub`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast({ title: '✓ Downloaded', description: `${book.title}.epub` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Download failed', description: (e as Error).message });
      throw e;
    }
  }, [toast]);

  const filtered = useMemo(() => {
    return books.filter(b => matchesLibrarySearch(b.title, b.author, query));
  }, [books, query]);

  const visibleBooks = filtered.slice(0, visibleCount);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!open || loading) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || visibleCount >= filtered.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + LOAD_MORE, filtered.length));
        }
      },
      { root, rootMargin: '600px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, loading, tab, visibleCount, filtered.length]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col overflow-x-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold tracking-tight truncate">Community Library</h2>
            <p className="text-[10px] text-muted-foreground">{filtered.length.toLocaleString()} books</p>
          </div>
        </div>

        {/* Desktop search */}
        <form className="hidden sm:flex items-center gap-2 flex-1 min-w-0 max-w-sm" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); setQuery(searchText.current.trim()); }}>
          <Input
            ref={searchRef}
            defaultValue={searchText.current}
            onChange={(e) => updateSearchDraft(e.target.value)}
            enterKeyHint="search"
            placeholder="Search titles…"
            className="min-w-0 h-9 text-xs"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Search
          </Button>
        </form>

        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" onClick={() => load(tab)} disabled={loading} title="Refresh" className="h-8 w-8">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-3 sm:px-5 pt-2 border-b border-border overflow-x-auto no-scrollbar bg-card/50">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); setQuery(''); updateSearchDraft(''); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-[11px] sm:text-xs font-semibold rounded-t-lg transition-all whitespace-nowrap shrink-0 border-b-2',
              tab === id
                ? 'text-primary border-b-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground border-b-transparent hover:bg-muted/50'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Mobile search */}
      <div className="flex sm:hidden px-3 py-2 border-b border-border">
        <form className="flex items-center gap-2 flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); setQuery(searchText.current.trim()); }}>
          <Input
            ref={mobileSearchRef}
            defaultValue={searchText.current}
            onChange={(e) => updateSearchDraft(e.target.value)}
            enterKeyHint="search"
            placeholder="Search titles…"
            className="min-w-0 h-9 text-xs"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Search
          </Button>
        </form>
      </div>

      {/* ── Body ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 sm:px-6 py-4 bg-muted/30">

        {/* Loading skeletons */}
        {loading && (
          <div className="grid gap-2 xl:grid-cols-2 max-w-6xl mx-auto w-full">
            {Array.from({ length: 14 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <X className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={() => load(tab)}>
              Try again
            </Button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              {query ? `No results for "${query}"` : 'No books found'}
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="grid gap-2 xl:grid-cols-2 max-w-6xl mx-auto w-full">
              {visibleBooks.map((book) => (
                <BookCard key={book.id} book={book} onDownload={handleDownload} />
              ))}
            </div>

            {visibleCount < filtered.length && (
              <>
                <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
                <div className="flex items-center justify-center gap-3 pt-6 pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((c) => Math.min(c + LOAD_MORE, filtered.length))}
                  >
                    Load more
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(filtered.length)}
                  >
                    Show all ({filtered.length.toLocaleString()})
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
