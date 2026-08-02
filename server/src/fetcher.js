// Server-side port of src/utils/localWorker.ts.
// Runs on Node, so it fetches sites DIRECTLY (no CORS proxy) — much faster.
// CORS proxies are kept only as a fallback when a site blocks the dyno IP.
import { parseHTML } from "linkedom";
import crypto from "node:crypto";
import fs from "node:fs";

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
  "https://proxy.cors.sh/",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://thingproxy.freeboard.io/fetch/",
  "https://api.cors.lol/?url=",
  "https://render-proxy-1-181c.onrender.com/proxy?url=",
  "https://prasadghanwat.alwaysdata.net/proxy?url=",
  "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url="
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
  const out = [];

  const collect = (d) => {
    d.querySelectorAll("#idData li > a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href) {
        out.push({
          url: absoluteUrl(base, href),
          title: (a.textContent || "").trim() || a.getAttribute("title") || "",
        });
      }
    });
  };

  collect(doc);

  const options = doc.querySelectorAll("#indexselect option");
  const totalPage = options.length || 1;

  const pages = [];
  for (let p = 2; p <= totalPage; p++) {
    pages.push(`${base}?page=${p}`);
  }

  const htmls = await mapPool(pages, 8, async (pageUrl) => {
    try {
      return await getText(pageUrl);
    } catch {
      return "";
    }
  });

  htmls.forEach((h) => {
    if (h) collect(parseHtml(h));
  });

  return out;
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

// ---------------------------------------------------------------------------
// wtr-lab chapter bodies
//
// The page HTML is a Next.js shell with no text, so chapter text must come from
// POST /api/reader/get. The "ai" translation needs a login, so we use the free
// "webplus" service, which returns AES-256-GCM encrypted raw (Chinese) text.
// Reads are metered per IP behind Cloudflare Turnstile, so requests carry
// browser-like headers and rotate through the proxy pool when challenged.
// ---------------------------------------------------------------------------

const WTRLAB_AI_LOCKED = new Set();
const WTRLAB_KEY = "IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru";

function decryptWtrlabBody(encrypted) {
  if (typeof encrypted !== "string") return encrypted;
  let isArray = false;
  let dataStr = encrypted;
  if (dataStr.startsWith("arr:")) {
    isArray = true;
    dataStr = dataStr.slice(4);
  } else if (dataStr.startsWith("str:")) {
    dataStr = dataStr.slice(4);
  } else {
    return encrypted;
  }
  const parts = dataStr.split(":");
  if (parts.length < 3) return encrypted;
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const cipher = Buffer.from(parts.slice(2).join(":"), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(WTRLAB_KEY), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(cipher), decipher.final()]).toString("utf8");
  return isArray ? JSON.parse(out) : out;
}

const WTRLAB_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": UA,
  Origin: "https://wtr-lab.com",
  Referer: "https://wtr-lab.com/",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "sec-ch-ua": '"Chromium";v="123", "Not:A-Brand";v="8"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

