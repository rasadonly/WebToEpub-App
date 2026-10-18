import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Cloud, Archive, Download, Search, BookOpen, CheckCircle2, RefreshCw, HardDriveDownload } from 'lucide-react';
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

const TABS: { id: Tab; label: string; icon: typeof Send; desc: string }[] = [
  { id: 'community', label: 'Community', icon: BookOpen, desc: 'Shared by the community' },
  { id: 'my-downloads', label: 'My Books', icon: HardDriveDownload, desc: 'Your saved conversions' },
  { id: 'telegram', label: 'Telegram', icon: Send, desc: 'From Telegram channel' },
  { id: 'mega', label: 'Mega', icon: Cloud, desc: 'Mega cloud folder' },
  { id: 'archive', label: 'Archive.org', icon: Archive, desc: 'Internet Archive' },
];

function formatSize(bytes?: number) {
  if (!bytes) return '';
  const mb = bytes / 1_048_576;
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}

// Generate a stable, rich gradient for a book cover based on its title.
function bookGradient(title: string): { from: string; to: string; text: string } {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = Math.imul(31, hash) + title.charCodeAt(i) | 0;
  }
  const abs = Math.abs(hash);
  const palettes: Array<{ from: string; to: string; text: string }> = [
    { from: '#1a1a2e', to: '#16213e', text: '#7ec8e3' },
    { from: '#2d1b69', to: '#11998e', text: '#f0fff4' },
    { from: '#360033', to: '#0b8793', text: '#ffe6fa' },
    { from: '#1f4037', to: '#99f2c8', text: '#1f4037' },
    { from: '#3a1c71', to: '#d76d77', text: '#fff0f3' },
    { from: '#141e30', to: '#243b55', text: '#b8d4f0' },
    { from: '#4e342e', to: '#d7722c', text: '#fff3e0' },
    { from: '#004d40', to: '#1de9b6', text: '#e0f2f1' },
    { from: '#1a237e', to: '#7c4dff', text: '#e8eaf6' },
    { from: '#37003c', to: '#c2185b', text: '#fce4ec' },
    { from: '#263238', to: '#37474f', text: '#b0bec5' },
    { from: '#0d1117', to: '#161b22', text: '#58a6ff' },
  ];
  return palettes[abs % palettes.length];
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white/5 animate-pulse">
      <div className="aspect-[2/3] bg-white/10" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-white/10 rounded w-1/2" />
        <div className="h-8 bg-white/10 rounded-lg mt-3" />
      </div>
    </div>
  );
}

interface BookCardProps {
  book: LibraryBook;
  onDownload: (book: LibraryBook, onProgress: (pct: number) => void) => Promise<void>;
}

