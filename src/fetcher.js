// Server-side port of src/utils/localWorker.ts.
// Runs on Node, so it fetches sites DIRECTLY (no CORS proxy) — much faster.
// CORS proxies are kept only as a fallback when a site blocks the dyno IP.
import { parseHTML } from "linkedom";
import crypto from "node:crypto";
import fs from "node:fs";
import { aiContentSelectors, aiTocSelectors } from "./aiParser.js";


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
  "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url=",
  "https://prasadghanwat.alwaysdata.net/proxy?url=",
  "https://render-proxy-1-181c.onrender.com/proxy?url=",
  "https://corsproxy.io/?key=ab3170e1&url=",
  "https://api.allorigins.win/raw?url=",
  "https://api.cors.lol/?url=",
];

const ENCODED_SUFFIXES = ["?url=", "?quest=", "&url="];

function buildUrl(base, target) {
  if (!base) return target;
  return ENCODED_SUFFIXES.some((s) => base.endsWith(s))
    ? base + encodeURIComponent(target)
    : base + target;
}

/* ------------------------------------------------------------------ *
 * Politeness layer — the top failure cause in the logs is HTTP 429/403
 * (rate limiting / bot blocking), not broken selectors. We therefore:
 *   1. serialise requests per host with a minimum gap between them,
 *   2. retry 429/403/503 with exponential backoff (honouring Retry-After),
 *   3. rotate User-Agents and send a same-origin Referer,
 *   4. only *temporarily* mark a host as direct-blocked (was permanent).
 * ------------------------------------------------------------------ */

