// Server-side port of src/utils/localWorker.ts.
// Runs on Node, so it fetches sites DIRECTLY (no CORS proxy) — much faster.
// CORS proxies are kept only as a fallback when a site blocks the dyno IP.
import { parseHTML } from "linkedom";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const PROXIES = [
  "", // direct
  "https://corsproxy.io/?key=ab3170e1&url=",
  "https://api.allorigins.win/raw?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.cors.lol/?url=",
];

const ENCODED_SUFFIXES = ["?url=", "?quest=", "&url="];

function buildUrl(base, target) {
  if (!base) return target;
  return ENCODED_SUFFIXES.some((s) => base.endsWith(s))
    ? base + encodeURIComponent(target)
    : base + target;
}

async function httpGet(url, extra = {}, timeoutMs = 20000) {
  let lastErr = null;
  for (const proxy of PROXIES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(buildUrl(proxy, url), {
        headers: { ...DEFAULT_HEADERS, ...extra },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (r.ok) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("All fetch attempts failed");
}

async function getText(url) {
  return (await httpGet(url)).text();
}

async function getJson(url) {
  return (await httpGet(url, { Accept: "application/json" })).json();
}

function parseHtml(html) {
  return parseHTML(html).document;
}

function absoluteUrl(base, rel) {
  try {
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
}

function stripInside(root, selector) {
  root.querySelectorAll(selector).forEach((n) => n.remove());
}

function extractWithSelector(doc, selectors) {
  for (const sel of String(selectors || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const el = doc.querySelector(sel);
    if (el) {
      stripInside(el, "script, style, ins, iframe, .ad, .ads, .advertisement");
      return el.innerHTML;
    }
  }
  return "";
}

// ---------------- TOC parsers ----------------

async function tocNovelhall(url) {
  const doc = parseHtml(await getText(url));
  const out = [];
  doc.querySelectorAll("#morelist a, .book-catalog a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href) out.push({ url: absoluteUrl(url, href), title: (a.textContent || "").trim() });
  });
  return out;
}

async function tocFreeWebNovel(url) {
  const base = url.split("?")[0].replace(/\/$/, "");
  const html = await getText(base);
  const doc = parseHtml(html);
  const chapterPath = `${new URL(base).pathname}/chapter-`;
  const seen = new Set();

  const collectPage = (d) => {
    const items = [];
    const root = d.querySelector("#idData");
    const scope = root || d;
    const selector = root
      ? "li > a[href]"
      : [
          `li > a.con[href*="${chapterPath}"]`,
          `a.con[href*="${chapterPath}"]`,
          `a[href*="${chapterPath}"]`,
        ].join(",");
    scope.querySelectorAll(selector).forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      const abs = absoluteUrl(base, href);
      if (abs.includes(chapterPath) && !seen.has(abs)) {
        seen.add(abs);
        items.push({ url: abs, title: (a.textContent || "").trim() || a.getAttribute("title") || "" });
      }
    });
    return items;
  };

  const results = collectPage(doc);

  let totalPage = 1;
  const indexSelect = doc.querySelector("#indexselect");
  if (indexSelect) totalPage = indexSelect.querySelectorAll("option").length || 1;
  if (totalPage === 1) {
    const m = /totalPage:\s*(\d+)/.exec(html);
    if (m) totalPage = parseInt(m[1]);
  }

  const fetchTocPage = async (pageUrl) => {
    const raw = await getText(pageUrl);
    if (!raw) return "";
    try {
      return JSON.parse(raw)?.html || "";
    } catch {
      return raw.includes("<li") ? raw : "";
    }
  };

  const pages = [];
  for (let p = 2; p <= totalPage; p++) pages.push(`${base}?ajax=chapters&page=${p}`);
  const htmls = await mapPool(pages, 8, async (pageUrl) => {
    for (let a = 0; a < 3; a++) {
      try {
        const h = await fetchTocPage(pageUrl);
        if (h) return h;
      } catch {
        /* retry */
      }
    }
    return "";
  });
  htmls.forEach((h) => {
    if (h) results.push(...collectPage(parseHtml(h)));
  });
  return results;
}

async function tocNovelFire(url) {
  let base = url.replace(/\/$/, "");
  if (base.endsWith("/chapters")) base = base.slice(0, -"/chapters".length);
  const chaptersUrl = `${base}/chapters`;
  const firstHtml = await getText(chaptersUrl);
  const pages = [...new Set([...firstHtml.matchAll(/chapters\?page=(\d+)/g)].map((m) => +m[1]))];
  const maxPage = pages.length ? Math.max(...pages) : 1;

  const collect = (html) => {
    const items = [];
    parseHtml(html)
      .querySelectorAll(".chapter-list li a")
      .forEach((a) => {
        const href = a.getAttribute("href");
        if (href) items.push({ url: absoluteUrl(chaptersUrl, href), title: (a.textContent || "").trim() });
      });
    return items;
  };

  const results = collect(firstHtml);
  const urls = [];
  for (let p = 2; p <= maxPage; p++) urls.push(`${chaptersUrl}?page=${p}`);
  const htmls = await mapPool(urls, 8, async (u) => {
    try {
      return await getText(u);
    } catch {
      return "";
    }
  });
  htmls.forEach((h) => h && results.push(...collect(h)));
  return results;
}

async function tocNovGo(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const novelId =
    doc.querySelector("[data-novel-id]")?.getAttribute("data-novel-id") ||
    html.match(/novelId["'\s:=]+["']?(\d+)/)?.[1];
  if (!novelId) throw new Error("NovGo: novelId not found");
  const origin = new URL(url).origin;
  const apiDoc = parseHtml(await getText(`${origin}/ajax-chapter-option?novelId=${novelId}`));
  const out = [];
  apiDoc.querySelectorAll("option[value]").forEach((opt) => {
    const val = opt.getAttribute("value");
    if (val) out.push({ url: absoluteUrl(origin, val), title: (opt.textContent || "").trim() });
  });
  return out;
}

async function tocNovelBuddy(url) {
  const doc = parseHtml(await getText(url));
  const nextData = doc.querySelector("script#__NEXT_DATA__");
  if (!nextData?.textContent) throw new Error("NovelBuddy: __NEXT_DATA__ missing");
  const pageProps = JSON.parse(nextData.textContent)?.props?.pageProps || {};
  const apiUrl = pageProps?.siteConfig?.apiUrl;
  const mangaId = pageProps?.manga?.id || pageProps?.item?.id || pageProps?.data?.id;
  if (!apiUrl || !mangaId) throw new Error("NovelBuddy: apiUrl/mangaId missing");
  const listJson = await getJson(`${apiUrl.replace(/\/$/, "")}/titles/${mangaId}/chapters`);
  const chaps = listJson?.data?.chapters || [];
  return chaps
    .slice()
    .reverse()
    .map((c, i) => ({
      url: `${apiUrl.replace(/\/$/, "")}/titles/${mangaId}/chapters/${c.id || c._id}`,
      title: c.name || c.title || `Chapter ${i + 1}`,
    }));
}

async function tocNovelArrow(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const slug = parts.includes("novel") ? parts[parts.indexOf("novel") + 1] : parts[parts.length - 1];
  const apiBase = `${u.origin}/api-web`;
  const listJson = await getJson(`${apiBase}/novels/${slug}/chapters?sort=asc`);
  return (listJson?.items || [])
    .filter((c) => c.chapter_id)
    .map((c, i) => ({
      url: `${apiBase}/novels/${slug}/chapters/${c.chapter_id}`,
      title: c.chapter_title || c.title || `Chapter ${i + 1}`,
    }));
}

async function tocNovelFull(url) {
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
  const collect = (h) => {
    const items = [];
    parseHtml(h)
      .querySelectorAll("ul.list-chapter a, .list-chapter a")
      .forEach((a) => {
        const href = a.getAttribute("href");
        if (href) items.push({ url: absoluteUrl(origin, href), title: (a.textContent || "").trim() });
      });
    return items;
  };
  const results = collect(html);
  const urls = [];
  for (let i = 2; i <= limit; i++) urls.push(`${url}?page=${i}&per-page=50`);
  const htmls = await mapPool(urls, 8, async (u) => {
    try {
      return await getText(u);
    } catch {
      return "";
    }
  });
  htmls.forEach((h) => h && results.push(...collect(h)));
  return results;
}

async function tocNovelBin(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const novelId =
    html.match(/data-novel-id=["'](\d+)["']/)?.[1] ||
    new URL(url).pathname.split("/").filter(Boolean).pop();
  const ajaxHtml = await getText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
  const out = [];
  parseHtml(ajaxHtml)
    .querySelectorAll("a[href]")
    .forEach((a) => {
      const href = a.getAttribute("href");
      if (href) out.push({ url: absoluteUrl(origin, href), title: (a.textContent || "").trim() });
    });
  return out;
}

async function tocWtrLab(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const language = parts[0] || "en";
  const slug = parts[parts.length - 1].split("?")[0];
  const seriePart = parts.find((p) => p.startsWith("serie-"));
  let id = seriePart?.slice(6);
  if (!id) {
    const idx = parts.indexOf("novel");
    if (idx >= 0 && /^\d+$/.test(parts[idx + 1] || "")) id = parts[idx + 1];
  }
  if (!id) id = parts.find((p) => /^\d+$/.test(p));
  if (!id) throw new Error("wtr-lab: serie id missing");
  const json = await getJson(`https://wtr-lab.com/api/chapters/${id}`);
  const chapters = json.chapters || json.data?.chapters || [];
  return chapters.map((a, i) => ({
    url: `https://wtr-lab.com/${language}/serie-${id}/${slug}/${a.order ?? a.id}`,
    title: a.title || `Chapter ${i + 1}`,
  }));
}

function wattpadStoryId(url) {
  return url.match(/(?:\/story\/|story\/)([0-9]+)/)?.[1] || url.match(/wattpad\.com\/([0-9]+)/)?.[1] || null;
}

async function tocWattpad(url) {
  const storyId = wattpadStoryId(url);
  if (!storyId) throw new Error("Wattpad: could not extract story ID");
  const json = await getJson(
    `https://www.wattpad.com/api/v3/stories/${storyId}?fields=id,title,parts(id,title,url)`
  );
  const parts = json?.parts || [];
  if (!parts.length) throw new Error("Wattpad: no chapters found");
  return parts.map((p, i) => ({
    url: p.url?.startsWith("http") ? p.url : `https://www.wattpad.com/${p.id}`,
    title: p.title || `Chapter ${i + 1}`,
  }));
}

// ---------------- Body parsers ----------------

async function bodyNovelhall(url) {
  return extractWithSelector(parseHtml(await getText(url)), "#htmlContent, .entry-content, .content");
}
async function bodyFreeWebNovel(url) {
  return extractWithSelector(parseHtml(await getText(url)), "#article, .chapter-content, #chr-content");
}
async function bodyNovelFire(url) {
  return extractWithSelector(parseHtml(await getText(url)), "#content, .chapter-content");
}
async function bodyNovGo(url) {
  const doc = parseHtml(await getText(url));
  const container = doc.querySelector("#chapter-content, #chr-content");
  if (!container) return "";
  stripInside(container, "script, style, iframe, ins");
  return container.innerHTML;
}
async function bodyNovelBuddy(url) {
  return (await getJson(url))?.data?.chapter?.content || "";
}
async function bodyNovelArrow(url) {
  return (await getJson(url))?.item?.chapterInfo?.chapter_content || "";
}
async function bodyWattpad(url) {
  const partId = url.match(/wattpad\.com\/(\d+)/)?.[1];
  if (partId) {
    try {
      const json = await getJson(
        `https://www.wattpad.com/api/v3/story_parts/${partId}?fields=id,title,text`
      );
      if ((json?.text || "").trim().length > 20) return json.text;
    } catch {
      /* fall through */
    }
  }
  return extractWithSelector(
    parseHtml(await getText(url)),
    ".part-content, pre.part-content, [data-field='text']"
  );
}
async function bodyGeneric(url, selector) {
  return extractWithSelector(
    parseHtml(await getText(url)),
    selector || "#chapter-content, .chapter-content, #content, article, .content"
  );
}

// ---------------- Dispatch ----------------

function siteKey(hostname) {
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

/** Returns [{ url, title }]. */
export async function fetchChapterLinks(tocUrl, linkSelector = "") {
  const key = siteKey(new URL(tocUrl).hostname);
  switch (key) {
    case "novelhall":
      return tocNovelhall(tocUrl);
    case "freewebnovel":
      return tocFreeWebNovel(tocUrl);
    case "novelfire":
      return tocNovelFire(tocUrl);
    case "novgo":
      return tocNovGo(tocUrl);
    case "novelbuddy":
      return tocNovelBuddy(tocUrl);
    case "novelarrow":
      return tocNovelArrow(tocUrl);
    case "novelfull":
      return tocNovelFull(tocUrl);
    case "novelbin":
      return tocNovelBin(tocUrl);
    case "wtrlab":
      return tocWtrLab(tocUrl);
    case "wattpad":
      return tocWattpad(tocUrl);
    default: {
      const doc = parseHtml(await getText(tocUrl));
      const out = [];
      doc.querySelectorAll(linkSelector || "a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        if (href) out.push({ url: absoluteUrl(tocUrl, href), title: (a.textContent || "").trim() });
      });
      return out;
    }
  }
}

export async function fetchChapterContent(chapterUrl, contentSelector = "") {
  let hostname = "";
  try {
    hostname = new URL(chapterUrl).hostname;
  } catch {
    /* ignore */
  }
  const key = siteKey(hostname);
  const attempt = () => {
    switch (key) {
      case "novelhall":
        return bodyNovelhall(chapterUrl);
      case "freewebnovel":
        return bodyFreeWebNovel(chapterUrl);
      case "novelfire":
        return bodyNovelFire(chapterUrl);
      case "novgo":
        return bodyNovGo(chapterUrl);
      case "novelbuddy":
        return bodyNovelBuddy(chapterUrl);
      case "novelarrow":
        return bodyNovelArrow(chapterUrl);
      case "wattpad":
        return bodyWattpad(chapterUrl);
      default:
        return bodyGeneric(chapterUrl, contentSelector);
    }
  };

  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const html = await attempt();
      if (html && html.replace(/<[^>]+>/g, "").trim().length >= 20) return html;
      last = html || last;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  if (last) return last;
  throw new Error("Chapter content appears to be empty");
}

/** Fetch metadata (title / author / cover) from a TOC page, best-effort. */
export async function fetchBookMeta(tocUrl) {
  try {
    const doc = parseHtml(await getText(tocUrl));
    const pick = (sels) => {
      for (const s of sels) {
        const el = doc.querySelector(s);
        const v = (el?.getAttribute?.("content") || el?.textContent || "").trim();
        if (v) return v;
      }
      return "";
    };
    return {
      title: pick(['meta[property="og:title"]', "h1", "title"]),
      author: pick(['meta[property="og:novel:author"]', '[itemprop="author"]', ".author a", ".author"]),
      cover: pick(['meta[property="og:image"]', ".book-img img", ".novel-cover img", "img.cover"]),
      description: pick(['meta[property="og:description"]', 'meta[name="description"]']),
    };
  } catch {
    return { title: "", author: "", cover: "", description: "" };
  }
}

/** Bounded-concurrency map that preserves input order. */
export async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
