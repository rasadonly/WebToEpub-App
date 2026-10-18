import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Cloud, Archive, Download, Search, BookOpen, CheckCircle2, RefreshCw, HardDriveDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
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
const BG_BATCH = 200;

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

/* ── Skeleton card placeholder ─────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-muted/50 animate-pulse border border-border">
      <div className="aspect-[2/3] bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-muted rounded w-4/5" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="h-8 bg-muted rounded-lg mt-3" />
      </div>
    </div>
  );
}

/* ── Book card with download progress ──────────────────────── */
interface BookCardProps {
  book: LibraryBook;
  onDownload: (book: LibraryBook, onProgress: (pct: number) => void) => Promise<void>;
}

function BookCard({ book, onDownload }: BookCardProps) {
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

  return (
    <div className="group rounded-xl overflow-hidden bg-card border border-border flex flex-col hover:border-primary/40 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5">
      {/* Cover */}
      <div
        className="aspect-[2/3] relative overflow-hidden"
        style={{ background: `linear-gradient(160deg, hsl(${hue}deg 45% 30%), hsl(${hueEnd}deg 50% 14%))` }}
      >
        {book.coverUrl && !imgFailed ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <>
            {/* spine */}
            <div className="absolute inset-y-0 left-0 w-2 bg-background/25" />
            <div className="absolute inset-y-0 left-2 w-px bg-primary-foreground/15" />
            {/* big initial watermark */}
            <span
              aria-hidden="true"
              className="absolute -right-2 -bottom-6 font-serif font-bold leading-none text-primary-foreground/10 select-none"
              style={{ fontSize: '9rem' }}
            >
              {(book.title.trim()[0] || '?').toUpperCase()}
            </span>
            <div className="relative z-10 h-full pl-5 pr-3 py-4 flex flex-col text-primary-foreground">
              <div className="h-px w-8 bg-primary-foreground/50 mb-3" />
              <span
                className="font-serif font-bold leading-snug line-clamp-5 break-words"
                style={{ fontSize: book.title.length > 40 ? '0.8rem' : '0.95rem' }}
              >
                {book.title}
              </span>
              <div className="mt-auto space-y-1">
                {book.author && (
                  <span className="block text-[10px] italic opacity-75 line-clamp-1">{book.author}</span>
                )}
                <span className="block text-[9px] font-mono uppercase tracking-[0.2em] opacity-50">EPUB</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Info + Button */}
      <div className="p-3 flex-1 flex flex-col gap-1">
        <h3 className="font-semibold text-xs sm:text-sm leading-tight line-clamp-2" title={book.title}>
          {book.title}
        </h3>
        {book.author && (
          <p className="text-[10px] text-muted-foreground line-clamp-1">{book.author}</p>
        )}
        {book.size !== undefined && (
          <p className="text-[10px] text-muted-foreground/70">{formatSize(book.size)}</p>
        )}

        <div className="mt-auto pt-2 space-y-1.5">
          <Button
            size="sm"
            onClick={handleClick}
            disabled={state === 'loading'}
            className={cn(
              'w-full text-[11px] font-semibold transition-all',
              state === 'done' && 'bg-green-600 hover:bg-green-600 text-white',
            )}
            variant={state === 'done' ? 'default' : state === 'loading' ? 'outline' : 'default'}
          >
            {state === 'loading' && progress > 0 && (
              <span className="tabular-nums mr-1 text-[10px]">{progress}%</span>
            )}
            {state === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
            {state === 'idle' && <Download className="w-3 h-3 mr-1" />}
            {state === 'loading' ? (progress > 0 ? 'Downloading' : 'Connecting…') : state === 'done' ? 'Downloaded!' : 'EPUB'}
          </Button>

          {/* Progress bar */}
          {state === 'loading' && (
            <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.max(progress, 3)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Library Modal ───────────────────────────────────── */
export function LibraryModal({ open, onClose }: LibraryModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('community');
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [megaUrl, setMegaUrl] = useState(DEFAULT_MEGA_URL);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const handleDownload = async (book: LibraryBook, onProgress: (pct: number) => void) => {
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
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${book.title}.epub`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: '✓ Downloaded', description: `${book.title}.epub` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Download failed', description: (e as Error).message });
      throw e;
    }
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return books.filter(
      (b) =>
        !q ||
        b.title.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(q) ||
        b.author.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(q)
    );
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

  // Background progressive loading: once the first batch is shown,
  // incrementally bump visible count so all cards render without user scrolling.
  useEffect(() => {
    if (loading || visibleCount >= filtered.length || filtered.length <= INITIAL_VISIBLE) return;
    const timer = setTimeout(() => {
      setVisibleCount((c) => Math.min(c + BG_BATCH, filtered.length));
    }, 800);
    return () => clearTimeout(timer);
  }, [loading, visibleCount, filtered.length]);

  if (!open) return null;

  return (
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
        <div className="relative hidden sm:block flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles…"
            className="pl-9 h-9 text-xs"
          />
        </div>

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
            onClick={() => { setTab(id); setQuery(''); }}
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles…"
            className="pl-9 h-9 text-xs"
          />
        </div>
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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {Array.from({ length: 18 }).map((_, i) => <SkeletonCard key={i} />)}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
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
    </div>
  );
}
