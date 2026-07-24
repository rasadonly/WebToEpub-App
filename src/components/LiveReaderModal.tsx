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

const TTS_VOICES = [
  { id: 'alloy', label: 'Alloy — neutral' },
  { id: 'ash', label: 'Ash — warm male' },
  { id: 'ballad', label: 'Ballad — expressive' },
  { id: 'coral', label: 'Coral — bright female' },
  { id: 'echo', label: 'Echo — calm male' },
  { id: 'fable', label: 'Fable — storyteller' },
  { id: 'nova', label: 'Nova — energetic female' },
  { id: 'onyx', label: 'Onyx — deep male' },
  { id: 'sage', label: 'Sage — soft female' },
  { id: 'shimmer', label: 'Shimmer — smooth female' },
];

const TTS_TONES = [
  { id: 'natural', label: 'Natural narrator', prompt: 'Read in a warm, natural human narrator voice with gentle expression and lifelike pacing. Honor punctuation. Never robotic or monotone.' },
  { id: 'dramatic', label: 'Dramatic', prompt: 'Read with cinematic drama and rich emotion, varying pitch and pace to bring scenes to life. Pause for impact.' },
  { id: 'calm', label: 'Calm bedtime', prompt: 'Read slowly, softly, and soothingly, as if telling a bedtime story. Gentle warmth, quiet pauses.' },
  { id: 'cheerful', label: 'Cheerful', prompt: 'Read in a bright, friendly, upbeat tone with a smile in the voice.' },
  { id: 'serious', label: 'Serious news', prompt: 'Read in a clear, composed, professional tone like a seasoned news anchor.' },
];

async function fetchTtsBlob(text: string, voice: string, instructions: string, speed: number, signal: AbortSignal): Promise<Blob> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ text, voice, instructions, speed }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.blob();
}

interface LiveReaderModalProps {
  url?: string;
  open: boolean;
  onClose: () => void;
}

type View = 'url' | 'loading' | 'details' | 'reader';

