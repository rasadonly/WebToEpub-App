import { NovelSite } from '@/types';

export const SUPPORTED_SITES: NovelSite[] = [
  {
    name: 'Novelhall',
    domain: 'novelhall.com',
    tocSelector: '#morelist a',
    contentSelector: '#htmlContent',
    titleSelector: 'h1',
    removeSelectors: ['.ad', '.advertisement', 'script', 'style']
  },
  {
    name: 'Novelfull',
    domain: 'novelfull.com',
    tocSelector: '.list-chapter a',
    contentSelector: '#chapter-content',
    titleSelector: '.chapter-title',
    removeSelectors: ['.ads', '.advertisement', 'script', 'style']
  },
  {
    name: 'Royalroad',
    domain: 'royalroad.com',
    tocSelector: '.table-of-contents a',
    contentSelector: '.chapter-content',
    titleSelector: 'h1',
    removeSelectors: ['.portlet-body', 'script', 'style']
  },
  {
    name: 'Webnovel',
    domain: 'webnovel.com',
    tocSelector: '.content-list a',
    contentSelector: '.cha-content',
    titleSelector: '.cha-tit',
    removeSelectors: ['.AD', '.advertisement', 'script', 'style']
  },
  {
    name: 'Novel Updates',
    domain: 'novelupdates.com',
    tocSelector: '.chp-release a',
    contentSelector: '#chapter-content',
    titleSelector: '.chapter-title',
    removeSelectors: ['.ads', 'script', 'style']
  },
  {
    name: 'Scribble Hub',
    domain: 'scribblehub.com',
    tocSelector: '.toc_w a',
    contentSelector: '#chp_raw',
    titleSelector: '.chapter_title',
    removeSelectors: ['.ads', 'script', 'style']
  },
  {
    name: 'Wuxiaworld',
    domain: 'wuxiaworld.com',
    tocSelector: '.panel-body a',
    contentSelector: '.fr-view',
    titleSelector: 'h4',
    removeSelectors: ['.pirate-please', 'script', 'style']
  }
];

export function getSiteConfig(url: string): NovelSite | null {
  const domain = extractDomain(url);
  return SUPPORTED_SITES.find(site => domain.includes(site.domain)) || null;
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

export function resolveUrl(baseUrl: string, relativeUrl: string): string {
  if (isAbsoluteUrl(relativeUrl)) {
    return relativeUrl;
  }
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}