function BookCard({ book, onDownload }: BookCardProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [progress, setProgress] = useState<number>(0);
  const grad = bookGradient(book.title);

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
    <div className="group rounded-2xl overflow-hidden bg-white/[0.04] border border-white/10 flex flex-col hover:border-white/25 hover:bg-white/[0.07] transition-all duration-200 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5">
      {/* Cover */}
      <div
        className="aspect-[2/3] relative flex items-end overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${grad.from}, ${grad.to})` }}
      >
        {book.coverUrl ? (
          <img src={book.coverUrl} alt={book.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <>
            {/* Subtle texture lines */}
            <div className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,.08) 18px,rgba(255,255,255,.08) 19px)' }} />
            {/* Spine shimmer */}
            <div className="absolute left-0 top-0 bottom-0 w-4"
              style={{ background: 'linear-gradient(90deg,rgba(255,255,255,.12),transparent)' }} />
            {/* Title on cover */}
            <div className="relative z-10 p-3 w-full">
              <p className="text-[10px] font-mono tracking-[0.2em] uppercase opacity-50 mb-1" style={{ color: grad.text }}>EPUB</p>
              <p className="text-[11px] font-semibold leading-tight line-clamp-4" style={{ color: grad.text }}>
                {book.title}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3 className="text-[12px] font-semibold leading-snug line-clamp-2 text-white/90" title={book.title}>
          {book.title}
        </h3>
        {book.author && (
          <p className="text-[10px] text-white/40 line-clamp-1">{book.author}</p>
        )}
        {book.size !== undefined && (
          <p className="text-[10px] text-white/30">{formatSize(book.size)}</p>
        )}

        {/* Download button + progress bar */}
        <div className="mt-auto space-y-1.5">
          <button
            onClick={handleClick}
            disabled={state === 'loading'}
            className={cn(
              'w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all duration-200',
              state === 'done'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : state === 'loading'
                ? 'bg-indigo-900/50 text-indigo-300 cursor-not-allowed border border-indigo-500/20'
                : 'bg-indigo-500 hover:bg-indigo-400 text-white border border-indigo-400/20 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95'
            )}
          >
            {state === 'loading' && (
              <span className="text-[10px] tabular-nums">{progress < 1 ? '…' : `${progress}%`}</span>
            )}
            {state === 'done' && <CheckCircle2 className="w-3 h-3" />}
            {state === 'idle' && <Download className="w-3 h-3" />}
            {state === 'loading' ? 'Downloading' : state === 'done' ? 'Downloaded!' : 'Download EPUB'}
          </button>
          {/* Progress bar */}
          {state === 'loading' && (
            <div className="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

  // Focus search when modal opens
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

  // Infinite scroll
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

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{
        background: 'linear-gradient(135deg, #0d0d1a 0%, #0a0a14 60%, #10091a 100%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30">
            <BookOpen className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white leading-none">Community Library</h2>
            <p className="text-[10px] text-white/40 mt-0.5">{activeTab.desc}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative hidden sm:flex items-center w-56 lg:w-72">
          <Search className="absolute left-3 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-white/[0.06] border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.08] transition-all"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={() => load(tab)}
          disabled={loading}
          className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-all disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-all"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-4 sm:px-6 pt-3 pb-0 overflow-x-auto no-scrollbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id as Tab); setQuery(''); }}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl text-[11px] font-semibold whitespace-nowrap transition-all duration-200 border-b-2 shrink-0',
              tab === id
                ? 'bg-white/[0.07] text-white border-b-indigo-500 border-l border-r border-t border-white/10'
                : 'text-white/35 hover:text-white/60 border-b-transparent hover:bg-white/[0.04]'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="h-px bg-white/[0.08] mx-4 sm:mx-6" />

      {/* ── Mega URL input ── */}
      {tab === 'mega' && (
        <div className="flex gap-2 px-4 sm:px-6 py-3 border-b border-white/[0.06]">
          <input
            value={megaUrl}
            onChange={(e) => setMegaUrl(e.target.value)}
            placeholder="Mega folder URL…"
            className="flex-1 px-4 py-2 rounded-xl text-xs bg-white/[0.06] border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-500/50 transition-all"
          />
          <button
            onClick={() => load('mega')}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold transition-all disabled:opacity-50"
          >
            Load
          </button>
        </div>
      )}

      {/* Mobile search */}
      <div className="flex sm:hidden px-4 py-2 border-b border-white/[0.06]">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-white/[0.06] border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-500/50 transition-all"
          />
        </div>
      </div>

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
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <X className="w-5 h-5 text-red-400" />
            </div>
            <p className="text-sm text-white/60 max-w-sm">{error}</p>
            <button
              onClick={() => load(tab)}
              className="mt-2 px-4 py-2 rounded-xl bg-white/[0.07] border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white/30" />
            </div>
            <p className="text-sm text-white/40">
              {query ? `No results for "${query}"` : 'No books found'}
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && filtered.length > 0 && (
          <>
            <p className="text-[10px] text-white/25 mb-3 font-mono">
              {filtered.length.toLocaleString()} books{query && ` matching "${query}"`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {visibleBooks.map((book) => (
                <BookCard key={book.id} book={book} onDownload={handleDownload} />
              ))}
            </div>

            {visibleCount < filtered.length && (
              <>
                <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
                <div className="flex items-center justify-center gap-3 pt-8 pb-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => Math.min(c + LOAD_MORE, filtered.length))}
                    className="px-5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white/60 hover:text-white hover:bg-white/10 transition-all"
                  >
                    Load more
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filtered.length)}
                    className="px-5 py-2.5 rounded-xl text-xs text-white/30 hover:text-white/60 transition-all"
                  >
                    Show all ({filtered.length.toLocaleString()})
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
