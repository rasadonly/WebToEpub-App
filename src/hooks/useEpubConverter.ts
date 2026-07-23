import { useState, useCallback } from 'react';
import { ConversionProgress, ChapterData } from '@/types';
import { ConversionFormData } from '@/components/ConversionForm';
import { fetchChapterLinks, fetchChapterContent } from '@/utils/localWorker';
import { cleanHtmlContent } from '@/utils/readability';
import { generateEpub } from '@/utils/epubGenerator';
import { resolveUrl, getSiteConfig } from '@/utils/siteConfigs';
import { useToast } from '@/hooks/use-toast';

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
    message: 'Ready to convert'
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

  const fetchChapters = useCallback(async (data: ConversionFormData) => {
    try {
      setLogs([]);
      setChapterList(null);
      setPendingData(data);
      updateProgress({
        status: 'fetching-toc',
        currentChapter: 0,
        totalChapters: 0,
        message: 'Fetching table of contents...'
      });
      addLog('Starting conversion process');
      addLog(`Fetching TOC from: ${data.tocUrl}`);

      const chapterLinks = await fetchChapterLinks(data.tocUrl, data.tocSelector);

      if (chapterLinks.length === 0) {
        throw new Error('No chapter links found. Please check your TOC selector.');
      }

      const resolvedLinks = chapterLinks.map(link => resolveUrl(data.tocUrl, link));
      const uniqueLinks = Array.from(new Set(resolvedLinks)).filter(link => {
        try {
          new URL(link);
          return true;
        } catch {
          return false;
        }
      });

      addLog(`Found ${uniqueLinks.length} chapter links`);

      // Apply the form's initial range as a pre-filter
      let workingLinks = uniqueLinks;
      let indexOffset = 0;
      if (!data.chapterRange.useAll) {
        const startIndex = Math.max(0, data.chapterRange.start - 1);
        const endIndex = Math.min(uniqueLinks.length, data.chapterRange.end);
        workingLinks = uniqueLinks.slice(startIndex, endIndex);
        indexOffset = startIndex;
        addLog(`Pre-filtered to chapters ${startIndex + 1}-${endIndex}`);
      }

      const items: ChapterItem[] = workingLinks.map((url, i) => ({
        id: `${indexOffset + i}-${url}`,
        url,
        title: getChapterTitle(url) || `Chapter ${indexOffset + i + 1}`
      }));

      setChapterList(items);
      updateProgress({
        status: 'idle',
        totalChapters: items.length,
        message: `Fetched ${items.length} chapters. Review and adjust below.`
      });
      addLog(`Ready: ${items.length} chapters loaded. Edit the list, then click Generate EPUB.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      updateProgress({ status: 'error', message: `Error: ${errorMessage}` });
      addLog(`Fetch failed: ${errorMessage}`);
      toast({
        title: 'Fetch Failed',
        description: errorMessage,
        variant: 'destructive',
        duration: 8000
      });
    }
  }, [addLog, updateProgress, toast]);

  const generateFromChapters = useCallback(async (orderedChapters: ChapterItem[]) => {
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
        message: 'Processing chapters...'
      });

      const siteConfig = getSiteConfig(data.tocUrl);
      const removeSelectors = siteConfig?.removeSelectors || [];

      const chapters: ChapterData[] = [];

      for (let i = 0; i < orderedChapters.length; i++) {
        const item = orderedChapters[i];
        updateProgress({
          currentChapter: i + 1,
          message: `Processing chapter ${i + 1} of ${orderedChapters.length}...`
        });
        addLog(`Fetching chapter ${i + 1}: ${item.title}`);

        try {
          const rawContent = await fetchChapterContent(item.url, data.contentSelector);
          if (!rawContent.trim()) {
            addLog(`Warning: Chapter ${i + 1} appears to be empty`);
            continue;
          }
          const cleanContent = cleanHtmlContent(rawContent, removeSelectors);
          const title = extractChapterTitle(rawContent, item.url, i + 1) || item.title;
          chapters.push({ title, content: cleanContent, url: item.url, index: i });
          addLog(`Successfully processed chapter ${i + 1}: ${title}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          addLog(`Error processing chapter ${i + 1}: ${errorMessage}`);
          continue;
        }

        if (i < orderedChapters.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (chapters.length === 0) {
        throw new Error('No chapters could be processed. Please check your content selector.');
      }

      updateProgress({ status: 'generating-epub', message: 'Generating EPUB file...' });
      addLog('Generating EPUB file...');

      await generateEpub(chapters, data.metadata, {
        fontFamily: data.fontFamily,
        includeIndex: data.includeIndex,
        chapterRange: data.chapterRange
      });

      updateProgress({ status: 'complete', message: 'Conversion completed successfully!' });
      addLog(`EPUB file generated: ${data.metadata.title}.epub`);

      toast({
        title: 'Success!',
        description: `Successfully converted ${chapters.length} chapters to EPUB format.`,
        duration: 5000
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      updateProgress({ status: 'error', message: `Error: ${errorMessage}` });
      addLog(`Conversion failed: ${errorMessage}`);
      toast({
        title: 'Conversion Failed',
        description: errorMessage,
        variant: 'destructive',
        duration: 10000
      });
    }
  }, [pendingData, addLog, updateProgress, toast]);

  const resetConverter = useCallback(() => {
    setProgress({
      status: 'idle',
      currentChapter: 0,
      totalChapters: 0,
      message: 'Ready to convert'
    });
    setLogs([]);
    setChapterList(null);
    setPendingData(null);
  }, []);

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
    isFetchingToc,
    isGenerating,
    isConverting: isFetchingToc || isGenerating
  };
}

function getChapterTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    return last
      .replace(/\.(html?|xhtml)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function extractChapterTitle(content: string, url: string, index: number): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const titleSelectors = ['h1', '.chapter-title', '.title', 'h2'];
  for (const selector of titleSelectors) {
    const element = doc.querySelector(selector);
    if (element?.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  const urlTitle = getChapterTitle(url);
  return urlTitle || `Chapter ${index}`;
}
