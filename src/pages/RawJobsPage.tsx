import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ListOrdered, Download, X, RefreshCw } from 'lucide-react';
import {
  loadSpaceJobs,
  refreshSpaceJob,
  cancelSpaceJob,
  downloadSpaceEpub,
  epubNameFor,
  resolveJobTitle,
  getSpaceEpubFile,
  upsertSpaceJob,
  fetchPublicQueue,
  type SpaceJob,
  type PublicQueueJob,
} from '@/utils/spaceApi';

// /raw/jobs — two lists: jobs started in THIS browser (with
// downloads and library status), and below them the Space's
// public queue, so anyone can see what is translating right
// now. Public rows never carry a download button: a finished
// book's EPUB stays with the browser that started the job.
// Active jobs and the queue both refresh every 10s.
export default function RawJobsPage() {
  const [jobs, setJobs] = useState<SpaceJob[]>([]);
  const [queue, setQueue] = useState<PublicQueueJob[]>([]);
  const [queueError, setQueueError] = useState('');
  const [queueUpdatedAt, setQueueUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const jobsRef = useRef<SpaceJob[]>([]);

  const setJobsBoth = (next: SpaceJob[]) => {
    jobsRef.current = next;
    setJobs(next);
  };

  const refreshActive = async () => {
    const current = loadSpaceJobs();
    const actives = current.filter((j) => ['queued', 'running'].includes(j.status));
    if (!actives.length) return;
    const updated = await Promise.all(
      actives.map((j) => refreshSpaceJob(j).catch(() => j)),
    );
    const byId = new Map(updated.map((j) => [j.spaceJobId, j]));
    const next = current.map((j) => byId.get(j.spaceJobId) || j);
    next.forEach((j) => upsertSpaceJob(j));
    setJobsBoth(next);
  };

  const loadQueue = async () => {
    try {
      const q = await fetchPublicQueue();
      setQueue(q);
      setQueueUpdatedAt(Date.now());
      setQueueError('');
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Failed to load public queue');
    }
  };

  // Older jobs were saved under their original-script name;
  // translate those once and store the English name.
  const fixTitles = async () => {
    const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
    const stale = loadSpaceJobs().filter((j) => cjk.test(j.title || ''));
    for (const j of stale) {
      const t = await resolveJobTitle(j.title, j.source || 'auto', j.target || 'en').catch(() => j.title);
      if (t && t !== j.title && !cjk.test(t)) {
        upsertSpaceJob({ ...j, title: t, originalTitle: j.originalTitle || j.title });
        setJobsBoth(loadSpaceJobs());
      }
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setJobsBoth(loadSpaceJobs());
      await refreshActive();
      await loadQueue();
      void fixTitles();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Current Translation Jobs | LinkToEpub';
    void load();
    const t = window.setInterval(() => {
      void refreshActive();
      void loadQueue();
    }, 10_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDownload = async (job: SpaceJob) => {
    try {
      let epubUrl = job.epubUrl;
      let filename = job.epubFilename;
      if (!epubUrl) {
        const ep = await getSpaceEpubFile(job.spaceJobId);
        epubUrl = ep.url;
        filename = ep.filename;
        const next = { ...job, epubUrl, epubFilename: filename };
        upsertSpaceJob(next);
        setJobsBoth(loadSpaceJobs());
      }
      await downloadSpaceEpub(epubUrl, epubNameFor(job.title, filename?.replace(/\.epub$/i, '') || 'book'));
    } catch {
      setError('Download failed');
    }
  };

  // The library copy is a file link; opening it in a new tab
  // looked like nothing happened. Download it with its name.
  const onLibraryCopy = async (job: SpaceJob) => {
    if (!job.libraryUrl) return;
    try {
      await downloadSpaceEpub(job.libraryUrl, epubNameFor(job.title));
    } catch {
      window.location.href = job.libraryUrl;
    }
  };

  const onCancel = (job: SpaceJob) => {
    const next = cancelSpaceJob(job);
    upsertSpaceJob(next);
    setJobsBoth(loadSpaceJobs());
  };

  return (
    <div
      className="min-h-screen bg-background relative overflow-x-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <main className="container mx-auto max-w-4xl space-y-6">
        <section className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <ListOrdered className="w-3.5 h-3.5" /> Translation Jobs
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Current Translation Jobs</h1>
          <p className="text-muted-foreground text-sm">
            Your jobs from this browser, plus the public queue of everything translating on the Space right now.{' '}
            <Link to="/raw" className="text-primary hover:underline">Start a new translation →</Link>
          </p>
        </section>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-1" /> {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {jobs.length === 0 && !loading && (
          <p className="text-center text-muted-foreground text-sm">No translation jobs yet in this browser.</p>
        )}
        <h2 className="text-lg font-bold pt-2">Your jobs</h2>
        <ul className="space-y-3">
          {jobs.map((job) => {
            const active = ['queued', 'running'].includes(job.status);
            const finished = ['done', 'done_with_errors'].includes(job.status);
            return (
              <li key={job.spaceJobId} className="bg-gradient-card shadow-card border-0 rounded-xl p-4 space-y-2">
                <p className="font-semibold text-sm break-words">{job.title}</p>
                {job.originalTitle && job.originalTitle !== job.title && (
                  <p className="text-xs text-muted-foreground break-words">{job.originalTitle}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {job.status} · {job.phase} · {job.completed}/{job.total || '?'} chapters
                  {job.failed > 0 ? ` · ${job.failed} failed` : ''}
                </p>
                {active && job.currentChapter && job.currentChapter !== '—' && (
                  <p className="text-xs text-muted-foreground break-words">Current chapter: {job.currentChapter}</p>
                )}
                {job.lastCheckedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last checked {new Date(job.lastCheckedAt).toLocaleTimeString()}
                  </p>
                )}
                {job.total > 0 && (
                  <div className="h-2 bg-secondary rounded-full overflow-hidden" role="progressbar" aria-valuenow={job.completed} aria-valuemin={0} aria-valuemax={job.total}>
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, Math.round((job.completed / job.total) * 100))}%` }}
                    />
                  </div>
                )}
                {job.failedChapters && job.failedChapters.length > 0 && (
                  <p className="text-xs text-muted-foreground">Not translated: {job.failedChapters.join(', ')}</p>
                )}
                {job.error && <p className="text-xs text-destructive">{job.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {finished && (
                    <Button size="sm" onClick={() => void onDownload(job)}>
                      <Download className="w-4 h-4 mr-1" /> Download EPUB
                    </Button>
                  )}
                  {job.libraryStatus === 'saved' && job.libraryUrl && (
                    <Button size="sm" variant="outline" onClick={() => void onLibraryCopy(job)}>
                      <Download className="w-4 h-4 mr-1" /> Library copy
                    </Button>
                  )}
                  {job.libraryStatus === 'failed' && (
                    <span className="text-xs text-muted-foreground self-center">Library save failed: {job.libraryError || 'unknown'}</span>
                  )}
                  {active && (
                    <Button size="sm" variant="outline" onClick={() => onCancel(job)}>
                      <X className="w-4 h-4 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <section className="space-y-3 pt-2">
          <h2 className="text-lg font-bold">Public queue — all jobs on the Space</h2>
          <p className="text-muted-foreground text-sm">
            Every job currently translating or recently finished, from all users — active jobs first.
            Downloads stay on your own jobs above; this list shows status only.
            {queueUpdatedAt > 0 && (
              <> Last updated {new Date(queueUpdatedAt).toLocaleTimeString()} · refreshes every 10s.</>
            )}
          </p>
          {queueError && <p className="text-sm text-destructive text-center">{queueError}</p>}
          {queue.length === 0 && !queueError && (
            <p className="text-center text-muted-foreground text-sm">No jobs on the Space right now.</p>
          )}
          <ul className="space-y-3">
            {queue.map((q) => {
              const active = ['queued', 'running'].includes(q.status);
              const mine = jobs.some((j) => j.spaceJobId === q.job_id);
              return (
                <li key={q.job_id} className="bg-gradient-card shadow-card border-0 rounded-xl p-4 space-y-2">
                  <p className="font-semibold text-sm break-words">
                    {jobs.find((j) => j.spaceJobId === q.job_id)?.title || q.title}
                    {mine && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold align-middle">Yours</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {q.status} · {q.done}/{q.total || '?'} chapters ({q.percent}%)
                    {q.failed > 0 ? ` · ${q.failed} failed` : ''}
                  </p>
                  {active && q.current_chapter && q.current_chapter !== '—' && (
                    <p className="text-xs text-muted-foreground break-words">Current chapter: {q.current_chapter}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Started {new Date(q.created_at * 1000).toLocaleString()}
                  </p>
                  {q.total > 0 && (
                    <div className="h-2 bg-secondary rounded-full overflow-hidden" role="progressbar" aria-valuenow={q.done} aria-valuemin={0} aria-valuemax={q.total}>
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, q.percent)}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
