import { useState, useCallback, useRef, useEffect } from 'react';
import { ConversionProgress } from '@/types';
import { ConversionFormData } from '@/components/ConversionForm';
import { useToast } from '@/hooks/use-toast';
import {
  engineFetchTocLive,
  enginePackEpub,
  engineAbort,
  EngineChapter,
} from '@/utils/webtoepub/bridge';
import { fetchChapterLinksLive, ChapterLink } from '@/utils/localWorker';
import { getSiteConfig } from '@/utils/siteConfigs';
import {
  isBackendEnabled,
  isBackendSupportedUrl,
  backendToc,
  backendStartJob,
  backendCancelJob,
  backendDownload,
  pollJob,
  getActiveJobId,
  clearActiveJobId,
  BackendJob,
} from '@/utils/backend';


export interface ChapterItem {
  id: string;
  url: string;
  title: string;
}

export function useEpubConverter() {
  const { toast } = useToast();
  const [progress, setProgress] = useState<ConversionProgress>({
    status: 'idle',
    currentChapter: 0,
    totalChapters: 0,
    message: 'Ready to convert',
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [chapterList, setChapterList] = useState<ChapterItem[] | null>(null);
  const [pendingData, setPendingData] = useState<ConversionFormData | null>(null);
  // Accumulates chapters across async batches without stale-closure issues.
  const liveChaptersRef = useRef<ChapterItem[]>([]);
  // Server-side job (Heroku backend) — survives closing the page.
  const jobIdRef = useRef<string | null>(null);
  const stopPollRef = useRef<null | (() => void)>(null);
  const [serverJob, setServerJob] = useState<BackendJob | null>(null);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  const updateProgress = useCallback((update: Partial<ConversionProgress>) => {
    setProgress(prev => ({ ...prev, ...update }));
  }, []);

  /** Reflects a server job into the local progress UI. */
  const applyJob = useCallback(
    (job: BackendJob) => {
      setServerJob(job);
      if (job.status === 'done') {
        updateProgress({
          status: 'complete',
          currentChapter: job.completed,
          totalChapters: job.total,
          message: 'Conversion completed on the server — ready to download.',
        });
      } else if (job.status === 'error') {
        updateProgress({ status: 'error', message: `Error: ${job.error || 'server job failed'}` });
        clearActiveJobId();
      } else if (job.status === 'cancelled') {
        updateProgress({ status: 'error', message: 'Stopped by user.' });
        clearActiveJobId();
      } else {
        updateProgress({
          status: 'processing-chapters',
          currentChapter: job.completed,
          totalChapters: job.total,
          message: `${job.phase} (${job.completed}/${job.total || '…'})`,
        });
      }
    },
    [updateProgress]
  );

  // Resume an unfinished server job after a reload / reopened tab.
  useEffect(() => {
    if (!isBackendEnabled()) return;
    const id = getActiveJobId();
    if (!id) return;
    jobIdRef.current = id;
    stopPollRef.current = pollJob(id, applyJob);
    return () => stopPollRef.current?.();
  }, [applyJob]);


  const fetchChapters = useCallback(
    async (data: ConversionFormData) => {
      try {
        setLogs([]);
        setChapterList(null);
        liveChaptersRef.current = [];
        setPendingData(data);
        updateProgress({
          status: 'fetching-toc',
          currentChapter: 0,
          totalChapters: 0,
          message: 'Fetching chapters…',
        });
        addLog('Starting chapter fetch');
        addLog(`TOC: ${data.tocUrl}`);

        const siteConfig = getSiteConfig(data.tocUrl);
        const isKnownSite = !!siteConfig;

        /** Called each time a batch of chapter links arrives — updates UI live. */
        const onBatch = (batch: ChapterLink[] | EngineChapter[]) => {
          const newItems: ChapterItem[] = batch.map((c, i) => ({
            id: `${liveChaptersRef.current.length + i}-${c.url}`,
            url: c.url,
            title: c.title || `Chapter ${liveChaptersRef.current.length + i + 1}`,
          }));
          liveChaptersRef.current = [...liveChaptersRef.current, ...newItems];
          setChapterList([...liveChaptersRef.current]);
          updateProgress({
            status: 'fetching-toc',
            totalChapters: liveChaptersRef.current.length,
            message: `Found ${liveChaptersRef.current.length} chapter${liveChaptersRef.current.length === 1 ? '' : 's'}…`,
          });
        };

        let usedFastPath = false;

        // Server backend: only for sites that have a dedicated server-side parser.
        // Everything else goes straight to the browser engine (386 parsers).
        if (isBackendEnabled() && isBackendSupportedUrl(data.tocUrl)) {
          try {
            addLog('Fetching chapter list from the server (streaming)…');
            const { chapters } = await backendToc(data.tocUrl, data.tocSelector, (items) => {
              if (items.length > 0) onBatch(items as ChapterLink[]);
            });
            if (chapters?.length) {
              usedFastPath = true;
              addLog(`Server returned ${chapters.length} chapters`);
            }
          } catch (e) {
            addLog(`Server TOC fetch failed (${(e as Error).message}), falling back…`);
          }
        }

        if (!usedFastPath && isKnownSite) {
          try {
            addLog(`Fast-fetching via direct parser (${siteConfig!.name})…`);
            await fetchChapterLinksLive(data.tocUrl, data.tocSelector, onBatch);
            if (liveChaptersRef.current.length > 0) {
              usedFastPath = true;
              addLog(`Direct fetch complete: ${liveChaptersRef.current.length} chapters`);
            }
          } catch (fastErr) {
            addLog(`Direct fetch failed (${(fastErr as Error).message}), trying engine…`);
            liveChaptersRef.current = [];
            setChapterList(null);
          }
        }

        if (!usedFastPath) {
          updateProgress({ message: 'Loading WebToEpub engine…' });
          addLog('Using WebToEpub engine (streaming)…');
          await engineFetchTocLive(data.tocUrl, onBatch);
          addLog(`Engine fetch complete: ${liveChaptersRef.current.length} chapters`);
        }

        if (liveChaptersRef.current.length === 0) {
          throw new Error('No chapter links found. This site may not be supported.');
        }

        // Apply pre-filter range if set.
        let items = liveChaptersRef.current;
        if (!data.chapterRange.useAll) {
          const startIndex = Math.max(0, data.chapterRange.start - 1);
          const endIndex = Math.min(items.length, data.chapterRange.end);
          items = items.slice(startIndex, endIndex);
          addLog(`Filtered to chapters ${startIndex + 1}–${endIndex}`);
        }

        liveChaptersRef.current = items;
        setChapterList([...items]);
        updateProgress({
          status: 'idle',
          totalChapters: items.length,
          message: `${items.length} chapters ready. Review below, then Generate EPUB.`,
        });
        addLog(`Ready: ${items.length} chapters loaded.`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'An unknown error occurred';
        updateProgress({ status: 'error', message: `Error: ${errorMessage}` });
        addLog(`Fetch failed: ${errorMessage}`);
        toast({
          title: 'Fetch Failed',
          description: errorMessage,
          variant: 'destructive',
          duration: 8000,
        });
      }
    },
    [addLog, updateProgress, toast]
  );


  const generateFromChapters = useCallback(
    async (orderedChapters: ChapterItem[]) => {
      if (!pendingData) return;
      const data = pendingData;
      try {
        if (orderedChapters.length === 0) {
          throw new Error('No chapters selected.');
        }

        const meta = {
          title: data.metadata.title || 'Novel',
          author: data.metadata.author || 'Unknown Author',
          description: data.metadata.description || '',
          language: data.metadata.language || 'en',
          fileName: data.metadata.fileName || `${data.metadata.title || 'novel'}.epub`,
          coverUrl: data.metadata.coverUrl || '',
          tocUrl: data.tocUrl,
        };

        // --- Server-side conversion (keeps running if the page is closed) ---
        if (isBackendEnabled()) {
          try {
            updateProgress({
              status: 'processing-chapters',
              currentChapter: 0,
              totalChapters: orderedChapters.length,
              message: 'Starting server conversion…',
            });
            addLog(`Sending ${orderedChapters.length} chapters to the server…`);
            const job = await backendStartJob({
              tocUrl: data.tocUrl,
              chapters: orderedChapters.map(c => ({ url: c.url, title: c.title })),
              metadata: meta,
            });
            jobIdRef.current = job.id;
            addLog(`Server job started (${job.id}). You can close this page safely.`);
            stopPollRef.current?.();
            stopPollRef.current = pollJob(job.id, j => {
              applyJob(j);
              if (j.status === 'done') {
                addLog('Server finished — downloading EPUB…');
                backendDownload(j)
                  .then(() => clearActiveJobId())
                  .catch(err => addLog(`Download failed: ${(err as Error).message}`));
                toast({
                  title: 'Success!',
                  description: `Converted ${j.completed} chapters on the server.`,
                  duration: 5000,
                });
              }
            });
            return;
          } catch (serverErr) {
            addLog(
              `Server conversion unavailable (${(serverErr as Error).message}) — converting in browser…`
            );
          }
        }

        updateProgress({
          status: 'processing-chapters',
          currentChapter: 0,
          totalChapters: orderedChapters.length,
          message: `Fetching ${orderedChapters.length} chapters and packing EPUB…`,
        });
        addLog(
          `Handing ${orderedChapters.length} chapters to the engine for fetch + pack`
        );


        await enginePackEpub(
          orderedChapters,
          meta,

          ({ current, total, message }) => {
            updateProgress({
              currentChapter: current,
              totalChapters: total || orderedChapters.length,
              message: message
                ? `${message} — fetching chapters…`
                : `Fetching ${orderedChapters.length} chapters and packing EPUB…`,
            });
          }
        );

        updateProgress({
          status: 'complete',
          message: 'Conversion completed successfully!',
        });
        addLog(`EPUB file generated and downloaded: ${data.metadata.title}.epub`);

        toast({
          title: 'Success!',
          description: `Successfully converted ${orderedChapters.length} chapters to EPUB format.`,
          duration: 5000,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'An unknown error occurred';
        updateProgress({ status: 'error', message: `Error: ${errorMessage}` });
        addLog(`Conversion failed: ${errorMessage}`);
        toast({
          title: 'Conversion Failed',
          description: errorMessage,
          variant: 'destructive',
          duration: 10000,
        });
      }
    },
    [pendingData, addLog, updateProgress, toast, applyJob]
  );


  const resetConverter = useCallback(() => {
    setProgress({
      status: 'idle',
      currentChapter: 0,
      totalChapters: 0,
      message: 'Ready to convert',
    });
    setLogs([]);
    setChapterList(null);
    setPendingData(null);
  }, []);

  const stopConversion = useCallback(async () => {
    addLog('Stop requested — aborting…');
    stopPollRef.current?.();
    stopPollRef.current = null;
    if (jobIdRef.current) {
      try {
        await backendCancelJob(jobIdRef.current);
      } catch {
        /* ignore */
      }
      jobIdRef.current = null;
      setServerJob(null);
    }
    await engineAbort();
    updateProgress({ status: 'error', message: 'Stopped by user.' });
    toast({
      title: 'Stopped',
      description: 'Conversion was cancelled.',
      duration: 4000,
    });
  }, [addLog, updateProgress, toast]);

  /** Manually re-download a finished server job (e.g. after reopening the page). */
  const downloadServerJob = useCallback(async () => {
    if (!serverJob || !serverJob.ready) return;
    await backendDownload(serverJob);
    clearActiveJobId();
  }, [serverJob]);


  const isFetchingToc = progress.status === 'fetching-toc';
  const isGenerating =
    progress.status === 'processing-chapters' || progress.status === 'generating-epub';

  return {
    progress,
    logs,
    chapterList,
    setChapterList,
    fetchChapters,
    generateFromChapters,
    resetConverter,
    stopConversion,
    isFetchingToc,
    isGenerating,
    isConverting: isFetchingToc || isGenerating,
    serverJob,
    downloadServerJob,
  };

}
