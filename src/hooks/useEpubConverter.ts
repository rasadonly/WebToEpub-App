import { useState, useCallback } from 'react';
import { ConversionProgress, ChapterData } from '@/types';
import { ConversionFormData } from '@/components/ConversionForm';
import { fetchChapterLinks, fetchChapterContent } from '@/utils/workerApi';
import { cleanHtmlContent } from '@/utils/readability';
import { generateEpub } from '@/utils/epubGenerator';
import { resolveUrl, getSiteConfig } from '@/utils/siteConfigs';
import { useToast } from '@/hooks/use-toast';

export function useEpubConverter() {
  const { toast } = useToast();
  const [progress, setProgress] = useState<ConversionProgress>({
    status: 'idle',
    currentChapter: 0,
    totalChapters: 0,
    message: 'Ready to convert'
  });
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  const updateProgress = useCallback((update: Partial<ConversionProgress>) => {
    setProgress(prev => ({ ...prev, ...update }));
  }, []);

  const convertToEpub = useCallback(async (data: ConversionFormData) => {
    try {
      setLogs([]);
      updateProgress({
        status: 'fetching-toc',
        currentChapter: 0,
        totalChapters: 0,
        message: 'Fetching table of contents...'
      });
      addLog('Starting conversion process');
      addLog(`Fetching TOC from: ${data.tocUrl}`);

      // Fetch chapter links
      const chapterLinks = await fetchChapterLinks(data.tocUrl, data.tocSelector);
      
      if (chapterLinks.length === 0) {
        throw new Error('No chapter links found. Please check your TOC selector.');
      }

      // Resolve relative URLs
      const resolvedLinks = chapterLinks.map(link => resolveUrl(data.tocUrl, link));
      
      // Remove duplicates and filter valid URLs
      const uniqueLinks = Array.from(new Set(resolvedLinks)).filter(link => {
        try {
          new URL(link);
          return true;
        } catch {
          return false;
        }
      });

      addLog(`Found ${uniqueLinks.length} chapter links`);
      updateProgress({
        status: 'processing-chapters',
        totalChapters: uniqueLinks.length,
        message: 'Processing chapters...'
      });

      // Get site config for cleanup rules
      const siteConfig = getSiteConfig(data.tocUrl);
      const removeSelectors = siteConfig?.removeSelectors || [];

      // Fetch and process chapters
      const chapters: ChapterData[] = [];
      
      for (let i = 0; i < uniqueLinks.length; i++) {
        const chapterUrl = uniqueLinks[i];
        updateProgress({
          currentChapter: i + 1,
          message: `Processing chapter ${i + 1} of ${uniqueLinks.length}...`
        });
        addLog(`Fetching chapter ${i + 1}: ${getChapterTitle(chapterUrl)}`);

        try {
          const rawContent = await fetchChapterContent(chapterUrl, data.contentSelector);
          
          if (!rawContent.trim()) {
            addLog(`Warning: Chapter ${i + 1} appears to be empty`);
            continue;
          }

          const cleanContent = cleanHtmlContent(rawContent, removeSelectors);
          const title = extractChapterTitle(rawContent, chapterUrl, i + 1);

          chapters.push({
            title,
            content: cleanContent,
            url: chapterUrl,
            index: i
          });

          addLog(`Successfully processed chapter ${i + 1}: ${title}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          addLog(`Error processing chapter ${i + 1}: ${errorMessage}`);
          
          // Continue with other chapters instead of failing completely
          continue;
        }

        // Faster, consistent delay
        if (i < uniqueLinks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      if (chapters.length === 0) {
        throw new Error('No chapters could be processed. Please check your content selector.');
      }

      addLog(`Successfully processed ${chapters.length} chapters`);
      updateProgress({
        status: 'generating-epub',
        message: 'Generating EPUB file...'
      });
      addLog('Generating EPUB file...');

      // Filter chapters based on range
      let finalChapters = chapters;
      if (!data.chapterRange.useAll) {
        const startIndex = Math.max(0, data.chapterRange.start - 1);
        const endIndex = Math.min(chapters.length, data.chapterRange.end);
        finalChapters = chapters.slice(startIndex, endIndex);
        
        addLog(`Filtered chapters ${data.chapterRange.start}-${Math.min(data.chapterRange.end, chapters.length)} (${finalChapters.length} chapters)`);
      }

      // Generate EPUB
      await generateEpub(finalChapters, data.metadata, {
        fontFamily: data.fontFamily,
        includeIndex: data.includeIndex,
        chapterRange: data.chapterRange
      });

      updateProgress({
        status: 'complete',
        message: 'Conversion completed successfully!'
      });
      addLog(`EPUB file generated: ${data.metadata.title}.epub`);
      addLog('Download should start automatically');

      toast({
        title: "Success!",
        description: `Successfully converted ${chapters.length} chapters to EPUB format.`,
        duration: 5000
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      updateProgress({
        status: 'error',
        message: `Error: ${errorMessage}`
      });
      addLog(`Conversion failed: ${errorMessage}`);

      toast({
        title: "Conversion Failed",
        description: errorMessage,
        variant: "destructive",
        duration: 10000
      });
    }
  }, [addLog, updateProgress, toast]);

  const resetConverter = useCallback(() => {
    setProgress({
      status: 'idle',
      currentChapter: 0,
      totalChapters: 0,
      message: 'Ready to convert'
    });
    setLogs([]);
  }, []);

  return {
    progress,
    logs,
    convertToEpub,
    resetConverter,
    isConverting: progress.status !== 'idle' && progress.status !== 'complete' && progress.status !== 'error'
  };
}

function getChapterTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'Unknown Chapter';
  } catch {
    return 'Unknown Chapter';
  }
}

function extractChapterTitle(content: string, url: string, index: number): string {
  // Try to extract title from content
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  
  // Look for common title selectors
  const titleSelectors = ['h1', '.chapter-title', '.title', 'h2'];
  
  for (const selector of titleSelectors) {
    const element = doc.querySelector(selector);
    if (element?.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  
  // Fallback to URL-based title
  const urlTitle = getChapterTitle(url);
  return urlTitle !== 'Unknown Chapter' ? urlTitle : `Chapter ${index}`;
}