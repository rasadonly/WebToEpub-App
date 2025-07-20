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
  },
  {
    name: 'Royal Road',
    domain: 'royalroad.com',
    tocSelector: '.chapter-row td a, .fiction-chapters a',
    contentSelector: '.chapter-content, .chapter-inner',
    titleSelector: '.chapter-title, h1',
    removeSelectors: ['.portlet-ads', '.ads', 'script', 'style'],
    exampleUrls: [
      'https://www.royalroad.com/fiction/21220/mother-of-learning',
      'https://www.royalroad.com/fiction/26534/the-perfect-run'
    ]
  },
  {
    name: 'Webnovel',
    domain: 'webnovel.com',
    tocSelector: '.episode-item a, .chapter-item a',
    contentSelector: '.cha-content, .chapter-entity',
    titleSelector: '.chapter-title, h3',
    removeSelectors: ['.adsbox', '.ads', 'script', 'style'],
    exampleUrls: [
      'https://www.webnovel.com/book/reverend-insanity_7996858406002505',
      'https://www.webnovel.com/book/lord-of-the-mysteries_11022733006234505'
    ]
  },
  {
    name: 'Wuxiaworld',
    domain: 'wuxiaworld.com',
    tocSelector: '.chapter-item a, .table-chapters a',
    contentSelector: '.chapter-content, .fr-view',
    titleSelector: '.chapter-title, h4',
    removeSelectors: ['.ads', 'script', 'style'],
    exampleUrls: [
      'https://www.wuxiaworld.com/novel/coiling-dragon',
      'https://www.wuxiaworld.com/novel/stellar-transformations'
    ]
  },
  {
    name: 'Scribble Hub',
    domain: 'scribblehub.com',
    tocSelector: '.toc_w a, .wi_fic_chp a',
    contentSelector: '#chp_contents, .chp_text',
    titleSelector: '.chapter-title, h1',
    removeSelectors: ['.ads', 'script', 'style'],
    exampleUrls: [
      'https://www.scribblehub.com/series/12345/example-novel',
      'https://www.scribblehub.com/series/67890/another-novel'
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