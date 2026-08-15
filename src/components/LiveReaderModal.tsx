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

  const rawNodes = Array.from(
    root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')
  );
  if (rawNodes.length === 0) {
    const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return [{ html: `<p>${text}</p>`, text }];
  }
  // Filter out parent container nodes that contain other matched block elements to prevent double reading
  const nodes = rawNodes.filter(
    (node) => !rawNodes.some((other) => other !== node && node.contains(other))
  );

  const seen = new Set<string>();
  const blocks: Paragraph[] = [];
  for (const el of nodes) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) continue;
    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ html: (el as HTMLElement).outerHTML, text });
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
    if (url) {
      setInputUrl(url);
      void loadBook(url);
    } else {
      setView('url');
    }
    return () => {
      window.removeEventListener('keydown', onKey);
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
            utt.onend = null;
            utt.onerror = null;
            if (!ttsActiveRef.current) return;
            pauseTimerRef.current = window.setTimeout(
              speakSentence,
              endsStrong ? 260 : 140
            );
          };
          utt.onerror = (e: SpeechSynthesisErrorEvent) => {
            utt.onend = null;
            utt.onerror = null;
            if (!ttsActiveRef.current) return;
            if (e.error === 'interrupted' || e.error === 'canceled') return;
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
      // Start from wherever the reader is currently looking, not chapter start.
      const start =
        ttsIndexRef.current >= 0 ? ttsIndexRef.current : findParagraphInView();
      speakFrom(start);
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
    const base = ttsIndexRef.current >= 0 ? ttsIndexRef.current : findParagraphInView();
    const target = Math.max(
      0,
      Math.min(paragraphsRef.current.length - 1, base + delta)
    );
    speakFrom(target);
  };

  // Apply voice changes immediately: cancel the current utterance so the
  // next sentence (started from onend) picks up the new voice via refs.
  // Rate/pitch changes only need the ref update — they apply on the next
  // sentence automatically without interrupting the current one.
  useEffect(() => {
    if (!supportsTTS || !ttsActiveRef.current) return;
    window.speechSynthesis.cancel();
    // speakSentence will be re-scheduled by the onend/onerror handler chain,
    // but cancel() suppresses those events on some engines — restart from
    // the current paragraph to be safe.
    const idx = ttsIndexRef.current >= 0 ? ttsIndexRef.current : 0;
    pauseTimerRef.current = window.setTimeout(() => speakFrom(idx), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceURI]);

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
        className="flex items-center justify-between px-4 py-2 border-b bg-card/80 backdrop-blur-md sticky top-0 z-50"
        style={{ borderColor: 'rgba(127,127,127,0.15)', background: themeVars.bg }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {view === 'reader' && (
            <Button variant="ghost" size="icon" onClick={() => { stopTTS(); setView('details'); }} className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {view === 'details' && (
            <Button variant="ghost" size="sm" onClick={() => setView('url')} className="gap-1.5 h-8">
              <ArrowLeft className="w-3.5 h-3.5" /> New URL
            </Button>
          )}
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 shrink-0">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold truncate">
                {view === 'reader' ? chapterTitle : book?.title || 'Live Reader'}
              </span>
              {view === 'reader' && (
                <span className="text-[10px] uppercase tracking-wider font-medium opacity-50">
                  Chapter {chapterIndex + 1} of {chapters.length}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {view === 'reader' && (
            <>
              <Button variant="ghost" size="icon" onClick={() => setShowToc((v) => !v)} title="Contents" className={`h-8 w-8 ${showToc ? 'text-primary bg-primary/10' : ''}`}>
                <List className="w-4 h-4" />
              </Button>
              {supportsTTS && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTtsOpen((v) => !v)}
                  title="Text to speech"
                  className={`h-8 w-8 ${ttsOpen ? 'text-primary bg-primary/10' : ''}`}
                >
                  <Volume2 className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setImmersive(true)}
                title="Immersive mode"
                className="h-8 w-8"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
            </>
          )}
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={onClose} title="Close" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      )}

      {/* Reader toolbar (themes / fonts / size / progress) */}
      {view === 'reader' && !immersive && (
        <div
          className="flex flex-wrap items-center gap-2 px-4 py-3 bg-secondary/30 border-b backdrop-blur-sm"
          style={{ borderColor: 'rgba(127,127,127,0.15)' }}
        >
          <div className="flex items-center gap-1 bg-background rounded-lg p-1 border">
            <Button size="sm" variant={theme === 'light' ? 'secondary' : 'ghost'} onClick={() => setTheme('light')} title="Light" className="h-8 w-8 p-0">
              <Sun className="w-4 h-4" />
            </Button>
            <Button size="sm" variant={theme === 'sepia' ? 'secondary' : 'ghost'} onClick={() => setTheme('sepia')} title="Sepia" className="h-8 w-8 p-0">
              <Coffee className="w-4 h-4" />
            </Button>
            <Button size="sm" variant={theme === 'dark' ? 'secondary' : 'ghost'} onClick={() => setTheme('dark')} title="Dark" className="h-8 w-8 p-0">
              <Moon className="w-4 h-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-border mx-1" />

          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="bg-background border rounded-md px-2 py-1 h-9 text-xs"
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 px-3 border rounded-md h-9 bg-background">
            <span className="text-[10px] uppercase font-bold text-muted-foreground">Size</span>
            <input
              type="range"
              min={14}
              max={28}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
              className="w-20"
            />
          </div>

          <label className="flex items-center gap-1.5 px-3 border rounded-md h-9 bg-background text-xs cursor-pointer hover:bg-secondary/50">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-primary"
            />
            Auto-advance
          </label>

          <span className="ml-auto text-xs font-mono font-bold text-muted-foreground tabular-nums px-2 py-1 bg-background rounded border">
            {progress}%
          </span>
        </div>
      )}

      {/* TTS Panel */}
      {view === 'reader' && ttsOpen && supportsTTS && !immersive && (
        <div
          className="border-b px-4 py-3 flex flex-wrap items-center gap-3 bg-primary/5 backdrop-blur-md"
          style={{ borderColor: themeVars.accent + '33' }}
        >
          <div className="flex items-center gap-1 bg-background rounded-lg border p-1">
            <Button size="sm" variant="ghost" onClick={() => skip(-1)} title="Previous paragraph" className="h-8 w-8 p-0">
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button size="sm" onClick={togglePlay} className="h-8 px-3 gap-1.5 shadow-sm">
              {ttsPlaying && !ttsPaused ? (
                <><Pause className="w-3.5 h-3.5 fill-current" /> Pause</>
              ) : (
                <><Play className="w-3.5 h-3.5 fill-current" /> {ttsPaused ? 'Resume' : 'Play'}</>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={stopTTS} title="Stop" className="h-8 w-8 p-0">
              <Square className="w-4 h-4 fill-current" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => skip(1)} title="Next paragraph" className="h-8 w-8 p-0">
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-border mx-1" />

          <select
            value={voiceURI}
            onChange={(e) => setVoiceURI(e.target.value)}
            className="bg-background border rounded-md px-2 py-1 h-9 text-[11px] max-w-[200px]"
          >
            {voices.length === 0 && <option value="">Default Voice</option>}
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 px-3 border rounded-md h-9 bg-background">
            <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">Speed {rate.toFixed(1)}x</span>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-16 sm:w-24"
            />
          </div>

          <div className="flex items-center gap-2 px-3 border rounded-md h-9 bg-background hidden sm:flex">
            <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">Pitch</span>
            <input
              type="range"
              min={0.5}
              max={1.6}
              step={0.05}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-16"
            />
          </div>

          {ttsIndex >= 0 && (
            <div className="ml-auto flex items-center gap-2 px-2 py-1 bg-primary/10 rounded-full border border-primary/20">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary tabular-nums">
                Para {ttsIndex + 1} / {paragraphs.length}
              </span>
            </div>
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
              className="max-w-3xl mx-auto px-6 py-12 md:py-20"
              style={readerStyle}
            >
              <h1 className="font-display text-3xl md:text-4xl font-bold mb-10 text-center md:text-left leading-tight" style={{ color: themeVars.accent }}>
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
                      onClick={(e) => {
                        if (!supportsTTS) return;
                        // Let real links navigate; jump TTS ONLY if TTS is already active/playing.
                        const target = e.target as HTMLElement;
                        if (target.closest('a')) return;
                        if (!ttsActiveRef.current) return;
                        speakFrom(i);
                      }}
                      className={`transition-colors rounded px-2 -mx-2 mb-3 ${
                        supportsTTS ? 'cursor-pointer' : ''
                      }`}
                      style={
                        i === ttsIndex
                          ? {
                              background: themeVars.accent + '15',
                              boxShadow: `-4px 0 0 ${themeVars.accent}`,
                              paddingLeft: 16,
                              borderRadius: '0 4px 4px 0',
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
                  className="gap-2 px-6 h-10 shadow-md font-bold uppercase tracking-wider text-xs"
                >
                  Next Chapter <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </article>
            <div className="h-20" /> {/* Extra spacing for better scrolling experience */}
          </div>
        </div>
      )}
    </div>
  );
}