const UA_POOL = [
  UA,
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

/** Hosts that rate-limit aggressively → bigger gap between hits. */
const HOST_THROTTLE = [
  [/freewebnovel\.com$/i, 2500],
  [/novelfull(l)?\.(net|com)$/i, 1800],
  [/(^|\.)(all-?novelfull|allnovelfull|allnovelnext|allnovelbook|allnovel)\.(com|net|org)$/i, 1800],
  [/novelfullbook\.com$/i, 1800],
  [/novelfire\.net$/i, 1500],
  [/novelhall\.com$/i, 1500],
  [/scribblehub\.com$/i, 1500],
  [/(novelgo\.id|novgo\.net)$/i, 1500],
  [/novelcodex\.com$/i, 1200],
  [/novel-?next\.(com|net)$/i, 1200],
  [/novel-?bin\.(com|net)$/i, 1200],
  [/novelbin\.(com|me|net)$/i, 1200],
  [/(novelmax\.net|novelgate\.net|novelhulk\.net)$/i, 1200],
  [/fanfiction\.net$/i, 2000],
  [/archiveofourown\.org$/i, 2000],
  [/(akknovel\.com|readlightnovel\.me)$/i, 1500],
];

const DEFAULT_GAP_MS = 250;

function gapFor(host) {
  for (const [re, ms] of HOST_THROTTLE) if (re.test(host)) return ms;
  return DEFAULT_GAP_MS;
}

// host -> promise chain tail, so requests to the same host queue up
const hostQueues = new Map();

function throttle(host) {
  const gap = gapFor(host);
  const prev = hostQueues.get(host) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  hostQueues.set(host, prev.then(() => next));
  return prev.then(() => ({
    done: () => setTimeout(release, gap),
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// host -> timestamp until which direct fetching is skipped
const blockedUntil = new Map();
const BLOCK_TTL_MS = 5 * 60 * 1000;

const blockedHosts = {
  has: (h) => (blockedUntil.get(h) || 0) > Date.now(),
  add: (h) => blockedUntil.set(h, Date.now() + BLOCK_TTL_MS),
  delete: (h) => blockedUntil.delete(h),
};

const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

async function httpGet(url, extra = {}, timeoutMs = 7000) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const origin = parsed.origin;
  let lastErr = null;
  let uaIndex = 0;

  const lease = await throttle(host);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const proxy of PROXIES) {
        if (!proxy && blockedHosts.has(host)) continue;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const headers = {
            ...DEFAULT_HEADERS,
            "User-Agent": UA_POOL[uaIndex++ % UA_POOL.length],
            Referer: origin + "/",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            ...extra,
          };
          const r = await fetch(buildUrl(proxy, url), {
            headers,
            signal: ctrl.signal,
            redirect: "follow",
          });
          if (r.ok) {
            if (!proxy) blockedHosts.delete(host);
            return r;
          }
          if (!proxy && (r.status === 403 || r.status === 401 || r.status === 429)) {
            blockedHosts.add(host);
          }
          lastErr = new Error(`HTTP ${r.status}`);
          lastErr.status = r.status;
          if (r.status === 429) {
            const ra = parseInt(r.headers.get("retry-after") || "", 10);
            if (Number.isFinite(ra) && ra > 0 && ra <= 30) await sleep(ra * 1000);
          }
          if (!RETRY_STATUS.has(r.status) && r.status !== 403 && r.status !== 401) {
            // 404 and friends won't change on retry with another proxy
            if (r.status === 404) throw lastErr;
          }
        } catch (e) {
          if (e?.status === 404) throw e;
          if (!proxy) blockedHosts.add(host);
          lastErr = e;
        } finally {
          clearTimeout(timer);
        }
      }
      // All proxies failed this round — back off before the next sweep.
      if (attempt < 2) await sleep(800 * Math.pow(2, attempt) + Math.random() * 400);
    }
    throw lastErr || new Error("All fetch attempts failed");
  } finally {
    lease.done();
  }
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

function unwrapProxyUrl(url) {
  if (!url) return url;
  if (url.includes("/api/proxy?url=") || url.includes("?url=")) {
    try {
      const match = url.match(/[?&]url=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    } catch {}
  }
  return url;
}

function absoluteUrl(base, rel) {
  try {
    return unwrapProxyUrl(new URL(rel, base).href);
  } catch {
    return unwrapProxyUrl(rel);
  }
}

function stripInside(root, selector) {
  root.querySelectorAll(selector).forEach((n) => n.remove());
}

/**
 * Fix bare & in href/src/action attribute values so EPUB's XML parser
 * doesn't throw "attributes construct error". Runs on every returned chunk.
 */
function sanitizeHtml(html) {
  if (!html) return "";
  // Replace & not already part of a named/numeric entity with &amp;
  // This handles href="?a=1&b=2" → href="?a=1&amp;b=2"
  return html.replace(
    /(<[^>]+?(?:href|src|action|data-url|data-href)\s*=\s*["'])([^"']*)(["'])/gi,
    (_, before, val, after) =>
      before + val.replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;") + after
  );
}

function extractWithSelector(doc, selectors) {
  for (const sel of String(selectors || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const el = doc.querySelector(sel);
    if (el) {
      stripInside(el, "script, style, ins, iframe, .ad, .ads, .advertisement, a[href*='utm_source'], a[href^='mailto:']");
      return sanitizeHtml(el.innerHTML);
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
  const collect = (h) => {
    const items = [];
    parseHtml(h)
      .querySelectorAll("#idData li a, #idData a, ul.list-chapter a, .list-chapter a, ul.chapter-list a")
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
  let html = "";
  if (partId) {
    try {
      const json = await getJson(
        `https://www.wattpad.com/api/v3/story_parts/${partId}?fields=id,title,text`
      );
      if ((json?.text || "").trim().length > 20) html = json.text;
    } catch {
      /* fall through */
    }
  }
  if (!html) {
    html = extractWithSelector(
      parseHtml(await getText(url)),
      ".part-content, pre.part-content, [data-field='text']"
    );
  }
  if (!html) return "";

  // --- Sanitize for EPUB XML validity ---
  // 1. Remove social-share / footer sections that contain mailto: and tracking URLs
  const doc = parseHtml(`<div id="_wp_root">${html}</div>`);
  const root = doc.querySelector("#_wp_root");

  // Remove share/send buttons, report links, author profile badges, follow buttons, and promoted stories
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

  // 2. Fix bare & in all attribute values (& not followed by word chars + ;)
  //    Walk every element and re-encode href/src/action attrs
  const fixAmpersand = (val) =>
    val ? val.replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;") : val;

  root.querySelectorAll("[href], [src], [action], [data-url]").forEach((el) => {
    for (const attr of ["href", "src", "action", "data-url"]) {
      const v = el.getAttribute(attr);
      if (v) {
        let clean = fixAmpersand(v);
        clean = clean.replace(/"/g, "&quot;");
        el.setAttribute(attr, clean);
      }
    }
  });

  return sanitizeHtml(root.innerHTML);
}

/** Last-resort heuristic: the block element with the most paragraph text. */
function bodyByDensity(doc) {
  let best = null;
  let bestScore = 0;
  const nodes = doc.querySelectorAll("div, article, section, main, td");
  nodes.forEach((el) => {
    const paras = el.querySelectorAll("p, br").length;
    const text = (el.textContent || "").trim();
    if (text.length < 400) return;
    const links = el.querySelectorAll("a").length;
    const linkText = [...el.querySelectorAll("a")].reduce(
      (n, a) => n + (a.textContent || "").length,
      0
    );
    // Penalise link-heavy blocks (nav / chapter lists), reward paragraphs.
    const score = text.length * (1 - Math.min(linkText / text.length, 0.9)) + paras * 40 - links * 20;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  if (!best) return "";
  stripInside(best, "script, style, iframe, ins, nav, header, footer, form, .ads, .adsbygoogle, a[href*='utm_'], a[href^='mailto:']");
  return sanitizeHtml(best.innerHTML);
}

/**
 * Chapter body for any site without a hand-written parser: user selector first,
 * then the selectors extracted from that site's WebToEpub parser, common
 * container names, then AI-detected selectors, then a text-density heuristic.
 */
async function bodyGeneric(url, selector) {
  let config = null;
  try {
    config = lookupSiteConfig(new URL(url).hostname);
  } catch {
    /* ignore */
  }
  const rawHtml = await getText(url);
  const doc = parseHtml(rawHtml);
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
  const good = (html) => html && html.replace(/<[^>]+>/g, "").trim().length >= 200;
  let weak = "";
  for (const sel of candidates) {
    const html = extractWithSelector(doc, sel);
    if (good(html)) return html;
    if (!weak && html && html.replace(/<[^>]+>/g, "").trim().length >= 20) weak = html;
  }

  // Nothing solid — let the AI work out the selectors for this host (cached),
  // then fall back to a text-density heuristic.
  try {
    const ai = await aiContentSelectors(rawHtml, url);
    if (ai?.content) {
      const html = extractWithSelector(doc, ai.content);
      if (good(html) || (!weak && html)) {
        if (ai.remove) {
          try {
            const frag = parseHtml(`<div id="__ai">${html}</div>`);
            const root = frag.querySelector("#__ai");
            stripInside(root, ai.remove);
            return root.innerHTML;
          } catch {
            return html;
          }
        }
        if (good(html)) return html;
        weak = weak || html;
      }
    }
  } catch (e) {
    console.warn("[fetcher] AI content fallback failed", e?.message || e);
  }

  const dense = bodyByDensity(doc);
  if (good(dense)) return dense;
  return weak || dense || "";
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
    "novelfull.net",
    "novelbin.com",
    "wtr-lab.com",
    "wattpad.com",
    ...MAJOR_DOMAINS,
    ...Object.keys(SITE_CONFIGS),
  ]
    .filter((d, i, a) => a.indexOf(d) === i)
    .sort();
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
    // Only append " a" when the selector doesn't already target links/options.
    const targetsLinks = /(^|[\s>+~])(a|option)\b|\ba\[|\boption\[/.test(sel);
    try {
      nodes = doc.querySelectorAll(targetsLinks ? sel : `${sel} a`);
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
  let rawHtml = "";
  let results = [];
  let sourceUrl = url;
  for (const candidate of variants) {
    try {
      const h = await getText(candidate);
      const d = parseHtml(h);
      const items = collectTocLinks(d, candidate, selectors);
      if (items.length) {
        doc = d;
        rawHtml = h;
        results = items;
        sourceUrl = candidate;
        break;
      }
      if (!doc) {
        doc = d;
        rawHtml = h;
        sourceUrl = candidate;
      }
    } catch {
      /* try the next variant */
    }
  }
  if (!doc) return [];
  url = sourceUrl;

  // No configured selector matched — ask the AI for this host's TOC selectors
  // (cached per host) and retry with them.
  if (!results.length) {
    try {
      const ai = await aiTocSelectors(rawHtml, url);
      if (ai?.toc?.length) {
        const items = collectTocLinks(doc, url, ai.toc);
        if (items.length) {
          results = items;
          selectors.unshift(...ai.toc);
        }
      }
    } catch (e) {
      console.warn("[fetcher] AI TOC fallback failed", e?.message || e);
    }
  }

  // Still nothing: take every same-origin link that looks like a chapter.
  if (!results.length) {
    results = collectTocLinks(doc, url, ["body"]).filter((r) =>
      /(chapter|chap|ch-|\/c\d|episode|part)[-_/]?\d|\d+\.html?$/i.test(r.url)
    );
  }




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

// ---------------- Dedicated parsers for major sites ----------------
//
// These sites paginate their TOC or serve it from a JSON/AJAX endpoint, so the
// static selector table alone only ever sees the first page (or nothing).
// Ported from the matching WebToEpub parsers.

const textOf = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

async function tryText(url) {
  try {
    return await getText(url);
  } catch {
    return "";
  }
}

/** Collect links from an HTML string with a selector, keeping order. */
function linksFrom(html, base, selector, titleSelector) {
  const out = [];
  if (!html) return out;
  parseHtml(html)
    .querySelectorAll(selector)
    .forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const title = titleSelector ? textOf(a.querySelector(titleSelector)) || textOf(a) : textOf(a);
      out.push({ url: absoluteUrl(base, href), title });
    });
  return out;
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((i) => i.url && !seen.has(i.url) && seen.add(i.url));
}

// --- Royal Road: /fiction/<id>/<slug>, chapter table paginated with ?page=N ---
async function tocRoyalRoad(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const ci = parts.indexOf("chapter");
  const tocUrl = u.origin + "/" + (ci > 0 ? parts.slice(0, ci) : parts).join("/");
  const html = await getText(tocUrl);
  let items = linksFrom(html, tocUrl, "table#chapters a[href*='/chapter/']");
  // Older/large fictions paginate the chapter table.
  const doc = parseHtml(html);
  const pages = [...doc.querySelectorAll("ul.pagination a[href*='page=']")]
    .map((a) => parseInt(new URL(absoluteUrl(tocUrl, a.getAttribute("href"))).searchParams.get("page") || "0"))
    .filter((n) => n > 1);
  const max = pages.length ? Math.max(...pages) : 1;
  if (max > 1) {
    const urls = [];
    for (let p = 2; p <= max; p++) urls.push(`${tocUrl}?page=${p}`);
    const htmls = await mapPool(urls, 4, tryText);
    htmls.forEach((h) => items.push(...linksFrom(h, tocUrl, "table#chapters a[href*='/chapter/']")));
  }
  return dedupeByUrl(items);
}

// --- ScribbleHub: TOC paginated with ?toc=N, newest first ---
async function tocScribbleHub(url) {
  const base = url.split("?")[0];
  const first = await getText(base);
  const total = parseInt(textOf(parseHtml(first).querySelector("span.cnt_toc")) || "0");
  let items = linksFrom(first, base, "a.toc_a");
  for (let page = 2; page <= 60; page++) {
    if (total && items.length >= total) break;
    const html = await tryText(`${base}?toc=${page}`);
    const more = linksFrom(html, base, "a.toc_a");
    if (!more.length) break;
    items = items.concat(more);
  }
  return dedupeByUrl(items).reverse();
}

// --- Tapas: episode list REST API ---
async function tocTapas(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const seriesId =
    doc.querySelector("meta[property='al:android:url']")?.getAttribute("content")?.split("/").pop() ||
    html.match(/series[\\/_-]?id["':\s]+(\d+)/i)?.[1];
  if (!seriesId) throw new Error("Tapas: series id not found");
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const json = await getJson(
      `https://tapas.io/series/${seriesId}/episodes?page=${page}&sort=OLDEST&max_limit=20`
    );
    const data = json?.data || {};
    const eps = data.episodes || [];
    eps
      .filter((e) => e.free || e.free_access || e.unlocked)
      .forEach((e) => out.push({ url: `https://tapas.io/episode/${e.id}`, title: `${e.scene}: ${e.title}` }));
    if (!data.pagination?.has_next || eps.length < 20) break;
  }
  return out;
}

// --- NovelUpdates: table#myTable, paginated with ?pg=N, oldest last ---
async function tocNovelUpdates(url) {
  const base = url.split("?")[0].replace(/\/$/, "") + "/";
  const html = await getText(base);
  const doc = parseHtml(html);
  const rowLinks = (h) => {
    const items = [];
    parseHtml(h)
      .querySelectorAll("table#myTable tbody tr")
      .forEach((row) => {
        const links = [...row.querySelectorAll("a[href]")];
        const a = links[links.length - 1];
        if (a) items.push({ url: absoluteUrl(base, a.getAttribute("href")), title: textOf(a) });
      });
    return items;
  };
  let items = rowLinks(html);
  const maxPage = [...doc.querySelectorAll("div.digg_pagination a[href*='pg=']")]
    .map((a) => parseInt(new URL(absoluteUrl(base, a.getAttribute("href"))).searchParams.get("pg") || "0"))
    .reduce((a, b) => Math.max(a, b), 1);
  if (maxPage > 1) {
    const urls = [];
    for (let p = 2; p <= maxPage; p++) urls.push(`${base}?pg=${p}`);
    const htmls = await mapPool(urls, 4, tryText);
    htmls.forEach((h) => h && items.push(...rowLinks(h)));
  }
  return dedupeByUrl(items).reverse();
}

// --- FanFiction.net / FictionPress: select#chap_select ---
async function tocFanFiction(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const select = doc.querySelector("select#chap_select");
  const storyId = url.match(/\/s\/(\d+)/)?.[1];
  const origin = new URL(url).origin;
  const slug = url.split("/").filter(Boolean).pop();
  if (!select || !storyId) {
    return [{ url, title: textOf(doc.querySelector("div#profile_top b")) || "Chapter 1" }];
  }
  return [...select.querySelectorAll("option")].map((o) => ({
    url: `${origin}/s/${storyId}/${o.getAttribute("value")}/${slug}`,
    title: textOf(o),
  }));
}

// --- Archive of Our Own: chapter index ---
async function tocAo3(url) {
  const workId = url.match(/\/works\/(\d+)/)?.[1];
  if (!workId) throw new Error("AO3: work id not found");
  const origin = new URL(url).origin;
  const navHtml = await tryText(`${origin}/works/${workId}/navigate`);
  let items = linksFrom(navHtml, origin, "ol.chapter.index.group li a[href*='/chapters/']");
  if (!items.length) {
    const html = await getText(`${origin}/works/${workId}`);
    items = [...parseHtml(html).querySelectorAll("select#selected_id option")].map((o) => ({
      url: `${origin}/works/${workId}/chapters/${o.getAttribute("value")}`,
      title: textOf(o),
    }));
  }
  if (!items.length) items = [{ url: `${origin}/works/${workId}`, title: "Chapter 1" }];
  return dedupeByUrl(items);
}

// --- LightNovelWorld family: /chapters?page=N ---
async function tocLightNovelWorld(url) {
  const base = url.split("?")[0].replace(/\/$/, "").replace(/\/chapters$/, "");
  const firstUrl = `${base}/chapters`;
  const html = await getText(firstUrl);
  const doc = parseHtml(html);
  const pick = (h) => linksFrom(h, firstUrl, "ul.chapter-list a", ".chapter-title");
  let items = pick(html);
  const maxPage = [...doc.querySelectorAll(".pagination a[href*='page=']")]
    .map((a) => parseInt(new URL(absoluteUrl(firstUrl, a.getAttribute("href"))).searchParams.get("page") || "0"))
    .reduce((a, b) => Math.max(a, b), 1);
  if (maxPage > 1) {
    const urls = [];
    for (let p = 2; p <= maxPage; p++) urls.push(`${firstUrl}?page=${p}`);
    const htmls = await mapPool(urls, 4, tryText);
    htmls.forEach((h) => h && items.push(...pick(h)));
  }
  return dedupeByUrl(items);
}

// --- Ranobes: /chapters/<id>/ with page/N/ pagination, newest first ---
async function tocRanobes(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  let tocUrl =
    doc.querySelector("div.r-fullstory-chapters-foot a[href*='/chapters/']")?.getAttribute("href") ||
    doc.querySelector("a[href*='/chapters/']")?.getAttribute("href");
  if (!tocUrl) {
    return linksFrom(html, url, "ul.chapters-scroll-list a", ".title").reverse();
  }
  tocUrl = absoluteUrl(url, tocUrl).replace(/\/$/, "") + "/";
  const tocHtml = await getText(tocUrl);
  const pagesCount =
    parseInt(tocHtml.match(/"pages_count"\s*:\s*(\d+)/)?.[1] || "0") ||
    [...parseHtml(tocHtml).querySelectorAll(".pages a")]
      .map((a) => parseInt(textOf(a)))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 1);
  const pick = (h) => linksFrom(h, tocUrl, "div#dle-content a[title], .cat_line a, ul.chapters-scroll-list a");
  let items = pick(tocHtml);
  for (let p = 2; p <= Math.max(pagesCount, 1); p++) {
    const h = await tryText(`${tocUrl}page/${p}/`);
    const more = pick(h);
    if (!more.length) break;
    items = items.concat(more);
  }
  return dedupeByUrl(items).reverse();
}

// --- Madara (WordPress manga/novel theme) family: admin-ajax chapter list ---
async function tocMadara(url) {
  const base = url.split("?")[0].replace(/\/$/, "") + "/";
  const origin = new URL(url).origin;
  const pick = (h) => linksFrom(h, base, "li.wp-manga-chapter a:not([title]), li.wp-manga-chapter a");
  // 1. Modern theme: POST-free AJAX endpoint on the series URL.
  let items = [];
  try {
    const res = await httpGet(`${base}ajax/chapters/`, { "X-Requested-With": "XMLHttpRequest" });
    items = pick(await res.text());
  } catch {
    /* fall through */
  }
  // 2. Older theme: admin-ajax with the numeric post id.
  if (!items.length) {
    const html = await getText(base);
    items = pick(html);
    if (!items.length) {
      const postId = html.match(/manga_id["'\s:=]+(\d+)/)?.[1] || html.match(/postid-(\d+)/)?.[1];
      if (postId) {
        try {
          const res = await fetch(`${origin}/wp-admin/admin-ajax.php`, {
            method: "POST",
            headers: {
              ...DEFAULT_HEADERS,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: `action=manga_get_chapters&manga=${postId}`,
          });
          items = pick(await res.text());
        } catch {
          /* ignore */
        }
      }
    }
  }
  return dedupeByUrl(items).reverse();
}

// --- ReadNovelFull family (novelfull clones with an AJAX chapter archive) ---
async function tocReadNovelFull(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  let items = linksFrom(html, url, "ul.list-chapter a, .list-chapter a");
  if (!items.length) {
    const novelId =
      html.match(/data-novel-id=["'](\d+)["']/)?.[1] || html.match(/novelId["'\s:=]+(\d+)/)?.[1];
    if (novelId) {
      const ajax = await tryText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
      items = linksFrom(ajax, origin, "a[href]");
    }
  }
  return dedupeByUrl(items);
}

// --- Webnovel (Qidian International): the /catalog page holds every chapter ---
async function tocWebnovel(url) {
  const catalog = url
    .replace(/(\/book\/(?:.*?_)?\d+\b).*/, "$1/catalog")
    .replace(/(\/comic\/(?:.*?_)?\d+\b).*/, "$1/catalog");
  const html = await getText(catalog);
  let items = linksFrom(html, catalog, "ul.content-list a[href], div.volume-item ol a[href]");
  if (!items.length) items = linksFrom(html, catalog, "a[href*='/book/'][href*='_']");
  return dedupeByUrl(items);
}

// --- MTLNovel: chapter list lives on <series>/chapter-list/ ---
async function tocMtlNovel(url) {
  const base = url.split("?")[0].replace(/\/$/, "");
  const listUrl = base.endsWith("chapter-list") ? base + "/" : `${base}/chapter-list/`;
  const html = await tryText(listUrl);
  let items = linksFrom(html, listUrl, "a.ch-link, div.ch-list a, #chapterlist a");
  if (!items.length) items = linksFrom(await getText(base + "/"), base, "a.ch-link, div.ch-list a");
  return dedupeByUrl(items).reverse();
}

// --- NovelCool: .chp-item a — all chapters on one page, reverse order ---
async function tocNovelCool(url) {
  const base = url.split('?')[0].replace(/\/$/, '').replace(/\/chapter\/.*$/, '');
  const html = await getText(base);
  const doc = parseHtml(html);
  const out = [];
  doc.querySelectorAll('.chp-item a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || !href.includes('/chapter/')) return;
    const title = a.getAttribute('title') || textOf(a.querySelector('.chapter-item-title')) || textOf(a);
    out.push({ url: absoluteUrl(base, href), title });
  });
  return out.reverse(); // site shows newest-first
}

// --- AllNovelFull: ul.list-chapter a — all chapters on one page ---
async function tocAllNovelFull(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  const html = await getText(base);
  const out = [];
  parseHtml(html).querySelectorAll('#list-chapter a[href], ul.list-chapter a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(base, href), title: textOf(a) });
  });
  return dedupeByUrl(out);
}

// --- Syosetu (ncode.syosetu.com): episode list on TOC page ---
async function tocSyosetu(url) {
  const u = new URL(url);
  const ncode = u.pathname.split('/').filter(Boolean)[0];
  const tocUrl = `https://ncode.syosetu.com/${ncode}/`;
  const html = await getText(tocUrl);
  const doc = parseHtml(html);
  const origin = 'https://ncode.syosetu.com';
  const out = [];
  // New design (2024+): .p-eplist__subtitle
  doc.querySelectorAll('a.p-eplist__subtitle[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
  });
  if (out.length) return out;
  // Old design: dd.subtitle > a
  doc.querySelectorAll('dl.novel_sublist2 dd.subtitle a, dl.novel_sublist a').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
  });
  return out;
}

// --- Novel18 (adult syosetu, same structure) ---
async function tocNovel18(url) {
  const u = new URL(url);
  const ncode = u.pathname.split('/').filter(Boolean)[0];
  const tocUrl = `https://novel18.syosetu.com/${ncode}/`;
  const html = await getText(tocUrl);
  const doc = parseHtml(html);
  const origin = 'https://novel18.syosetu.com';
  const out = [];
  doc.querySelectorAll('a.p-eplist__subtitle[href], dl.novel_sublist2 dd.subtitle a').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
  });
  return out;
}

// --- Kakuyomu (kakuyomu.jp): JSON in __NEXT_DATA__ ---
async function tocKakuyomu(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  try {
    const nd = doc.querySelector('script#__NEXT_DATA__')?.textContent;
    if (nd) {
      const data = JSON.parse(nd);
      const work = Object.values(data?.props?.pageProps?.__APOLLO_STATE__ || {})
        .find(v => v?.__typename === 'Work');
      const episodes = Object.values(data?.props?.pageProps?.__APOLLO_STATE__ || {})
        .filter(v => v?.__typename === 'Episode' && v?.title);
      const workId = url.match(/works\/(\d+)/)?.[1];
      return episodes.map(e => ({
        url: `https://kakuyomu.jp/works/${workId}/episodes/${e.id?.split(':').pop() || e.id}`,
        title: e.title || ''
      }));
    }
  } catch {}
  // Fallback: scrape episode links
  return linksFrom(html, url, 'a[href*="/episodes/"]');
}

// --- WuxiaWorld.co: chapter list page ---
async function tocWuxiaWorldCo(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  // Try /chapter-list.html variant
  const variants = [
    base,
    base.replace(/(\/[^/]+)$/, '$1/$1'.split('/').pop() + '-chapter-list.html'),
    base + '/chapter-list.html',
  ];
  for (const v of variants) {
    try {
      const html = await getText(v);
      const items = linksFrom(html, v, '.chapter-list a[href], .chapter-item a[href], li.chapter-li a[href]');
      if (items.length) return dedupeByUrl(items);
    } catch {}
  }
  return [];
}

// --- XenForo threadmarks (SpaceBattles, SufficientVelocity, QuestionableQuesting) ---
async function tocXenForo(url) {
  const u = new URL(url);
  const base = u.origin;
  // Extract thread id from URL like /threads/name.12345/
  const threadMatch = u.pathname.match(/\/threads\/[^/]+\.(\d+)/);
  if (!threadMatch) return [];
  const threadId = threadMatch[1];
  // Use the threadmarks reader page
  const readerUrl = `${base}/threads/${threadId}/threadmarks`;
  const html = await getText(readerUrl);
  const doc = parseHtml(html);
  const out = [];
  // XenForo threadmark list
  doc.querySelectorAll('.block-body .structItem--threadmark .structItem-title a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(base, href), title: textOf(a) });
  });
  if (out.length) return out;
  // Alternative selector
  doc.querySelectorAll('a.threadmarkLabel[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(base, href), title: textOf(a) });
  });
  return dedupeByUrl(out);
}

// --- CreativeNovels: chapter list AJAX ---
async function tocCreativeNovels(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const postId = html.match(/"postId":(\d+)/)?.[1] ||
    doc.querySelector('[data-post-id]')?.getAttribute('data-post-id');
  if (!postId) {
    return linksFrom(html, url, '.lcp_catlist a[href], .chapter-list a[href]');
  }
  const origin = new URL(url).origin;
  const ajaxHtml = await tryText(`${origin}/wp-admin/admin-ajax.php?action=lcp_category&catid=${postId}&order=ASC`);
  return linksFrom(ajaxHtml || html, url, 'a[href]').filter(i => /chapter|chap|ch[-_]?\d/i.test(i.url));
}

// --- Moonquill / generic Next.js novel sites ---
async function tocNextJs(url) {
  const html = await getText(url);
  const nd = parseHtml(html).querySelector('script#__NEXT_DATA__')?.textContent;
  if (!nd) return [];
  try {
    const data = JSON.parse(nd);
    const chapters = data?.props?.pageProps?.chapters ||
      data?.props?.pageProps?.novel?.chapters ||
      data?.props?.pageProps?.book?.chapters || [];
    const origin = new URL(url).origin;
    return chapters.map((c, i) => ({
      url: c.url || absoluteUrl(origin, c.slug || c.path || `/chapter/${c.id || i + 1}`),
      title: c.title || c.name || `Chapter ${i + 1}`
    }));
  } catch { return []; }
}

// --- NovelHi / NovelGate family: /ajax/chapter-archive ---
async function tocNovelHi(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const novelId = html.match(/data-novel-id=["'](\d+)["']/)?.[1] ||
    html.match(/novelId["'\s:=]+(\d+)/)?.[1];
  if (novelId) {
    const ajaxHtml = await tryText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
    const items = linksFrom(ajaxHtml, origin, 'a[href]');
    if (items.length) return items;
  }
  return linksFrom(html, url, 'ul.list-chapter a, .list-chapter a, #chapter-list a');
}

// --- LightNovelPub / NovelPub: /chapters page, paginated ---
async function tocLightNovelPub(url) {
  const base = url.split('?')[0].replace(/\/$/, '').replace(/\/chapters$/, '');
  const chapUrl = `${base}/chapters`;
  const html = await getText(chapUrl);
  const doc = parseHtml(html);
  const pick = h => linksFrom(h, chapUrl, 'ul.chapter-list a, li.chapter-item a, .chp-item a');
  let items = pick(html);
  // Get max page
  const maxPage = [...doc.querySelectorAll('.pagination a[href*="page="]')]
    .map(a => parseInt(new URL(absoluteUrl(chapUrl, a.getAttribute('href'))).searchParams.get('page') || '0'))
    .reduce((a, b) => Math.max(a, b), 1);
  if (maxPage > 1) {
    const urls = [];
    for (let p = 2; p <= maxPage; p++) urls.push(`${chapUrl}?page=${p}`);
    const htmls = await mapPool(urls, 4, tryText);
    htmls.forEach(h => h && items.push(...pick(h)));
  }
  return dedupeByUrl(items);
}

// --- NovelUpdatesForums / Translated Scans: WordPress-based scanlation groups ---
async function tocWordPressList(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  // Try WP REST API
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
  try {
    const json = await getJson(`${origin}/wp-json/wp/v2/posts?categories_name=${slug}&per_page=100&orderby=date&order=asc`);
    if (Array.isArray(json) && json.length) {
      return json.map(p => ({ url: p.link, title: p.title?.rendered || p.slug }));
    }
  } catch {}
  return linksFrom(html, url, '.entry-content a[href], .post-content a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d|episode|part[-_]?\d/i.test(i.title + i.url));
}

// --- AsianFanfics: story/view pages ---
async function tocAsianFanfics(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  // Chapter list is rendered via JS — try the chapters tab URL
  const storyId = url.match(/story\/view\/(\d+)/)?.[1];
  if (!storyId) return [];
  // Try the chapter list page
  const chapHtml = await tryText(`${origin}/story/view/${storyId}/chapters`);
  const items = linksFrom(chapHtml || html, origin, 'a[href*="story/view/"][href*="/"]')
    .filter(i => i.url.split('/').length > 6);
  return dedupeByUrl(items);
}

// --- WattpadStory (mobile): use existing wattpad parser but handle /story/ URL ---
async function tocWattpadStory(url) {
  // Normalize /story/ URL to standard format then delegate
  const normalized = url.replace('/story/', '/w/');
  return tocWattpad(normalized);
}

// --- NovelOnlineFull / similar aggregators with standard HTML list ---
async function tocNovelOnlineFull(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  const html = await getText(base);
  const out = [];
  parseHtml(html).querySelectorAll('#list-chapter a[href], ul.list-chapter a[href], .list-chapter a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(base, href), title: textOf(a) });
  });
  return dedupeByUrl(out);
}

// --- JJ Wuxia Comics (jjwxc.net): Chinese fiction (GBK-encoded server, proxies transcode to UTF-8) ---
async function tocJjwxc(url) {
  const novelId = new URL(url).searchParams.get('novelid') || url.match(/novelid=(\d+)/)?.[1];
  if (!novelId) return [];
  const tocUrl = `https://www.jjwxc.net/onebook.php?novelid=${novelId}`;
  // getText() uses the Content-Type charset (gb2312 direct, utf-8 via proxy) — both work correctly
  const html = await getText(tocUrl);
  const origin = 'https://www.jjwxc.net';
  const doc = parseHtml(html);
  const out = [];
  doc.querySelectorAll('a[href*="chapterid="]').forEach(a => {
    const href = a.getAttribute('href');
    if (href.includes('report')) return;
    const title = (a.textContent || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (href && title) out.push({ url: absoluteUrl(origin, href), title });
  });
  return dedupeByUrl(out);
}



// --- Pixiv Novel (novel.pixiv.net): series API ---
async function tocPixivNovel(url) {
  const seriesId = url.match(/series\/(\d+)/)?.[1];
  const workId = url.match(/works\/(\d+)/)?.[1];
  if (seriesId) {
    // Fetch series chapter list via AJAX API
    const json = await getJson(
      `https://www.pixiv.net/ajax/novel/series/${seriesId}/content_titles?last_order=0&order_by=asc`
    );
    const works = json?.body?.page?.series || [];
    if (works.length) {
      return works.map(w => ({
        url: `https://novel.pixiv.net/works/${w.id}`,
        title: w.title || `Chapter ${w.series?.contentOrder || ''}`
      }));
    }
  }
  if (workId) {
    // Single work — check if part of a series
    try {
      const json = await getJson(`https://www.pixiv.net/ajax/novel/${workId}`);
      const sid = json?.body?.seriesNavData?.seriesId;
      if (sid) return tocPixivNovel(`https://novel.pixiv.net/series/${sid}`);
      return [{ url, title: json?.body?.title || 'Chapter 1' }];
    } catch {}
  }
  return linksFrom(await tryText(url), url, 'a[href*="/works/"], a[href*="/series/"]');
}

// --- StoriesOnline.net: numeric chapter TOC ---
async function tocStoriesOnline(url) {
  const storyId = url.match(/\/s\/(\d+)/)?.[1];
  if (!storyId) return [];
  const tocUrl = `https://storiesonline.net/s/${storyId}`;
  const html = await getText(tocUrl);
  const out = [];
  parseHtml(html).querySelectorAll('a[href*="/s/' + storyId + '/"]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && /\/s\/\d+\/\d+/.test(href)) {
      out.push({ url: absoluteUrl('https://storiesonline.net', href), title: textOf(a) });
    }
  });
  return dedupeByUrl(out);
}

// --- FicWad: list of stories for an author / story chapters ---
async function tocFicwad(url) {
  const html = await getText(url);
  const origin = 'https://ficwad.com';
  // Story page: /story/XXXX — chapters listed in .chapter_list
  const chaps = linksFrom(html, origin, '.chapter_list a[href], .chapters a[href], a[href*="/story/"]');
  if (chaps.length > 1) return dedupeByUrl(chaps);
  // Author page: /a/XXXX — list all their stories
  return linksFrom(html, origin, 'a[href*="/story/"]').filter(i => !/author/.test(i.url));
}

// --- Volare Novels / WordPress translation blog ---
async function tocVolareNovels(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  const slug = base.split('/novel/')[1]?.split('/')[0];
  const origin = new URL(base).origin;
  // Try WP REST API for chapter posts
  if (slug) {
    try {
      const json = await getJson(`${origin}/wp-json/wp/v2/posts?slug=${slug}&per_page=1`);
      const catId = json?.[0]?.categories?.[0];
      if (catId) {
        const posts = await getJson(`${origin}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&orderby=date&order=asc`);
        if (Array.isArray(posts) && posts.length) {
          return posts.map(p => ({ url: p.link, title: p.title?.rendered || p.slug }));
        }
      }
    } catch {}
  }
  // Fallback: scrape chapter links from the novel index page
  const html = await getText(base);
  return linksFrom(html, base, '.chapter-list a, .entry-content a[href], table.chapter-table a')
    .filter(i => /chapter|chap|ch[-_]?\d/i.test(i.title + i.url));
}

// --- GravityTales / similar WP translation blogs ---
async function tocGravityTales(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  // Chapter table or list
  const items = linksFrom(html, origin, 'table.tablepress a[href], .chapter-list a[href], .entry-content a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d|\d+-\d+/i.test(i.title + i.url));
  return dedupeByUrl(items);
}

// --- WuxiaWorld.com: official REST API ---
async function tocWuxiaWorld(url) {
  // Normalize: /novel/<slug>/<chapter-slug> → /novel/<slug>
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const novelIdx = parts.indexOf('novel');
  const slug = novelIdx >= 0 ? parts[novelIdx + 1] : parts[0];
  if (!slug) throw new Error('WuxiaWorld: novel slug not found');
  // REST API returns all chapters
  const json = await getJson(`https://www.wuxiaworld.com/api/novels/${slug}/chapters`);
  const chapters = json?.chapters || json?.items || [];
  if (chapters.length) {
    return chapters.map((c, i) => ({
      url: `https://www.wuxiaworld.com/novel/${slug}/${c.slug || c.transliteratedTitle?.toLowerCase().replace(/\s+/g, '-') || `chapter-${i + 1}`}`,
      title: c.name || c.title || `Chapter ${i + 1}`,
    }));
  }
  // Fallback: scrape the novel page
  const html = await getText(`https://www.wuxiaworld.com/novel/${slug}`);
  return linksFrom(html, `https://www.wuxiaworld.com/novel/${slug}`, 'a[href*="/novel/"][href*="/chapter"]');
}

async function bodyWuxiaWorld(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '.chapter-content, #chapter-content, .cha-words, .chapter-text, article .content');
}

// --- Inkitt: story reader API ---
async function tocInkitt(url) {
  const storyId = url.match(/stories\/(\d+)/)?.[1] ||
    url.match(/story\/(\d+)/)?.[1];
  if (!storyId) {
    // Try slug-based URL
    const slug = url.match(/inkitt\.com\/stories\/([^/?#]+)/)?.[1];
    if (slug) {
      try {
        const json = await getJson(`https://www.inkitt.com/api/stories/${slug}`);
        const sid = json?.id || json?.story?.id;
        if (sid) return tocInkitt(`https://www.inkitt.com/stories/${sid}`);
      } catch {}
    }
    return [];
  }
  const json = await getJson(`https://www.inkitt.com/api/stories/${storyId}/chapters`);
  const chapters = json?.chapters || json?.data || [];
  return chapters.map((c, i) => ({
    url: `https://www.inkitt.com/stories/${storyId}/chapters/${c.id || c.number || i + 1}`,
    title: c.title || `Chapter ${i + 1}`,
  }));
}

async function bodyInkitt(url) {
  const storyId = url.match(/stories\/(\d+)/)?.[1];
  const chapterId = url.match(/chapters\/(\d+)/)?.[1];
  if (storyId && chapterId) {
    try {
      const json = await getJson(`https://www.inkitt.com/api/stories/${storyId}/chapters/${chapterId}`);
      const content = json?.content || json?.chapter?.content || json?.text || '';
      if (content) {
        return content.split('\n').map(p => `<p>${p}</p>`).join('');
      }
    } catch {}
  }
  return extractWithSelector(parseHtml(await getText(url)),
    '.chapter-text, .story-body, .content-wrapper, article');
}

// --- ReadLightNovel (.me / .org / .mobi): AJAX chapter list ---
async function tocReadLightNovel(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const origin = new URL(url).origin;
  // Try AJAX endpoint
  const novelId = html.match(/data-novel-id=["'](\d+)["']/)?.[1] ||
    html.match(/"novel_id"\s*:\s*(\d+)/)?.[1];
  if (novelId) {
    const ajaxHtml = await tryText(`${origin}/ajax/chapters/?novel_id=${novelId}`);
    const items = linksFrom(ajaxHtml, origin, 'a[href]')
      .filter(i => /chapter|chap|ch-?\d/i.test(i.url));
    if (items.length) return items;
  }
  // Fallback: HTML chapter list
  const items = linksFrom(html, url, '.list-chapter a, ul.chapter-list a, #chapter-list a');
  return dedupeByUrl(items);
}

async function bodyReadLightNovel(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '.chapter-content, #chapter-content, .desc, .novel-body');
}

// --- KnoxT / KnoxT Space: WP-based EN translation ---
async function tocKnoxT(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const items = linksFrom(html, url, '.entry-content a[href], .chapter-list a[href], table a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d|part[-_]?\d|episode/i.test(i.title + i.url));
  if (items.length) return dedupeByUrl(items);
  // WP REST API fallback
  const slug = url.split('/').filter(Boolean).pop();
  try {
    const json = await getJson(`${origin}/wp-json/wp/v2/posts?categories_name=${slug}&per_page=100&orderby=date&order=asc`);
    if (Array.isArray(json) && json.length)
      return json.map(p => ({ url: p.link, title: p.title?.rendered || p.slug }));
  } catch {}
  return dedupeByUrl(items);
}

// --- Chrysanthemum Garden: WP-based BL/danmei translations ---
async function tocChrysanthemumGarden(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  // CG uses a table of contents in the post body
  const items = linksFrom(html, url, '.entry-content a[href], article a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d|\bpart\b|\bepisode\b|\bprologue\b|\bepilogue\b/i.test(i.title + i.url)
      && !/(author|donate|patreon|twitter|discord|tag|category)\//.test(i.url));
  return dedupeByUrl(items);
}

// --- Genesis Translations: WP-based translation group ---
async function tocGenesisTranslations(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
  // Try WP REST API
  try {
    const search = await getJson(`${origin}/wp-json/wp/v2/posts?search=${slug}&per_page=1`);
    const catId = search?.[0]?.categories?.[0];
    if (catId) {
      const posts = await getJson(`${origin}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&orderby=date&order=asc`);
      if (Array.isArray(posts) && posts.length)
        return posts.map(p => ({ url: p.link, title: p.title?.rendered || p.slug }));
    }
  } catch {}
  const items = linksFrom(html, url, '.entry-content a[href], .chapter-list a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d/i.test(i.title + i.url));
  return dedupeByUrl(items);
}

// --- Novel Nest: aggregator with chapter list ---
async function tocNovelNest(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const novelId = html.match(/data-id=["'](\d+)["']/)?.[1] ||
    html.match(/novel_id["'\s:=]+(\d+)/)?.[1];
  if (novelId) {
    const ajaxHtml = await tryText(`${origin}/ajax/chapter-archive?id=${novelId}`);
    const items = linksFrom(ajaxHtml, origin, 'a[href]');
    if (items.length) return items;
  }
  const items = linksFrom(html, url, '#chapter-list a, .chapter-list a, ul.list-chapter a');
  return dedupeByUrl(items);
}

// --- NovelMtl: simple HTML chapter list ---
async function tocNovelMtl(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  const html = await getText(base);
  const doc = parseHtml(html);
  const origin = new URL(url).origin;
  const out = [];
  doc.querySelectorAll('.chapter-list a[href], #chapters a[href], ul.list li a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(base, href), title: textOf(a) });
  });
  if (out.length) return dedupeByUrl(out);
  // Paginated fallback
  return linksFrom(html, base, 'a[href]')
    .filter(i => /chapter|chap|ch[-_]?\d/i.test(i.url));
}

// --- Literotica: adult fiction, paginated chapters ---
async function tocLiterotica(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const origin = 'https://www.literotica.com';
  // Series page
  const seriesItems = linksFrom(html, origin, 'a[href*="/series/"], a[href*="/s/"]');
  if (seriesItems.length > 2) return dedupeByUrl(seriesItems);
  // Author page
  const authorItems = linksFrom(html, origin, 'table.st a[href], .a-story-link a[href]');
  if (authorItems.length) return dedupeByUrl(authorItems);
  // Single story — check for pages
  const pageCount = parseInt(doc.querySelector('select.b-pager-pages option:last-child')?.getAttribute('value') || '1');
  if (pageCount <= 1) return [{ url, title: textOf(doc.querySelector('h1')) || 'Chapter 1' }];
  const pages = [];
  for (let p = 1; p <= pageCount; p++) pages.push({ url: `${url}?page=${p}`, title: `Page ${p}` });
  return pages;
}

async function bodyLiterotica(url) {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, '.aa_ht, .b-story-body-x, #story_text, .story-body');
}

// --- NovelStar: CN novel site, AJAX chapter archive ---
async function tocNovelStar(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const novelId = html.match(/novelId["'\s:=]+(\d+)/)?.[1] ||
    html.match(/data-novel-id=["'](\d+)["']/)?.[1];
  if (novelId) {
    const ajaxHtml = await tryText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
    const items = linksFrom(ajaxHtml, origin, 'a[href]');
    if (items.length) return items;
  }
  return linksFrom(html, url, 'ul.chapter-list a, .list-chapter a, #chapter-list a');
}

// --- 69shuba.com: CN raw fiction, paginated TOC ---
async function toc69shuba(url) {
  const base = url.split('?')[0].replace(/\/$/, '');
  const html = await getText(base);
  const doc = parseHtml(html);
  const origin = new URL(url).origin;
  const out = [];
  // Main chapter list
  doc.querySelectorAll('#catalog a[href], .catalog a[href], dl dd a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
  });
  return dedupeByUrl(out);
}

async function body69shuba(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '#content, #booktxt, .booktxt, .readcontent');
}

// --- UUKanshu: CN raw fiction ---
async function tocUukanshu(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;
  const out = [];
  parseHtml(html).querySelectorAll('.book-chapter-item a[href], dl dd a[href], #catalog a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href) out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
  });
  return dedupeByUrl(out);
}

async function bodyUukanshu(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '#content, #booktxt, .booktxt, .content');
}

// --- ReadNovelMtl (readnovelmtl.com) ---
async function tocReadNovelMtl(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const origin = new URL(url).origin;
  const menu = doc.querySelector("#chapters") ? doc.querySelector("#chapters").parentElement : doc.querySelector(".accordion");
  let items = [];
  if (menu) {
    menu.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href) {
        items.push({ url: absoluteUrl(origin, href), title: (a.textContent || "").trim() });
      }
    });
  }
  if (!items.length) {
    items = linksFrom(html, origin, ".chapter-list a, .list-chapter a, #idData a, .chapters a, .ch-list a");
  }
  return dedupeByUrl(items);
}

async function bodyReadNovelMtl(url) {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, "#content, .chapter-content, #chr-content");
}


/** Hosts covered by the dedicated parsers above (used by supportedDomains). */
const MAJOR_DOMAINS = [
  "royalroad.com",
  "scribblehub.com",
  "tapas.io",
  "novelupdates.com",
  "fanfiction.net",
  "fictionpress.com",
  "archiveofourown.org",
  "lightnovelworld.com",
  "lightnovelcave.com",
  "lightnovelpub.com",
  "novelpub.com",
  "webnovelpub.com",
  "pandanovel.co",
  "ranobes.top",
  "ranobes.net",
  "webnovel.com",
  "mtlnovel.com",
  "readnovelfull.com",
  "novelusb.com",
  "allnovel.org",
  "novelsonline.net",
  "boxnovel.com",
  "wuxiaworld.site",
  "wuxiaworld.com",
  "foxaholic.com",
  "1stkissnovel.love",
  "sonicmtl.com",
  "hiraethtranslation.com",
  "zetrotranslation.com",
  "daonovel.com",
  "novelmic.com",
  "wetriedtls.com",
  "mvlempyr.com",
  "novelhold.com",
  "novelmt.com",
  "wuxiabox.com",
  "webnovelworld.org",
  "novelbin.me",
  "novgo.net",
  "asuracomic.net",
  "nocturnetranslations.com",
  "69shuba.com",
  "uukanshu.com",
  "ptwxz.com",
  "bixiange.me",
  "fictionlog.co",
  // New sites
  "inkitt.com",
  "readlightnovel.me",
  "readlightnovel.org",
  "readlightnovel.mobi",
  "knoxt.space",
  "knoxt.com",
  "chrysanthemumgarden.com",
  "genesistranslations.com",
  "novelnest.org",
  "novelmtl.com",
  "literotica.com",
  "novelstar.top",
  "akknovel.com",
];

/** Chapter-body selectors for the dedicated sites, tried in order. */
const MAJOR_BODY_SELECTORS = {
  royalroad: "div.chapter-inner, div.chapter-content, .page-content-wrapper",
  scribblehub: "div#chp_raw, div.chp_raw, div.fic_row",
  tapas: "#viewport, article.viewer__body, article",
  novelupdates: "",
  fanfiction: "div.storytext, #storytext",
  ao3: "div#chapters .userstuff, div#chapters, .userstuff",
  lightnovelworld: "#chapter-container, div.chapter-content, .chapter-container",
  ranobes: "div#arrticle, .story, #dle-content .text-story",
  webnovel: "div.chapter_content, .cha-words, .cha-content",
  mtlnovel: "div.par, .chapter-content, #chapter-content",
  readnovelfull: "#chr-content, #chapter-content, div.chapter-content",
  madara: "div.reading-content .text-left, div.reading-content, div.entry-content, .text-left",
  novelcool: ".chapter-content, .text-content, #chapterContent, .reading-content",
  allnovelfull: ".chr-c, #chapter-content, .reading-content, div.chapter-content",
  syosetu: "#novel_honbun, .p-novel__body, div#novel_color",
  novel18: "#novel_honbun, .p-novel__body, div#novel_color",
  kakuyomu: ".widget-episodeBody, .js-episode-body, article.widget-episodeBody",
  wuxiaworld_co: ".chapter-content, #chapter-content, .text-chapter",
  xenforo: "article.message-body .bbWrapper, .message-body .bbWrapper, .message-userContent",
  creativenovels: ".entry-content, .chapter-content, article .post-content",
  nextjs: ".chapter-content, .reader-content, main article",
  novelhi: "#chr-content, #chapter-content, div.chapter-content",
  lightnovelpub: "#chapter-content, .chapter-content, .chapter-body",
  asianfanfics: ".story-body, .chapter-text, .container .text",
  jjwxc: "div.noveltext, #noveltext, .readtxt",
  pixivnovel: "section.novel-text, .works-display, p",
  storiesonline: "#chapter_body, .chapter-text, div#story",
  ficwad: ".storytext, #story, .storyBody",
  volarenovels: ".entry-content, .chapter-content, article .post-content",
  gravitytales: ".entry-content, .chapter-content, article",
  // New sites
  wuxiaworld: ".chapter-content, #chapter-content, .cha-words, article .content",
  readlightnovel: ".chapter-content, #chapter-content, .desc, .novel-body",
  knoxt: ".entry-content, .chapter-content, article .post-content",
  chrysanthemumgarden: ".entry-content, .chapter-content, article",
  genesistranslations: ".entry-content, .chapter-content, article",
  novelnest: "#chr-content, #chapter-content, div.chapter-content",
  novelmtl: ".chapter-content, #chapter-content, .text-content",
  novelstar: "#chr-content, #chapter-content, div.chapter-content",
  akknovel: "#chr-content, .chapter-content, #chapter-content",
  "69shuba": "#content, #booktxt, .booktxt, .readcontent",
  uukanshu: "#content, #booktxt, .booktxt, .content",
};


const MAJOR_SITES = [
  [/(^|\.)royalroadl?\.com$/, "royalroad"],
  [/(^|\.)scribblehub\.com$/, "scribblehub"],
  [/(^|\.)tapas\.io$/, "tapas"],
  [/(^|\.)novelupdates\.com$/, "novelupdates"],
  [/(^|\.)(fanfiction|fictionpress)\.net$/, "fanfiction"],
  [/(^|\.)fictionpress\.com$/, "fanfiction"],
  [/(^|\.)archiveofourown\.org$/, "ao3"],
  [
    /(^|\.)(lightnovelworld\.(com|co)|lightnovelcave\.com|lightnovelpub\.(com|fan)|novelpub\.com|webnovelpub\.(com|pro)|pandanovel\.co|novelbob\.org|findnovel\.net|lightnovelstranslations\.com)$/,
    "lightnovelworld",
  ],
  [/(^|\.)ranobes\.(top|net|com)$/, "ranobes"],
  [/(^|\.)webnovel\.com$/, "webnovel"],
  [/(^|\.)mtlnovel\.(com|net|org)$/, "mtlnovel"],
  [/(^|\.)mtlnation\.com$/, "mtlnovel"],
  [
    /(^|\.)(readnovelfull\.(com|me)|novelusb\.com|allnovel\.org|vipnovel\.com|novelall\.com|lightnovelheaven\.com|novelsonline\.net|novelgate\.net|novelhall\.net|novelnext\.com|novelhat\.com|freefullnovel\.com|novelplanet\.com|novelonlinefull\.com|novelonlinefree\.com|novelhold\.com|novelmt\.com|wuxiabox\.com|webnovelworld\.org)$/,
    "readnovelfull",
  ],
  [
    /(^|\.)(boxnovel\.(com|net)|wuxiaworld\.site|foxaholic\.com|1stkissnovel\.love|listnovel\.com|morenovel\.net|noveltrench\.com|readwebnovel\.xyz|novelnice\.com|mangasushi\.net|zinnovel\.com|noveluniverse\.net|woopread\.com|novelpassion\.net|novelkite\.com|romanticlovebooks\.com|lscomic\.com|novel35\.com|sleepytranslations\.com|novelskip\.com|mangaonlineteam\.com|manhwatop\.com|novelcenter\.net|isekaiscan\.(com|eu)|manhuafast\.com|topmanhua\.com|manhuaga\.com|dragonholic\.com|nightscans\.net|mangatx\.com|sonicmtl\.com|hiraethtranslation\.com|zetrotranslation\.com|daonovel\.com|novelmic\.com|wetriedtls\.com|mvlempyr\.com)$/,
    "madara",
  ],
  [/(^|\.)(ncode|novel18)\.syosetu\.com$/, "syosetu"],
  [/(^|\.)kakuyomu\.jp$/, "kakuyomu"],
  [/(^|\.)novelcool\.com$/, "novelcool"],
  [/(^|\.)allnovelfull\.(com|net)$/, "allnovelfull"],
  [/(^|\.)wuxiaworld\.co$/, "wuxiaworld_co"],
  [/(^|\.)asianfanfics\.com$/, "asianfanfics"],
  [/(^|\.)forums?\.spacebattles\.com$/, "xenforo"],
  [/(^|\.)forums?\.sufficientvelocity\.com$/, "xenforo"],
  [/(^|\.)forum\.questionablequesting\.com$/, "xenforo"],
  [/(^|\.)creative-novels\.com$/, "creativenovels"],
  [/(^|\.)moonquill\.com$/, "nextjs"],
  [/(^|\.)jjwxc\.net$/, "jjwxc"],
  [/(^|\.)novel\.pixiv\.net$/, "pixivnovel"],
  [/(^|\.)storiesonline\.net$/, "storiesonline"],
  [/(^|\.)ficwad\.com$/, "ficwad"],
  [/(^|\.)volarenovels\.com$/, "volarenovels"],
  [/(^|\.)gravitytales\.com$/, "gravitytales"],
  [/(^|\.)wuxiaworld\.com$/, "wuxiaworld"],
  [/(^|\.)inkitt\.com$/, "inkitt"],
  [/(^|\.)readlightnovel\.(me|org|mobi)$/, "readlightnovel"],
  [/(^|\.)akknovel\.com$/, "readlightnovel"],
  [/(^|\.)knoxt\.(space|com)$/, "knoxt"],
  [/(^|\.)chrysanthemumgarden\.com$/, "chrysanthemumgarden"],
  [/(^|\.)genesistranslations\.com$/, "genesistranslations"],
  [/(^|\.)novelnest\.org$/, "novelnest"],
  [/(^|\.)novelmtl\.com$/, "novelmtl"],
  [/(^|\.)literotica\.com$/, "literotica"],
  [/(^|\.)novelstar\.top$/, "novelstar"],
  [/(^|\.)69shuba\.com$/, "69shuba"],
  [/(^|\.)uukanshu\.com$/, "uukanshu"],
];

function siteKey(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (host.includes("novelhall.com")) return "novelhall";
  if (host.includes("freewebnovel.com")) return "freewebnovel";
  if (host.includes("novelfire.")) return "novelfire";
  if (host.includes("novgo.")) return "novgo";
  if (host.includes("novelbuddy.com")) return "novelbuddy";
  if (host.includes("novelarrow.com")) return "novelarrow";
  if (host.includes("novelfull.net")) return "novelfullnet";
  if (host.includes("novelfull.com")) return "novelfullcom";
  if (host.includes("novelfull.")) return "novelfull";
  if (host.includes("novelbin") || host.includes("novlove")) return "novelbin";
  if (host.includes("wtr-lab.com")) return "wtrlab";
  if (host.includes("wattpad.com")) return "wattpad";
  if (host.includes("novelhi.com") || host.includes("novelgate.")) return "novelhi";
  if (host.includes("lightnovelpub.") || host.includes("novelpub.")) return "lightnovelpub";
  if (host.includes("creative-novels.com")) return "creativenovels";
  if (host.includes("readnovelmtl.com")) return "readnovelmtl";
  // New sites
  if (host === "wuxiaworld.com" || host.endsWith(".wuxiaworld.com")) return "wuxiaworld";
  if (host.includes("inkitt.com")) return "inkitt";
  if (host.includes("readlightnovel.") || host === "akknovel.com") return "readlightnovel";
  if (host.includes("knoxt.")) return "knoxt";
  if (host.includes("chrysanthemumgarden.com")) return "chrysanthemumgarden";
  if (host.includes("genesistranslations.com")) return "genesistranslations";
  if (host.includes("novelnest.org")) return "novelnest";
  if (host.includes("novelmtl.com")) return "novelmtl";
  if (host.includes("literotica.com")) return "literotica";
  if (host.includes("novelstar.top")) return "novelstar";
  if (host.includes("69shuba.com")) return "69shuba";
  if (host.includes("uukanshu.com")) return "uukanshu";

  for (const [re, key] of MAJOR_SITES) {
    if (re.test(host)) return key;
  }
  return "generic";
}



/** Returns [{ url, title }]. */
export async function fetchChapterLinks(tocUrl, linkSelector = "") {
  const key = siteKey(new URL(tocUrl).hostname);
  const dedicated = async () => {
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
      case "novelfullnet":
      case "novelfullcom":
      case "novelfull":
        return tocNovelFull(tocUrl);
      case "novelbin":
        return tocNovelBin(tocUrl);
      case "wtrlab":
        return tocWtrLab(tocUrl);
      case "wattpad":
        return tocWattpad(tocUrl);
      case "royalroad":
        return tocRoyalRoad(tocUrl);
      case "scribblehub":
        return tocScribbleHub(tocUrl);
      case "tapas":
        return tocTapas(tocUrl);
      case "novelupdates":
        return tocNovelUpdates(tocUrl);
      case "fanfiction":
        return tocFanFiction(tocUrl);
      case "ao3":
        return tocAo3(tocUrl);
      case "lightnovelworld":
        return tocLightNovelWorld(tocUrl);
      case "ranobes":
        return tocRanobes(tocUrl);
      case "webnovel":
        return tocWebnovel(tocUrl);
      case "mtlnovel":
        return tocMtlNovel(tocUrl);
      case "readnovelfull":
        return tocReadNovelFull(tocUrl);
      case "madara":
        return tocMadara(tocUrl);
      case "novelcool":
        return tocNovelCool(tocUrl);
      case "allnovelfull":
        return tocAllNovelFull(tocUrl);
      case "syosetu":
        return tocSyosetu(tocUrl);
      case "novel18":
        return tocNovel18(tocUrl);
      case "kakuyomu":
        return tocKakuyomu(tocUrl);
      case "wuxiaworld_co":
        return tocWuxiaWorldCo(tocUrl);
      case "xenforo":
        return tocXenForo(tocUrl);
      case "creativenovels":
        return tocCreativeNovels(tocUrl);
      case "nextjs":
        return tocNextJs(tocUrl);
      case "novelhi":
        return tocNovelHi(tocUrl);
      case "lightnovelpub":
        return tocLightNovelPub(tocUrl);
      case "asianfanfics":
        return tocAsianFanfics(tocUrl);
      case "jjwxc":
        return tocJjwxc(tocUrl);
      case "pixivnovel":
        return tocPixivNovel(tocUrl);
      case "storiesonline":
        return tocStoriesOnline(tocUrl);
      case "ficwad":
        return tocFicwad(tocUrl);
      case "volarenovels":
        return tocVolareNovels(tocUrl);
      case "gravitytales":
        return tocGravityTales(tocUrl);
      case "readnovelmtl":
        return tocReadNovelMtl(tocUrl);
      // New sites
      case "wuxiaworld":
        return tocWuxiaWorld(tocUrl);
      case "inkitt":
        return tocInkitt(tocUrl);
      case "readlightnovel":
        return tocReadLightNovel(tocUrl);
      case "knoxt":
        return tocKnoxT(tocUrl);
      case "chrysanthemumgarden":
        return tocChrysanthemumGarden(tocUrl);
      case "genesistranslations":
        return tocGenesisTranslations(tocUrl);
      case "novelnest":
        return tocNovelNest(tocUrl);
      case "novelmtl":
        return tocNovelMtl(tocUrl);
      case "literotica":
        return tocLiterotica(tocUrl);
      case "novelstar":
        return tocNovelStar(tocUrl);
      case "69shuba":
        return toc69shuba(tocUrl);
      case "uukanshu":
        return tocUukanshu(tocUrl);

      default:
        return [];
    }
  };

  if (key !== "generic") {
    try {
      const items = await dedicated();
      if (items?.length) return items;
    } catch (e) {
      console.warn("[fetcher] dedicated TOC parser failed", key, e?.message || e);
    }
  }

  // Unknown site, or the dedicated parser came back empty: config selectors,
  // then AI-detected selectors, then a raw same-origin link sweep.
  const config = lookupSiteConfig(new URL(tocUrl).hostname);
  const items = await tocFromConfig(tocUrl, config, linkSelector);
  if (items.length) return items;
  const doc = parseHtml(await getText(tocUrl));
  return collectTocLinks(doc, tocUrl, [linkSelector || "a[href]"]);
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
      case "readnovelmtl":
        return bodyReadNovelMtl(chapterUrl);
      // New sites
      case "wuxiaworld":
        return bodyWuxiaWorld(chapterUrl);
      case "inkitt":
        return bodyInkitt(chapterUrl);
      case "readlightnovel":
        return bodyReadLightNovel(chapterUrl);
      case "literotica":
        return bodyLiterotica(chapterUrl);
      case "69shuba":
        return body69shuba(chapterUrl);
      case "uukanshu":
        return bodyUukanshu(chapterUrl);

      default:
        if (MAJOR_BODY_SELECTORS[key]) {
          return bodyGeneric(chapterUrl, contentSelector || MAJOR_BODY_SELECTORS[key]);
        }
        return bodyGeneric(chapterUrl, contentSelector);
    }
  };

  const enough = (h) => h && h.replace(/<[^>]+>/g, "").trim().length >= 20;
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const html = await attempt();
      if (enough(html)) return html;
      last = html || last;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  // A hand-written parser produced nothing (site changed its markup) — retry
  // through the generic path, which includes the AI selector fallback.
  if (key !== "generic") {
    try {
      const html = await bodyGeneric(chapterUrl, contentSelector);
      if (enough(html)) return html;
      last = last || html;
    } catch {
      /* ignore */
    }
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
