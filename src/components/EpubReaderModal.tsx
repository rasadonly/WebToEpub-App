import { useCallback, useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs';
import {
  X,
  ChevronLeft,
  ChevronRight,
  List,
  Upload,
  BookOpen,
  Sun,
  Moon,
  Coffee,
  Type as TypeIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EpubReaderModalProps {
  open: boolean;
  onClose: () => void;
}

type Theme = 'light' | 'dark' | 'sepia';

const THEMES: Record<Theme, Record<string, Record<string, string>>> = {
  light: {
    body: { background: '#ffffff', color: '#111111' },
    a: { color: '#c62828' },
  },
  dark: {
    body: { background: '#0f0f0f', color: '#e6e6e6' },
    a: { color: '#ff7676' },
  },
  sepia: {
    body: { background: '#f4ecd8', color: '#3b2f1e' },
    a: { color: '#8a3b1e' },
  },
};

const FONTS = [
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'mono', label: 'Mono', css: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { id: 'reader', label: 'Reader', css: 'Merriweather, Georgia, serif' },
];

export function EpubReaderModal({ open, onClose }: EpubReaderModalProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [toc, setToc] = useState<NavItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('');

  const [theme, setTheme] = useState<Theme>('dark');
  const [fontSize, setFontSize] = useState(110); // %
  const [fontFamily, setFontFamily] = useState('serif');

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
      setBookLoaded(false);
      setTitle('');
      setToc([]);
      setError(null);
      setProgress(0);
      setCurrentLabel('');
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') renditionRef.current?.next();
      else if (e.key === 'ArrowLeft') renditionRef.current?.prev();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const applyTheme = useCallback(
    (r: Rendition, name: Theme, size: number, family: string) => {
      r.themes.register(name, THEMES[name]);
      r.themes.select(name);
      r.themes.fontSize(`${size}%`);
      const familyCss = FONTS.find((f) => f.id === family)?.css || FONTS[0].css;
      r.themes.override('font-family', familyCss, true);
    },
    []
  );

  const openFile = useCallback(
    async (file: File | ArrayBuffer) => {
      setError(null);
      setLoading(true);
      try {
        renditionRef.current?.destroy();
        bookRef.current?.destroy();

        const data = file instanceof File ? await file.arrayBuffer() : file;
        const book = ePub(data);
        bookRef.current = book;

        await book.ready;
        const meta = await book.loaded.metadata;
        setTitle(meta?.title || (file instanceof File ? file.name : 'EPUB'));

        const nav = await book.loaded.navigation;
        setToc(nav?.toc || []);

        if (!viewerRef.current) throw new Error('Viewer not ready');
        viewerRef.current.innerHTML = '';
        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          manager: 'default',
          spread: 'auto',
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        applyTheme(rendition, theme, fontSize, fontFamily);

        rendition.on('relocated', (loc: any) => {
          const pct = loc?.start?.percentage ?? 0;
          setProgress(Math.round(pct * 100));
          const href = loc?.start?.href;
          const item = href ? findTocItem(nav?.toc || [], href) : null;
          setCurrentLabel(item?.label?.trim() || '');
        });

        // Click zones for prev/next inside the iframe
        rendition.on('keyup', (e: KeyboardEvent) => {
          if (e.key === 'ArrowRight') rendition.next();
          if (e.key === 'ArrowLeft') rendition.prev();
        });

        await rendition.display();
        setBookLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [applyTheme, theme, fontSize, fontFamily]
  );

  // Re-apply theme / font live
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, theme, fontSize, fontFamily);
  }, [theme, fontSize, fontFamily, applyTheme]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void openFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && /\.epub$/i.test(f.name)) void openFile(f);
    else setError('Please drop a .epub file');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col animate-in fade-in duration-200 pointer-events-auto"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-card/80">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">
            {title || 'EPUB Reader'}
          </span>
          {currentLabel && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              · {currentLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {bookLoaded && (
            <Button variant="ghost" size="sm" onClick={() => setShowToc((v) => !v)} title="Contents">
              <List className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            title="Open EPUB"
          >
            <Upload className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <X className="w-4 h-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            onChange={onPickFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Toolbar */}
      {bookLoaded && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card/60 text-xs">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={theme === 'light' ? 'default' : 'outline'}
              onClick={() => setTheme('light')}
              title="Light"
            >
              <Sun className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant={theme === 'sepia' ? 'default' : 'outline'}
              onClick={() => setTheme('sepia')}
              title="Sepia"
            >
              <Coffee className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant={theme === 'dark' ? 'default' : 'outline'}
              onClick={() => setTheme('dark')}
              title="Dark"
            >
              <Moon className="w-3.5 h-3.5" />
            </Button>
          </div>

          <label className="flex items-center gap-1">
            <TypeIcon className="w-3.5 h-3.5" />
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Size {fontSize}%
            <input
              type="range"
              min={70}
              max={200}
              step={10}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            />
          </label>

          <span className="ml-auto text-muted-foreground">{progress}%</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {bookLoaded && showToc && (
          <aside className="w-72 border-r border-border overflow-auto bg-card/50 shrink-0">
            <TocList
              items={toc}
              onSelect={(href) => {
                renditionRef.current?.display(href);
                setShowToc(false);
              }}
            />
          </aside>
        )}

        <div className="flex-1 relative">
          {/* Viewer is always mounted so epub.js has a container even before a book is opened */}
          <div ref={viewerRef} className="absolute inset-0" />

          {bookLoaded && (
            <>
              <button
                aria-label="Previous page"
                onClick={() => renditionRef.current?.prev()}
                className="absolute inset-y-0 left-0 w-1/6 flex items-center justify-start pl-2 opacity-0 hover:opacity-100 transition"
              >
                <ChevronLeft className="w-6 h-6 text-foreground/70" />
              </button>
              <button
                aria-label="Next page"
                onClick={() => renditionRef.current?.next()}
                className="absolute inset-y-0 right-0 w-1/6 flex items-center justify-end pr-2 opacity-0 hover:opacity-100 transition"
              >
                <ChevronRight className="w-6 h-6 text-foreground/70" />
              </button>
            </>
          )}

          {!bookLoaded && (
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-background">
              {loading ? (
                <p className="text-sm text-muted-foreground">Opening EPUB…</p>
              ) : (
                <div className="text-center max-w-md space-y-4">
                  <div className="text-5xl">📚</div>
                  <h2 className="text-2xl font-display font-bold">EPUB Reader</h2>
                  <p className="text-sm text-muted-foreground">
                    Open an EPUB file to read it in-browser with themes, fonts and a table of contents.
                  </p>
                  <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                    <Upload className="w-4 h-4" /> Choose EPUB file
                  </Button>
                  <p className="text-xs text-muted-foreground">…or drop a .epub anywhere on this window</p>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
              )}
            </div>
          )}

          {bookLoaded && error && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-destructive bg-card border border-border rounded px-3 py-1">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function findTocItem(items: NavItem[], href: string): NavItem | null {
  for (const it of items) {
    if (it.href && href.includes(it.href.split('#')[0])) return it;
    if (it.subitems?.length) {
      const s = findTocItem(it.subitems, href);
      if (s) return s;
    }
  }
  return null;
}

function TocList({ items, onSelect, depth = 0 }: { items: NavItem[]; onSelect: (href: string) => void; depth?: number }) {
  return (
    <ul className="py-2">
      {items.map((it, i) => (
        <li key={`${it.href || i}-${depth}`}>
          <button
            onClick={() => it.href && onSelect(it.href)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate"
            style={{ paddingLeft: 12 + depth * 12 }}
            title={it.label}
          >
            {it.label?.trim() || 'Untitled'}
          </button>
          {it.subitems?.length ? (
            <TocList items={it.subitems} onSelect={onSelect} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
