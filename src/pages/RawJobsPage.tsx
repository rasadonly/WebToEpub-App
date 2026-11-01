import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ListOrdered, Download, X, RefreshCw } from 'lucide-react';
import {
  loadSpaceJobs,
  refreshSpaceJob,
  cancelSpaceJob,
  downloadSpaceEpub,
  getSpaceEpubFile,
  upsertSpaceJob,
  type SpaceJob,
} from '@/utils/spaceApi';

// /raw/jobs — translation jobs started in THIS browser (the Space
// holds the real job state; this page lists what localStorage
// remembers, since there is no server-side job list any more).
// Active jobs poll the Space every 10s; finished jobs keep their
// Space download link and library status.
export default function RawJobsPage() {
  const [jobs, setJobs] = useState<SpaceJob[]>([]);
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

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setJobsBoth(loadSpaceJobs());
      await refreshActive();
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
      await downloadSpaceEpub(epubUrl, filename || 'book.epub');
    } catch {
      setError('Download failed');
    }
  };

  const onCancel = (job: SpaceJob) => {
    const next = cancelSpaceJob(job);
    upsertSpaceJob(next);
    setJobsBoth(loadSpaceJobs());
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-6">
        <section className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <ListOrdered className="w-3.5 h-3.5" /> Translation Jobs
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Current Translation Jobs</h1>
          <p className="text-muted-foreground text-sm">
            Jobs started in this browser, tracked live from the Translate Me Space.{' '}
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
        <ul className="space-y-3">
          {jobs.map((job) => {
            const active = ['queued', 'running'].includes(job.status);
            const finished = ['done', 'done_with_errors'].includes(job.status);
            return (
              <li key={job.spaceJobId} className="bg-card border border-border rounded-xl p-4 space-y-2">
                <p className="font-semibold text-sm">{job.title}</p>
                {job.originalTitle && job.originalTitle !== job.title && (
                  <p className="text-xs text-muted-foreground">{job.originalTitle}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {job.status} · {job.phase} · {job.completed}/{job.total || '?'} chapters
                  {job.failed > 0 ? ` · ${job.failed} failed` : ''}
                </p>
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
                    <a href={job.libraryUrl} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">Library copy</Button>
                    </a>
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
      </main>
    </div>
  );
}
