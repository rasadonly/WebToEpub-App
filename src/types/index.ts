export interface NovelSite {
  name: string;
  domain: string;
  tocSelector: string;
  contentSelector: string;
  titleSelector?: string;
  nextPageSelector?: string;
  removeSelectors?: string[];
  exampleUrls?: string[];
}

export interface ConversionProgress {
  status: 'idle' | 'fetching-toc' | 'processing-chapters' | 'generating-epub' | 'complete' | 'error';
  currentChapter: number;
  totalChapters: number;
  message: string;
}

export interface ChapterData {
  title: string;
  content: string;
  url: string;
  index: number;
}

export interface EpubMetadata {
  title: string;
  author: string;
  language: string;
  description?: string;
  fileName?: string;
  coverUrl?: string;
}