interface Paragraph {
  html: string;
  text: string;
}

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
  const [fontSize, setFontSize] = useState(18);
  const [showToc, setShowToc] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  // TTS state (Lovable AI, human-sounding)
  const supportsTTS = typeof window !== 'undefined' && typeof Audio !== 'undefined';
  const [ttsOpen, setTtsOpen] = useState(false);
  const [voice, setVoice] = useState<string>('alloy');
  const [tone, setTone] = useState<string>('natural');
  const [rate, setRate] = useState(1);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsIndex, setTtsIndex] = useState(-1);
  const ttsIndexRef = useRef(-1);
  const ttsActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchRef = useRef<{ index: number; blob: Promise<Blob> } | null>(null);

  const paragraphs = useMemo(() => extractParagraphs(chapterHtml), [chapterHtml]);
  const paragraphsRef = useRef<Paragraph[]>([]);
  paragraphsRef.current = paragraphs;

  const releaseAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  const stopTTS = useCallback(() => {
    ttsActiveRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    prefetchRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    releaseAudioUrl();
    setTtsPlaying(false);
    setTtsPaused(false);
    setTtsLoading(false);
    setTtsIndex(-1);
    ttsIndexRef.current = -1;
  }, []);

  // Reset when re-opened
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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

  const speakFrom = useCallback(
    (startIndex: number) => {
      const list = paragraphsRef.current;
      if (!list.length) return;
      // Reset any prior playback
      abortRef.current?.abort();
      abortRef.current = null;
      prefetchRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      releaseAudioUrl();

      ttsActiveRef.current = true;
      setTtsPlaying(true);
      setTtsPaused(false);

      const currentInstructions = TTS_TONES.find((t) => t.id === tone)?.prompt ?? TTS_TONES[0].prompt;

      const requestBlob = (i: number, ctrl: AbortController) =>
        fetchTtsBlob(list[i].text, voice, currentInstructions, rate, ctrl.signal);

      const playAt = async (i: number) => {
        if (!ttsActiveRef.current) return;
        if (i >= list.length) {
          ttsActiveRef.current = false;
          setTtsPlaying(false);
          setTtsIndex(-1);
          ttsIndexRef.current = -1;
          if (chapterIndex < chapters.length - 1) {
            void openChapter(chapterIndex + 1).then(() => {
              setTimeout(() => speakFrom(0), 400);
            });
          }
          return;
        }

        setTtsIndex(i);
        ttsIndexRef.current = i;
        const el = viewportRef.current?.querySelector(`[data-tts-idx="${i}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

        try {
          setTtsLoading(true);
          let blob: Blob;
          const cached = prefetchRef.current;
          if (cached && cached.index === i) {
            blob = await cached.blob;
          } else {
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            blob = await requestBlob(i, ctrl);
          }
          if (!ttsActiveRef.current || ttsIndexRef.current !== i) return;

          // Prefetch next paragraph while this one plays
          if (i + 1 < list.length) {
            const nextCtrl = new AbortController();
            abortRef.current = nextCtrl;
            prefetchRef.current = {
              index: i + 1,
              blob: requestBlob(i + 1, nextCtrl).catch(() => new Blob()),
            };
          } else {
            prefetchRef.current = null;
          }

          releaseAudioUrl();
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.src = url;
          audio.playbackRate = 1; // speed is baked into TTS via `speed` param
          audio.onended = () => {
            if (!ttsActiveRef.current) return;
            void playAt(i + 1);
          };
          audio.onerror = () => {
            if (!ttsActiveRef.current) return;
            void playAt(i + 1);
          };
          setTtsLoading(false);
          await audio.play().catch(() => {});
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return;
          console.error('TTS error', err);
          setTtsLoading(false);
          if (ttsActiveRef.current) void playAt(i + 1);
        }
      };

      void playAt(Math.max(0, Math.min(startIndex, list.length - 1)));
    },
    [voice, tone, rate, chapterIndex, chapters.length] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const togglePlay = () => {
    if (!supportsTTS) return;
    if (!ttsPlaying) {
      speakFrom(ttsIndexRef.current >= 0 ? ttsIndexRef.current : 0);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (ttsPaused) {
      void audio.play();
      setTtsPaused(false);
    } else {
      audio.pause();
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
    () => ({ fontSize: `${fontSize}px`, lineHeight: 1.7 }),
    [fontSize]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80">
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
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold truncate">
            {view === 'reader' ? chapterTitle : book?.title || 'Live Reader'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {view === 'reader' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowToc((v) => !v)} className="gap-1">
                <List className="w-4 h-4" />
              </Button>
              {supportsTTS && (
                <Button
                  variant={ttsOpen ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTtsOpen((v) => !v)}
                  className="gap-1"
                  title="Text to speech"
                >
                  <Volume2 className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                className="gap-1"
                title="Smaller text"
              >
                A-
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFontSize((s) => Math.min(32, s + 2))}
                className="gap-1"
                title="Larger text"
              >
                A+
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* TTS Panel */}
      {view === 'reader' && ttsOpen && supportsTTS && (
        <div className="border-b border-border bg-card/60 px-4 py-3 flex flex-wrap items-center gap-3">
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
              className="bg-background border border-border rounded px-2 py-1 text-xs max-w-[220px]"
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
            Rate {rate.toFixed(1)}x
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
          </label>

          <label className="flex items-center gap-2 text-xs">
            Pitch {pitch.toFixed(1)}
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
            />
          </label>

          {ttsIndex >= 0 && (
            <span className="text-xs text-muted-foreground ml-auto">
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
            <p className="text-sm text-muted-foreground max-w-md">
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
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{status}</p>
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
              <div className="w-full aspect-[2/3] rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                <BookOpen className="w-10 h-10" />
              </div>
            )}
            <div className="space-y-3 min-w-0">
              <h2 className="text-2xl font-display font-bold break-words">{book.title || 'Untitled'}</h2>
              {book.author && <p className="text-sm text-muted-foreground">by {book.author}</p>}
              {book.description && (
                <p className="text-sm text-foreground/80 whitespace-pre-line line-clamp-[12]">
                  {book.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => openChapter(0)} disabled={!chapters.length} className="gap-2">
                  <BookOpen className="w-4 h-4" /> Start reading
                </Button>
                <span className="text-sm text-muted-foreground self-center">
                  {chapters.length} chapters
                </span>
              </div>
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-6 pb-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Chapters
            </h3>
            <div className="border border-border rounded-lg divide-y divide-border">
              {chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => openChapter(i)}
                  className="w-full text-left px-4 py-2 hover:bg-muted transition-colors flex items-center gap-3"
                >
                  <span className="text-xs text-muted-foreground w-10 tabular-nums">{i + 1}</span>
                  <span className="text-sm truncate">{ch.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reader view */}
      {view === 'reader' && (
        <div className="flex-1 flex overflow-hidden">
          {showToc && (
            <aside className="w-72 border-r border-border overflow-auto bg-card/50">
              {chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => openChapter(i)}
                  className={`w-full text-left px-3 py-2 text-sm truncate hover:bg-muted transition-colors ${
                    i === chapterIndex ? 'bg-primary/10 text-primary font-medium' : ''
                  }`}
                >
                  {i + 1}. {ch.title}
                </button>
              ))}
            </aside>
          )}
          <div ref={viewportRef} className="flex-1 overflow-auto">
            <article
              className="max-w-2xl mx-auto px-6 py-10 prose prose-sm dark:prose-invert"
              style={readerStyle}
            >
              <h1 className="font-display">{chapterTitle}</h1>
              {loadingChapter ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading chapter…
                </div>
              ) : paragraphs.length > 0 ? (
                <div>
                  {paragraphs.map((p, i) => (
                    <div
                      key={i}
                      data-tts-idx={i}
                      onClick={() => supportsTTS && ttsOpen && speakFrom(i)}
                      className={`transition-colors rounded px-2 -mx-2 ${
                        i === ttsIndex ? 'bg-primary/15 ring-1 ring-primary/40' : ''
                      } ${supportsTTS && ttsOpen ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                      dangerouslySetInnerHTML={{ __html: p.html }}
                    />
                  ))}
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: chapterHtml }} />
              )}
              <div className="flex justify-between items-center mt-10 pt-6 border-t border-border not-prose">
                <Button
                  variant="outline"
                  onClick={() => openChapter(chapterIndex - 1)}
                  disabled={chapterIndex === 0 || loadingChapter}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>
                <span className="text-xs text-muted-foreground">
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
