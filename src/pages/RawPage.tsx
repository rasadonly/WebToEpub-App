import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Languages, Search, BookOpen, Download, X, AlertTriangle, CheckCircle2, Library as LibraryIcon } from 'lucide-react';
import {
  rawSearch,
  rawToc,
  rawStartJob,
  rawJobStatus,
  rawCancelJob,
  rawDownload,
  type RawJob,
  type RawSearchResult,
  type RawLibraryResult,
} from '@/utils/rawApi';

// /raw — translate one raw (untranslated) book at a time, using
// the Translate Me Space as the translation backend. The flow
// mirrors the main converter: find a book, fetch its TOC, pick
// a chapter range, start the job, follow it to an EPUB — except
// only one translation job runs at a time, an already-available
// book is suggested instead of re-translated, and the finished
// EPUB is saved to the community library under its correct
// (translated) title. The finished EPUB stays downloadable from
// linktoepub for 24 hours even when the library refuses it for
// being under 100 KB.
export default function RawPage() {
  // Single search bar, like the main page: a title searches, a
  // pasted URL fetches its TOC. (Previously two separate inputs;
  // on mobile the second one was easy to miss.)
  const [input, setInput] = useState('');
  const [results, setResults] = useState<RawSearchResult[]>([]);
  const [libraryResults, setLibraryResults] = useState<RawLibraryResult[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [url, setUrl] = useState('');
  const [tocTitle, setTocTitle] = useState('');
  const [tocCount, setTocCount] = useState(0);
  const [chaptersText, setChaptersText] = useState('');
  const [infoText, setInfoText] = useState('');
  const [tocSource, setTocSource] = useState<'space' | 'linktoepub' | ''>('');
  const [tocNote, setTocNote] = useState('');
  const [fetchingToc, setFetchingToc] = useState(false);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('en');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(-1);
  const [job, setJob] = useState<RawJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [librarySuggestion, setLibrarySuggestion] = useState<{ title: string; url: string } | null>(null);
  const pollRef = useRef<number | null>(null);
  const jobSectionRef = useRef<HTMLElement | null>(null);
  const [translatingUrl, setTranslatingUrl] = useState('');

  useEffect(() => {
    document.title = 'Raw Translation — Translate Raw Novels to EPUB | LinkToEpub';
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const pollJob = (id: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await rawJobStatus(id);
        setJob(next);
        if (['done', 'done_with_errors', 'error', 'cancelled'].includes(next.status)) stopPolling();
      } catch {
        /* keep polling; a transient backend hiccup is not a job failure */
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
      const out = await rawSearch(q);
      setResults(out.results);
      setLibraryResults(out.libraryResults || []);
      setSearchStatus(out.status);
      if (!out.results.length && !(out.libraryResults || []).length) setNotice('No results — try the original-language title, or paste a book URL.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const onFetchToc = async (value: string) => {
    const u = value.trim();
    if (!u) return null;
    setFetchingToc(true);
    setError('');
    setNotice('');
    setLibrarySuggestion(null);
    try {
      const out = await rawToc(u);
      setUrl(u);
      setTocTitle(out.title);
      setTocCount(out.count);
      setChaptersText(out.chaptersText);
      setInfoText(out.info);
      setTocSource(out.source);
      setTocNote(out.note || '');
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

  // Shared start logic: library/job suggestions, the one-job
  // guard (409), polling, and scrolling the progress into view
  // (on phones the job section sits below the fold).
  const runStart = async (payload: { tocUrl: string; title?: string; source: string; target: string; from: number; to: number }) => {
    setStarting(true);
    setError('');
    setNotice('');
    setLibrarySuggestion(null);
    try {
      const out = await rawStartJob(payload);
      if ('suggestion' in out && out.suggestion === 'library') {
        setLibrarySuggestion({ title: out.title, url: out.url });
        setNotice('This translation is already available in the community library — no need to translate it again.');
        return;
      }
      if ('suggestion' in out && out.suggestion === 'job') {
        setJob(out.job);
        setNotice('This book already has a translation job here — following that job instead of starting a duplicate.');
        if (['queued', 'running'].includes(out.job.status)) pollJob(out.job.id);
        return;
      }
      setJob(out as RawJob);
      pollJob((out as RawJob).id);
      window.setTimeout(() => jobSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      const err = e as Error & { status?: number; body?: { job?: RawJob } };
      if (err.status === 409 && err.body?.job) {
        setJob(err.body.job);
        setNotice('A translation job is already running — one book at a time. Following the running job.');
        pollJob(err.body.job.id);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to start translation job');
      }
    } finally {
      setStarting(false);
    }
  };

  const onStart = () => {
    if (!url.trim()) return;
    void runStart({
      tocUrl: url.trim(),
      title: tocTitle || undefined,
      source,
      target,
      // UI chapters are 1-based; the backend takes 0-based indices (-1 = end).
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
      await runStart({ tocUrl: resultUrl, title: toc.title, source, target, from: 0, to: -1 });
    } finally {
      setTranslatingUrl('');
    }
  };

  const onCancel = async () => {
    if (!job) return;
    try {
      const next = await rawCancelJob(job.id);
      setJob(next);
      stopPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
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
            Find a Japanese, Korean, or Chinese novel, translate it chapter by chapter, and get a clean English EPUB —
            saved to the community library when it finishes. One book at a time, so every job gets full attention.
            A finished book stays downloadable here for 24 hours even if the library refuses it for being too small.
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
        {librarySuggestion && (
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <p className="font-semibold">Already available: {librarySuggestion.title}</p>
            <a href={librarySuggestion.url} target="_blank" rel="noreferrer">
              <Button>Download from the community library</Button>
            </a>
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
          {libraryResults.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm flex items-center gap-2"><LibraryIcon className="w-4 h-4" /> Already in the community library</h3>
              <ul className="divide-y divide-border border border-border rounded-lg">
                {libraryResults.map((r) => (
                  <li key={r.path} className="p-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{r.title}</span>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      <Button variant="outline">Download</Button>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
            {tocSource === 'linktoepub' && tocNote && <p className="text-xs text-amber-500">{tocNote}</p>}
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
              {jobFinished && job.ready && (
                <Button onClick={() => rawDownload(job).catch((e) => setError(e instanceof Error ? e.message : 'Download failed'))}>
                  <Download className="w-4 h-4 mr-1" /> Download EPUB
                </Button>
              )}
              {job.libraryStatus === 'saved' && job.libraryUrl && (
                <a href={job.libraryUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline">Community library copy</Button>
                </a>
              )}
              {job.libraryStatus === 'failed' && (
                <span className="text-xs text-muted-foreground self-center">Library save failed: {job.libraryError || 'unknown'} — download here still works for 24 hours</span>
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
