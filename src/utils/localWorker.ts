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
export const CORS_PROXY_LIST: Array<{ name: string; url: string }> = [
  { name: "corsproxy.io (with key)", url: "https://corsproxy.io/?key=ab3170e1&url=" },
  { name: "allOrigins (raw)", url: "https://api.allorigins.win/raw?url=" },
  { name: "CORS.SH", url: "https://proxy.cors.sh/" },
  { name: "CodeTabs", url: "https://api.codetabs.com/v1/proxy?quest=" },
  { name: "ThingProxy", url: "https://thingproxy.freeboard.io/fetch/" },
  { name: "cors.lol", url: "https://api.cors.lol/?url=" },
  { name: "Render Proxy", url: "https://render-proxy-1-181c.onrender.com/proxy?url=" },
  { name: "Alwaysdata Proxy", url: "https://prasadghanwat.alwaysdata.net/proxy?url=" },
  { name: "Lovable Proxy", url: "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url=" },
];

// Proxies that take the target URL as a query param need encodeURIComponent;
// path-style proxies (CORS.SH, ThingProxy) just prefix the raw URL.
const ENCODED_PROXY_SUFFIXES = ["?url=", "?quest=", "&url="];

function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const needsEncoding = ENCODED_PROXY_SUFFIXES.some((s) => proxyBase.endsWith(s));
  return needsEncoding ? proxyBase + encodeURIComponent(targetUrl) : proxyBase + targetUrl;
}

const CORS_PROXIES: Array<(url: string) => string> = CORS_PROXY_LIST.map(
  (p) => (url: string) => buildProxyUrl(p.url, url)
);

async function httpGet(url: string, extra: Record<string, string> = {}): Promise<Response> {
  let lastErr: unknown = null;
  for (const build of CORS_PROXIES) {
    try {
      const r = await fetch(build(url), { headers: { ...DEFAULT_HEADERS, ...extra } });
      if (r.ok) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
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

function absoluteUrl(base: string, rel: string): string {
  try {
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
}

function stripInside(root: Element, selector: string) {
  root.querySelectorAll(selector).forEach((n) => n.remove());
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
    d.querySelectorAll('#idData li > a, li > a.con, li > a[href], a.con[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const title = (a.textContent || '').trim() || a.getAttribute('title') || '';
      if (href) items.push({ url: absoluteUrl(base, href), title });
    });
    if (items.length === 0) {
      d.querySelectorAll('.m-newest2 a, .chapter-list a, a[href*="/chapter-"]').forEach((a) => {
        const href = a.getAttribute('href');
        const title = (a.textContent || '').trim();
        if (href) items.push({ url: absoluteUrl(base, href), title });
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
  const lastPageEl = doc.querySelector("li.last a");
  if (lastPageEl) {
    const page =
      lastPageEl.getAttribute("data-page") ||
      new URL(lastPageEl.getAttribute("href") || "", url).searchParams.get("page");
    if (page) limit = parseInt(page) + 1;
  }
  const origin = new URL(url).origin;

  const collectPage = (h: string): ChapterLink[] => {
    const items: ChapterLink[] = [];
    parseHtml(h)
      .querySelectorAll("ul.list-chapter a, .list-chapter a")
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
  const seriePart = parts.find((p) => p.startsWith("serie-"));
  const language = parts[0];
  const slug = parts[parts.length - 1].split("?")[0];
  const id = seriePart?.slice(6);
  if (!id) throw new Error("wtr-lab: serie id missing");
  const json = await getJson(`https://wtr-lab.com/api/chapters/${id}`);
  return (json.chapters || []).map(
    (a: any) => `https://wtr-lab.com/${language}/serie-${id}/${slug}/${a.order}`
  );
}

// ---------- Site-specific chapter body ----------

function extractWithSelector(doc: Document, selectors: string): string {
  const sels = selectors.split(",").map((s) => s.trim()).filter(Boolean);
  for (const sel of sels) {
    const el = doc.querySelector(sel);
    if (el) {
      stripInside(el, "script, style, ins, iframe, .ad, .ads, .advertisement");
      return el.innerHTML;
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
  return extractWithSelector(doc, "#htmlContent, .entry-content, .content");
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
  // Extract partId from URL (wattpad.com/{partId}-...)
  const partIdMatch = url.match(/wattpad\.com\/(\d+)/);
  if (partIdMatch) {
    try {
      const apiBase = "https://www.wattpad.com/api/v3";
      const partJson = await getJson(
        `${apiBase}/story_parts/${partIdMatch[1]}?fields=id,title,text`
      );
      const text: string = partJson?.text || "";
      if (text.trim().length > 20) {
        // text is already HTML
        return text;
      }
    } catch { /* fall through to scraping */ }
  }
  // Fallback: scrape the page
  const doc = parseHtml(await getText(url));
  return extractWithSelector(
    doc,
    ".part-content, pre.part-content, [data-field='text']"
  );
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
