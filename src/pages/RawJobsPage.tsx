import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ListOrdered, Download, X, RefreshCw } from 'lucide-react';
import { rawJobsList, rawCancelJob, rawDownload, type RawJob } from '@/utils/rawApi';

// /raw/jobs — the current translation jobs list. One book at a
// time means this list is usually short: the running job on top,
// finished jobs below with their download and library links.
// Finished raw jobs stay listed (and downloadable) for 24 hours.
export default function RawJobsPage() {
  const [jobs, setJobs] = useState<RawJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const out = await rawJobsList();
      setJobs(out.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Current Translation Jobs | LinkToEpub';
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-6">
        <section className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <ListOrdered className="w-3.5 h-3.5" /> Translation Jobs
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Current Translation Jobs</h1>
          <p className="text-muted-foreground text-sm">
            <Link to="/raw" className="text-primary hover:underline">Start a new translation →</Link>
          </p>
        </section>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <div className="flex justify-center">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-1" /> {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {jobs.length === 0 && !loading && (
          <p className="text-center text-muted-foreground text-sm">No translation jobs yet.</p>
        )}
        <ul className="space-y-3">
          {jobs.map((job) => {
            const active = ['queued', 'running'].includes(job.status);
            const finished = ['done', 'done_with_errors'].includes(job.status);
            return (
              <li key={job.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                <p className="font-semibold text-sm">{job.title}</p>
                {job.originalTitle && job.originalTitle !== job.title && (
                  <p className="text-xs text-muted-foreground">{job.originalTitle}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {job.status} · {job.phase} · {job.completed}/{job.total || '?'} chapters
                  {job.failed > 0 ? ` · ${job.failed} failed` : ''}
                </p>
                {job.failedChapters && job.failedChapters.length > 0 && (
                  <p className="text-xs text-muted-foreground">Not translated: {job.failedChapters.join(', ')}</p>
                )}
                {job.error && <p className="text-xs text-destructive">{job.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {finished && job.ready && (
                    <Button size="sm" onClick={() => rawDownload(job).catch(() => setError('Download failed'))}>
                      <Download className="w-4 h-4 mr-1" /> Download EPUB
                    </Button>
                  )}
                  {job.libraryStatus === 'saved' && job.libraryUrl && (
                    <a href={job.libraryUrl} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">Library copy</Button>
                    </a>
                  )}
                  {active && (
                    <Button size="sm" variant="outline" onClick={async () => { await rawCancelJob(job.id); load(); }}>
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
