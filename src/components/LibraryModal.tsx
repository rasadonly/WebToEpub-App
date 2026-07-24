import { useEffect, useState } from 'react';
import { X, Send, Cloud, Archive, Loader2, Download, Search, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  LibraryBook,
  libraryGetTelegram,
  libraryGetMega,
  libraryGetArchive,
  libraryDownloadHF,
  libraryDownloadMega,
  libraryDownloadArchive,
} from '@/utils/webtoepub/bridge';

interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'telegram' | 'mega' | 'archive';

const DEFAULT_MEGA_URL = 'https://mega.nz/folder/Ci4ETASB#KIFVuPI99P1Ytg0dxmtYlw';

const TABS: { id: Tab; label: string; icon: typeof Send }[] = [
  { id: 'telegram', label: 'Telegram (HF)', icon: Send },
  { id: 'mega', label: 'Mega Cloud', icon: Cloud },
  { id: 'archive', label: 'Archive.org', icon: Archive },
];

function formatSize(bytes?: number) {
  if (!bytes) return '';
  const mb = bytes / 1_048_576;
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
}

export function LibraryModal({ open, onClose }: LibraryModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('telegram');
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [megaUrl, setMegaUrl] = useState(DEFAULT_MEGA_URL);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const load = async (which: Tab, megaOverride?: string) => {
    setLoading(true);
    setError(null);
    setBooks([]);
    try {
      let list: LibraryBook[] = [];
      if (which === 'telegram') list = await libraryGetTelegram();
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
    if (tab !== 'mega') load(tab);
  }, [open, tab]);

  const download = async (book: LibraryBook) => {
    setDownloadingId(book.id);
    try {
      let blob: Blob;
      if (book.source === 'mega') blob = await libraryDownloadMega(book.handle);
      else if (book.source === 'archive') blob = await libraryDownloadArchive(book.handle);
      else blob = await libraryDownloadHF(book.handle);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${book.title}.epub`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: 'Downloaded', description: `${book.title}.epub` });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Download failed',
        description: (e as Error).message,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const filtered = books.filter(
    (b) =>
      !query ||
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      b.author.toLowerCase().includes(query.toLowerCase())
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-6xl h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Community Library</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-3 border-b border-border">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border border-b-0',
                tab === id
                  ? 'bg-background text-foreground border-border'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-border flex flex-wrap gap-2 items-center bg-background/50">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search books…"
              className="pl-9"
            />
          </div>
          {tab === 'mega' && (
            <>
              <Input
                value={megaUrl}
                onChange={(e) => setMegaUrl(e.target.value)}
                placeholder="Mega folder URL"
                className="flex-1 min-w-[240px]"
              />
              <Button onClick={() => load('mega')} disabled={loading}>
                Load folder
              </Button>
            </>
          )}
          {tab !== 'mega' && (
            <Button variant="outline" onClick={() => load(tab)} disabled={loading}>
              Refresh
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading library…
            </div>
          )}

          {!loading && error && (
            <div className="text-destructive text-sm p-4 rounded-lg bg-destructive/10 border border-destructive/30">
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              {tab === 'mega' && books.length === 0
                ? 'Enter a Mega folder URL and click “Load folder”.'
                : 'No books found.'}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filtered.map((book) => (
                <div
                  key={book.id}
                  className="bg-background border border-border rounded-xl overflow-hidden flex flex-col hover:border-primary/50 hover:shadow-lg transition-all"
                >
                  <div className="aspect-[2/3] bg-muted flex items-center justify-center overflow-hidden">
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <BookOpen className="w-10 h-10 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-1">
                    <h3
                      className="font-semibold text-sm line-clamp-2 leading-tight"
                      title={book.title}
                    >
                      {book.title}
                    </h3>
                    {book.author && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {book.author}
                      </p>
                    )}
                    {book.size !== undefined && (
                      <p className="text-[10px] text-muted-foreground/80">
                        {formatSize(book.size)}
                      </p>
                    )}
                    <Button
                      size="sm"
                      className="mt-auto w-full"
                      onClick={() => download(book)}
                      disabled={downloadingId === book.id}
                    >
                      {downloadingId === book.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <>
                          <Download className="w-3 h-3 mr-1" /> EPUB
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
