import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Loader2,
  List,
  Volume2,
  Play,
  Pause,
  Square,
  SkipForward,
  SkipBack,
  Sun,
  Moon,
  Coffee,
  Type as TypeIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  engineFetchToc,
  engineFetchChapter,
  engineGetBookInfo,
  type EngineChapter,
  type EngineBookInfo,
} from '@/utils/webtoepub/bridge';

interface LiveReaderModalProps {
  url?: string;
  open: boolean;
  onClose: () => void;
}

type View = 'url' | 'loading' | 'details' | 'reader';
type Theme = 'light' | 'dark' | 'sepia';

interface Paragraph {
  html: string;
  text: string;
}

const THEMES: Record<Theme, { bg: string; fg: string; muted: string; accent: string }> = {
  light: { bg: '#ffffff', fg: '#111111', muted: '#666', accent: '#c62828' },
  dark:  { bg: '#0f0f0f', fg: '#e6e6e6', muted: '#9aa', accent: '#ff7676' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', muted: '#7a6a4d', accent: '#8a3b1e' },
};

const FONTS = [
  { id: 'serif',  label: 'Serif',  css: 'Georgia, "Times New Roman", serif' },
  { id: 'sans',   label: 'Sans',   css: 'Inter, system-ui, sans-serif' },
  { id: 'mono',   label: 'Mono',   css: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { id: 'reader', label: 'Reader', css: 'Merriweather, Georgia, serif' },
];

/** Split chapter HTML into speakable paragraphs, preserving inline formatting. */
function extractParagraphs(html: string): Paragraph[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return [];
  const blocks: Paragraph[] = [];
  const pick = (el: Element) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    blocks.push({ html: (el as HTMLElement).outerHTML, text });
  };
  const children = Array.from(root.children);
  if (children.length === 0) {
    const text = (root.textContent || '').trim();
    if (text) blocks.push({ html: `<p>${text}</p>`, text });
    return blocks;
  }
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const inner = extractParagraphs(child.innerHTML);
      if (inner.length) blocks.push(...inner);
      else pick(child);
    } else {
      pick(child);
    }
  }
  return blocks;
}

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

