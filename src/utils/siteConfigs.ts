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
    name: 'NovelBin',
    domain: 'novelbin.com',
    tocSelector: '.chapter-list a, .list-chapter a, .chapter-item a',
    contentSelector: '.chapter-content, .reading-content, .content-area',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.sidebar', 'script', 'style', '.nav-buttons']
  },
  {
    name: 'NovelBin ME',
    domain: 'novelbin.me',
    tocSelector: '.chapter-list a, .list-chapter a, .chapter-item a',
    contentSelector: '.chapter-content, .reading-content, .content-area',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.sidebar', 'script', 'style', '.nav-buttons']
  },
  {
    name: 'NovGo',
    domain: 'novgo.me',
    tocSelector: '.chapter-list a, .episode-list a, .toc a',
    contentSelector: '.chapter-content, .content, .reading-area',
    titleSelector: '.chapter-title, h1, .title',
    removeSelectors: ['.ads', '.advertisement', '.comments', 'script', 'style']
  },
  {
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    tocSelector: '.chapter-list a, .chapters a, .serie-chapters a',
    contentSelector: '.chapter-content, .content-area, .reading-content',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.navigation', 'script', 'style', '.comments']
  }
];

export function getSiteConfig(url: string): NovelSite | null {
  const domain = extractDomain(url);
  
  // Check for custom sites first
  const customSites = (window as any).customSiteConfigs || JSON.parse(localStorage.getItem('customSites') || '[]');
  const allSites = [...customSites, ...SUPPORTED_SITES];
  
  return allSites.find(site => domain.includes(site.domain)) || null;
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