/** POSTs to /api/reader/get, rotating egress routes when Turnstile blocks one. */
async function wtrlabReaderGet(payload) {
  const body = JSON.stringify(payload);
  const target = "https://wtr-lab.com/api/reader/get";
  let lastErr = null;
  // Direct first (fastest); proxies act as extra egress IPs with their own quota.
  for (const proxy of PROXIES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        let res;
        try {
          res = await fetch(buildUrl(proxy, target), {
            method: "POST",
            headers: WTRLAB_HEADERS,
            body,
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const json = await res.json();
        if (json?.requireTurnstile) {
          lastErr = new Error("Cloudflare Turnstile challenge");
          break; // this egress IP is burned — move to the next route
        }
        return json;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr || new Error("wtr-lab reader request failed");
}

/** Translates raw paragraphs to English via the public Google translate endpoint. */
async function translateToEnglish(paragraphs) {
  if (!paragraphs.length) return paragraphs;
  const sample = paragraphs.slice(0, 5).join(" ");
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;
  if (latin > sample.length * 0.5) return paragraphs; // already English

  const out = [];
  const SEP = "\n\n";
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const text = batch.join(SEP);
    try {
      const res = await fetch(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            "User-Agent": UA,
          },
          body: "q=" + encodeURIComponent(text),
        }
      );
      const json = await res.json();
      let translated = "";
      for (const part of json?.[0] || []) if (part?.[0]) translated += part[0];
      const pieces = translated.split(SEP).map((s) => s.trim());
      out.push(...(pieces.length === batch.length ? pieces : [translated]));
    } catch {
      out.push(...batch); // fall back to the raw text rather than failing the chapter
    }
    batch = [];
    size = 0;
  };
  for (const p of paragraphs) {
    if (size + p.length > 1800) await flush();
    batch.push(p);
    size += p.length + SEP.length;
  }
  await flush();
  return out.length ? out : paragraphs;
}

async function bodyWtrLab(chapterUrl) {
  const u = new URL(chapterUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  const language = parts[0] || "en";
  const seriePart = parts.find((p) => p.startsWith("serie-"));
  let rawId = seriePart?.slice(6);
  if (!rawId) {
    const idx = parts.indexOf("novel");
    if (idx >= 0 && /^\d+$/.test(parts[idx + 1] || "")) rawId = parts[idx + 1];
  }
  const last = parts[parts.length - 1].replace("chapter-", "").split("?")[0];
  const chapterNo = Number(last);
  if (!rawId || !Number.isFinite(chapterNo)) {
    throw new Error("wtr-lab: could not read serie id / chapter number from URL");
  }

  const base = {
    language,
    raw_id: Number(rawId),
    chapter_no: chapterNo,
    retry: false,
    force_retry: false,
  };

  // AI translation is best quality but needs a logged-in account (code 1401).
  // Each request counts against the per-IP Turnstile meter, so once a novel has
  // answered 1401 we stop asking and go straight to webplus for later chapters.
  let paragraphs = null;
  let title = "";
  let glossary = null;
  let patch = null;
  if (!WTRLAB_AI_LOCKED.has(rawId)) {
    try {
      const ai = await wtrlabReaderGet({ ...base, translate: "ai" });
      title = ai?.chapter?.title || title;
      if (ai?.code === 1401) {
        WTRLAB_AI_LOCKED.add(rawId);
      } else {
        let aiBody = ai?.data?.data?.body;
        if (typeof aiBody === "string") aiBody = decryptWtrlabBody(aiBody);
        if (Array.isArray(aiBody) && aiBody.length) {
          paragraphs = aiBody;
          glossary = ai?.data?.data?.glossary_data?.terms || null;
          patch = ai?.data?.data?.patch || null;
        }
      }
    } catch {
      /* fall through to webplus */
    }
  }


  if (!paragraphs) {
    const wp = await wtrlabReaderGet({ ...base, translate: "webplus" });
    title = wp?.chapter?.title || title;
    const enc = wp?.data?.data?.body;
    if (typeof enc !== "string" || !enc.length) {
      throw new Error(`wtr-lab returned no content for chapter ${chapterNo}`);
    }
    const decrypted = decryptWtrlabBody(enc);
    paragraphs = Array.isArray(decrypted) ? decrypted : [decrypted];
    paragraphs = await translateToEnglish(paragraphs.filter((p) => String(p).trim()));
  }

  // AI bodies use ※n⛬ placeholders that map into the chapter glossary.
  if (glossary?.length || patch?.length) {
    paragraphs = paragraphs.map((raw) => {
      let text = String(raw);
      for (let i = 0; i < (glossary?.length || 0); i++) {
        const term = glossary[i]?.[0] ?? `※${i}⛬`;
        text = text.replaceAll(`※${i}⛬`, term).replaceAll(`※${i}〓`, term);
      }
      for (const p of patch || []) {
        if (p?.zh) text = text.replaceAll(p.zh, ` ${p.en ?? ""}`);
      }
      return text;
    });
  }

  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const heading = title ? `<h1>${esc(chapterNo)}: ${esc(title)}</h1>` : "";
  return heading + paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");

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
/**
 * Chapter body for any site without a hand-written parser: user selector first,
 * then the selectors extracted from that site's WebToEpub parser, then common
 * container names as a final fallback.
 */
async function bodyGeneric(url, selector) {
  let config = null;
  try {
    config = lookupSiteConfig(new URL(url).hostname);
  } catch {
    /* ignore */
  }
  const doc = parseHtml(await getText(url));
  const candidates = [
    ...(selector ? [selector] : []),
    ...(config?.content || []),
    "#chapter-content",
    ".chapter-content",
    "#chr-content",
    "#content",
    "div.entry-content",
    "div.post-content",
    "div.reading-content",
    "article",
    ".content",
  ];
  for (const sel of candidates) {
    const html = extractWithSelector(doc, sel);
    if (html && html.replace(/<[^>]+>/g, "").trim().length >= 20) return html;
  }
  return "";
}


// ---------------- Generic site table ----------------
//
// siteConfigs.json is generated from the ~380 vendored WebToEpub parsers
// (see scripts/extract-site-configs.mjs). Each entry maps a domain to the TOC
// link selectors and chapter-content selectors that parser uses, which lets the
// Node backend handle hundreds of sites without hand-porting every parser.

const SITE_CONFIGS = JSON.parse(
  fs.readFileSync(new URL("./siteConfigs.json", import.meta.url), "utf8")
);

/** Domain lookup that tolerates www./m. prefixes and sub-domains. */
export function lookupSiteConfig(hostname) {
  let host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (SITE_CONFIGS[host]) return SITE_CONFIGS[host];
  if (SITE_CONFIGS[`www.${host}`]) return SITE_CONFIGS[`www.${host}`];
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join(".");
    if (SITE_CONFIGS[suffix]) return SITE_CONFIGS[suffix];
  }
  return null;
}

/** Every domain the backend knows how to handle. */
export function supportedDomains() {
  return [
    "novelhall.com",
    "freewebnovel.com",
    "novelfire.net",
    "novgo.me",
    "novelbuddy.com",
    "novelarrow.com",
    "novelfull.com",
    "novelbin.com",
    "wtr-lab.com",
    "wattpad.com",
    ...Object.keys(SITE_CONFIGS),
  ].sort();
}

const NON_CHAPTER = /\/(login|register|signup|search|tag|genre|author|category|user|profile|contact|about|privacy|terms|feed|rss)\b/i;

/** Turns anchors matched by a config's TOC selectors into chapter entries. */
function collectTocLinks(doc, pageUrl, selectors) {
  const out = [];
  const seen = new Set();
  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return "";
    }
  })();
  for (const sel of selectors) {
    let nodes;
    try {
      nodes = doc.querySelectorAll(sel.endsWith(" a") || /\ba\b/.test(sel) ? sel : `${sel} a`);
    } catch {
      continue;
    }
    nodes.forEach((a) => {
      const href = a.getAttribute?.("href") || a.getAttribute?.("value");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const abs = absoluteUrl(pageUrl, href);
      if (origin && !abs.startsWith(origin)) return;
      if (NON_CHAPTER.test(abs) || seen.has(abs)) return;
      seen.add(abs);
      out.push({
        url: abs,
        title: (a.textContent || "").trim() || a.getAttribute?.("title") || "",
      });
    });
    if (out.length) break; // first selector that matches wins
  }
  return out;
}

