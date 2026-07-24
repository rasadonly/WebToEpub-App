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
      'https://www.novelhall.com/against-the-gods-0',
      'https://www.novelhall.com/martial-god-asura-0'
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
    tocSelector: '.list-chapter a',
    contentSelector: '#chr-content, .chr-c',
    titleSelector: '.chr-title, h1',
    removeSelectors: ['.ads', '.advertisement', 'script', 'style', 'ins'],
    exampleUrls: [
      'https://novelbin.com/b/against-the-gods-novel'
    ]
  },
  {
    name: 'FreeWebNovel',
    domain: 'freewebnovel.com',
    tocSelector: '#idData a, .m-newest2 a, .chapter-list a',
    contentSelector: '#article, .chapter-content, #chr-content',
    titleSelector: '.chapter-title, h1',
    removeSelectors: ['.ad', '.ads', 'script', 'style', 'ins', 'iframe'],
    exampleUrls: [
      'https://freewebnovel.com/novel/against-the-gods'
    ]
  },
  {
    name: 'NovelFire',
    domain: 'novelfire.net',
    tocSelector: '.chapter-list li a',
    contentSelector: '#content, .chapter-content',
    titleSelector: '.chapter-title, h1',
    removeSelectors: ['.ads', 'script', 'style', 'ins', 'iframe'],
    exampleUrls: [
      'https://novelfire.net/book/shadow-slave'
    ]
  },
  {
    name: 'NovGo',
    domain: 'novgo.net',
    tocSelector: 'option[value]',
    contentSelector: '#chapter-content, #chr-content',
    titleSelector: '.chapter-title, h1',
    removeSelectors: ['.ads', 'script', 'style', 'ins', 'iframe'],
    exampleUrls: [
      'https://novgo.net/novel/shadow-slave'
    ]
  },
  {
    name: 'NovelBuddy',
    domain: 'novelbuddy.com',
    tocSelector: 'api',
    contentSelector: 'api',
    titleSelector: 'api',
    removeSelectors: [],
    exampleUrls: [
      'https://novelbuddy.com/novel/shadow-slave'
    ]
  },
  {
    name: 'NovelArrow',
    domain: 'novelarrow.com',
    tocSelector: 'api',
    contentSelector: 'api',
    titleSelector: 'api',
    removeSelectors: [],
    exampleUrls: [
      'https://novelarrow.com/novel/quick-transmigration-homewrecker-system'
    ]
  },
  {
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    tocSelector: 'api',
    contentSelector: '.text-normal, #chapter-content, .chapter-body',
    titleSelector: 'h1',
    removeSelectors: ['.ads', 'script', 'style'],
    exampleUrls: [
      'https://wtr-lab.com/en/serie-1/some-novel'
    ]
  },
  {
    name: 'Wattpad',
    domain: 'wattpad.com',
    tocSelector: 'api',
    contentSelector: '.part-content, pre.part-content',
    titleSelector: 'h1, .story-meta .title',
    removeSelectors: ['.ads', 'script', 'style', '.ad-placeholder'],
    exampleUrls: [
      'https://www.wattpad.com/story/123456789-some-story'
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