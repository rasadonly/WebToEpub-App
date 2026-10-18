import { useEffect, useState } from 'react';
import { Download, Loader2, X, CheckCircle2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LibraryBook, libraryGetCommunity, libraryDownloadHF } from '@/utils/webtoepub/bridge';

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/\.(epub|txt)$/i, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function matchScore(bookTitle: string, wanted: string): number {
  const a = norm(bookTitle);
  const b = norm(wanted);
  if (!a || !b || b.length < 3) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wa = new Set(a.split(' ').filter((w) => w.length > 1));
  const wb = b.split(' ').filter((w) => w.length > 1);
  if (wb.length < 2) return 0;
  const hit = wb.filter((w) => wa.has(w)).length;
  return hit / Math.max(wb.length, wa.size);
}

interface Props {
  query: string;
}

export default function LibrarySuggestion({ query }: Props) {
  const [matches, setMatches] = useState<LibraryBook[]>([]);
  const [dismissed, setDismissed] = useState('');
  const [downloading, setDownloading] = useState<Record<string, 'loading' | 'done'>>({});
  const { toast } = useToast();

  useEffect(() => {
    const q = query.trim();
    if (norm(q).length < 3) { setMatches([]); return; }
    let alive = true;

    const score = (books: LibraryBook[]) => books
      .map((b) => ({ b, s: matchScore(b.title, q) }))
      .filter((x) => x.s >= 0.75)
      .sort((x, y) => y.s - x.s || (y.b.size || 0) - (x.b.size || 0))
      .slice(0, 3)
      .map((x) => x.b);

    const t = window.setTimeout(() => {
      libraryGetCommunity((updated) => {
        if (alive) setMatches(score(updated));
      })
        .then((books) => { if (alive) setMatches(score(books)); })
        .catch(() => alive && setMatches([]));
    }, 400);

    return () => { alive = false; window.clearTimeout(t); };
  }, [query]);

  if (!matches.length || dismissed === query) return null;

  const download = async (book: LibraryBook) => {
    if (downloading[book.id]) return;
    setDownloading((d) => ({ ...d, [book.id]: 'loading' }));
    try {
      const blob = await libraryDownloadHF(book.handle);
      const name = `${(book.title || 'book').replace(/[\\/:*?"<>|]+/g, '').replace(/\.epub$/i, '')}.epub`;
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/epub+zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloading((d) => ({ ...d, [book.id]: 'done' }));
      setTimeout(() => setDownloading((d) => { const n = { ...d }; delete n[book.id]; return n; }), 2500);
    } catch (e) {
      setDownloading((d) => { const n = { ...d }; delete n[book.id]; return n; });
      toast({ title: 'Download failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="mt-4 rounded-2xl overflow-hidden border border-indigo-500/25 bg-indigo-950/30 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-white/80">Already in the Community Library</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(query)}
          aria-label="Dismiss"
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/10 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Books */}
      <div className="p-3 flex flex-col gap-2">
        {matches.map((b) => {
          const state = downloading[b.id];
          return (
            <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] transition-all">
              {/* Tiny color block */}
              <div
                className="w-8 h-10 rounded-md shrink-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(145deg,#3730a3,#6366f1)' }}
              >
                <span className="text-[8px] font-bold text-white/70 tracking-wider">EPUB</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white/85 truncate">{b.title}</p>
                {b.size ? <p className="text-[10px] text-white/30 mt-0.5">{(b.size / 1_048_576).toFixed(1)} MB</p> : null}
              </div>
              <button
                type="button"
                onClick={() => download(b)}
                disabled={!!state}
                className={
                  state === 'done'
                    ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[11px] font-semibold'
                    : state === 'loading'
                    ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-white/40 text-[11px] font-semibold cursor-not-allowed'
                    : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-[11px] font-semibold transition-all active:scale-95 hover:shadow-lg hover:shadow-indigo-500/20'
                }
              >
                {state === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
                {state === 'done' && <CheckCircle2 className="w-3 h-3" />}
                {!state && <Download className="w-3 h-3" />}
                {state === 'loading' ? 'Downloading' : state === 'done' ? 'Done!' : 'Download'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[10px] text-white/25">Not the right book? Dismiss — your search keeps going.</p>
    </div>
  );
}