const PAGINATION_SELECTORS = [
  ".pagination a[href]",
  ".paging a[href]",
  "ul.pager a[href]",
  ".page-nav a[href]",
  ".page-numbers a[href]",
  "a.page-numbers[href]",
  ".pages a[href]",
  ".pager a[href]",
  "nav.pagination a[href]",
  "[class*='pagination'] a[href]",
  "[class*='page-num'] a[href]",
  "select.listpage option[value]",
  "select#pagination option[value]",
].join(", ");

/** Extracts the page number encoded in a URL, or 0. */
function pageNumberOf(absUrl) {
  let u;
  try {
    u = new URL(absUrl);
  } catch {
    return 0;
  }
  const q =
    u.searchParams.get("page") ||
    u.searchParams.get("p") ||
    u.searchParams.get("pageNo") ||
    u.searchParams.get("pg");
  if (q && /^\d+$/.test(q)) return Number(q);
  const m =
    /\/page[/-](\d+)/i.exec(u.pathname) ||
    /[?&](?:page|p|pg)=(\d+)/i.exec(u.search) ||
    /[-_/]trang[-_/](\d+)/i.exec(u.pathname) ||
    /[-_](\d+)\.html?$/i.exec(u.pathname);
  return m ? Number(m[1]) : 0;
}

