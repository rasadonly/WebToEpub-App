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
  Columns2,
  Square,
  ScrollText,
  Volume2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square as StopIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EpubReaderModalProps {
  open: boolean;
  onClose: () => void;
}

type Theme = 'light' | 'dark' | 'sepia';
type ViewMode = 'single' | 'double' | 'scroll';

const THEME_BG: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#0f0f0f',
  sepia: '#f4ecd8',
};

const THEMES: Record<Theme, Record<string, Record<string, string>>> = {
  light: {
    html: { background: '#ffffff' },
    body: { background: '#ffffff', color: '#111111' },
    a: { color: '#c62828' },
  },
  dark: {
    html: { background: '#0f0f0f' },
    body: { background: '#0f0f0f', color: '#e6e6e6' },
    a: { color: '#ff7676' },
  },
  sepia: {
    html: { background: '#f4ecd8' },
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

// ---------- TTS helpers (browser SpeechSynthesis; prefers Google voices) ----------
function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?…]+[.!?…]+["'”’)]?|\S[^.!?…]*$/g);
  return (parts || [cleaned]).map((s) => s.trim()).filter(Boolean);
}

function humanizeForSpeech(sentence: string): string {
  return sentence
    .replace(/—/g, ', ')
    .replace(/\s*[–-]\s+/g, ', ')
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .replace(/\.{3,}/g, '… ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

type TtsPara = { text: string; el: Element | null };

function extractParagraphsFromDoc(doc: Document | null | undefined): TtsPara[] {
  if (!doc) return [];
  const nodes = Array.from(
    doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')
  );
  const seen = new Set<string>();
  const out: TtsPara[] = [];
  for (const n of nodes) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2) continue;
    const key = t.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: t, el: n });
  }
  return out;
}

