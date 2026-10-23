import { useEffect, useState } from 'react';
import { Download, Loader2, X, CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { LibraryBook, libraryGetCommunity, libraryDownloadHF } from '@/utils/webtoepub/bridge';
import { normalizeBookSearch as norm, libraryMatchScore as matchScore } from '@/utils/librarySearch';

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
    <Card className="mt-4 p-4 border border-primary/30 bg-primary/5 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Already in the Community Library</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(query)}
          aria-label="Dismiss"
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Books */}
      <div className="flex flex-col gap-2">
        {matches.map((b) => {
          const state = downloading[b.id];
          return (
            <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-background border border-border hover:border-primary/30 transition-all">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{b.title}</p>
                {b.size ? <p className="text-[10px] text-muted-foreground mt-0.5">{(b.size / 1_048_576).toFixed(1)} MB</p> : null}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => download(b)}
                disabled={!!state}
                variant={state === 'done' ? 'outline' : 'default'}
                className={state === 'done' ? 'text-green-600 border-green-600/30' : ''}
              >
                {state === 'loading' && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                {state === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {!state && <Download className="w-3 h-3 mr-1" />}
                {state === 'loading' ? 'Downloading' : state === 'done' ? 'Done!' : 'Download'}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Not the right book? Dismiss — your search keeps going.</p>
    </Card>
  );
}
