export interface WorkerResponse {
  results?: string[];
  error?: string;
}

/** A chapter URL + title pair streamed by fetchChapterLinksLive. */
export interface ChapterLink {
  url: string;
  title: string;
}

/** Called progressively as TOC pages are fetched. */
export type OnChapterBatch = (batch: ChapterLink[]) => void;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// CORS proxy list ported from WebToEpub (public/webtoepub/plugin/js/HttpClient.js).
// Kept in sync with the engine so both fetch paths share the same fallback chain.
// The Heroku backend proxy is prepended at runtime (if backend is enabled) so it
// gets tried first — it's faster and more reliable than public proxies.
export const CORS_PROXY_LIST: Array<{ name: string; url: string }> = [
  { name: "Lovable Proxy", url: "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url=" },
  { name: "Alwaysdata Proxy", url: "https://prasadghanwat.alwaysdata.net/proxy?url=" },
  { name: "Render Proxy", url: "https://render-proxy-1-181c.onrender.com/proxy?url=" },
  { name: "corsproxy.io (with key)", url: "https://corsproxy.io/?key=ab3170e1&url=" },
  { name: "allOrigins (raw)", url: "https://api.allorigins.win/raw?url=" },
  { name: "cors.lol", url: "https://api.cors.lol/?url=" },
];

const BACKEND_URL_KEY = 'backendUrl';
const HEROKU_BACKEND = 'https://link-to-epub-37130-dfa858b712fc.herokuapp.com';
const HF_BACKEND = 'https://prasadonly-web-to-epub-bot.hf.space';

/** Returns active backend proxies (Heroku + Hugging Face) if backend is enabled. */
function getBackendProxies(): Array<{ name: string; url: string }> {
  try {
    if (localStorage.getItem('backendEnabled') === 'false') return [];
    return [
      { name: 'Heroku Proxy', url: `${HEROKU_BACKEND}/api/proxy?url=` },
      { name: 'HuggingFace Proxy', url: `${HF_BACKEND}/api/proxy?url=` },
    ];
  } catch {
    return [];
  }
}

// Proxies that take the target URL as a query param need encodeURIComponent;
// path-style proxies (CORS.SH, ThingProxy) just prefix the raw URL.
const ENCODED_PROXY_SUFFIXES = ["?url=", "?quest=", "&url="];

function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const needsEncoding = ENCODED_PROXY_SUFFIXES.some((s) => proxyBase.endsWith(s));
  return needsEncoding ? proxyBase + encodeURIComponent(targetUrl) : proxyBase + targetUrl;
}

function getActiveCorsProxies(): Array<(url: string) => string> {
  const backends = getBackendProxies();
  const list = backends.length ? [...backends, ...CORS_PROXY_LIST] : CORS_PROXY_LIST;
  return list.map((p) => (url: string) => buildProxyUrl(p.url, url));
}

const CORS_PROXIES: Array<(url: string) => string> = CORS_PROXY_LIST.map(
  (p) => (url: string) => buildProxyUrl(p.url, url)
);


async function httpGet(url: string, extra: Record<string, string> = {}): Promise<Response> {
  let lastErr: unknown = null;
  for (const build of getActiveCorsProxies()) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7_000);
    try {
      const r = await fetch(build(url), {
        headers: { ...DEFAULT_HEADERS, ...extra },
        signal: controller.signal,
      });
      if (r.ok) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All CORS proxies failed");
}

