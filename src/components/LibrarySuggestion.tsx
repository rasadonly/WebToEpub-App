import { useEffect, useState } from 'react';
import { BookOpenCheck, Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { LibraryBook, libraryGetCommunity, libraryDownloadHF } from '@/utils/webtoepub/bridge';

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/\.(epub|txt)$/i, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** How closely a library title matches the wanted title (0–1). */
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
  /** Book title (from a pasted link) or the search text. */
  query: string;
}

/**
 * Suggests books already in the Community Library that match the wanted
 * title. It never blocks the search or scraping; it's just an option shown first.
 */
export default function LibrarySuggestion({ query }: Props) {
  const [matches, setMatches] = useState<LibraryBook[]>([]);
  const [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    const q = query.trim();
    if (norm(q).length < 3) { setMatches([]); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      libraryGetCommunity()
        .then((books) => {
          if (!alive) return;
          const scored = books
            .map((b) => ({ b, s: matchScore(b.title, q) }))
            .filter((x) => x.s >= 0.75)
            .sort((x, y) => y.s - x.s || (y.b.size || 0) - (x.b.size || 0))
            .slice(0, 3)
            .map((x) => x.b);
          setMatches(scored);
        })
        .catch(() => alive && setMatches([]));
    }, 400);
    return () => { alive = false; window.clearTimeout(t); };
  }, [query]);

  if (!matches.length || dismissed === query) return null;

  const download = async (book: LibraryBook) => {
    setBusy(book.id);
    try {
      const blob = await libraryDownloadHF(book.handle);
      const name = `${(book.title || 'book').replace(/[\\/:*?"<>|]+/g, '').replace(/\.epub$/i, '')}.epub`;
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/epub+zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast({ title: 'Download failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="mt-4 p-4 border border-primary/40 bg-primary/5 rounded-2xl animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpenCheck className="w-4 h-4 text-primary" />
          Already in the Community Library: download it now
        </div>
        <button type="button" onClick={() => setDismissed(query)} aria-label="Not this book" className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {matches.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate text-foreground">{b.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {[b.author, b.size ? `${(b.size / 1_048_576).toFixed(1)} MB` : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button type="button" size="sm" onClick={() => download(b)} disabled={!!busy}>
              {busy === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span className="ml-1">Download</span>
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Not the right book? Close this box. Your search or chapter loading keeps going.
      </p>
    </Card>
  );
}