export function EpubReaderModal({ open, onClose }: EpubReaderModalProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentLocRef = useRef<string | null>(null);

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
  const [viewMode, setViewMode] = useState<ViewMode>('scroll');
  const [immersive, setImmersive] = useState(false);

  // --- TTS state ---
  const supportsTTS =
    typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [ttsOpen, setTtsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsIndex, setTtsIndex] = useState(-1);
  const [ttsTotal, setTtsTotal] = useState(0);
  const ttsActiveRef = useRef(false);
  const pauseTimerRef = useRef<number | null>(null);
  const ttsParaIdxRef = useRef(0);
  const ttsParasRef = useRef<TtsPara[]>([]);
  const ttsHighlightedRef = useRef<Element | null>(null);

  const clearPauseTimer = () => {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  };

  const clearHighlight = () => {
    if (ttsHighlightedRef.current) {
      ttsHighlightedRef.current.classList.remove('tts-current');
      ttsHighlightedRef.current = null;
    }
  };

  const highlightParagraph = (el: Element | null) => {
    clearHighlight();
    if (!el) return;
    el.classList.add('tts-current');
    ttsHighlightedRef.current = el;
  };

  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    clearPauseTimer();
    if (supportsTTS) window.speechSynthesis.cancel();
    clearHighlight();
    setTtsPlaying(false);
    setTtsPaused(false);
    setTtsIndex(-1);
  }, [supportsTTS]);

  // Load voices (prefer Google English)
  useEffect(() => {
    if (!supportsTTS) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      const ranked = [...list].sort((a, b) => {
        const score = (v: SpeechSynthesisVoice) =>
          (/google/i.test(v.name) ? 0 : 2) + (/^en/i.test(v.lang) ? 0 : 1);
        return score(a) - score(b);
      });
      setVoices(ranked);
      setVoiceURI((prev) => prev || ranked[0]?.voiceURI || '');
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supportsTTS]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      stopTTS();
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
  }, [open, onClose, stopTTS]);

  const applyTheme = useCallback(
    (r: Rendition, name: Theme, size: number, family: string) => {
      r.themes.register(name, THEMES[name]);
      r.themes.select(name);
      r.themes.fontSize(`${size}%`);
      const familyCss = FONTS.find((f) => f.id === family)?.css || FONTS[0].css;
      r.themes.override('font-family', familyCss, true);
      // Repaint live: overwrite any already-rendered iframe backgrounds so
      // toggling dark mode doesn't leave white gaps between chapters.
      const bg = THEME_BG[name];
      try {
        const contentsList: any[] = (r as any).getContents?.() || [];
        contentsList.forEach((c) => {
          try {
            if (c?.document?.documentElement) c.document.documentElement.style.background = bg;
            if (c?.document?.body) c.document.body.style.background = bg;
            const iframe = c?.window?.frameElement as HTMLIFrameElement | null;
            if (iframe) iframe.style.background = bg;
          } catch { /* noop */ }
        });
      } catch { /* noop */ }
    },
    []
  );

  const renderWithMode = useCallback(
    async (book: Book, mode: ViewMode, startHref?: string) => {
      if (!viewerRef.current) return;
      renditionRef.current?.destroy();
      viewerRef.current.innerHTML = '';

      const opts: any = {
        width: '100%',
        height: '100%',
        allowScriptedContent: false,
      };
      if (mode === 'scroll') {
        // Continuous manager auto-loads the next section as you scroll past
        // the current chapter's end — no manual "next chapter" tap needed.
        opts.flow = 'scrolled';
        opts.manager = 'continuous';
      } else {
        opts.flow = 'paginated';
        opts.manager = 'default';
        opts.spread = mode === 'double' ? 'always' : 'none';
      }

      const rendition = book.renderTo(viewerRef.current, opts);
      renditionRef.current = rendition;
      // Inject TTS highlight styling into every rendered section (iframe).
      rendition.hooks.content.register((contents: any) => {
        try {
          const doc: Document = contents.document;
          // Force theme background on html/body immediately to prevent
          // white flashes between chapter iframes in continuous scroll mode.
          const bg = THEME_BG[theme];
          if (doc.documentElement) doc.documentElement.style.background = bg;
          if (doc.body) doc.body.style.background = bg;
          try {
            const iframe = contents.window?.frameElement as HTMLIFrameElement | null;
            if (iframe) iframe.style.background = bg;
          } catch { /* noop */ }
          if (doc.getElementById('tts-highlight-style')) return;
          const style = doc.createElement('style');
          style.id = 'tts-highlight-style';
          style.textContent = `
            html, body { background: ${bg} !important; }
            .tts-current {
              background: rgba(239, 68, 68, 0.16) !important;
              box-shadow: -4px 0 0 rgba(239, 68, 68, 0.8) !important;
              padding-left: 8px !important;
              border-radius: 3px;
              transition: background 0.25s ease;
            }
          `;
          doc.head.appendChild(style);
        } catch { /* noop */ }
      });
      applyTheme(rendition, theme, fontSize, fontFamily);

      rendition.on('relocated', (loc: any) => {
        const pct = loc?.start?.percentage ?? 0;
        setProgress(Math.round(pct * 100));
        const href = loc?.start?.href;
        currentLocRef.current = href || null;
        const item = href ? findTocItem(toc, href) : null;
        setCurrentLabel(item?.label?.trim() || '');
      });
      rendition.on('keyup', (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight') rendition.next();
        if (e.key === 'ArrowLeft') rendition.prev();
      });

      await rendition.display(startHref || undefined);
    },
    [applyTheme, theme, fontSize, fontFamily, toc]
  );

  const openFile = useCallback(
    async (file: File | ArrayBuffer) => {
      setError(null);
      setLoading(true);
      try {
        stopTTS();
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

        for (let i = 0; i < 20 && !viewerRef.current; i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        if (!viewerRef.current) throw new Error('Viewer not ready');

        await renderWithMode(book, viewMode);
        setBookLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [renderWithMode, viewMode, stopTTS]
  );

  // Re-apply theme / font live
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, theme, fontSize, fontFamily);
  }, [theme, fontSize, fontFamily, applyTheme]);

  // Re-render when view mode changes
  useEffect(() => {
    if (!bookLoaded || !bookRef.current) return;
    void renderWithMode(bookRef.current, viewMode, currentLocRef.current || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

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

  // ---------- TTS engine ----------
  const collectCurrentParagraphs = useCallback((): TtsPara[] => {
    const r = renditionRef.current;
    if (!r) return [];
    const contents: any[] = (r as any).getContents?.() || [];
    const paras: TtsPara[] = [];
    for (const c of contents) {
      const doc: Document | undefined = c?.document;
      paras.push(...extractParagraphsFromDoc(doc));
    }
    return paras;
  }, []);

  const speakLoop = useCallback(() => {
    if (!ttsActiveRef.current || !supportsTTS) return;
    const paras = ttsParasRef.current;
    const idx = ttsParaIdxRef.current;

    if (idx >= paras.length) {
      // Try refreshing first — in continuous scroll mode, new sections may
      // have already been auto-loaded into the DOM as we scrolled paragraphs
      // into view. If that gives us more text, keep going without a page turn.
      const refreshed = collectCurrentParagraphs();
      if (refreshed.length > paras.length) {
        ttsParasRef.current = refreshed;
        speakLoop();
        return;
      }
      const r = renditionRef.current;
      if (!r) {
        stopTTS();
        return;
      }
      pauseTimerRef.current = window.setTimeout(async () => {
        if (!ttsActiveRef.current) return;
        try {
          await r.next();
        } catch {
          stopTTS();
          return;
        }
        pauseTimerRef.current = window.setTimeout(() => {
          if (!ttsActiveRef.current) return;
          const fresh = collectCurrentParagraphs();
          if (
            !fresh.length ||
            (fresh.length === paras.length && fresh[0]?.text === paras[0]?.text)
          ) {
            stopTTS();
            return;
          }
          ttsParasRef.current = fresh;
          ttsParaIdxRef.current = 0;
          speakLoop();
        }, 350);
      }, 300);
      return;
    }

    // Highlight + scroll current paragraph into view. Scrolling also nudges
    // epub.js's continuous manager to auto-load the next section as needed.
    setTtsIndex(idx);
    setTtsTotal(paras.length);
    highlightParagraph(paras[idx].el);
    try {
      paras[idx].el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      /* noop */
    }

    const chosenVoice =
      voices.find((v) => v.voiceURI === voiceURI) || voices[0] || null;
    const sentences = splitSentences(paras[idx].text);
    if (!sentences.length) {
      ttsParaIdxRef.current = idx + 1;
      speakLoop();
      return;
    }

    let sIndex = 0;
    const speakSentence = () => {
      if (!ttsActiveRef.current) return;
      if (sIndex >= sentences.length) {
        ttsParaIdxRef.current = idx + 1;
        pauseTimerRef.current = window.setTimeout(speakLoop, 420);
        return;
      }
      const raw = sentences[sIndex++];
      const text = humanizeForSpeech(raw);
      const utt = new SpeechSynthesisUtterance(text);
      if (chosenVoice) {
        utt.voice = chosenVoice;
        utt.lang = chosenVoice.lang;
      }
      const jitter = (Math.random() - 0.5) * 0.08;
      const rateJit = (Math.random() - 0.5) * 0.06;
      utt.pitch = Math.max(0, Math.min(2, pitch + jitter));
      utt.rate = Math.max(0.5, Math.min(2, rate + rateJit));
      utt.volume = 1;
      const endsStrong = /[.!?…]["'”’)]?$/.test(raw);
      utt.onend = () => {
        if (!ttsActiveRef.current) return;
        pauseTimerRef.current = window.setTimeout(
          speakSentence,
          endsStrong ? 260 : 140
        );
      };
      utt.onerror = () => {
        if (!ttsActiveRef.current) return;
        pauseTimerRef.current = window.setTimeout(speakSentence, 60);
      };
      window.speechSynthesis.speak(utt);
    };
    speakSentence();
  }, [supportsTTS, voices, voiceURI, rate, pitch, collectCurrentParagraphs, stopTTS]);

  const findViewportParagraphIndex = useCallback((paras: TtsPara[]): number => {
    // Look for the paragraph closest to the top-third of the viewport,
    // accounting for the fact that each paragraph lives inside an epub.js
    // iframe (so its rect is iframe-local — we add the iframe's own rect top).
    const anchorY = window.innerHeight * 0.25;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < paras.length; i++) {
      const el = paras[i].el as HTMLElement | null;
      if (!el) continue;
      try {
        const doc = el.ownerDocument;
        const iframe = doc?.defaultView?.frameElement as HTMLIFrameElement | null;
        const iframeTop = iframe?.getBoundingClientRect().top ?? 0;
        const r = el.getBoundingClientRect();
        const top = r.top + iframeTop;
        const bottom = r.bottom + iframeTop;
        if (bottom < 0) continue; // above viewport
        if (top > window.innerHeight) break; // below viewport, list is DOM-ordered
        const dist = Math.abs(top - anchorY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      } catch { /* noop */ }
    }
    return bestIdx;
  }, []);

  const startTTS = useCallback((fromIndex?: number) => {
    if (!supportsTTS) return;
    clearPauseTimer();
    window.speechSynthesis.cancel();
    const paras = collectCurrentParagraphs();
    if (!paras.length) {
      setError('No readable text on this page');
      return;
    }
    ttsParasRef.current = paras;
    const startIdx =
      typeof fromIndex === 'number'
        ? Math.max(0, Math.min(paras.length - 1, fromIndex))
        : findViewportParagraphIndex(paras);
    ttsParaIdxRef.current = startIdx;
    ttsActiveRef.current = true;
    setTtsPlaying(true);
    setTtsPaused(false);
    speakLoop();
  }, [supportsTTS, collectCurrentParagraphs, speakLoop, findViewportParagraphIndex]);

  // Jump TTS to a specific paragraph element (used when user clicks a paragraph).
  const jumpToParagraph = useCallback((el: Element) => {
    const paras = collectCurrentParagraphs();
    if (!paras.length) return;
    const idx = paras.findIndex((p) => p.el === el);
    if (idx < 0) return;
    ttsParasRef.current = paras;
    ttsParaIdxRef.current = idx;
    clearPauseTimer();
    window.speechSynthesis.cancel();
    ttsActiveRef.current = true;
    setTtsPlaying(true);
    setTtsPaused(false);
    speakLoop();
  }, [collectCurrentParagraphs, speakLoop]);

  const togglePlay = () => {
    if (!supportsTTS) return;
    if (!ttsPlaying) {
      startTTS();
      return;
    }
    if (ttsPaused) {
      window.speechSynthesis.resume();
      setTtsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setTtsPaused(true);
    }
  };

  const skipParagraph = (delta: number) => {
    if (!ttsActiveRef.current) {
      // Prime + start, then jump
      const paras = collectCurrentParagraphs();
      if (!paras.length) return;
      ttsParasRef.current = paras;
      ttsParaIdxRef.current = Math.max(0, Math.min(paras.length - 1, delta > 0 ? delta : 0));
      ttsActiveRef.current = true;
      setTtsPlaying(true);
      setTtsPaused(false);
      window.speechSynthesis.cancel();
      speakLoop();
      return;
    }
    clearPauseTimer();
    window.speechSynthesis.cancel();
    ttsParaIdxRef.current = Math.max(
      0,
      Math.min(ttsParasRef.current.length - 1, ttsParaIdxRef.current + delta)
    );
    speakLoop();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col animate-in fade-in duration-200 pointer-events-auto"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Header */}
      {!immersive && (
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
          {bookLoaded && supportsTTS && (
            <Button
              variant={ttsOpen ? 'default' : 'ghost'}
              size="sm"
              onClick={() => {
                setTtsOpen((v) => {
                  const next = !v;
                  // Read-aloud only makes sense in continuous scroll.
                  if (next && viewMode !== 'scroll') setViewMode('scroll');
                  return next;
                });
              }}
              title="Text-to-speech (scroll mode)"
            >
              <Volume2 className="w-4 h-4" />
            </Button>
          )}
          {bookLoaded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setImmersive(true)}
              title="Immersive mode"
            >
              <Maximize2 className="w-4 h-4" />
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
      )}

      {/* Toolbar */}
      {bookLoaded && !immersive && (
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

          {/* View mode */}
          <div className="flex items-center gap-1 border-l border-border pl-3">
            <Button
              size="sm"
              variant={viewMode === 'single' ? 'default' : 'outline'}
              onClick={() => setViewMode('single')}
              title="Single page"
            >
              <Square className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'double' ? 'default' : 'outline'}
              onClick={() => setViewMode('double')}
              title="Two pages"
            >
              <Columns2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'scroll' ? 'default' : 'outline'}
              onClick={() => setViewMode('scroll')}
              title="Scroll mode"
            >
              <ScrollText className="w-3.5 h-3.5" />
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

      {/* TTS panel */}
      {bookLoaded && ttsOpen && supportsTTS && !immersive && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-card/40 text-xs">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => skipParagraph(-1)} title="Previous paragraph">
              <SkipBack className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={togglePlay} className="gap-1" title={ttsPlaying && !ttsPaused ? 'Pause' : 'Play'}>
              {ttsPlaying && !ttsPaused ? (
                <><Pause className="w-3.5 h-3.5" /> Pause</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> {ttsPaused ? 'Resume' : 'Play'}</>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={stopTTS} title="Stop">
              <StopIcon className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => skipParagraph(1)} title="Next paragraph">
              <SkipForward className="w-3.5 h-3.5" />
            </Button>
            {ttsIndex >= 0 && ttsTotal > 0 && (
              <span className="ml-2 text-muted-foreground tabular-nums">
                ¶ {ttsIndex + 1} / {ttsTotal}
              </span>
            )}
          </div>

          <label className="flex items-center gap-1">
            Voice
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 max-w-[220px]"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Speed {rate.toFixed(2)}
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
          </label>

          <label className="flex items-center gap-2">
            Pitch {pitch.toFixed(2)}
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
            />
          </label>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {bookLoaded && showToc && (
          <>
            <div
              className="sm:hidden fixed inset-0 bg-black/40 z-20"
              onClick={() => setShowToc(false)}
            />
            <aside className="absolute sm:relative top-0 left-0 h-full w-72 max-w-[85vw] border-r border-border overflow-auto bg-card z-30 sm:z-auto shrink-0">
              <TocList
                items={toc}
                onSelect={async (href) => {
                  const r = renditionRef.current;
                  const b = bookRef.current;
                  if (!r || !b) return;
                  setShowToc(false);
                  // Resolve TOC href against the book spine — epub.js TOC hrefs
                  // are relative to the nav document, but display() needs a
                  // spine-relative href, otherwise the jump silently no-ops
                  // (especially in continuous scroll mode).
                  let target: string = href;
                  try {
                    const spineItem =
                      (b.spine as any).get(href) ||
                      (b.spine as any).get(href.split('#')[0]);
                    if (spineItem?.href) {
                      const hash = href.includes('#') ? '#' + href.split('#')[1] : '';
                      target = spineItem.href + hash;
                    }
                  } catch { /* noop */ }
                  try {
                    await r.display(target);
                  } catch {
                    try { await r.display(href); } catch { /* noop */ }
                  }
                }}
              />
            </aside>
          </>
        )}

        <div className="flex-1 relative">
          {/* Viewer is always mounted so epub.js has a container even before a book is opened */}
          <div ref={viewerRef} className="absolute inset-0" style={{ background: THEME_BG[theme] }} />

          {bookLoaded && immersive && (
            <button
              onClick={() => setImmersive(false)}
              title="Exit immersive"
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-card/70 backdrop-blur border border-border hover:bg-card transition opacity-40 hover:opacity-100"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}


          {bookLoaded && viewMode !== 'scroll' && (
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
                    Open an EPUB file to read it in-browser with themes, fonts, view modes and read-aloud.
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
