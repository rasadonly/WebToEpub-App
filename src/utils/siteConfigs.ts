import { NovelSite } from '@/types';

export const SUPPORTED_SITES: NovelSite[] = [
  {
    name: 'Novelhall',
    domain: 'novelhall.com',
    tocSelector: '#morelist a',
    contentSelector: '#htmlContent',
    titleSelector: 'h1',
    removeSelectors: ['.ad', '.advertisement', 'script', 'style'],
    exampleUrls: [
      'https://www.novelhall.com/Against-the-Gods-0',
      'https://www.novelhall.com/Martial-God-Asura-0'
    ]
  },
  {
    name: 'Novelfull',
    domain: 'novelfull.com',
    tocSelector: '.list-chapter a',
    contentSelector: '#chapter-content',
    titleSelector: '.chapter-title',
    removeSelectors: ['.ads', '.advertisement', 'script', 'style'],
    exampleUrls: [
      'https://novelfull.com/against-the-gods.html',
      'https://novelfull.com/martial-god-asura.html'
    ]
  },
  {
    name: 'NovelBin',
    domain: 'novelbin.com',
    tocSelector: '.chapter-list a, .list-chapter a, .chapter-item a',
    contentSelector: '.chapter-content, .reading-content, .content-area',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.sidebar', 'script', 'style', '.nav-buttons'],
    exampleUrls: [
      'https://novelbin.com/b/against-the-gods-novel',
      'https://novelbin.com/b/martial-god-asura'
    ]
  },
  {
    name: 'NovelBin ME',
    domain: 'novelbin.me',
    tocSelector: '.chapter-list a, .list-chapter a, .chapter-item a',
    contentSelector: '.chapter-content, .reading-content, .content-area',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.sidebar', 'script', 'style', '.nav-buttons'],
    exampleUrls: [
      'https://novelbin.me/b/against-the-gods-novel',
      'https://novelbin.me/b/martial-god-asura'
    ]
  },
  {
    name: 'NovGo',
    domain: 'novgo.me',
    tocSelector: '.chapter-list a, .episode-list a, .toc a',
    contentSelector: '.chapter-content, .content, .reading-area',
    titleSelector: '.chapter-title, h1, .title',
    removeSelectors: ['.ads', '.advertisement', '.comments', 'script', 'style'],
    exampleUrls: [
      'https://novgo.me/novel/against-the-gods',
      'https://novgo.me/novel/martial-god-asura'
    ]
  },
  {
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    tocSelector: '.chapter-list a, .chapters a, .serie-chapters a',
    contentSelector: '.chapter-content, .content-area, .reading-content',
    titleSelector: '.chapter-title, h1, .chapter-name',
    removeSelectors: ['.ads', '.advertisement', '.navigation', 'script', 'style', '.comments'],
    exampleUrls: [
      'https://wtr-lab.com/en/series/against-the-gods',
      'https://wtr-lab.com/en/series/martial-god-asura'
    ]
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