async function getText(url: string): Promise<string> {
  const r = await httpGet(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function getJson(url: string): Promise<any> {
  const r = await httpGet(url, { Accept: "application/json" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function unwrapProxyUrl(url: string): string {
  if (!url) return url;
  if (url.includes("/api/proxy?url=") || url.includes("?url=")) {
    try {
      const match = url.match(/[?&]url=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    } catch {}
  }
  return url;
}

function absoluteUrl(base: string, rel: string): string {
  try {
    return unwrapProxyUrl(new URL(rel, base).href);
  } catch {
    return unwrapProxyUrl(rel);
  }
}

function stripInside(root: Element, selector: string) {
  root.querySelectorAll(selector).forEach((n) => n.remove());
}

function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html.replace(
    /(<[^>]+?(?:href|src|action|data-url|data-href)\s*=\s*["'])([^"']*)(["'])/gi,
    (_, before, val, after) =>
      before + val.replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;") + after
  );
}

// ---------- Site-specific link (TOC) parsers ----------

async function tocFreeWebNovel(
  url: string,
  onBatch?: OnChapterBatch
): Promise<string[]> {
  const base = url.split('?')[0].replace(/\/$/, '');
  const html = await getText(base);
  const doc = parseHtml(html);



  const collectPage = (d: Document): ChapterLink[] => {
    const items: ChapterLink[] = [];
    const seenPageUrls = new Set<string>();
    const chapterPath = `${new URL(base).pathname}/chapter-`;
    const chapterRoot = d.querySelector('#idData');
    const scope: ParentNode = chapterRoot || d;
    const selector = chapterRoot
      ? 'li > a[href]'
      : [`li > a.con[href*="${chapterPath}"]`, `a.con[href*="${chapterPath}"]`, `a[href*="${chapterPath}"]`].join(',');
    scope.querySelectorAll(selector).forEach((a) => {
      const href = a.getAttribute('href');
      const title = (a.textContent || '').trim() || a.getAttribute('title') || '';
      if (href) {
        const abs = absoluteUrl(base, href);
        if (abs.includes(chapterPath) && !seenPageUrls.has(abs)) {
          seenPageUrls.add(abs);
          items.push({ url: abs, title });
        }
      }
    });
    if (items.length === 0) {
      d.querySelectorAll('.m-newest2 a, .chapter-list a').forEach((a) => {
        const href = a.getAttribute('href');
        const title = (a.textContent || '').trim();
        if (href) {
          const abs = absoluteUrl(base, href);
          if (abs.includes(chapterPath) && !seenPageUrls.has(abs)) {
            seenPageUrls.add(abs);
            items.push({ url: abs, title });
          }
        }
      });
    }
    return items;
  };

  const results: string[] = [];
  const firstBatch = collectPage(doc);
  firstBatch.forEach(c => results.push(c.url));
  if (onBatch && firstBatch.length > 0) onBatch(firstBatch);

  // FreeWebNovel paginates the TOC via an AJAX endpoint: ?ajax=chapters&page=N
  let totalPage = 1;
  const indexSelect = doc.querySelector('#indexselect');
  if (indexSelect) {
    totalPage = indexSelect.querySelectorAll('option').length || 1;
  } else {
    for (const script of Array.from(doc.querySelectorAll('script'))) {
      const m = /totalPage:\s*(\d+)/.exec(script.textContent || '');
      if (m) { totalPage = parseInt(m[1]); break; }
    }
    if (totalPage === 1) {
      const m = /totalPage:\s*(\d+)/.exec(html);
      if (m) totalPage = parseInt(m[1]);
    }
  }

  // Some proxies mangle JSON responses, so try JSON first then raw HTML.
  const fetchTocPage = async (pageUrl: string): Promise<string> => {
    try {
      const json = await getJson(pageUrl);
      if (json?.html) return json.html;
    } catch {
      /* fall through */
    }
    const raw = await getText(pageUrl);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return parsed?.html || '';
    } catch {
      return raw.includes('<li') ? raw : '';
    }
  };

  const seen = new Set<string>(results);
  for (let p = 2; p <= totalPage; p++) {
    const ajaxUrl = `${base}?ajax=chapters&page=${p}`;
    let pageHtml = '';
    for (let attempt = 0; attempt < 3 && !pageHtml; attempt++) {
      try {
        pageHtml = await fetchTocPage(ajaxUrl);
      } catch {
        /* retry */
      }
    }
    if (!pageHtml) continue;
    const batch = collectPage(parseHtml(pageHtml)).filter((c) => !seen.has(c.url));
    if (batch.length === 0) continue;
    batch.forEach((c) => {
      seen.add(c.url);
      results.push(c.url);
    });
    if (onBatch) onBatch(batch);
  }



  return results;
}


async function tocNovelFire(
  url: string,
  onBatch?: OnChapterBatch
): Promise<string[]> {
  let base = url.replace(/\/$/, "");
  if (base.endsWith("/chapters")) base = base.slice(0, -"/chapters".length);
  const chaptersUrl = `${base}/chapters`;

  const firstHtml = await getText(chaptersUrl);
  const pages = Array.from(
    new Set(Array.from(firstHtml.matchAll(/chapters\?page=(\d+)/g)).map((m) => parseInt(m[1])))
  ).sort((a, b) => a - b);
  const maxPage = pages.length ? Math.max(...pages) : 1;

  const collectPage = (html: string): ChapterLink[] => {
    const items: ChapterLink[] = [];
    const d = parseHtml(html);
    d.querySelectorAll(".chapter-list li a").forEach((a) => {
      const href = a.getAttribute("href");
      const title = (a.textContent || '').trim();
      if (href) items.push({ url: absoluteUrl(chaptersUrl, href), title });
    });
    return items;
  };

  const results: string[] = [];
  const firstBatch = collectPage(firstHtml);
  firstBatch.forEach(c => results.push(c.url));
  if (onBatch && firstBatch.length > 0) onBatch(firstBatch);

  for (let p = 2; p <= maxPage; p++) {
    try {
      const h = await getText(`${chaptersUrl}?page=${p}`);
      if (h) {
        const batch = collectPage(h);
        batch.forEach(c => results.push(c.url));
        if (onBatch && batch.length > 0) onBatch(batch);
      }
    } catch { /* skip */ }
  }
  return results;
}


async function tocNovGo(url: string): Promise<string[]> {
  const html = await getText(url);
  const doc = parseHtml(html);
  const novelIdEl = doc.querySelector("[data-novel-id]");
  const novelId =
    novelIdEl?.getAttribute("data-novel-id") ||
    html.match(/novelId["'\s:=]+["']?(\d+)/)?.[1];
  if (!novelId) throw new Error("NovGo: novelId not found");

  const origin = new URL(url).origin;
  const apiUrl = `${origin}/ajax-chapter-option?novelId=${novelId}`;
  const apiHtml = await getText(apiUrl);
  const apiDoc = parseHtml(apiHtml);
  const results: string[] = [];
  apiDoc.querySelectorAll("option[value]").forEach((opt) => {
    const val = opt.getAttribute("value");
    if (val) results.push(absoluteUrl(origin, val));
  });
  return results;
}

async function tocNovelBuddy(url: string): Promise<string[]> {
  // Load novel page and read __NEXT_DATA__
  const html = await getText(url);
  const doc = parseHtml(html);
  const nextData = doc.querySelector("script#__NEXT_DATA__");
  if (!nextData?.textContent) throw new Error("NovelBuddy: __NEXT_DATA__ missing");
  const data = JSON.parse(nextData.textContent);
  const pageProps = data?.props?.pageProps || {};
  const apiUrl: string | undefined = pageProps?.siteConfig?.apiUrl;
  const mangaId: string | undefined =
    pageProps?.manga?.id || pageProps?.item?.id || pageProps?.data?.id;
  if (!apiUrl || !mangaId) throw new Error("NovelBuddy: apiUrl/mangaId missing");

  const listUrl = `${apiUrl.replace(/\/$/, "")}/titles/${mangaId}/chapters`;
  const listJson = await getJson(listUrl);
  const chaps: any[] = listJson?.data?.chapters || [];
  // API returns newest-first; reverse to ascending
  return chaps
    .slice()
    .reverse()
    .map((c) => `${apiUrl.replace(/\/$/, "")}/titles/${mangaId}/chapters/${c.id || c._id}`);
}

async function tocNovelArrow(url: string): Promise<string[]> {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const slug = parts.includes("novel") ? parts[parts.indexOf("novel") + 1] : parts[parts.length - 1];
  const apiBase = `${u.origin}/api-web`;
  const listUrl = `${apiBase}/novels/${slug}/chapters?sort=asc`;
  const listJson = await getJson(listUrl);
  const items: any[] = listJson?.items || [];
  return items
    .map((c) => c.chapter_id)
    .filter(Boolean)
    .map((cid) => `${apiBase}/novels/${slug}/chapters/${cid}`);
}

async function tocNovelFull(
  url: string,
  onBatch?: OnChapterBatch
): Promise<string[]> {
  const html = await getText(url);
  const doc = parseHtml(html);
  let limit = 1;
  const options = doc.querySelectorAll("#indexselect option");
  if (options.length > 0) {
    limit = options.length;
  } else {
    const lastPageEl = doc.querySelector("li.last a");
    if (lastPageEl) {
      const rawHref = unwrapProxyUrl(lastPageEl.getAttribute("href") || "");
      const page =
        lastPageEl.getAttribute("data-page") ||
        new URL(rawHref, url).searchParams.get("page");
      if (page) limit = parseInt(page) + 1;
    }
  }
  const origin = new URL(url).origin;

  const collectPage = (h: string): ChapterLink[] => {
    const items: ChapterLink[] = [];
    parseHtml(h)
      .querySelectorAll("#idData li a, #idData a, ul.list-chapter a, .list-chapter a, ul.chapter-list a")
      .forEach((a) => {
        const href = a.getAttribute("href");
        const title = (a.textContent || '').trim();
        if (href) items.push({ url: absoluteUrl(origin, href), title });
      });
    return items;
  };

  const results: string[] = [];
  // Fetch all pages in parallel (novelfull pages are fast), but stream page 1 first.
  const firstBatch = collectPage(html);
  firstBatch.forEach(c => results.push(c.url));
  if (onBatch && firstBatch.length > 0) onBatch(firstBatch);

  if (limit > 1) {
    // Fetch pages 2..limit in parallel, then emit as they resolve.
    const pageUrls: string[] = [];
    for (let i = 2; i <= limit; i++) pageUrls.push(`${url}?page=${i}&per-page=50`);
    await Promise.all(
      pageUrls.map(async (u) => {
        try {
          const h = await getText(u);
          if (!h) return;
          const batch = collectPage(h);
          batch.forEach(c => results.push(c.url));
          if (onBatch && batch.length > 0) onBatch(batch);
        } catch { /* skip */ }
      })
    );
  }
  return results;
}

async function tocNovelBin(
  url: string,
  onBatch?: OnChapterBatch
): Promise<string[]> {
  const html = await getText(url);
  const idMatch = html.match(/data-novel-id=["'](\d+)["']/);
  const origin = new URL(url).origin;
  const novelId = idMatch?.[1] || new URL(url).pathname.split("/").filter(Boolean).pop();
  const ajaxHtml = await getText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
  const results: ChapterLink[] = [];
  parseHtml(ajaxHtml)
    .querySelectorAll("a[href]")
    .forEach((a) => {
      const href = a.getAttribute("href");
      const title = (a.textContent || '').trim();
      if (href) results.push({ url: absoluteUrl(origin, href), title });
    });
  if (onBatch && results.length > 0) onBatch(results);
  return results.map(c => c.url);
}


async function tocWtrLab(url: string): Promise<string[]> {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const language = parts[0] || "en";
  const slug = parts[parts.length - 1].split("?")[0];
  // Two URL shapes exist:
  //   /en/serie-12345/slug            -> id in the "serie-" segment
  //   /en/novel/12345/slug            -> id is the numeric segment after "novel"
  const seriePart = parts.find((p) => p.startsWith("serie-"));
  let id = seriePart?.slice(6);
  if (!id) {
    const novelIdx = parts.indexOf("novel");
    if (novelIdx >= 0 && /^\d+$/.test(parts[novelIdx + 1] || "")) id = parts[novelIdx + 1];
  }
  if (!id) id = parts.find((p) => /^\d+$/.test(p));
  if (!id) throw new Error("wtr-lab: serie id missing");
  const json = await getJson(`https://wtr-lab.com/api/chapters/${id}`);
  const chapters = json.chapters || json.data?.chapters || [];
  return chapters.map(
    (a: any) => `https://wtr-lab.com/${language}/serie-${id}/${slug}/${a.order ?? a.id}`
  );
}

// ---------- Site-specific chapter body ----------

function extractWithSelector(doc: Document, selectors: string): string {
  const sels = selectors.split(",").map((s) => s.trim()).filter(Boolean);
  for (const sel of sels) {
    const el = doc.querySelector(sel);
    if (el) {
      stripInside(el, "script, style, ins, iframe, .ad, .ads, .advertisement, a[href*='utm_source'], a[href^='mailto:']");
      return sanitizeHtml(el.innerHTML);
    }
  }
  return "";
}

async function bodyFreeWebNovel(url: string): Promise<string> {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, "#article, .chapter-content, #chr-content");
}

async function bodyNovelFire(url: string): Promise<string> {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, "#content, .chapter-content");
}

async function bodyNovGo(url: string): Promise<string> {
  const doc = parseHtml(await getText(url));
  const container = doc.querySelector("#chapter-content, #chr-content");
  if (!container) return "";
  stripInside(container, "script, style, iframe, ins");
  container.querySelectorAll("div").forEach((d) => {
    // drop empty container divs but keep paragraphs
    if (!d.textContent?.trim()) d.remove();
  });
  return container.innerHTML;
}

async function bodyNovelBuddy(apiChapterUrl: string): Promise<string> {
  const json = await getJson(apiChapterUrl);
  return json?.data?.chapter?.content || "";
}

async function bodyNovelArrow(apiChapterUrl: string): Promise<string> {
  const json = await getJson(apiChapterUrl);
  return json?.item?.chapterInfo?.chapter_content || "";
}

async function bodyGeneric(url: string, selector: string): Promise<string> {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, selector || "#chapter-content, .chapter-content, article, .content");
}

// ---------- Dispatch ----------

function siteKey(hostname: string): string {
  if (hostname.includes("novelhall.com")) return "novelhall";
  if (hostname.includes("freewebnovel.com")) return "freewebnovel";
  if (hostname.includes("novelfire.")) return "novelfire";
  if (hostname.includes("novgo.")) return "novgo";
  if (hostname.includes("novelbuddy.com")) return "novelbuddy";
  if (hostname.includes("novelarrow.com")) return "novelarrow";
  if (hostname.includes("novelfull")) return "novelfull";
  if (hostname.includes("novelbin") || hostname.includes("novlove")) return "novelbin";
  if (hostname.includes("wtr-lab.com")) return "wtrlab";
  if (hostname.includes("wattpad.com")) return "wattpad";
  return "generic";
}

async function tocNovelhall(url: string): Promise<string[]> {
  const doc = parseHtml(await getText(url));
  const out: string[] = [];
  doc.querySelectorAll("#morelist a, .book-catalog a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href) out.push(absoluteUrl(url, href));
  });
  return out;
}

async function bodyNovelhall(url: string): Promise<string> {
  const doc = parseHtml(await getText(url));
  const el =
    doc.querySelector("div#htmlContent") ||
    doc.querySelector("article div.entry-content") ||
    doc.querySelector("div.entry-content") ||
    doc.querySelector("div.read-content") ||
    doc.querySelector("div.content");
  if (!el) return "";
  stripInside(
    el,
    "script, style, ins, iframe, .ad, .ads, .advertisement, .chapter-nav, .nav, center, a[href*='novelhall.com/'], div.mnt, div#volumelist"
  );
  // Novelhall separates paragraphs with <br> tags only — turn them into <p>.
  const html = el.innerHTML;
  if (!/<p[\s>]/i.test(html) && /<br/i.test(html)) {
    const parts = html
      .split(/(?:\s*<br\s*\/?>\s*)+/i)
      .map((s) => s.trim())
      .filter((s) => s && s.replace(/<[^>]+>/g, "").trim().length > 0);
    if (parts.length) return parts.map((p) => `<p>${p}</p>`).join("\n");
  }
  return html;
}

// ---- Wattpad ----
// Wattpad's public API v3 endpoint returns JSON with story parts.
// Story URLs: https://www.wattpad.com/story/{storyId}-{slug}
// Part URLs:  https://www.wattpad.com/{partId}-{slug}

function wattpadStoryId(url: string): string | null {
  // Match /story/1234567 or /myworks/1234567
  const m = url.match(/(?:\/story\/|story\/)([0-9]+)/);
  if (m) return m[1];
  // Some URLs put the ID directly after wattpad.com/
  const m2 = url.match(/wattpad\.com\/([0-9]+)/);
  return m2 ? m2[1] : null;
}

async function tocWattpad(url: string): Promise<string[]> {
  const storyId = wattpadStoryId(url);
  if (!storyId) throw new Error("Wattpad: could not extract story ID from URL");

  // Fetch the story info via Wattpad's v3 API (public, no auth needed)
  const apiBase = "https://www.wattpad.com/api/v3";
  const storyJson = await getJson(
    `${apiBase}/stories/${storyId}?fields=id,title,parts(id,title,url)`
  );
  const parts: Array<{ id: number; title: string; url: string }> =
    storyJson?.parts || [];
  if (!parts.length) throw new Error("Wattpad: no chapters found via API");
  // Return the canonical part URLs
  return parts.map((p) =>
    p.url.startsWith("http") ? p.url : `https://www.wattpad.com/${p.id}`
  );
}

async function bodyWattpad(url: string): Promise<string> {
  const partIdMatch = url.match(/wattpad\.com\/(\d+)/);
  let html = "";
  if (partIdMatch) {
    try {
      const apiBase = "https://www.wattpad.com/api/v3";
      const partJson = await getJson(
        `${apiBase}/story_parts/${partIdMatch[1]}?fields=id,title,text`
      );
      if ((partJson?.text || "").trim().length > 20) {
        html = partJson.text;
      }
    } catch { /* fall through to scraping */ }
  }
  if (!html) {
    // Fallback: scrape the page
    html = extractWithSelector(
      parseHtml(await getText(url)),
      ".part-content, pre.part-content, [data-field='text']"
    );
  }
  if (!html) return "";

  // Sanitize for EPUB XML validity
  const doc = parseHtml(`<div id="_wp_root">${html}</div>`);
  const root = doc.querySelector("#_wp_root");
  if (!root) return html;

  stripInside(root, [
    "figure.media-share",
    ".share-buttons",
    "[class*='share']",
    "[class*='social']",
    "a[href^='mailto:']",
    "a[href*='utm_source']",
    "a[href*='utm_medium']",
    ".report-story",
    ".author-info",
    ".follow-button",
    ".reading-widget",
    ".promoted-stories-container",
    ".left-rail",
    ".right-rail",
    "#sticky-nav",
    ".sidebar",
    ".share-tools",
    ".part-footer-actions",
    ".component-wrapper",
    ".carousel-indicators",
    ".social-icons-container",
    ".image-options-container",
    "a[href*='pinterest']",
    "a[href*='facebook.com/sharer']",
    "a[href*='twitter.com/intent']",
    "a[href*='tumblr.com']"
  ].join(", "));

  const fixAmpersand = (val: string | null) =>
    val ? val.replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;") : val;

  root.querySelectorAll("[href], [src], [action], [data-url]").forEach((el) => {
    for (const attr of ["href", "src", "action", "data-url"]) {
      const v = el.getAttribute(attr);
      if (v) {
        let clean = fixAmpersand(v) || "";
        clean = clean.replace(/"/g, "&quot;");
        el.setAttribute(attr, clean);
      }
    }
  });

  return sanitizeHtml(root.innerHTML);
}

export async function fetchChapterLinks(tocUrl: string, linkSelector: string): Promise<string[]> {
  const hostname = new URL(tocUrl).hostname;
  const key = siteKey(hostname);
  try {
    switch (key) {
      case "novelhall":    return await tocNovelhall(tocUrl);
      case "freewebnovel": return await tocFreeWebNovel(tocUrl);
      case "novelfire":    return await tocNovelFire(tocUrl);
      case "novgo":        return await tocNovGo(tocUrl);
      case "novelbuddy":   return await tocNovelBuddy(tocUrl);
      case "novelarrow":   return await tocNovelArrow(tocUrl);
      case "novelfull":    return await tocNovelFull(tocUrl);
      case "novelbin":     return await tocNovelBin(tocUrl);
      case "wtrlab":       return await tocWtrLab(tocUrl);
      case "wattpad":      return await tocWattpad(tocUrl);
      default: {
        const doc = parseHtml(await getText(tocUrl));
        const out: string[] = [];
        doc.querySelectorAll(linkSelector || "a[href]").forEach((a) => {
          const href = a.getAttribute("href");
          if (href) out.push(absoluteUrl(tocUrl, href));
        });
        return out;
      }
    }
  } catch (e) {
    throw new Error(`Failed to fetch chapter links: ${(e as Error).message}`);
  }
}

/**
 * Streaming version of fetchChapterLinks.
 * Calls onBatch() each time a page of the TOC is fetched, so chapters appear
 * in the UI progressively rather than all at once at the end.
 * Returns the complete flat list when all pages are done.
 */
export async function fetchChapterLinksLive(
  tocUrl: string,
  linkSelector: string,
  onBatch: OnChapterBatch
): Promise<ChapterLink[]> {
  const hostname = new URL(tocUrl).hostname;
  const key = siteKey(hostname);
  const all: ChapterLink[] = [];
  const wrap = (batch: ChapterLink[]) => {
    all.push(...batch);
    onBatch(batch);
  };

  try {
    switch (key) {
      case "freewebnovel": await tocFreeWebNovel(tocUrl, wrap); break;
      case "novelfire":    await tocNovelFire(tocUrl, wrap); break;
      case "novelfull":    await tocNovelFull(tocUrl, wrap); break;
      case "novelbin":     await tocNovelBin(tocUrl, wrap); break;
      default: {
        // For sites that return everything at once (API-based / single-page),
        // fetch and emit one batch so the UI still updates.
        const urls = await fetchChapterLinks(tocUrl, linkSelector);
        const batch = urls.map((url, i) => ({ url, title: `Chapter ${i + 1}` }));
        if (batch.length > 0) wrap(batch);
        break;
      }
    }
  } catch (e) {
    throw new Error(`Failed to fetch chapter links: ${(e as Error).message}`);
  }

  return all;
}


export async function fetchChapterContent(
  chapterUrl: string,
  contentSelector: string
): Promise<string> {
  const hostname = (() => {
    try { return new URL(chapterUrl).hostname; } catch { return ""; }
  })();
  const key = siteKey(hostname);

  const attempt = async (): Promise<string> => {
    switch (key) {
      case "novelhall":    return bodyNovelhall(chapterUrl);
      case "freewebnovel": return bodyFreeWebNovel(chapterUrl);
      case "novelfire":    return bodyNovelFire(chapterUrl);
      case "novgo":        return bodyNovGo(chapterUrl);
      case "novelbuddy":   return bodyNovelBuddy(chapterUrl);
      case "novelarrow":   return bodyNovelArrow(chapterUrl);
      case "wattpad":      return bodyWattpad(chapterUrl);
      default:             return bodyGeneric(chapterUrl, contentSelector);
    }
  };

  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const html = await attempt();
      if (html && html.replace(/<[^>]+>/g, "").trim().length >= 20) return html;
      last = html;
    } catch (e) {
      last = "";
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  if (last) return last;
  throw new Error("Chapter content appears to be empty");
}

// Kept for backwards compatibility with older imports.
export async function fetchHtmlContent(
  url: string,
  selector: string = "body",
  mode: string = "content"
): Promise<WorkerResponse> {
  try {
    if (mode === "link") {
      const results = await fetchChapterLinks(url, selector);
      return { results };
    }
    const content = await fetchChapterContent(url, selector);
    return { results: [content] };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
