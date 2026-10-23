import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Cloud, Archive, Download, Search, BookOpen, CheckCircle2, RefreshCw, HardDriveDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { matchesLibrarySearch } from '@/utils/librarySearch';
import {
  LibraryBook,
  libraryGetTelegram,
  libraryGetMega,
  libraryGetArchive,
  libraryGetCommunity,
  libraryGetMyDownloads,
  libraryDownloadHF,
  libraryDownloadMega,
} from '@/utils/webtoepub/bridge';

interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'community' | 'my-downloads' | 'telegram' | 'mega' | 'archive';

const DEFAULT_MEGA_URL = 'https://mega.nz/folder/Ci4ETASB#KIFVuPI99P1Ytg0dxmtYlw';
const INITIAL_VISIBLE = 80;
const LOAD_MORE = 80;

const TABS: { id: Tab; label: string; icon: typeof Send }[] = [
  { id: 'community', label: 'Community', icon: BookOpen },
  { id: 'my-downloads', label: 'My Books', icon: HardDriveDownload },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'mega', label: 'Mega', icon: Cloud },
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

/* ── Skeleton card placeholder ─────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-muted/60" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-muted rounded w-4/5" />
        <div className="h-3 bg-muted rounded w-2/5" />
        <div className="h-8 bg-muted rounded-lg w-full mt-1" />
      </div>
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
    <div className="group flex flex-col rounded-2xl bg-card border border-border overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40 transition-all duration-200">
      {/* Cover */}
      <div
        className="relative aspect-[2/3] overflow-hidden"
        style={{ background: `linear-gradient(165deg, hsl(${hue}deg 52% 32%), hsl(${hueEnd}deg 58% 15%))` }}
      >
        {hasCover ? (
          <img
            src={book.coverUrl}
            alt={cleanTitle}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <>
            {/* Designed fallback cover: gradient, spine, typeset title */}
            <div className="absolute inset-y-0 left-0 w-[7px] bg-gradient-to-b from-white/35 via-white/10 to-black/30" />
            <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/10 blur-2xl" />
            <span
              aria-hidden="true"
              className="absolute -bottom-7 -right-2 font-serif font-bold text-[7.5rem] leading-none text-white/[0.07] select-none"
            >
              {(cleanTitle.trim()[0] || '?').toUpperCase()}
            </span>
            <div className="absolute inset-0 flex flex-col px-4 pl-5 py-4">
              <span className="text-[8px] font-semibold uppercase tracking-[0.28em] text-white/60">
                LinkToEpub Library
              </span>
              <h4 className="mt-3 font-serif font-bold text-white text-[15px] leading-snug line-clamp-6 drop-shadow-sm">
                {cleanTitle}
              </h4>
              <div className="mt-3 h-px w-10 bg-white/50" />
              {book.author && (
                <span className="mt-2 text-[10px] uppercase tracking-widest text-white/70 line-clamp-1">
                  {book.author}
                </span>
              )}
              <span className="mt-auto text-[8px] font-semibold uppercase tracking-[0.28em] text-white/45">
                EPUB Edition
              </span>
            </div>
          </>
        )}
        {chapterLabel && (
          <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white text-[10px] font-semibold tabular-nums">
            {chapterLabel}
          </span>
        )}
        {state === 'loading' && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/30">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.max(progress, 3)}%` }}
            />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-3">
        <h3 className="font-serif font-semibold text-sm leading-snug line-clamp-2" title={book.title}>
          {cleanTitle}
        </h3>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
          {book.author && <span className="truncate">{book.author}</span>}
          {book.author && book.size !== undefined && <span aria-hidden="true">·</span>}
          {book.size !== undefined && <span className="shrink-0 tabular-nums">{formatSize(book.size)}</span>}
          {book.uploadedAt && <span aria-hidden="true">·</span>}
          {book.uploadedAt && <span className="shrink-0">{formatDate(book.uploadedAt)}</span>}
        </div>
        <Button
          size="sm"
          onClick={handleClick}
          disabled={state === 'loading'}
          aria-label={`Download ${book.title}`}
          className={cn(
            'mt-3 w-full text-[11px] font-semibold',
            state === 'done' && 'bg-green-600 hover:bg-green-600 text-white',
          )}
          variant={state === 'loading' ? 'outline' : 'default'}
        >
          {state === 'loading' && progress > 0 && <span className="tabular-nums">{progress}%</span>}
          {state === 'loading' && progress === 0 && <RefreshCw className="w-3 h-3 animate-spin" />}
          {state === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
          {state === 'idle' && <Download className="w-3 h-3 mr-1" />}
          {state === 'done' ? 'Downloaded' : state === 'idle' ? 'Download EPUB' : ''}
        </Button>
      </div>
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
  const [megaUrl, setMegaUrl] = useState(DEFAULT_MEGA_URL);
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

  const load = async (which: Tab, megaOverride?: string) => {
    setLoading(true);
    setError(null);
    setBooks([]);
    setVisibleCount(INITIAL_VISIBLE);
    try {
      let list: LibraryBook[] = [];
      if (which === 'community') {
        list = await libraryGetCommunity((fresh) => {
          if (tabRef.current === 'community') setBooks(fresh);
        });
      } else if (which === 'my-downloads') list = await libraryGetMyDownloads();
      else if (which === 'telegram') list = await libraryGetTelegram();
      else if (which === 'archive') list = await libraryGetArchive();
      else list = await libraryGetMega(megaOverride ?? megaUrl);
      setBooks(list);
    } catch (e) {
      setError((e as Error).message || 'Failed to load library');
    } finally {
      setLoading(false);
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
      const blob =
        book.source === 'mega'
          ? await libraryDownloadMega(book.handle)
          : await libraryDownloadHF(book.handle, onProgress);
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
      className="fixed inset-0 z-[100] bg-background flex flex-col"
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

      {/* Mega URL input */}
      {tab === 'mega' && (
        <div className="flex gap-2 px-4 sm:px-6 py-3 border-b border-border">
          <Input
            value={megaUrl}
            onChange={(e) => setMegaUrl(e.target.value)}
            placeholder="Mega folder URL…"
            className="flex-1 h-9 text-xs"
          />
          <Button size="sm" onClick={() => load('mega')} disabled={loading}>
            Load
          </Button>
        </div>
      )}

      {/* ── Body ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 bg-muted/30">

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 max-w-[1400px] mx-auto w-full">
            {Array.from({ length: 15 }).map((_, i) => <SkeletonCard key={i} />)}
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
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 max-w-[1400px] mx-auto w-full">
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
