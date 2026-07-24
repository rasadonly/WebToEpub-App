import { useState, useCallback } from 'react';
import { ConversionProgress } from '@/types';
import { ConversionFormData } from '@/components/ConversionForm';
import { useToast } from '@/hooks/use-toast';
import {
  engineFetchToc,
  enginePackEpub,
  engineAbort,
  EngineChapter,
} from '@/utils/webtoepub/bridge';

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

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  const updateProgress = useCallback((update: Partial<ConversionProgress>) => {
    setProgress(prev => ({ ...prev, ...update }));
  }, []);

  const fetchChapters = useCallback(
    async (data: ConversionFormData) => {
      try {
        setLogs([]);
        setChapterList(null);
        setPendingData(data);
        updateProgress({
          status: 'fetching-toc',
          currentChapter: 0,
          totalChapters: 0,
          message: 'Loading WebToEpub engine…',
        });
        addLog('Starting conversion via WebToEpub engine');
        addLog(`Fetching TOC from: ${data.tocUrl}`);

        const engineChapters: EngineChapter[] = await engineFetchToc(data.tocUrl);

        if (engineChapters.length === 0) {
          throw new Error(
            'No chapter links found. This site may not be supported by the engine.'
          );
        }

        addLog(`Engine returned ${engineChapters.length} chapters`);

        let items: ChapterItem[] = engineChapters;
        if (!data.chapterRange.useAll) {
          const startIndex = Math.max(0, data.chapterRange.start - 1);
          const endIndex = Math.min(items.length, data.chapterRange.end);
          items = items.slice(startIndex, endIndex);
          addLog(`Pre-filtered to chapters ${startIndex + 1}-${endIndex}`);
        }

        setChapterList(items);
        updateProgress({
          status: 'idle',
          totalChapters: items.length,
          message: `Fetched ${items.length} chapters. Review and adjust below.`,
        });
        addLog(
          `Ready: ${items.length} chapters loaded. Edit the list, then click Generate EPUB.`
        );
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
          {
            title: data.metadata.title || 'Novel',
            author: data.metadata.author || 'Unknown Author',
            description: data.metadata.description || '',
            language: data.metadata.language || 'en',
            fileName: `${data.metadata.title || 'novel'}.epub`,
          },
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
    [pendingData, addLog, updateProgress, toast]
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
    addLog('Stop requested — aborting engine…');
    await engineAbort();
    updateProgress({ status: 'error', message: 'Stopped by user.' });
    toast({
      title: 'Stopped',
      description: 'Conversion was cancelled.',
      duration: 4000,
    });
  }, [addLog, updateProgress, toast]);

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
  };
}
