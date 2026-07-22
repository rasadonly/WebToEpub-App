export interface WorkerResponse {
  results?: string[];
  error?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Public CORS proxy — many novel sites don't send CORS headers, so browser
// fetch would be blocked without this hop.
const CORS_PROXY = "https://corsproxy.io/?url=";

function proxied(url: string): string {
  return CORS_PROXY + encodeURIComponent(url);
}

async function httpGet(url: string, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(proxied(url), { headers: { ...DEFAULT_HEADERS, ...extra } });
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

async function tocFreeWebNovel(url: string): Promise<string[]> {
  const html = await getText(url);
  const doc = parseHtml(html);
  const totalPageMatch = html.match(/window\.chapterPagination\.totalPage\s*=\s*(\d+)/);
  const totalPage = totalPageMatch ? parseInt(totalPageMatch[1]) : 1;

  const collect = (d: Document, out: string[]) => {
    d.querySelectorAll("#idData a, .m-newest2 a, .chapter-list a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href) out.push(absoluteUrl(url, href));
    });
  };

  const results: string[] = [];
  collect(doc, results);

  if (totalPage > 1) {
    const base = url.replace(/\/$/, "");
    const pageUrls: string[] = [];
    for (let p = 2; p <= totalPage; p++) pageUrls.push(`${base}/${p}`);
    const htmls = await Promise.all(pageUrls.map((u) => getText(u).catch(() => "")));
    htmls.forEach((h) => h && collect(parseHtml(h), results));
  }
  return results;
}

async function tocNovelFire(url: string): Promise<string[]> {
  let base = url.replace(/\/$/, "");
  if (base.endsWith("/chapters")) base = base.slice(0, -"/chapters".length);
  const chaptersUrl = `${base}/chapters`;

  const firstHtml = await getText(chaptersUrl);
  const pages = Array.from(
    new Set(Array.from(firstHtml.matchAll(/chapters\?page=(\d+)/g)).map((m) => parseInt(m[1])))
  ).sort((a, b) => a - b);
  const maxPage = pages.length ? Math.max(...pages) : 1;

  const collect = (html: string, out: string[]) => {
    const d = parseHtml(html);
    d.querySelectorAll(".chapter-list li a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href) out.push(absoluteUrl(chaptersUrl, href));
    });
  };

  const results: string[] = [];
  collect(firstHtml, results);

  if (maxPage > 1) {
    const urls: string[] = [];
    for (let p = 2; p <= maxPage; p++) urls.push(`${chaptersUrl}?page=${p}`);
    const htmls = await Promise.all(urls.map((u) => getText(u).catch(() => "")));
    htmls.forEach((h) => h && collect(h, results));
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

async function tocNovelFull(url: string): Promise<string[]> {
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
  const pageUrls: string[] = [];
  for (let i = 1; i <= limit; i++) pageUrls.push(`${url}?page=${i}&per-page=50`);
  const htmls = await Promise.all(pageUrls.map((u) => getText(u).catch(() => "")));
  const out: string[] = [];
  htmls.forEach((h) => {
    if (!h) return;
    parseHtml(h)
      .querySelectorAll("ul.list-chapter a, .list-chapter a")
      .forEach((a) => {
        const href = a.getAttribute("href");
        if (href) out.push(absoluteUrl(origin, href));
      });
  });
  return out;
}

async function tocNovelBin(url: string): Promise<string[]> {
  const html = await getText(url);
  const idMatch = html.match(/data-novel-id=["'](\d+)["']/);
  const origin = new URL(url).origin;
  const novelId = idMatch?.[1] || new URL(url).pathname.split("/").filter(Boolean).pop();
  const ajaxHtml = await getText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
  const results: string[] = [];
  parseHtml(ajaxHtml)
    .querySelectorAll("a[href]")
    .forEach((a) => {
      const href = a.getAttribute("href");
      if (href) results.push(absoluteUrl(origin, href));
    });
  return results;
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
  if (hostname.includes("freewebnovel.com")) return "freewebnovel";
  if (hostname.includes("novelfire.")) return "novelfire";
  if (hostname.includes("novgo.")) return "novgo";
  if (hostname.includes("novelbuddy.com")) return "novelbuddy";
  if (hostname.includes("novelarrow.com")) return "novelarrow";
  if (hostname.includes("novelfull")) return "novelfull";
  if (hostname.includes("novelbin") || hostname.includes("novlove")) return "novelbin";
  if (hostname.includes("wtr-lab.com")) return "wtrlab";
  return "generic";
}

export async function fetchChapterLinks(tocUrl: string, linkSelector: string): Promise<string[]> {
  const hostname = new URL(tocUrl).hostname;
  const key = siteKey(hostname);
  try {
    switch (key) {
      case "freewebnovel": return await tocFreeWebNovel(tocUrl);
      case "novelfire":    return await tocNovelFire(tocUrl);
      case "novgo":        return await tocNovGo(tocUrl);
      case "novelbuddy":   return await tocNovelBuddy(tocUrl);
      case "novelarrow":   return await tocNovelArrow(tocUrl);
      case "novelfull":    return await tocNovelFull(tocUrl);
      case "novelbin":     return await tocNovelBin(tocUrl);
      case "wtrlab":       return await tocWtrLab(tocUrl);
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
      case "freewebnovel": return bodyFreeWebNovel(chapterUrl);
      case "novelfire":    return bodyNovelFire(chapterUrl);
      case "novgo":        return bodyNovGo(chapterUrl);
      case "novelbuddy":   return bodyNovelBuddy(chapterUrl);
      case "novelarrow":   return bodyNovelArrow(chapterUrl);
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