/** Builds the URL of page `n` from a template URL that already has a page marker. */
function pageUrlTemplate(sampleUrl, n) {
  const u = new URL(sampleUrl);
  for (const key of ["page", "p", "pageNo", "pg"]) {
    if (u.searchParams.has(key)) {
      u.searchParams.set(key, String(n));
      return u.href;
    }
  }
  if (/\/page[/-]\d+/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/page([/-])\d+/i, `/page$1${n}`);
    return u.href;
  }
  if (/[-_/]trang[-_/]\d+/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/([-_/]trang[-_/])\d+/i, `$1${n}`);
    return u.href;
  }
  u.searchParams.set("page", String(n));
  return u.href;
}

/**
 * Finds every extra TOC page. Handles query pagination (?page=2), path
 * pagination (/page/2, /trang-2), `<option>` page pickers, and "last page"
 * links that only expose the highest page number.
 */
function tocPageUrls(doc, pageUrl) {
  const urls = new Set();
  const explicit = [];
  let maxPage = 1;
  let template = null;

  let nodes = [];
  try {
    nodes = [...doc.querySelectorAll(PAGINATION_SELECTORS)];
  } catch {
    nodes = [];
  }

  for (const a of nodes) {
    const href = a.getAttribute("href") || a.getAttribute("value");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const abs = absoluteUrl(pageUrl, href);
    const n = pageNumberOf(abs);
    if (n > 1) {
      explicit.push({ n, abs });
      if (!template) template = abs;
      if (n > maxPage) maxPage = n;
    }
    // Some sites put the page count only in the link text ("Last (37)").
    const textN = Number((a.textContent || "").replace(/[^\d]/g, ""));
    if (textN > maxPage && textN < 5000) maxPage = textN;
  }

  const base = template || pageUrl;
  for (let p = 2; p <= Math.min(maxPage, 300); p++) {
    try {
      urls.add(pageUrlTemplate(base, p));
    } catch {
      /* ignore malformed */
    }
  }
  // Keep any explicitly-linked page that the template didn't reproduce.
  explicit.forEach(({ abs }) => urls.add(abs));
  urls.delete(pageUrl);
  return [...urls];
}

/** TOC extraction driven purely by the generated config table. */
async function tocFromConfig(url, config, linkSelector) {
  const selectors = [
    ...(linkSelector ? [linkSelector] : []),
    ...(config?.toc || []),
    "ul.chapter-list a",
    ".chapter-list a",
    "#chapterlist a",
    "#list a",
    ".listchapter a",
    "#chapters a",
  ];
  // Many sites keep the chapter list on a dedicated sub-page rather than the
  // novel landing page, so try those variants when the landing page is empty.
  const clean = url.split(/[?#]/)[0].replace(/\/$/, "");
  const variants = [url];
  if (!/\/(chapters?|toc|chapter-list)$/i.test(clean)) {
    variants.push(`${clean}/chapters`, `${clean}/chapter-list`, `${clean}/toc`);
  }

  let doc = null;
  let results = [];
  let sourceUrl = url;
  for (const candidate of variants) {
    try {
      const d = parseHtml(await getText(candidate));
      const items = collectTocLinks(d, candidate, selectors);
      if (items.length) {
        doc = d;
        results = items;
        sourceUrl = candidate;
        break;
      }
      doc = doc || d;
    } catch {
      /* try the next variant */
    }
  }
  if (!doc) return [];
  url = sourceUrl;



  const pages = tocPageUrls(doc, url);
  if (pages.length) {
    const htmls = await mapPool(pages, 8, async (u) => {
      try {
        return await getText(u);
      } catch {
        return "";
      }
    });
    const seen = new Set(results.map((r) => r.url));
    htmls.forEach((h) => {
      if (!h) return;
      for (const item of collectTocLinks(parseHtml(h), url, selectors)) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          results.push(item);
        }
      }
    });
  }
  return results;
}

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
      const config = lookupSiteConfig(new URL(tocUrl).hostname);
      const items = await tocFromConfig(tocUrl, config, linkSelector);
      if (items.length) return items;
      // Last resort: scrape every same-origin link on the page.
      const doc = parseHtml(await getText(tocUrl));
      return collectTocLinks(doc, tocUrl, [linkSelector || "a[href]"]);
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
      case "wtrlab":
        return bodyWtrLab(chapterUrl);

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
