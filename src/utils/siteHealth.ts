import { CORS_PROXY_LIST } from '@/utils/localWorker';
import { supabase } from '@/integrations/supabase/client';

export type SiteStatus = 'up' | 'parked' | 'down' | 'unknown';

export interface SiteHealth {
  host: string;
  status: SiteStatus;
  checkedAt: number;
  note?: string;
}

const CACHE_KEY = 'siteHealthCache_v1';
const TTL_MS = 24 * 60 * 60 * 1000;

const ENCODED_SUFFIXES = ['?url=', '?quest=', '&url='];
function buildProxyUrl(base: string, target: string) {
  return ENCODED_SUFFIXES.some((s) => base.endsWith(s))
    ? base + encodeURIComponent(target)
    : base + target;
}

// Signals that a domain is expired / parked / a fake ad landing page.
const PARKING_PATTERNS: RegExp[] = [
  /domain\s+(is\s+)?(for\s+sale|parking|parked)/i,
  /buy\s+this\s+domain/i,
  /this\s+domain\s+(may\s+be|is)\s+for\s+sale/i,
  /sedoparking|parkingcrew|bodis\.com|above\.com|dan\.com\/buy-domain|afternic|hugedomains|namecheap\s+parking/i,
  /related\s+searches/i,
  /the\s+domain\s+name\s+.{0,40}\s+is\s+available/i,
  /website\s+(is\s+)?(coming\s+soon|under\s+construction)/i,
  /account\s+suspended|site\s+suspended|this\s+site\s+can[’']?t\s+be\s+reached/i,
  /default\s+web\s+site\s+page|apache2?\s+(ubuntu\s+)?default\s+page|welcome\s+to\s+nginx/i,
];

function classify(html: string): { status: SiteStatus; note?: string } {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const trimmed = text.replace(/\s+/g, ' ').trim();

  for (const re of PARKING_PATTERNS) {
    if (re.test(html) || re.test(trimmed)) {
      return { status: 'parked', note: 'Looks like a parking / placeholder page' };
    }
  }
  if (trimmed.length < 400) {
    return { status: 'parked', note: 'Almost no page content' };
  }
  return { status: 'up' };
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function checkSite(host: string): Promise<SiteHealth> {
  const target = `https://${host}/`;
  // Try a few proxies only — keeps checks fast across hundreds of hosts.
  for (const proxy of CORS_PROXY_LIST.slice(0, 4)) {
    try {
      const res = await fetchWithTimeout(buildProxyUrl(proxy.url, target), 12000);
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 50) continue;
      const { status, note } = classify(html);
      return { host, status, note, checkedAt: Date.now() };
    } catch {
      /* try next proxy */
    }
  }
  return { host, status: 'down', note: 'No response', checkedAt: Date.now() };
}

export function loadCache(): Record<string, SiteHealth> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, SiteHealth>;
    const now = Date.now();
    const fresh: Record<string, SiteHealth> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && now - v.checkedAt < TTL_MS) fresh[k] = v;
    }
    return fresh;
  } catch {
    return {};
  }
}

export function saveCache(cache: Record<string, SiteHealth>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — ignore */
  }
}

export const STATUS_RANK: Record<SiteStatus, number> = {
  up: 0,
  unknown: 1,
  parked: 2,
  down: 3,
};

/** Runs checks with limited concurrency, reporting each result as it lands. */
export async function checkSites(
  hosts: string[],
  onResult: (h: SiteHealth) => void,
  concurrency = 8,
  shouldStop?: () => boolean
) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, hosts.length) }, async () => {
    while (i < hosts.length) {
      if (shouldStop?.()) return;
      const host = hosts[i++];
      const result = await checkSite(host);
      onResult(result);
    }
  });
  await Promise.all(workers);
}