export function LiveReaderModal({ url, open, onClose }: LiveReaderModalProps) {
  const [view, setView] = useState<View>('url');
  const [inputUrl, setInputUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<EngineBookInfo | null>(null);
  const [chapters, setChapters] = useState<EngineChapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterHtml, setChapterHtml] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [loadingChapter, setLoadingChapter] = useState(false);

  // Reader preferences (mirror EpubReaderModal)
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState('reader');
  const [theme, setTheme] = useState<Theme>('dark');
  const [immersive, setImmersive] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [progress, setProgress] = useState(0);

  const [showToc, setShowToc] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const chapterIndexRef = useRef(0);
  chapterIndexRef.current = chapterIndex;
  const loadingChapterRef = useRef(false);
  loadingChapterRef.current = loadingChapter;

  // TTS state — browser SpeechSynthesis (free, uses Google voices on Chrome)
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
  const ttsIndexRef = useRef(-1);
  const ttsActiveRef = useRef(false);
  const pauseTimerRef = useRef<number | null>(null);
  // Live-tunable refs so voice/speed/pitch changes take effect on the NEXT
  // sentence utterance without restarting playback.
  const rateRef = useRef(rate);
  const pitchRef = useRef(pitch);
  const voiceURIRef = useRef(voiceURI);
  rateRef.current = rate;
  pitchRef.current = pitch;
  voiceURIRef.current = voiceURI;

  /** Find the paragraph index closest to the current viewport center. */
  const findParagraphInView = useCallback((): number => {
    const vp = viewportRef.current;
    if (!vp) return 0;
    const vpRect = vp.getBoundingClientRect();
    const target = vpRect.top + vpRect.height * 0.25;
    const nodes = vp.querySelectorAll<HTMLElement>('[data-tts-idx]');
    let bestIdx = 0;
    let bestDist = Infinity;
    nodes.forEach((n) => {
      const r = n.getBoundingClientRect();
      // Prefer paragraphs whose top is at or just above the reading line.
      const dist = Math.abs(r.top - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = parseInt(n.dataset.ttsIdx || '0', 10);
      }
    });
    return bestIdx;
  }, []);

  const paragraphs = useMemo(() => extractParagraphs(chapterHtml), [chapterHtml]);
  const paragraphsRef = useRef<Paragraph[]>([]);
  paragraphsRef.current = paragraphs;

  const themeVars = THEMES[theme];
  const fontCss = FONTS.find((f) => f.id === fontFamily)?.css || FONTS[0].css;

  // Load available voices; prefer Google English voices which sound most human.
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

  const clearPauseTimer = () => {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  };

  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    clearPauseTimer();
    if (supportsTTS) window.speechSynthesis.cancel();
    setTtsPlaying(false);
    setTtsPaused(false);
    setTtsIndex(-1);
    ttsIndexRef.current = -1;
  }, [supportsTTS]);

  // Reset when re-opened
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (immersive) setImmersive(false);
        else onClose();
      } else if (view === 'reader' && e.key === 'ArrowRight') openChapter(chapterIndexRef.current + 1);
      else if (view === 'reader' && e.key === 'ArrowLeft') openChapter(chapterIndexRef.current - 1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    if (url) {
      setInputUrl(url);
      void loadBook(url);
    } else {
      setView('url');
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (supportsTTS) window.speechSynthesis.cancel();
      clearPauseTimer();
      ttsActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url]);

  async function loadBook(target: string) {
    setError(null);
    setView('loading');
    setStatus('Loading novel page…');
    try {
      const toc = await engineFetchToc(target);
      setStatus('Reading metadata…');
      const info = await engineGetBookInfo();
      setChapters(toc);
      setBook(info);
      setView('details');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView('url');
    }
  }

  async function openChapter(index: number) {
    if (index < 0 || index >= chapters.length) return;
    stopTTS();
    setChapterIndex(index);
    setView('reader');
    setLoadingChapter(true);
    setChapterHtml('');
    setChapterTitle(chapters[index].title);
    setShowToc(false);
    setProgress(0);
    try {
      const c = await engineFetchChapter(chapters[index].url, chapters[index].title);
      setChapterHtml(c.html);
      setChapterTitle(c.title || chapters[index].title);
      viewportRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setChapterHtml(
        `<p style="color:#f87171">Failed to load chapter: ${
          e instanceof Error ? e.message : String(e)
        }</p>`
      );
    } finally {
      setLoadingChapter(false);
    }
  }

  // Track scroll progress + auto-advance to next chapter when reaching the bottom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || view !== 'reader') return;
    let advancing = false;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0;
      setProgress(Math.round(pct));
      if (
        autoAdvance &&
        !advancing &&
        !loadingChapterRef.current &&
        pct >= 98 &&
        chapterIndexRef.current < chapters.length - 1
      ) {
        advancing = true;
        void openChapter(chapterIndexRef.current + 1);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, chapters.length, autoAdvance, chapterHtml]);

  const speakFrom = useCallback(
    (startIndex: number) => {
      if (!supportsTTS) return;
      const list = paragraphsRef.current;
      if (!list.length) return;

      clearPauseTimer();
      window.speechSynthesis.cancel();
      ttsActiveRef.current = true;
      setTtsPlaying(true);
      setTtsPaused(false);

      const pickVoice = () =>
        voices.find((v) => v.voiceURI === voiceURIRef.current) || voices[0] || null;

      const speakParagraph = (pIndex: number) => {
        if (!ttsActiveRef.current) return;
        if (pIndex >= list.length) {
          ttsActiveRef.current = false;
          setTtsPlaying(false);
          setTtsIndex(-1);
          ttsIndexRef.current = -1;
          if (chapterIndex < chapters.length - 1) {
            void openChapter(chapterIndex + 1).then(() => {
              pauseTimerRef.current = window.setTimeout(() => speakFrom(0), 500);
            });
          }
          return;
        }

        setTtsIndex(pIndex);
        ttsIndexRef.current = pIndex;
        const el = viewportRef.current?.querySelector(`[data-tts-idx="${pIndex}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const sentences = splitSentences(list[pIndex].text);
        if (!sentences.length) {
          speakParagraph(pIndex + 1);
          return;
        }

        let sIndex = 0;
        const speakSentence = () => {
          if (!ttsActiveRef.current) return;
          if (sIndex >= sentences.length) {
            pauseTimerRef.current = window.setTimeout(
              () => speakParagraph(pIndex + 1),
              420
            );
            return;
          }
          const raw = sentences[sIndex++];
          const text = humanizeForSpeech(raw);
          const utt = new SpeechSynthesisUtterance(text);
          const chosenVoice = pickVoice();
          if (chosenVoice) {
            utt.voice = chosenVoice;
            utt.lang = chosenVoice.lang;
          }
          // Read from live refs so slider changes apply on the next sentence.
          const currentPitch = pitchRef.current;
          const currentRate = rateRef.current;
          const jitter = (Math.random() - 0.5) * 0.08;
          const rateJit = (Math.random() - 0.5) * 0.06;
          utt.pitch = Math.max(0, Math.min(2, currentPitch + jitter));
          utt.rate = Math.max(0.5, Math.min(2, currentRate + rateJit));
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
      };

      speakParagraph(Math.max(0, Math.min(startIndex, list.length - 1)));
    },
    [supportsTTS, voices, chapterIndex, chapters.length] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const togglePlay = () => {
    if (!supportsTTS) return;
    if (!ttsPlaying) {
      speakFrom(ttsIndexRef.current >= 0 ? ttsIndexRef.current : 0);
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

  const skip = (delta: number) => {
    if (!paragraphsRef.current.length) return;
    const target = Math.max(
      0,
      Math.min(
        paragraphsRef.current.length - 1,
        (ttsIndexRef.current >= 0 ? ttsIndexRef.current : 0) + delta
      )
    );
    speakFrom(target);
  };

  // Stop TTS when modal closes
  useEffect(() => {
    if (!open) stopTTS();
  }, [open, stopTTS]);

  const readerStyle = useMemo(
    () => ({
      fontSize: `${fontSize}px`,
      lineHeight: 1.75,
      fontFamily: fontCss,
      color: themeVars.fg,
    }),
    [fontSize, fontCss, themeVars.fg]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col animate-in fade-in duration-200"
      style={{ background: themeVars.bg, color: themeVars.fg }}
    >
      {/* Header */}
      {!immersive && (
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'rgba(127,127,127,0.25)', background: themeVars.bg }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {view === 'reader' && (
            <Button variant="ghost" size="sm" onClick={() => { stopTTS(); setView('details'); }} className="gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          )}
          {view === 'details' && (
            <Button variant="ghost" size="sm" onClick={() => setView('url')} className="gap-1">
              <ArrowLeft className="w-4 h-4" /> New URL
            </Button>
          )}
          <BookOpen className="w-4 h-4" style={{ color: themeVars.accent }} />
          <span className="text-sm font-semibold truncate">
            {view === 'reader' ? chapterTitle : book?.title || 'Live Reader'}
          </span>
          {view === 'reader' && (
            <span className="text-xs opacity-60 hidden sm:inline">
              · {chapterIndex + 1}/{chapters.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {view === 'reader' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowToc((v) => !v)} title="Contents">
                <List className="w-4 h-4" />
              </Button>
              {supportsTTS && (
                <Button
                  variant={ttsOpen ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTtsOpen((v) => !v)}
                  title="Text to speech"
                >
                  <Volume2 className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImmersive(true)}
                title="Immersive mode"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      )}

      {/* Reader toolbar (themes / fonts / size / progress) */}
      {view === 'reader' && !immersive && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-2 border-b text-xs"
          style={{ borderColor: 'rgba(127,127,127,0.25)' }}
        >
          <div className="flex items-center gap-1">
            <Button size="sm" variant={theme === 'light' ? 'default' : 'outline'} onClick={() => setTheme('light')} title="Light">
              <Sun className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant={theme === 'sepia' ? 'default' : 'outline'} onClick={() => setTheme('sepia')} title="Sepia">
              <Coffee className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => setTheme('dark')} title="Dark">
              <Moon className="w-3.5 h-3.5" />
            </Button>
          </div>

          <label className="flex items-center gap-1">
            <TypeIcon className="w-3.5 h-3.5" />
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="bg-transparent border rounded px-2 py-1"
              style={{ borderColor: 'rgba(127,127,127,0.4)' }}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Size {fontSize}
            <input
              type="range"
              min={12}
              max={32}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            />
          </label>

          <label className="flex items-center gap-1 select-none">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
            />
            Auto-advance
          </label>

          <span className="ml-auto opacity-70 tabular-nums">{progress}%</span>
        </div>
      )}

      {/* TTS Panel */}
      {view === 'reader' && ttsOpen && supportsTTS && !immersive && (
        <div
          className="border-b px-4 py-3 flex flex-wrap items-center gap-3"
          style={{ borderColor: 'rgba(127,127,127,0.25)' }}
        >
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => skip(-1)} title="Previous paragraph">
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={togglePlay} className="gap-1">
              {ttsPlaying && !ttsPaused ? (
                <><Pause className="w-4 h-4" /> Pause</>
              ) : (
                <><Play className="w-4 h-4" /> {ttsPaused ? 'Resume' : 'Play'}</>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={stopTTS} title="Stop">
              <Square className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => skip(1)} title="Next paragraph">
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <label className="flex items-center gap-2 text-xs">
            Voice
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
              className="bg-transparent border rounded px-2 py-1 text-xs max-w-[260px]"
              style={{ borderColor: 'rgba(127,127,127,0.4)' }}
            >
              {voices.length === 0 && <option value="">Default</option>}
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs">
            Speed {rate.toFixed(2)}x
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
          </label>

          <label className="flex items-center gap-2 text-xs">
            Pitch {pitch.toFixed(2)}
            <input
              type="range"
              min={0.5}
              max={1.6}
              step={0.05}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
            />
          </label>

          {ttsIndex >= 0 && (
            <span className="text-xs opacity-70 ml-auto">
              ¶ {ttsIndex + 1} / {paragraphs.length}
            </span>
          )}
        </div>
      )}

      {/* URL view */}
      {view === 'url' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="text-center space-y-2">
            <div className="text-4xl">📖</div>
            <h1 className="text-2xl font-display font-bold">Live Reader</h1>
            <p className="text-sm opacity-70 max-w-md">
              Read any supported web novel directly here. Paste a novel URL to begin.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputUrl.trim()) void loadBook(inputUrl.trim());
            }}
            className="w-full max-w-xl flex gap-2"
          >
            <Input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://novelfull.com/some-novel.html"
              autoFocus
            />
            <Button type="submit" disabled={!inputUrl.trim()}>
              Read
            </Button>
          </form>
          {error && <p className="text-sm text-destructive max-w-xl text-center">{error}</p>}
        </div>
      )}

      {/* Loading view */}
      {view === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: themeVars.accent }} />
          <p className="text-sm opacity-70">{status}</p>
        </div>
      )}

      {/* Details view */}
      {view === 'details' && book && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto p-6 grid md:grid-cols-[220px_1fr] gap-6">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="w-full rounded-lg shadow-card object-cover bg-muted"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div className="w-full aspect-[2/3] rounded-lg bg-muted flex items-center justify-center opacity-60">
                <BookOpen className="w-10 h-10" />
              </div>
            )}
            <div className="space-y-3 min-w-0">
              <h2 className="text-2xl font-display font-bold break-words">{book.title || 'Untitled'}</h2>
              {book.author && <p className="text-sm opacity-70">by {book.author}</p>}
              {book.description && (
                <p className="text-sm opacity-90 whitespace-pre-line line-clamp-[12]">
                  {book.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => openChapter(0)} disabled={!chapters.length} className="gap-2">
                  <BookOpen className="w-4 h-4" /> Start reading
                </Button>
                <span className="text-sm opacity-70 self-center">
                  {chapters.length} chapters
                </span>
              </div>
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-6 pb-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider opacity-70 mb-2">
              Chapters
            </h3>
            <div className="border rounded-lg divide-y" style={{ borderColor: 'rgba(127,127,127,0.25)' }}>
              {chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => openChapter(i)}
                  className="w-full text-left px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xs opacity-60 w-10 tabular-nums">{i + 1}</span>
                  <span className="text-sm truncate">{ch.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reader view */}
      {view === 'reader' && (
        <div className="flex-1 flex overflow-hidden relative">
          {showToc && (
            <>
              <div
                className="sm:hidden fixed inset-0 bg-black/40 z-20"
                onClick={() => setShowToc(false)}
              />
              <aside
                className="absolute sm:relative top-0 left-0 h-full w-72 max-w-[85vw] border-r overflow-auto z-30 sm:z-auto shrink-0"
                style={{ borderColor: 'rgba(127,127,127,0.25)', background: themeVars.bg }}
              >
                {chapters.map((ch, i) => (
                  <button
                    key={ch.id}
                    onClick={() => openChapter(i)}
                    className={`w-full text-left px-3 py-2 text-sm truncate hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                      i === chapterIndex ? 'font-medium' : ''
                    }`}
                    style={i === chapterIndex ? { color: themeVars.accent } : undefined}
                  >
                    {i + 1}. {ch.title}
                  </button>
                ))}
              </aside>
            </>
          )}
          <div ref={viewportRef} className="flex-1 overflow-auto relative">
            {immersive && (
              <button
                onClick={() => setImmersive(false)}
                title="Exit immersive"
                className="fixed top-3 right-3 z-30 p-2 rounded-full border backdrop-blur transition opacity-40 hover:opacity-100"
                style={{ borderColor: 'rgba(127,127,127,0.3)', background: 'rgba(127,127,127,0.15)' }}
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <article
              className="max-w-2xl mx-auto px-6 py-10"
              style={readerStyle}
            >
              <h1 className="font-display text-2xl mb-6" style={{ color: themeVars.accent }}>
                {chapterTitle}
              </h1>
              {loadingChapter ? (
                <div className="flex items-center gap-2 opacity-70">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading chapter…
                </div>
              ) : paragraphs.length > 0 ? (
                <div>
                  {paragraphs.map((p, i) => (
                    <div
                      key={i}
                      data-tts-idx={i}
                      onClick={() => supportsTTS && ttsOpen && speakFrom(i)}
                      className={`transition-colors rounded px-2 -mx-2 mb-3 ${
                        supportsTTS && ttsOpen ? 'cursor-pointer' : ''
                      }`}
                      style={
                        i === ttsIndex
                          ? {
                              background:
                                theme === 'light'
                                  ? 'rgba(239, 68, 68, 0.12)'
                                  : 'rgba(239, 68, 68, 0.18)',
                              boxShadow: `-4px 0 0 ${themeVars.accent}`,
                              paddingLeft: 12,
                            }
                          : undefined
                      }
                      dangerouslySetInnerHTML={{ __html: p.html }}
                    />
                  ))}
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: chapterHtml }} />
              )}
              <div
                className="flex justify-between items-center mt-10 pt-6 border-t"
                style={{ borderColor: 'rgba(127,127,127,0.25)' }}
              >
                <Button
                  variant="outline"
                  onClick={() => openChapter(chapterIndex - 1)}
                  disabled={chapterIndex === 0 || loadingChapter}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>
                <span className="text-xs opacity-70">
                  {chapterIndex + 1} / {chapters.length}
                </span>
                <Button
                  onClick={() => openChapter(chapterIndex + 1)}
                  disabled={chapterIndex >= chapters.length - 1 || loadingChapter}
                  className="gap-1"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}
