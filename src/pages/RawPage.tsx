import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Languages, Search, BookOpen, Download, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  type SpaceJob,
  type SpaceSearchResult,
  type SpaceToc,
} from '@/utils/spaceApi';

// /raw — translate raw (untranslated) novels, with the Translate
// Me Space as the translation backend. The browser talks to the
// Space DIRECTLY for search, TOC, jobs, progress and EPUB
// downloads (at the user's direction: separate backends, HF for
// translation). The only call that still goes to linktoepub's own
// backend is the library save, because it needs the library
// token. There is no one-job-at-a-time guard, no library
// suggestions, and no parser fallback any more — those lived on
// the old proxy. Jobs are tracked per browser (localStorage), so
// /raw/jobs lists jobs started in this browser. A finished book
// is saved to the community library when it is big enough
// (>= 100 KB); smaller books still download fine from the Space.
export default function RawPage() {
  // Single search bar, like the main page: a title searches, a
  // pasted URL fetches its TOC.
  const [input, setInput] = useState('');
  const [results, setResults] = useState<SpaceSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [searching, setSearching] = useState(false);
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<number | null>(null);
  const jobRef = useRef<SpaceJob | null>(null);
  const jobSectionRef = useRef<HTMLElement | null>(null);
  const [translatingUrl, setTranslatingUrl] = useState('');

  useEffect(() => {
    document.title = 'Raw Translation — Translate Raw Novels to EPUB | LinkToEpub';
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
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

  const pollJob = (spaceJobId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
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
    }, 10_000);
  };

  const isUrlLike = (s: string) => /^https?:\/\//i.test(s.trim());

  const onSearch = async (value: string) => {
    const q = value.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const out = await searchBooks(q);
      setResults(out.results);
      setSearchStatus(out.status);
      if (!out.results.length) setNotice('No results — try the original-language title, or paste a book URL.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
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
      const title = await resolveJobTitle(payload.originalTitle, payload.source, payload.target, 'auto');
      const spaceJobId = await startSpaceJob({ ...payload, engine: 'auto' });
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

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-8">
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
          <div className="flex gap-2 items-start bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex gap-2 items-start bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-sm">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-bold flex items-center gap-2"><Search className="w-4 h-4" /> 1. Find the book</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
              placeholder="Search by title or paste a book URL (e.g. Re:Zero, or https://ncode.syosetu.com/n2267be/)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSingleAction()}
            />
            <Button onClick={onSingleAction} disabled={searching || fetchingToc || !input.trim()}>
              {fetchingToc ? 'Fetching…' : searching ? 'Searching…' : isUrlLike(input) ? 'Fetch TOC' : 'Search'}
            </Button>
          </div>
          {searchStatus && <p className="text-xs text-muted-foreground">{searchStatus}</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-border border border-border rounded-lg">
              {results.map((r) => (
                <li key={r.url} className="p-3 flex items-center justify-between gap-3">
                  <span className="text-sm">{r.label}</span>
                  <span className="flex gap-2 shrink-0">
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
        </section>

        {tocTitle && (
          <section className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><BookOpen className="w-4 h-4" /> 2. {tocTitle} — {tocCount} chapters</h2>
            {infoText && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{infoText}</p>}
            <pre className="text-xs bg-background border border-border rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap">{chaptersText}</pre>
            <div className="grid sm:grid-cols-4 gap-3 text-sm">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">From language</span>
                <select className="w-full bg-background border border-border rounded-lg px-2 py-2" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="auto">Auto-detect</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh-CN">Chinese (Simplified)</option>
                  <option value="zh-TW">Chinese (Traditional)</option>
                </select>
              </label>
              <label className="space-y-1">
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
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">From chapter (1-based)</span>
                <input type="number" min={1} className="w-full bg-background border border-border rounded-lg px-2 py-2" value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">To chapter (-1 = end)</span>
                <input type="number" className="w-full bg-background border border-border rounded-lg px-2 py-2" value={to} onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </div>
            <Button onClick={onStart} disabled={starting || !!jobActive}>
              {starting ? 'Starting…' : jobActive ? 'A translation is running…' : 'Start translation'}
            </Button>
          </section>
        )}

        {job && (
          <section ref={jobSectionRef} className="bg-card border border-border rounded-xl p-6 space-y-3">
            <h2 className="font-bold">3. Translation job</h2>
            <p className="text-sm"><strong>{job.title}</strong>{job.originalTitle && job.originalTitle !== job.title ? ` (${job.originalTitle})` : ''}</p>
            <p className="text-sm text-muted-foreground">
              Status: {job.status} · {job.phase} · {job.completed}/{job.total || '?'} chapters
              {job.failed > 0 ? ` · ${job.failed} failed` : ''}
            </p>
            {job.total > 0 && (
              <div className="space-y-1">
                <div className="h-2.5 bg-secondary rounded-full overflow-hidden" role="progressbar" aria-valuenow={job.completed} aria-valuemin={0} aria-valuemax={job.total}>
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, Math.round((job.completed / job.total) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {jobActive ? 'Translating…' : 'Finished'} {job.completed}/{job.total} chapters
                  {` (${Math.min(100, Math.round((job.completed / job.total) * 100))}%)`}
                </p>
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
            <div className="flex flex-wrap gap-2">
              {jobFinished && (
                <Button onClick={() => void onDownload()}>
                  <Download className="w-4 h-4 mr-1" /> Download EPUB
                </Button>
              )}
              {job.libraryStatus === 'saved' && job.libraryUrl && (
                <a href={job.libraryUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline">Community library copy</Button>
                </a>
              )}
              {job.libraryStatus === 'failed' && (
                <span className="text-xs text-muted-foreground self-center">Library save failed: {job.libraryError || 'unknown'} — download from the Space still works</span>
              )}
              {job.libraryStatus === 'uploading' && (
                <span className="text-xs text-muted-foreground self-center">Saving a copy to the community library…</span>
              )}
              {jobActive && (
                <Button variant="outline" onClick={onCancel}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
