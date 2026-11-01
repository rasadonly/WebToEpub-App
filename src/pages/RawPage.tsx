import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Languages,
  Search,
  BookOpen,
  Download,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Square,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  searchBooks,
  fetchSpaceToc,
  resolveJobTitle,
  startSpaceJob,
  refreshSpaceJob,
  cancelSpaceJob,
  downloadSpaceEpub,
  getSpaceEpubFile,
  upsertSpaceJob,
  findDoneJobForUrl,
  loadSpaceJobs,
  parseTocLines,
  type SpaceJob,
  type SpaceSearchResult,
  type SpaceToc,
} from '@/utils/spaceApi';
// Community Library recommendations reuse the homepage's own
// helpers (same data, same matching): the list comes from the
// public HF dataset, fetched straight from the browser, and the
// download goes to the dataset's public file URL. No translation
// runs anywhere but the Space, and no secret is involved.
import {
  libraryGetCommunity,
  libraryDownloadHF,
  type LibraryBook,
} from '@/utils/webtoepub/bridge';
import {
  normalizeBookSearch as norm,
  libraryMatchScore as matchScore,
} from '@/utils/librarySearch';

// /raw — translate raw (untranslated) novels, with the Translate
// Me Space as the translation backend. The browser talks to the
// Space DIRECTLY for search, TOC, jobs, progress and EPUB
// downloads (at the user's direction: separate backends, HF for
// translation). The only call that still goes to linktoepub's own
// backend is the library save, because it needs the library
// token. Sections deliberately reuse the homepage's own card
// treatment (bg-gradient-card, shadow-card, max-w-2xl) and its
// chapter-list and progress patterns, so /raw feels like the
// main page instead of a different app. Jobs are tracked per
// browser (localStorage), so /raw/jobs lists jobs started in
// this browser. A finished book is saved to the community
// library when it is big enough (>= 100 KB); smaller books
// still download fine from the Space.
export default function RawPage() {
  // Single search bar, like the main page: a title searches, a
  // pasted URL fetches its TOC.
  const [input, setInput] = useState('');
  const [results, setResults] = useState<SpaceSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [libMatches, setLibMatches] = useState<LibraryBook[]>([]);
  const [libDismissed, setLibDismissed] = useState('');
  const [downloadingLib, setDownloadingLib] = useState<Record<string, 'loading' | 'done'>>({});
  const [libError, setLibError] = useState('');
  const [url, setUrl] = useState('');
  const [tocTitle, setTocTitle] = useState('');
  const [tocCount, setTocCount] = useState(0);
  const [chaptersText, setChaptersText] = useState('');
  const [infoText, setInfoText] = useState('');
  const [fetchingToc, setFetchingToc] = useState(false);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('en');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(-1);
  const [job, setJob] = useState<SpaceJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<number | null>(null);
  const jobRef = useRef<SpaceJob | null>(null);
  const jobSectionRef = useRef<HTMLDivElement | null>(null);
  const [translatingUrl, setTranslatingUrl] = useState('');

  useEffect(() => {
    document.title = 'Raw Translation — Translate Raw Novels to EPUB | LinkToEpub';
    // Restore the latest job started in this browser (e.g. after
    // visiting /raw/jobs and coming back) and resume polling it.
    const saved = loadSpaceJobs();
    if (saved.length > 0) {
      const latest = saved[0];
      jobRef.current = latest;
      setJob(latest);
      if (['queued', 'running'].includes(latest.status)) {
        pollRef.current = window.setInterval(() => {
          void tickPoll(latest.spaceJobId);
        }, 10_000);
      }
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTrackedJob = (next: SpaceJob | null) => {
    jobRef.current = next;
    setJob(next);
    if (next) upsertSpaceJob(next);
  };

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const tickPoll = async (spaceJobId: string) => {
    const current = jobRef.current;
    if (!current || current.spaceJobId !== spaceJobId) {
      stopPolling();
      return;
    }
    try {
      const next = await refreshSpaceJob(current);
      setTrackedJob(next);
      if (['done', 'done_with_errors', 'error', 'cancelled'].includes(next.status)) stopPolling();
    } catch {
      /* keep polling; a transient Space hiccup is not a job failure */
    }
  };

  const pollJob = (spaceJobId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void tickPoll(spaceJobId);
    }, 10_000);
  };

  const isUrlLike = (s: string) => /^https?:\/\//i.test(s.trim());

  const matchLibrary = async (q: string): Promise<LibraryBook[]> => {
    if (norm(q).length < 3) return [];
    try {
      const books = await libraryGetCommunity();
      return books
        .map((b) => ({ b, s: matchScore(b.title, q) }))
        .filter((x) => x.s >= 0.75)
        .sort((x, y) => y.s - x.s || (y.b.size || 0) - (x.b.size || 0))
        .slice(0, 3)
        .map((x) => x.b);
    } catch {
      return [];
    }
  };

  const onSearch = async (value: string) => {
    const q = value.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    setNotice('');
    setLibError('');
    setLibDismissed('');
    try {
      const libPromise = matchLibrary(q);
      const out = await searchBooks(q);
      setResults(out.results);
      setSearchStatus(out.status);
      if (!out.results.length) setNotice('No results — try the original-language title, or paste a book URL.');
      setLibMatches(await libPromise);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const downloadLibraryBook = async (book: LibraryBook) => {
    if (downloadingLib[book.id]) return;
    setDownloadingLib((d) => ({ ...d, [book.id]: 'loading' }));
    setLibError('');
    try {
      const blob = await libraryDownloadHF(book.handle);
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/epub+zip' }));
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${(book.title || 'book').replace(/[\\/:*?"<>|]+/g, '').replace(/\.epub$/i, '')}.epub`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setDownloadingLib((d) => ({ ...d, [book.id]: 'done' }));
      window.setTimeout(
        () =>
          setDownloadingLib((d) => {
            const n = { ...d };
            delete n[book.id];
            return n;
          }),
        2500,
      );
    } catch {
      setDownloadingLib((d) => {
        const n = { ...d };
        delete n[book.id];
        return n;
      });
      setLibError('Library download failed — try again.');
    }
  };

  const onFetchToc = async (value: string): Promise<SpaceToc | null> => {
    const u = value.trim();
    if (!u) return null;
    setFetchingToc(true);
    setError('');
    setNotice('');
    try {
      const out = await fetchSpaceToc(u);
      setUrl(u);
      setTocTitle(out.title);
      setTocCount(out.count);
      setChaptersText(out.chaptersText);
      setInfoText(out.info);
      setTo(-1);
      return out;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch TOC');
      return null;
    } finally {
      setFetchingToc(false);
    }
  };

  // The single bar's action: a URL fetches its TOC, anything else searches.
  const onSingleAction = () => {
    const v = input.trim();
    if (!v) return;
    if (isUrlLike(v)) void onFetchToc(v);
    else void onSearch(v);
  };

  // Shared start logic: local duplicate check, title resolution,
  // Space start, tracking, polling, and scrolling the progress
  // into view (on phones the job section sits below the fold).
  const runStart = async (payload: {
    tocUrl: string;
    originalTitle: string;
    source: string;
    target: string;
    from: number;
    to: number;
  }) => {
    setStarting(true);
    setError('');
    setNotice('');
    try {
      const existing = findDoneJobForUrl(payload.tocUrl);
      if (existing) {
        setTrackedJob(existing);
        setNotice('You already translated this book in this browser — here is your EPUB.');
        return;
      }
      // Start the job and translate its title at the same time;
      // the title never blocks the job (capped at 20s).
      const [title, spaceJobId] = await Promise.all([
        Promise.race([
          resolveJobTitle(payload.originalTitle, payload.source, payload.target, 'auto'),
          new Promise<string>((r) => window.setTimeout(() => r(payload.originalTitle), 20_000)),
        ]),
        startSpaceJob({ ...payload, engine: 'auto' }),
      ]);
      // The server follows the job and saves it to the Community
      // Library even if this tab is closed.
      trackOnServer(spaceJobId, title);
      const created: SpaceJob = {
        spaceJobId,
        title,
        originalTitle: payload.originalTitle,
        tocUrl: payload.tocUrl,
        source: payload.source,
        target: payload.target,
        from: payload.from,
        to: payload.to,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'queued',
        phase: 'Queued',
        completed: 0,
        total: 0,
        failed: 0,
        failedChapters: [],
      };
      setTrackedJob(created);
      pollJob(spaceJobId);
      window.setTimeout(() => jobSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start translation job');
    } finally {
      setStarting(false);
    }
  };

  const onStart = () => {
    if (!url.trim()) return;
    void runStart({
      tocUrl: url.trim(),
      originalTitle: tocTitle || url.trim(),
      source,
      target,
      // UI chapters are 1-based; the Space takes 0-based indices (-1 = end).
      from: Math.max(0, from - 1),
      to: to < 0 ? -1 : Math.max(0, to - 1),
    });
  };

  // One tap from a search result: fetch the TOC, then translate
  // the whole book (chapter 1 to the end) and show its progress.
  const onTranslateEpub = async (resultUrl: string) => {
    setTranslatingUrl(resultUrl);
    setInput(resultUrl);
    try {
      const toc = await onFetchToc(resultUrl);
      if (!toc) return;
      await runStart({ tocUrl: resultUrl, originalTitle: toc.title, source, target, from: 0, to: -1 });
    } finally {
      setTranslatingUrl('');
    }
  };

  const onCancel = () => {
    if (!job) return;
    const next = cancelSpaceJob(job);
    setTrackedJob(next);
    stopPolling();
  };

  const onRefreshJob = async () => {
    const current = jobRef.current;
    if (!current || refreshing) return;
    setRefreshing(true);
    try {
      const next = await refreshSpaceJob(current);
      setTrackedJob(next);
      if (['done', 'done_with_errors', 'error', 'cancelled'].includes(next.status)) stopPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const onDownload = async () => {
    if (!job) return;
    try {
      let epubUrl = job.epubUrl;
      let filename = job.epubFilename;
      if (!epubUrl) {
        const ep = await getSpaceEpubFile(job.spaceJobId);
        epubUrl = ep.url;
        filename = ep.filename;
        setTrackedJob({ ...job, epubUrl, epubFilename: filename });
      }
      await downloadSpaceEpub(epubUrl, filename || 'book.epub');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const jobActive = job && ['queued', 'running'].includes(job.status);
  const jobFinished = job && ['done', 'done_with_errors'].includes(job.status);
  const jobPct =
    job && job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;
  const tocRows = tocTitle ? parseTocLines(chaptersText) : [];

  return (
    <div
      className="min-h-screen bg-background relative overflow-x-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <main className="container mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-12 space-y-8 max-w-6xl">
        <section className="space-y-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <Languages className="w-3.5 h-3.5" /> Raw Translation
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Translate a <span className="text-primary">Raw Novel</span> to EPUB
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Find a Japanese, Korean, or Chinese novel, translate it chapter by chapter, and get a clean English EPUB.
            Translation runs on the Translate Me Space, and finished books are saved to the community library when
            they are big enough.
          </p>
          <p className="text-xs text-muted-foreground">
            <Link to="/raw/jobs" className="text-primary hover:underline">View current translation jobs →</Link>
          </p>
        </section>

        {error && (
          <div className="flex gap-2 items-start bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-sm max-w-2xl mx-auto">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex gap-2 items-start bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-sm max-w-2xl mx-auto">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <Card className="w-full max-w-2xl mx-auto p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-4">
          <h2 className="font-bold flex items-center gap-2"><Search className="w-4 h-4" /> 1. Find the book</h2>
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1"
              placeholder="Search by title or paste a book URL (e.g. Re:Zero, or https://ncode.syosetu.com/n2267be/)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSingleAction()}
            />
            <Button onClick={onSingleAction} disabled={searching || fetchingToc || !input.trim()} className="shrink-0">
              {fetchingToc ? 'Fetching…' : searching ? 'Searching…' : isUrlLike(input) ? 'Fetch TOC' : 'Search'}
            </Button>
          </div>
          {searchStatus && <p className="text-xs text-muted-foreground">{searchStatus}</p>}
          {libMatches.length > 0 && libDismissed !== input.trim() && (
            <Card className="p-4 border border-primary/30 bg-primary/5 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs font-semibold">Already in the Community Library</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLibDismissed(input.trim())}
                  aria-label="Dismiss"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <ul className="space-y-2">
                {libMatches.map((book) => (
                  <li key={book.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm min-w-0 break-words">
                      {book.title}
                      {book.size ? <span className="text-xs text-muted-foreground"> · {Math.round(book.size / 1024)} KB</span> : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void downloadLibraryBook(book)}
                      disabled={downloadingLib[book.id] === 'loading'}
                    >
                      {downloadingLib[book.id] === 'loading' ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Downloading…</>
                      ) : downloadingLib[book.id] === 'done' ? (
                        'Downloaded ✓'
                      ) : (
                        <><Download className="w-4 h-4 mr-1" /> Download</>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
              {libError && <p className="text-xs text-destructive mt-2">{libError}</p>}
            </Card>
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-border border border-border rounded-lg">
              {results.map((r) => (
                <li key={r.url} className="p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm min-w-0 break-words">{r.label}</span>
                  <span className="flex flex-wrap gap-2 sm:shrink-0">
                    <Button
                      onClick={() => void onTranslateEpub(r.url)}
                      disabled={!!translatingUrl || !!jobActive}
                    >
                      {translatingUrl === r.url ? 'Starting…' : 'Translate & EPUB'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setInput(r.url);
                        void onFetchToc(r.url);
                      }}
                    >
                      Choose
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {tocTitle && (
          <Card className="w-full max-w-2xl mx-auto p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary shrink-0" />
                  <span className="min-w-0 break-words">Chapters ({tocCount})</span>
                </h2>
                <p className="text-sm text-muted-foreground break-words">{tocTitle}</p>
                {infoText && <p className="text-xs text-muted-foreground mt-1 break-words">{infoText}</p>}
              </div>
              <Button onClick={onStart} disabled={starting || !!jobActive} className="bg-gradient-primary hover:shadow-glow transition-smooth shrink-0">
                {starting ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting…</>
                ) : jobActive ? (
                  'A translation is running…'
                ) : (
                  'Start translation'
                )}
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <label className="space-y-1 min-w-0">
                <span className="text-xs text-muted-foreground">From language</span>
                <select className="w-full bg-background border border-border rounded-lg px-2 py-2" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="auto">Auto-detect</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh-CN">Chinese (Simplified)</option>
                  <option value="zh-TW">Chinese (Traditional)</option>
                </select>
              </label>
              <label className="space-y-1 min-w-0">
                <span className="text-xs text-muted-foreground">To language</span>
                <select className="w-full bg-background border border-border rounded-lg px-2 py-2" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="pt">Portuguese</option>
                  <option value="ru">Russian</option>
                  <option value="ar">Arabic</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-2 p-3 bg-muted/40 rounded-lg">
              <div className="space-y-1">
                <Label htmlFor="raw-range-start" className="text-xs">From</Label>
                <Input
                  id="raw-range-start"
                  type="number"
                  min={1}
                  max={Math.max(1, tocCount)}
                  value={from}
                  onChange={(e) => setFrom(Number(e.target.value) || 1)}
                  className="w-24 h-8"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="raw-range-end" className="text-xs">To</Label>
                <Input
                  id="raw-range-end"
                  type="number"
                  min={1}
                  max={Math.max(1, tocCount)}
                  value={to}
                  onChange={(e) => setTo(Number(e.target.value))}
                  className="w-24 h-8"
                />
              </div>
              <span className="text-xs text-muted-foreground mb-2">To = -1 means the last chapter.</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
              {tocRows.map((c) => (
                <div key={c.n} className="flex items-center gap-2 px-3 text-sm bg-background" style={{ minHeight: 40 }}>
                  <span className="w-10 text-xs text-muted-foreground tabular-nums shrink-0">{c.n}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{c.title}</div>
                  </div>
                </div>
              ))}
            </div>
            {tocCount > tocRows.length && (
              <p className="text-xs text-muted-foreground">
                Showing first {tocRows.length} of {tocCount} chapters — a job translates the full list.
              </p>
            )}
          </Card>
        )}

        {job && (
          <Card ref={jobSectionRef} className="w-full max-w-2xl mx-auto p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-4">
            <div className="flex items-center gap-3">
              {job.status === 'done' || job.status === 'done_with_errors' ? (
                <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              ) : job.status === 'error' ? (
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              ) : job.status === 'cancelled' ? null : (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold break-words">{job.title}</h3>
                {job.originalTitle && job.originalTitle !== job.title && (
                  <p className="text-xs text-muted-foreground break-words">{job.originalTitle}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {job.phase}
                  {job.total > 0 ? ` · Chapter ${job.completed} of ${job.total}` : ''}
                </p>
                {jobActive && job.currentChapter && job.currentChapter !== '—' && (
                  <p className="text-sm text-muted-foreground break-words">Current chapter: {job.currentChapter}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {job.lastCheckedAt
                    ? `Last checked ${new Date(job.lastCheckedAt).toLocaleTimeString()} · checking every 10s`
                    : 'Waiting for the first progress check…'}
                </p>
              </div>
              {jobActive && (
                <Button onClick={onCancel} variant="destructive" size="sm" className="gap-2 shrink-0">
                  <Square className="w-4 h-4 fill-current" /> Stop
                </Button>
              )}
              <Button onClick={() => void onRefreshJob()} variant="outline" size="sm" className="gap-2 shrink-0" disabled={refreshing}>
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
            {job.total > 0 && (
              <div className="space-y-2">
                <Progress value={jobPct} className="h-2 bg-muted" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{jobPct}% complete</span>
                  <span>{job.completed}/{job.total} chapters</span>
                </div>
              </div>
            )}
            {job.failedChapters && job.failedChapters.length > 0 && (
              <div className="text-sm">
                <p className="font-semibold">Chapters not translated (failed, not silently dropped):</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {job.failedChapters.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {job.error && <p className="text-sm text-destructive">{job.error}</p>}
            {jobFinished && (
              <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-4">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void onDownload()} size="sm" className="gap-2">
                    <Download className="w-4 h-4" /> Download EPUB
                  </Button>
                </div>
                {job.libraryStatus === 'saved' && job.libraryUrl ? (
                  <p className="text-xs text-muted-foreground">Saved to the Community Library.</p>
                ) : job.libraryStatus === 'uploading' ? (
                  <p className="text-xs text-muted-foreground">Saving a copy to the Community Library…</p>
                ) : job.libraryStatus === 'failed' ? (
                  <p className="text-xs text-muted-foreground">
                    Library save failed: {job.libraryError || 'unknown'} — download from the Space still works
                  </p>
                ) : null}
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
