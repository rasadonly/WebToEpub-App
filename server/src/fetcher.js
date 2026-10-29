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

// Ordered by measured success/speed: the self-hosted CF Worker opened the most
// sites (NovelFull, FreeWebNovel, NovelFire, NovGo...) and is fastest.
const PROXIES = [
  "", // direct
  "https://epub-cors-proxy.telegram-cf-proxy.workers.dev/api/proxy?url=",
  "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://corsproxy.io/?url=",
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
  [/snowytranslations\.com$/i, 2000],
  [/freewebnovel\.com$/i, 2500],
  [/novelfull(l)?\.(net|com)$/i, 1800],
  [/(^|\.)(all-?novelfull|allnovelfull|allnovelnext|allnovelbook|allnovel)\.(com|net|org)$/i, 1800],
  [/novelfullbook\.com$/i, 1800],
  [/novelfire\.net$/i, 1500],
  [/scribblehub\.com$/i, 1500],
  [/(novelgo\.id|novgo\.net)$/i, 1500],
  [/novelcodex\.com$/i, 1200],
  [/novel-?next\.(com|net)$/i, 1200],
  [/novel-?bin\.(com|net)$/i, 1200],
  [/(novelmax\.net|novelgate\.net|novelhulk\.net)$/i, 1200],
  [/fanfiction\.net$/i, 2000],
  [/(akknovel\.com|readlightnovel\.me)$/i, 1500],
];

const DEFAULT_GAP_MS = 250;

function gapFor(host) {
  for (const [re, ms] of HOST_THROTTLE) if (re.test(host)) return ms;
  return DEFAULT_GAP_MS;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-host lanes: several requests to one host run in parallel, with starts
// spaced by gap/lanes, so rate-limited sites still get paced but chapters are
// no longer fetched strictly one by one.
const hostLanes = new Map();
const HOST_LANES = Number(process.env.HOST_LANES || 10);

function throttle(host) {
  const gap = gapFor(host);
  let st = hostLanes.get(host);
  if (!st) { st = { active: 0, waiters: [], nextStart: 0 }; hostLanes.set(host, st); }
  const spacing = Math.ceil(gap / HOST_LANES);
  const acquire = () => {
    st.active++;
    const now = Date.now();
    const wait = Math.max(0, st.nextStart - now);
    st.nextStart = Math.max(now, st.nextStart) + spacing;
    let released = false;
    return sleep(wait).then(() => ({
      done: () => {
        if (released) return;
        released = true;
        st.active--;
        const w = st.waiters.shift();
        if (w) w();
      },
    }));
  };
  if (st.active < HOST_LANES) return acquire();
  return new Promise((r) => st.waiters.push(r)).then(acquire);
}


// host -> timestamp until which direct fetching is skipped
const blockedUntil = new Map();
const BLOCK_TTL_MS = 5 * 60 * 1000;

const blockedHosts = {
  has: (h) => (blockedUntil.get(h) || 0) > Date.now(),
  add: (h) => blockedUntil.set(h, Date.now() + BLOCK_TTL_MS),
  delete: (h) => blockedUntil.delete(h),
};

const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Hosts sitting behind a Cloudflare "Just a moment…" interstitial. A plain
 * server fetch always gets the challenge page, so we go through the rendering
 * proxies first (they solve it) and only try direct as a last resort.
 */
const CF_PROTECTED = [
  /(^|\.)zenithtls\.com$/i,
  // cherrymist.cafe HTML pages are directly accessible — no CF interstitial
  /(^|\.)novgo\.(net|com)$/i,
  /(^|\.)novelgo\.id$/i,
  /(^|\.)novelfire\.(net|com|io)$/i,
  /(^|\.)novelbuddy\.(com|io)$/i,
  /(^|\.)hako\.vn$/i,
  /(^|\.)docln\.(net|sbs)$/i,
  // Next.js app that renders chapter text client-side
  /(^|\.)readthedrama\.com$/i,
  // Ridi 403s / Cloudflare-challenges direct requests from datacenter IPs
  // on every host (series pages, GraphQL API, viewer) — proxies first.
  /(^|\.)ridibooks\.com$/i,
];

function isCfProtected(host) {
  return CF_PROTECTED.some((re) => re.test(host));
}

// Per-site probe results: host -> helpers that opened it, fastest first.
// Regenerate by re-running the probe; unknown hosts use the default order.
const PROXY_MAP = JSON.parse(
  fs.readFileSync(new URL("./proxyMap.json", import.meta.url), "utf8")
);
const PROBE_URLS = {
  direct: "",
  cfworker: "https://epub-cors-proxy.telegram-cf-proxy.workers.dev/api/proxy?url=",
  lovable: "https://loveable-proxy-forwebtoepub.lovable.app/api/proxy?url=",
  codetabs: "https://api.codetabs.com/v1/proxy?quest=",
  corsproxy: "https://corsproxy.io/?url=",
  corslol: "https://api.cors.lol/?url=",
  allorigins: "https://api.allorigins.win/raw?url=",
};

function proxyOrderFor(host) {
  const base = isCfProtected(host) ? [...PROXIES.filter(Boolean), ""] : PROXIES;
  const pref = (PROXY_MAP[host.replace(/^www\./, "")] || [])
    .map((n) => PROBE_URLS[n])
    .filter((u) => u !== undefined);
  if (!pref.length) return base;
  return [...new Set([...pref, ...base])];
}

/** True when the HTML we got back is a Cloudflare/bot interstitial, not content. */
function looksLikeChallenge(text) {
  const head = String(text || "").slice(0, 5000);
  return (
    /<title>\s*Just a moment/i.test(head) ||
    // Cloudflare block pages ("Attention Required! | Cloudflare" / "Sorry,
    // you have been blocked") can be returned with HTTP 200 by rewriting
    // proxies — they must be treated as a block, not as page content.
    /<title>\s*Attention Required/i.test(head) ||
    /Sorry, you have been blocked|Why have I been blocked/i.test(head) ||
    /cf-browser-verification|challenge-platform|cf_chl_opt|Checking your browser before/i.test(head) ||
    /Enable JavaScript and cookies to continue/i.test(head)
  );
}

/* ------------------------------------------------------------------ *
 * Stealth routes — curl_cffi (real Chrome TLS fingerprint), cloudscraper
 * and Tor. The Hugging Face image runs these locally as a Python sidecar;
 * Heroku (Node-only dyno) borrows the same capability over HTTP from the
 * Hugging Face Space, so both backends can beat Cloudflare.
 * ------------------------------------------------------------------ */

const LOCAL_STEALTH = (process.env.STEALTH_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
const REMOTE_STEALTH = (process.env.REMOTE_STEALTH_URL || "").replace(/\/$/, "");

const STEALTH_ROUTES = [
  LOCAL_STEALTH ? `${LOCAL_STEALTH}/fetch?url=` : "",
  REMOTE_STEALTH ? `${REMOTE_STEALTH}?url=` : "",
].filter(Boolean);

let localStealthOk = true;

function isInvalidStealthBody(text) {
  if (!text) return true;
  const head = text.slice(0, 5000).toLowerCase();
  return (
    head.includes("hugging face") ||
    head.includes("huggingface_logo") ||
    head.includes("preparing space") ||
    looksLikeChallenge(text)
  );
}

/** Fetches through the stealth chain. Returns the HTML, or null if unavailable. */
export async function stealthGet(url, timeoutMs = 45000, tor = "auto") {
  for (const base of STEALTH_ROUTES) {
    const isLocal = LOCAL_STEALTH && base.startsWith(LOCAL_STEALTH);
    if (isLocal && !localStealthOk) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs + 5000);
    try {
      const sep = base.includes("?") ? "&" : "?";
      const r = await fetch(
        `${base}${encodeURIComponent(url)}${sep}tor=${tor}&timeout=${Math.round(timeoutMs / 1000)}`,
        { signal: ctrl.signal }
      );
      if (r.ok) {
        const text = await r.text();
        if (text && !isInvalidStealthBody(text)) return text;
      }
    } catch {
      if (isLocal) localStealthOk = false; // sidecar not running here
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export function stealthAvailable() {
  return STEALTH_ROUTES.length > 0 && (localStealthOk || Boolean(REMOTE_STEALTH));
}

const INKITT_COOKIE =
  "user_credentials=4be4b2f459c9113e1a86bad353c1c89e9886c0285d11bf7cb9441e3f3f61278655ae43c8e47c607dfc31ccd985f88faa3e216542766d50d0b1b2d2fc181e4889%3A%3A12744546%3A%3A2026-09-16T06%3A16%3A52Z; _rocky_session_1=92ea8ac4dcdd4c3c8b169a722c1e9f36; __stripe_mid=94754462-ddb8-4b14-ba53-f09d65f073847cf17b";


// Many Chinese/Japanese/Korean sites declare their charset only in a <meta>
// tag (or not at all in the header); fetch's text() then defaults to UTF-8
// and GBK/Big5/Shift_JIS pages come back as mojibake. Decode the raw bytes
// with the declared charset instead (header first, then meta sniffing).
async function decodeBodyText(r) {
  const buf = await r.arrayBuffer();
  const ct = r.headers.get("content-type") || "";
  const headerCs = ct.match(/charset=([\w-]+)/i)?.[1];
  const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
  const metaCs = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  const declaredCs = metaCs || headerCs;
  const decode = (cs) => { try { return new TextDecoder(cs).decode(buf); } catch { return null; } };
  // U+FFFD marks a lossy decode; the literal sequence 锟斤拷 is what a
  // second wrong decode (of already-corrupted UTF-8) produces — both count.
  const badness = (s) => (s.match(/\uFFFD/g) || []).length + 3 * (s.match(/\u951F\u65A4\u62F7/g) || []).length;
  let text = decode(headerCs || metaCs || "utf-8");
  if (text == null) text = new TextDecoder("utf-8").decode(buf);
  // Proxies sometimes label GBK bytes as utf-8; if that produced replacement
  // characters and the page itself declares another charset, trust the page.
  if (metaCs && headerCs && metaCs.toLowerCase() !== headerCs.toLowerCase() && badness(text) > 0) {
    const alt = decode(metaCs);
    if (alt != null && badness(alt) < badness(text)) text = alt;
  }
  return { text, declared: declaredCs && !/^utf-?8$/i.test(declaredCs) ? declaredCs : null, bad: badness(text) };
}

async function httpGet(url, extra = {}, timeoutMs = 7000) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const origin = parsed.origin;
  let lastErr = null;
  let uaIndex = 0;
  // Rendering proxies need much longer than a direct fetch.
  const effTimeout = isCfProtected(host) ? Math.max(timeoutMs, 45000) : timeoutMs;

  const htmlResponse = (text) =>
    new Response(text, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  // Pacing only protects the site from *our* IP. When direct access is already
  // blocked every request goes through proxies, so don't serialize them —
  // that turned 100-page chapter lists (NovelFull) into 30s+ timeouts.
  const lease = ((blockedHosts.has(host) || isCfProtected(host)) && !/freewebnovel\.com$/i.test(host)) ? { done() {} } : await throttle(host);
  try {
    // Cloudflare-protected or currently-blocked hosts: stealth chain first.
    if (stealthAvailable() && (isCfProtected(host) || blockedHosts.has(host))) {
      const st = await stealthGet(url, effTimeout);
      if (st) return htmlResponse(st);
    }
    let wallSweeps = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      let responded = 0;
      let challenged = 0;
      for (const proxy of proxyOrderFor(host)) {
        if (!proxy && blockedHosts.has(host)) continue;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), effTimeout);
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
          if (host.includes("inkitt.com")) {
            headers["Cookie"] = extra.Cookie || INKITT_COOKIE;
            headers["x-proxy-cookie"] = extra.Cookie || INKITT_COOKIE;
          }
          const r = await fetch(buildUrl(proxy, url), {
            headers,
            signal: ctrl.signal,
            redirect: "follow",
          });
          responded++;
          if (r.ok) {
            const ct = r.headers.get("content-type") || "";
            if (/html|text\/plain/i.test(ct)) {
              const { text, declared, bad } = await decodeBodyText(r);
              // A transcoding proxy can "open" a GBK/Big5 page while
              // destroying its text (decoded as UTF-8 upstream, replacement
              // chars baked in). If the page declares a non-UTF-8 charset
              // and the body is full of replacement chars, this route is
              // lossy — fall through to the next one (direct decodes fine).
              if (declared && bad > 40) {
                lastErr = new Error("Lossy route (charset corruption)");
                continue;
              }
              if (looksLikeChallenge(text)) {
                challenged++;
                if (!proxy) blockedHosts.add(host);
                lastErr = new Error("Cloudflare challenge");
                continue; // this route is blocked — try the next one
              }
              if (!proxy) blockedHosts.delete(host);
              return new Response(text, {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            }
            if (!proxy) blockedHosts.delete(host);
            return r;
          }
          if (!proxy && (r.status === 403 || r.status === 401 || r.status === 429)) {
            blockedHosts.add(host);
          }
          if (r.status === 401 || r.status === 403 || r.status === 502) {
            // Bot walls often serve the challenge page WITH the error status,
            // and some proxies report the origin's wall in their own words.
            try {
              const body = await r.text();
              if (looksLikeChallenge(body) || /blocked by anti-bot|anti-bot protection/i.test(body.slice(0, 5000))) challenged++;
            } catch {
              /* body unreadable — not evidence either way */
            }
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
      // Bot-wall evidence (e.g. NovelHall from datacenter IPs): if two sweeps
      // in a row each saw 2+ routes serve a challenge page — or a single
      // sweep saw 4+ — more retries will not get through. Fail fast with a
      // clear error instead of churning through every fallback for minutes.
      if (challenged >= 2) wallSweeps++;
      else wallSweeps = 0;
      if (wallSweeps >= 2 || challenged >= 4) {
        lastErr = new Error(
          "Site is blocked by anti-bot protection (Cloudflare challenge) on all routes"
        );
        lastErr.blocked = true;
        break;
      }
      // All proxies failed this round — back off before the next sweep.
      if (attempt < 2) await sleep(800 * Math.pow(2, attempt) + Math.random() * 400);
    }
    // Last resort: curl_cffi / cloudscraper / Tor.
    if (stealthAvailable()) {
      const st = await stealthGet(url, effTimeout, "1");
      if (st) return htmlResponse(st);
    }
    throw lastErr || new Error("All fetch attempts failed");
  } finally {
    lease.done();
  }
}


async function getText(url) {
  return (await httpGet(url)).text();
}

/** Smart fetch with proxy/route fallbacks (used by /api/proxy when blocked). */
export async function smartGetText(url, timeoutMs = 7000, deadlineMs = 17000) {
  let t;
  const deadline = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("deadline")), deadlineMs); });
  try {
    return await Promise.race([httpGet(url, {}, timeoutMs).then((r) => r.text()), deadline]);
  } finally { clearTimeout(t); }
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


async function tocFreeWebNovel(url) {
  let base = url.split("?")[0].replace(/\/$/, "");
  // FreeWebNovel restructured book URLs from /{slug}.html to /novel/{slug};
  // the old .html URLs now 404. Rewrite so saved/old links keep working.
  base = base.replace(/^(https?:\/\/[^/]+\/)([a-z0-9-]+)\.html$/i, "$1novel/$2");
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

// ---- JadeScrolls (jadescrolls.com) ----
// The site is a Next.js app: its pages are empty shells and the chapter data
// loads client-side from a public JSON API (api.jadescrolls.com/api), so
// there is nothing to scrape in the HTML. The API is open for reads.
const JADESCROLLS_API = "https://api.jadescrolls.com/api";
const jadescrollsNovelIds = new Map();

async function jadescrollsGet(path) {
  const res = await fetch(`${JADESCROLLS_API}${path}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`JadeScrolls API HTTP ${res.status} for ${path}`);
  return res.json();
}

async function jadescrollsNovel(slug) {
  const novel = await jadescrollsGet(
    `/novels?slug=${encodeURIComponent(slug)}`
  );
  if (!novel || !novel.id)
    throw new Error(`JadeScrolls: novel not found for slug "${slug}"`);
  jadescrollsNovelIds.set(slug, novel.id);
  return novel;
}

async function tocJadeScrolls(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean)[1];
  if (!slug)
    throw new Error("JadeScrolls: could not read the novel slug from the URL");
  const novel = await jadescrollsNovel(slug);
  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await jadescrollsGet(
      `/novels-chapter/${novel.id}/chapters/list?page=${page}&limit=1000`
    );
    for (const ch of data.data || []) {
      if (ch.status && ch.status !== "PUBLISHED") continue;
      if (!ch.slug) continue;
      items.push({
        url: `https://jadescrolls.com/novel/${slug}/${ch.slug}`,
        title: ch.title || `Chapter ${ch.chapter_number}`,
        _num:
          typeof ch.chapter_number === "number"
            ? ch.chapter_number
            : Number.MAX_SAFE_INTEGER,
      });
    }
    totalPages = (data.meta && data.meta.total_pages) || 1;
    page += 1;
  } while (page <= totalPages);
  // The API returns newest first; the converter expects reading order.
  items.sort((a, b) => a._num - b._num);
  if (!items.length)
    throw new Error("JadeScrolls: the site API returned no chapters");
  return items.map(({ url: u, title: t }) => ({ url: u, title: t }));
}

async function bodyJadeScrolls(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const novelSlug = parts[1];
  const chapterSlug = parts[2];
  if (!novelSlug || !chapterSlug)
    throw new Error("JadeScrolls: bad chapter URL");
  let novelId = jadescrollsNovelIds.get(novelSlug);
  if (!novelId) novelId = (await jadescrollsNovel(novelSlug)).id;
  const ch = await jadescrollsGet(
    `/novels-chapter/${novelId}/chapters/${encodeURIComponent(chapterSlug)}`
  );
  if (ch && ch.type === "PREMIUM")
    throw new Error(
      "This chapter is locked on JadeScrolls (premium — it needs coins or a subscription there). Only a short preview is public, so it cannot be converted."
    );
  const html = String((ch && ch.content) || "").trim();
  if (!html) throw new Error("JadeScrolls returned an empty chapter");
  // The content opens with a "<p>Chapter N</p>" echo of the title, followed by
  // empty spacer paragraphs — drop both; the EPUB adds its own heading.
  const cleaned = html.replace(
    /^<p>\s*Chapter\s+\d+\s*<\/p>\s*(<p>\s*(<br\s*\/?>)?\s*<\/p>\s*)*/i,
    ""
  );
  return cleaned || html;
}

// ---- Ridibooks (ridibooks.com) ----
// Ridi is a Next.js app. A series page (ridibooks.com/books/{seriesId})
// server-renders the book header and the first episodes into __NEXT_DATA__
// (the riGrid cells); the remaining episodes come from the site's public
// GraphQL API (api.ridibooks.com/graphql), paged 100 at a time. Chapter
// text comes from the web viewer: POST /api/web-viewer/generate returns
// signed spine files ({value: html}). Free episodes work anonymously;
// paid episodes answer INVALID_ACCESS and app-only titles answer
// BOOK_NOT_SUPPORTED_ON_WEB_VIEWER — both fail with a clear error.
const RIDI_GQL = "https://api.ridibooks.com/graphql";
const RIDI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// Ridi refuses direct requests from datacenter IPs (HTTP 403 on the web
// hosts, a Cloudflare challenge on the API host), so the series page is
// fetched through the shared httpGet proxy cascade and the JSON POSTs go
// through the proxy pool, the same pattern as the WTR-LAB reader API.
const RIDI_API_HEADERS = {
  "User-Agent": RIDI_UA,
  Accept: "application/json",
  // Apollo Server's CSRF guard: carried so the call passes even if a proxy
  // rewrites the Content-Type on the way.
  "Apollo-Require-Preflight": "true",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Ch-Ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};
const RIDI_EPISODE_QUERY = `query BookDetailHomeEpisodeBooksPagination($id: UUID!, $context: BookDetailHomeEpisodeBookListCellContext!) {
  riGrid { cells { bookDetailHome { episodeBookListCell(id: $id, context: $context) { cell {
    books { bookId title price { sellingPrice } }
    pagination { nextPage { order offset limit } }
    seriesId
  } } } } } }`;

// POST JSON to a Ridi endpoint through the proxy pool (direct first),
// remembering the route that last answered so a long conversion does not
// re-probe the blocked direct route for every chapter.
let ridiRoute = 0;
async function ridiPostJson(target, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  let lastErr = null;
  for (let n = 0; n < PROXIES.length; n++) {
    const idx = (ridiRoute + n) % PROXIES.length;
    const routeName =
      idx === 0 ? "direct" : new URL(PROXIES[idx]).hostname;
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      let res;
      try {
        res = await fetch(buildUrl(PROXIES[idx], target), {
          method: "POST",
          headers: {
            ...RIDI_API_HEADERS,
            "Content-Type": "application/json",
            ...extraHeaders,
          },
          body,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      if (!res.ok) {
        console.log(
          `[ridi] route ${routeName} -> HTTP ${res.status} in ${Date.now() - t0}ms: ${text.slice(0, 120).replace(/\s+/g, " ")}`
        );
        lastErr = new Error(`Ridibooks HTTP ${res.status}`);
        continue;
      }
      if (looksLikeChallenge(text)) {
        console.log(
          `[ridi] route ${routeName} -> challenge page in ${Date.now() - t0}ms`
        );
        lastErr = new Error("Ridibooks: Cloudflare challenge");
        continue;
      }
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON — try the next route */
      }
      if (!json) {
        console.log(
          `[ridi] route ${routeName} -> non-JSON in ${Date.now() - t0}ms: ${text.slice(0, 120).replace(/\s+/g, " ")}`
        );
        lastErr = new Error("Ridibooks: non-JSON response");
        continue;
      }
      console.log(
        `[ridi] route ${routeName} -> OK in ${Date.now() - t0}ms`
      );
      ridiRoute = idx;
      return json;
    } catch (e) {
      console.log(
        `[ridi] route ${routeName} -> threw in ${Date.now() - t0}ms: ${e.message}`
      );
      lastErr = e;
    }
  }
  throw lastErr || new Error("Ridibooks request failed on every route");
}

async function ridiGql(query, variables) {
  const json = await ridiPostJson(
    RIDI_GQL,
    { query, variables },
    { Origin: "https://ridibooks.com", Referer: "https://ridibooks.com/" }
  );
  if (json.errors && json.errors.length)
    throw new Error(
      `Ridibooks API: ${json.errors[0].message || "unknown error"}`
    );
  return json.data;
}

function ridiSeriesId(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const id = parts[0] === "books" ? parts[1] : null;
  if (!id || !/^\d+$/.test(id))
    throw new Error(
      "Ridibooks: could not read the book id from the URL — paste a series page like https://ridibooks.com/books/3302009326"
    );
  return id;
}

// Fetch the series page once and pull the SSR'd riGrid cells out of
// __NEXT_DATA__: the header (title / author / cover) and the episode-list
// cell (first episodes + the cell id the GraphQL pager needs).
async function ridiSeriesPage(seriesId) {
  const res = await httpGet(
    `https://ridibooks.com/books/${seriesId}`,
    {},
    25000
  );
  if (!res.ok) throw new Error(`Ridibooks: series page HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m)
    throw new Error(
      "Ridibooks: the series page did not contain its data block (has the layout changed?)"
    );
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error("Ridibooks: could not parse the series page data");
  }
  const cells =
    (data &&
      data.props &&
      data.props.pageProps &&
      data.props.pageProps.sectionProps &&
      data.props.pageProps.sectionProps.gridQuery &&
      data.props.pageProps.sectionProps.gridQuery.riGrid &&
      data.props.pageProps.sectionProps.gridQuery.riGrid.grid &&
      data.props.pageProps.sectionProps.gridQuery.riGrid.grid.cells) ||
    [];
  let header = null;
  let episodeCell = null;
  let episodeCellId = null;
  for (const c of cells) {
    if (c.type === "BookDetailHomeHeader")
      header = c.cell__BookDetailHomeHeader || null;
    if (c.type === "BookDetailHomeEpisodeBookList") {
      episodeCell = c.cell__BookDetailHomeEpisodeBookList || null;
      episodeCellId = c.id || null;
    }
  }
  return { header, episodeCell, episodeCellId, html };
}



// ---- Snowy Translations (snowytranslations.com) ----
// WordPress site. Each series page carries its own chapter index, but the
// wrapper differs by the series' age: a .gp-auto-toc list (newer series),
// a ul.gp-chapter-toc-list, or plain dated-post links inside .entry-content
// (older series). None of them match the generic parser's chapter-link
// scoring, which instead returned the sidebar's two most recent posts.
// Later chapters are listed with the teaser label "Read advanced chapters"
// (the posts themselves hold the full chapter), so those entries are
// numbered by their position in the list. Chapter posts embed the same
// dropdown, prev/next navigation, a members promo and ad blocks inside
// .entry-content, all of which the generic body extractor swallowed.
const SNOWY_POST_RE = /\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/;

async function tocSnowyTranslations(url) {
  const doc = parseHtml(await getText(url));
  let anchors = [];
  for (const sel of [".gp-auto-toc", "ul.gp-chapter-toc-list", ".entry-content"]) {
    const root = doc.querySelector(sel);
    if (!root) continue;
    const found = [];
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (SNOWY_POST_RE.test(href))
        found.push({
          href,
          text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        });
    });
    if (found.length >= 3) {
      anchors = found;
      break;
    }
  }
  if (!anchors.length)
    throw new Error(
      "Snowy Translations: no chapter list found on this page — paste the series page URL (snowytranslations.com/series/...)"
    );
  const seen = new Set();
  const out = [];
  for (const { href, text } of anchors) {
    if (seen.has(href)) continue;
    if (/^(previous|next|show chapters)$/i.test(text)) continue;
    seen.add(href);
    const teaser = !text || /^read advanced chapters$/i.test(text);
    out.push({ url: href, title: teaser ? `Chapter ${out.length + 1}` : text });
  }
  return out;
}

async function bodySnowyTranslations(url) {
  const doc = parseHtml(await getText(url));
  const container = doc.querySelector(".entry-content");
  if (!container) return "";
  stripInside(
    container,
    ".gp-chapter-toc-container, .gp-chapter-navigation, .code-block, script, style, iframe, ins, form, button"
  );
  // The "Read advanced chapters" promo paragraph (a lone link to the
  // members site) can appear anywhere in the body.
  container.querySelectorAll("p").forEach((p) => {
    const text = (p.textContent || "").replace(/\s+/g, " ").trim();
    if (/^read advanced chapters$/i.test(text)) p.remove();
  });
  // Drop the chapter-title echo ("Chapter 165 She really liked it") when it
  // leads the body; the EPUB adds its own heading.
  const firstP = container.querySelector("p");
  if (firstP) {
    const text = (firstP.textContent || "").replace(/\s+/g, " ").trim();
    if (/^chapter\s+\d+(\.\d+)?\b/i.test(text) && text.length < 140)
      firstP.remove();
  }
  return sanitizeHtml(container.innerHTML);
}

async function tocNovelFire(url) {
  let base = url.replace(/\/$/, "");
  // NovelFire restructured book URLs from /novel/{slug} to /book/{slug};
  // the old /novel/ URLs now 404. Rewrite so saved/old links keep working.
  base = base.replace(/\/novel\//, "/book/");
  if (base.endsWith("/chapters")) base = base.slice(0, -"/chapters".length);
  const chaptersUrl = `${base}/chapters`;
  const firstHtml = await getText(chaptersUrl);

  const collect = (html) => {
    const items = [];
    parseHtml(html)
      .querySelectorAll(".chapter-list li a, #chapter-list li a")
      .forEach((a) => {
        const href = a.getAttribute("href");
        // Rendering proxies rewrite hrefs as ?url=<encoded target>, which
        // hides the "/chapter-" marker — test the unwrapped URL instead.
        const clean = href ? unwrapProxyUrl(href) : "";
        // Only include actual chapter URLs, not nav/latest links
        if (clean.includes('/chapter-')) {
          // Anchor text concatenates number + title + "x ago" update time;
          // the clean title lives on .chapter-title / the title attribute.
          const t =
            a.querySelector?.(".chapter-title")?.textContent?.trim() ||
            a.getAttribute("title") ||
            (a.textContent || "").trim();
          items.push({ url: absoluteUrl(chaptersUrl, clean), title: t });
        }
      });
    return items;
  };

  const firstBatch = collect(firstHtml);
  const chapsPerPage = firstBatch.length || 100;

  // Detect max page from pagination links
  const paginationPages = [...new Set([...firstHtml.matchAll(/chapters\?page=(\d+)/g)].map((m) => +m[1]))];
  const pageFromPagination = paginationPages.length ? Math.max(...paginationPages) : 1;

  // Fallback: use max="" attribute on chapter-number input to calculate total pages
  const maxChapMatch = firstHtml.match(/max="(\d+)"/);
  const totalChaps = maxChapMatch ? parseInt(maxChapMatch[1]) : 0;
  const pageFromTotal = totalChaps > 0 ? Math.ceil(totalChaps / chapsPerPage) : 1;

  const maxPage = Math.max(pageFromPagination, pageFromTotal);

  const results = [...firstBatch];
  if (maxPage > 1) {
    const pageNums = Array.from({ length: maxPage - 1 }, (_, i) => i + 2);
    const htmls = await mapPool(pageNums, 8, async (p) => {
      try { return await getText(`${chaptersUrl}?page=${p}`); }
      catch { return ""; }
    });
    htmls.forEach((h) => h && results.push(...collect(h)));
  }
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

async function novelBuddyTitleId(url) {
  // New-style: /titles/{id}-{slug} -> id is the part before the first '-'.
  // Old-style: /novel/{slug} -> resolve the slug through the API.
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "titles" && parts[1]) return parts[1].split("-")[0];
  const slug = parts.includes("novel") ? parts[parts.indexOf("novel") + 1] : parts[parts.length - 1];
  const lookup = await getJson(`https://api.novelbuddy.me/titles/by-slug/${slug}`);
  const newUrl = lookup?.data?.new_url || "";
  const id = newUrl.split("/titles/")[1]?.split("-")[0];
  if (!id) throw new Error("NovelBuddy: title id not found for slug " + slug);
  return id;
}

async function tocNovelBuddy(url) {
  // The redesigned site (novelbuddy.me, /titles/{id}-{slug}) no longer embeds
  // __NEXT_DATA__, but its underlying API is unchanged — and the book page
  // itself is Cloudflare-walled for server fetches, so resolve through the
  // API first and only fall back to parsing the page.
  let apiUrl = "https://api.novelbuddy.me";
  let mangaId = null;
  try {
    mangaId = await novelBuddyTitleId(url);
  } catch {
    try {
      const doc = parseHtml(await getText(url));
      const nextData = doc.querySelector("script#__NEXT_DATA__");
      if (nextData?.textContent) {
        const pageProps = JSON.parse(nextData.textContent)?.props?.pageProps || {};
        apiUrl = pageProps?.siteConfig?.apiUrl || apiUrl;
        mangaId = pageProps?.manga?.id || pageProps?.item?.id || pageProps?.data?.id || null;
      }
    } catch {
      /* rethrow below */
    }
  }
  if (!mangaId) throw new Error("NovelBuddy: title id not found");
  const base = apiUrl.replace(/\/$/, "");
  const listJson = await getJson(`${base}/titles/${mangaId}/chapters`);
  const chaps = listJson?.data?.chapters || [];
  return chaps
    .slice()
    .reverse()
    .map((c, i) => ({
      url: `${base}/titles/${mangaId}/chapters/${c.id || c._id}`,
      title: c.name || c.title || `Chapter ${i + 1}`,
    }));
}

// --- CrescentMoon: the TOC is prose, not a chapter list. Headings read
// "Chapter N : title" and are followed by Part links (or, for single-part
// chapters, the heading itself is the link). The generic sweep returned
// 84 links titled only "Part 1"/"Part 2" starting mid-book, so walk
// .entry-content in document order, naming each link from its heading.
async function tocCrescentMoon(url) {
  const doc = parseHtml(await getText(url));
  const root = doc.querySelector(".entry-content") || doc;
  const out = [];
  const seen = new Set();
  let heading = "";
  // Order-preserving pass over block elements in document order.
  root.querySelectorAll("p, li, h1, h2, h3, h4").forEach((el) => {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (/^Chapter\s+\d+\b/.test(text)) {
      heading = text;
      const direct = el.querySelector("a[href]");
      if (direct && !el.querySelector("ul")) {
        const abs = absoluteUrl(url, direct.getAttribute("href"));
        if (!seen.has(abs)) {
          seen.add(abs);
          out.push({ url: abs, title: heading });
        }
      }
      return;
    }
    el.querySelectorAll("a[href]").forEach((a) => {
      const abs = absoluteUrl(url, a.getAttribute("href"));
      if (seen.has(abs)) return;
      if (!/\/(20\d{2}\/\d{2}\/\d{2}\/|chapter|bmhs|bhms)/i.test(abs)) return;
      seen.add(abs);
      const part = (a.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ url: abs, title: heading ? `${heading} (${part})` : part });
    });
  });
  return out;
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

/** True when a block of text is mostly non-Latin (i.e. still needs translating). */
function needsTranslation(text) {
  const sample = String(text || "").slice(0, 4000);
  if (!sample.trim()) return false;
  const cjk = (sample.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  // Lower threshold (0.03 instead of 0.05) so mixed chapters are caught
  return cjk > sample.length * 0.03;
}

/** One call to a public translate endpoint. Returns "" when the route fails. */
async function translateOnce(text) {
  const endpoints = [
    async () => {
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      let out = "";
      for (const part of json?.[0] || []) if (part?.[0]) out += part[0];
      return out;
    },
    async () => {
      const res = await fetch(
        "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=en&q=" +
          encodeURIComponent(text),
        { headers: { "User-Agent": UA } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json)) {
        return json
          .map((p) => (Array.isArray(p) ? p[0] : p))
          .filter((p) => typeof p === "string")
          .join("");
      }
      return "";
    },
    // MyMemory — free, generous quota, good quality for CJK→EN
    async () => {
      const res = await fetch(
        "https://api.mymemory.translated.net/get?q=" +
          encodeURIComponent(text.slice(0, 500)) +
          "&langpair=zh|en",
        { headers: { "User-Agent": UA } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.responseData?.translatedText || "";
    },
    async () => {
      const res = await fetch(
        "https://lingva.ml/api/v1/auto/en/" + encodeURIComponent(text),
        { headers: { "User-Agent": UA } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json())?.translation || "";
    },
  ];
  for (const call of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await call();
        if (out && out.trim() && !out.includes("MYMEMORY WARNING")) return out;
      } catch {
        /* next attempt / endpoint */
      }
      await sleep(300 * (attempt + 1));
    }
  }
  return "";
}

/**
 * Translates raw paragraphs to English. Paragraphs are sent in small batches
 * separated by a newline; when the batch comes back with a different paragraph
 * count we re-translate that batch one paragraph at a time so nothing is lost
 * or misaligned (this was the cause of chapters staying in Chinese).
 */
async function translateToEnglish(paragraphs) {
  if (!paragraphs.length) return paragraphs;
  // Sample broadly — first 8 paras might be English headings before Chinese body text
  const sample = paragraphs.slice(0, 25).join(" ");
  if (!needsTranslation(sample)) return paragraphs;

  const SEP = "\n";
  const out = [];
  let batch = [];
  let size = 0;

  const flush = async () => {
    if (!batch.length) return;
    const current = batch;
    batch = [];
    size = 0;
    const translated = await translateOnce(current.join(SEP));
    const pieces = translated
      ? translated.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      : [];
    if (pieces.length === current.length) {
      out.push(...pieces);
      return;
    }
    // Misaligned (or failed) — translate each paragraph on its own.
    for (const p of current) {
      const one = await translateOnce(p);
      out.push(one && one.trim() ? one.trim() : p);
    }
  };

  for (const p of paragraphs) {
    if (size + p.length > 1500) await flush();
    batch.push(String(p));
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
    // webplus may need a moment on first request for a chapter — retry a few
    // times before giving up, otherwise the chapter lands in the book blank.
    let decrypted = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 4 && !decrypted; attempt++) {
      try {
        const wp = await wtrlabReaderGet({
          ...base,
          translate: "webplus",
          retry: attempt > 0,
          // On 3rd attempt, force the server to re-generate the translation
          force_retry: attempt >= 2,
        });
        title = wp?.chapter?.title || title;
        const wpStatus = wp?.data?.status;
        const enc = wp?.data?.data?.body;
        if (typeof enc === "string" && enc.length) {
          const d = decryptWtrlabBody(enc);
          const arr = Array.isArray(d) ? d : [d];
          if (arr.filter((p) => String(p).trim()).length) decrypted = arr;
        } else if (wpStatus !== undefined && wpStatus !== 0) {
          // Server is still processing — back off longer
          await sleep(1500 * (attempt + 1));
          continue;
        }
      } catch (e) {
        lastErr = e;
      }
      if (!decrypted) await sleep(900 * (attempt + 1));
    }
    if (!decrypted) {
      throw new Error(
        `wtr-lab returned no content for chapter ${chapterNo}${lastErr ? `: ${lastErr.message}` : ""}`
      );
    }
    paragraphs = decrypted.filter((p) => String(p).trim());
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

  // Whatever route produced the text (AI or webplus), auto-translate anything
  // that came back in the original language so the EPUB is always English.
  paragraphs = await translateToEnglish(paragraphs.map((p) => String(p)));
  if (title && needsTranslation(title)) {
    const t = await translateOnce(title);
    if (t.trim()) title = t.trim();
  }
  paragraphs = paragraphs.filter((p) => String(p).trim());
  if (!paragraphs.length) {
    throw new Error(`wtr-lab returned no content for chapter ${chapterNo}`);
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

// ---------------- Fictioneer / cherrymist.cafe ----------------

/**
 * Parse a Fictioneer story page (e.g. cherrymist.cafe/story/SLUG/).
 * Chapter list lives in <ol class="chapter-group__list"> with <li._publish a>.
 * Fictioneer uses single-quoted href attributes, so we combine DOM + regex.
 */


// ---------------- ln.hako.vn / docln (Vietnamese light novels) ----------------

async function tocHako(url) {
  const doc = parseHtml(await getText(url));
  const out = [];
  doc
    .querySelectorAll(".chapter-name a, .list-chapters a, .chapter_list a, ul.list-chapters li a")
    .forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      out.push({ url: absoluteUrl(url, href), title: (a.textContent || "").trim() });
    });
  return out;
}

async function bodyHako(url) {
  const html = await getText(url);
  // Protected chapters: #chapter-c-protected carries data-c (JSON array of
  // "NNNN<base64>" chunks), data-k (per-page key, in the clear) and data-s
  // (scheme). The site's own decoder: sort chunks by the numeric prefix,
  // base64-decode, then for xor_shuffle XOR each byte with the key's ASCII.
  const prot = html.match(/id="chapter-c-protected"[^>]*>/);
  if (prot) {
    const tag = prot[0];
    const attr = (n) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1];
    const scheme = attr('data-s') || '';
    const key = attr('data-k') || '';
    const rawC = attr('data-c');
    if (rawC) {
      try {
        const chunks = JSON.parse(rawC.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        const parts = chunks
          .slice()
          .sort((a, b) => parseInt(a.slice(0, 4), 10) - parseInt(b.slice(0, 4), 10))
          .map((c) => Buffer.from(c.slice(4), 'base64'));
        let text;
        if (scheme === 'xor_shuffle' && key) {
          text = parts.map((buf) => {
            const out = Buffer.alloc(buf.length);
            for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key.charCodeAt(i % key.length);
            return out.toString('utf8');
          }).join('');
        } else if (scheme === 'base64_reverse') {
          text = Buffer.from(parts.map((b) => b.toString('binary')).join('').split('').reverse().join(''), 'base64').toString('utf8');
        } else {
          text = parts.map((b) => b.toString('utf8')).join('');
        }
        if (text && text.replace(/<[^>]+>/g, '').trim().length > 200) return `<div>${text}</div>`;
      } catch { /* fall through to selector extraction */ }
    }
  }
  return extractWithSelector(parseHtml(html), "#chapter-content, .long-text, .chapter-content");
}

// ---------------- kanunu8.com (努努书坊) ----------------



// ---------------- tianyabooks.com (天涯书库) ----------------

async function tocTianya(url) {
  const doc = parseHtml(await getText(url));
  const out = [];
  doc.querySelectorAll(".idx-list a, .mulu-list a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    out.push({ url: absoluteUrl(url, href), title: (a.textContent || "").trim() });
  });
  return out;
}

async function bodyTianya(url) {
  const doc = parseHtml(await getText(url));
  const container = doc.querySelector(".article") || doc.querySelector(".container");
  if (!container) return "";
  stripInside(container, "script, style, iframe, ins, .meta, .breadcrumb, .chapter-links, .ad-bottom");
  return container.innerHTML;
}

// ---------------- readthedrama.com ----------------



// ---------------- Body parsers ----------------

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
    "freewebnovel.com",
    "novelfire.net",
    "novgo.me",
    "novelbuddy.com",
    "novelbuddy.me",
    "crescentmoon.blog",
    "novelarrow.com",
    "novelfull.com",
    "novelfull.net",
    "wtr-lab.com",
    "wattpad.com",
    "snowytranslations.com",
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

// --- ScribbleHub: TOC paginated with ?toc=N, newest first ---
async function tocScribbleHub(url) {
  const base = url.split("?")[0];
  const first = await getText(base);
  const total = parseInt(textOf(parseHtml(first).querySelector("span.cnt_toc")) || "0");
  let items = linksFrom(first, base, "a.toc_a");
  for (let page = 2; page <= (total ? Math.ceil(total / 15) + 1 : 60); page++) {
    if (total && items.length >= total) break;
    let more = [];
    for (let attempt = 0; attempt < 3 && !more.length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
      more = linksFrom(await tryText(`${base}?toc=${page}`), base, "a.toc_a");
    }
    if (!more.length) { if (!total) break; continue; }
    items = items.concat(more);
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

// --- Parahumans (Worm): the /table-of-contents/ page links chapters in two
// URL styles — category paths for the early arcs
// (/category/stories-arcs-1-10/arc-1-gestation/1-01/) and dated permalinks
// for the rest (/2012/06/30/plague-12-2/). The generic link sweep only
// clusters one style and returns a small slice, so collect both, in
// document order, from the page's .entry-content.
async function tocParahumans(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const root = doc.querySelector(".entry-content") || doc;
  const seen = new Set();
  const out = [];
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    let abs;
    try {
      abs = new URL(href, url).href;
    } catch {
      return;
    }
    if (!/parahumans\.wordpress\.com\/(category\/stories|20\d{2}\/)/.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    const title =
      (a.textContent || "").replace(/\s+/g, " ").trim() ||
      abs.split("/").filter(Boolean).pop() ||
      "";
    out.push({ url: abs, title });
  });
  return out;
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
  // Book pages (/ranobe/{id}-{slug}.html) 404 on the plain fetch route, but
  // the chapter index is addressable directly: /chapters/{slug}/.
  let tocUrl = null;
  const bookM = new URL(url).pathname.match(/\/ranobe\/\d+-([a-z0-9-]+)\.html$/i);
  if (bookM) tocUrl = `${new URL(url).origin}/chapters/${bookM[1]}/`;
  let html = '';
  if (!tocUrl) {
    html = await getText(url);
    const doc = parseHtml(html);
    tocUrl =
      doc.querySelector("div.r-fullstory-chapters-foot a[href*='/chapters/']")?.getAttribute("href") ||
      doc.querySelector("a[href*='/chapters/']")?.getAttribute("href");
    if (!tocUrl) {
      return linksFrom(html, url, "ul.chapters-scroll-list a", ".title").reverse();
    }
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
  // 1. Modern theme: AJAX endpoint on the series URL. Some themes serve the
  // chapter list only to POST — a GET returns the book page itself (which
  // has no chapter list), so fall back to POST when GET yields nothing.
  let items = [];
  const ajaxUrl = `${base}ajax/chapters/`;
  try {
    const res = await httpGet(ajaxUrl, { "X-Requested-With": "XMLHttpRequest" });
    items = pick(await res.text());
  } catch {
    /* fall through */
  }
  if (!items.length) {
    for (const proxy of PROXIES) {
      try {
        const res = await fetch(buildUrl(proxy, ajaxUrl), {
          method: "POST",
          headers: { ...DEFAULT_HEADERS, "X-Requested-With": "XMLHttpRequest" },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) continue;
        const frag = await res.text();
        items = pick(frag);
        if (!items.length) continue;
        // Paginated variant (e.g. novelnice): the fragment announces
        // "Page 1 of N" and serves the remaining newest-first blocks via
        // POST ?t={page}. Merge them all before the caller's reverse.
        let totalPages = parseInt(frag.match(/Page\s*1\s*of\s*(\d+)/i)?.[1] || '1', 10);
        for (const m of frag.matchAll(/data-page="(\d+)"/g)) totalPages = Math.max(totalPages, parseInt(m[1], 10));
        for (let p = 2; p <= Math.min(totalPages, 60); p++) {
          try {
            const r2 = await fetch(buildUrl(proxy, `${ajaxUrl}?t=${p}`), {
              method: "POST",
              headers: { ...DEFAULT_HEADERS, "X-Requested-With": "XMLHttpRequest" },
              signal: AbortSignal.timeout(30000),
            });
            const more = pick(await r2.text());
            if (!more.length) break;
            items = items.concat(more);
          } catch { break; }
        }
        if (items.length) break;
      } catch {
        /* try next route */
      }
    }
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
  // The book page embeds only the first page of chapters (~30); the archive
  // endpoint returns the complete list. Prefer it whenever it has more.
  const novelId =
    html.match(/data-novel-id=["'](\d+)["']/)?.[1] || html.match(/novelId["'\s:=]+(\d+)/)?.[1];
  if (novelId) {
    const ajax = await tryText(`${origin}/ajax/chapter-archive?novelId=${novelId}`);
    if (ajax) {
      const ajaxItems = linksFrom(ajax, origin, "a[href]").filter((i) =>
        i.url.includes("/chapter-")
      );
      if (ajaxItems.length > items.length) items = ajaxItems;
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

// --- XenForo threadmarks (SpaceBattles, SufficientVelocity, QuestionableQuesting) ---
async function tocXenForo(url) {
  const u = new URL(url);
  const base = u.origin;
  // Extract thread id from URL like /threads/name.12345/
  // Thread segment is "{slug}.{id}" or a bare "{id}" (both forms occur in
  // the wild; XenForo serves the threadmark index under either).
  const threadMatch = u.pathname.match(/^(.*\/threads\/[^/]+)/);
  const seg = threadMatch ? threadMatch[1].split('/').pop() : '';
  if (!threadMatch || !/^\d+$/.test(seg) && !/\.\d+$/.test(seg)) return [];
  // The threadmark index hangs off the thread path itself; deriving it from
  // the input URL keeps any path prefix (e.g. alternatehistory.com/forum).
  const readerUrl = `${base}${threadMatch[1]}/threadmarks`;
  const html = await getText(readerUrl);
  const doc = parseHtml(html);
  const out = [];
  // XenForo threadmark list
  doc.querySelectorAll('.structItem--threadmark .structItem-title a[href]').forEach(a => {
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

// --- WuxiaWorld.eu (Next.js): the book page's __NEXT_DATA__ carries the first
// 100 TOC items plus the page ranges; the remaining pages come from the
// /_next/data/<buildId>/novel/<slug>.json?page=N routes. Chapter pages live at
// /chapter/<slug>-<number> and server-render their text into #chapter-content.
async function tocWuxiaWorldEu(startUrl) {
  const u = new URL(startUrl);
  const slug = (u.pathname.match(/\/novel\/([^/?#]+)/) || [])[1];
  if (!slug) return [];
  const doc = parseHtml(await getText(startUrl));
  const ndText = doc.querySelector("script#__NEXT_DATA__")?.textContent;
  if (!ndText) return [];
  let nd;
  try { nd = JSON.parse(ndText); } catch { return []; }
  const pp = nd?.props?.pageProps || {};
  const buildId = nd?.buildId;
  const pages = Array.isArray(pp?.toc?.ranges) ? pp.toc.ranges.length : 1;
  const byNumber = new Map();
  const addItems = (items) => {
    for (const it of items || []) {
      const n = Number(it?.number);
      if (!Number.isFinite(n) || n <= 0 || byNumber.has(n)) continue;
      byNumber.set(n, {
        title: String(it?.title || `Chapter ${n}`).trim(),
        url: `${u.origin}/chapter/${slug}-${n}`,
      });
    }
  };
  addItems(pp?.toc?.items);
  if (buildId && pages > 1) {
    const rest = [];
    for (let p = 2; p <= pages; p++) rest.push(p);
    for (let i = 0; i < rest.length; i += 6) {
      await Promise.all(rest.slice(i, i + 6).map(async (p) => {
        try {
          const j = JSON.parse(await getText(`${u.origin}/_next/data/${buildId}/novel/${slug}.json?page=${p}`));
          addItems(j?.pageProps?.toc?.items);
        } catch { /* keep the pages that did load */ }
      }));
    }
  }
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// --- Baka-Tsuki (MediaWiki): a series page links its chapter subpages
// "<Series>:Volume<N>_<Part>" in reading order inside .mw-parser-output.
// The compiled ":Volume_N" full-text pages and illustration/registration
// subpages are excluded; without this the generic sweep drowns in wiki links.
async function tocBakaTsuki(startUrl) {
  const u = new URL(startUrl);
  const series = (u.searchParams.get("title") || "").trim();
  if (!series) return [];
  const doc = parseHtml(await getText(startUrl));
  const root = doc.querySelector(".mw-parser-output") || doc;
  const seen = new Set();
  const out = [];
  root.querySelectorAll("a[href]").forEach((a) => {
    // Routes that come back through a rewriting proxy carry proxy-wrapped
    // hrefs; unwrap before matching (the decoded target also has "&amp;"
    // from the proxy's double-encoding normalized by the URL parser below).
    const href = unwrapProxyUrl(a.getAttribute("href") || "").replace(/&amp;/g, "&");
    if (!href.includes("index.php?title=")) return;
    let abs, t;
    try {
      const x = new URL(href, u.origin);
      if (x.searchParams.has("action")) return;
      t = x.searchParams.get("title") || "";
      abs = x.href;
    } catch { return; }
    if (!t.startsWith(series + ":")) return;
    if (/:Volume_?\d+$/.test(t)) return; // compiled full-text page duplicates its chapters
    if (/Illustrations|Registration|Guideline/i.test(t)) return;
    const label = (a.textContent || "").trim();
    if (/^full text$/i.test(label)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    const sub = t.slice(series.length + 1);
    const vm = sub.match(/^Volume_?(\d+)_(.+)$/);
    const title = vm
      ? `Volume ${vm[1]} – ${label || vm[2].replace(/_/g, " ")}`
      : (label || sub.replace(/_/g, " "));
    out.push({ title, url: abs });
  });
  return out;
}

// --- Alphapolis (alphapolis.co.jp): the work page embeds its full episode
// list as JSON ("episodes":[{episodeNo,url,mainTitle,dispOrder,isPublic}]).
// Episode pages render their text into div#novelBody (see body selectors).
async function tocAlphapolis(startUrl) {
  const html = await getText(startUrl);
  const i = html.indexOf('"episodes":');
  if (i < 0) return [];
  const start = html.indexOf('[', i);
  if (start < 0) return [];
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) return [];
  let eps;
  try { eps = JSON.parse(html.slice(start, end + 1)); } catch { return []; }
  const origin = new URL(startUrl).origin;
  return eps
    .filter((e) => e && e.isPublic !== false && e.url)
    .sort((a, b) => (a.dispOrder || 0) - (b.dispOrder || 0))
    .map((e) => ({ title: String(e.mainTitle || `Episode ${e.episodeNo || ''}`).trim(), url: absoluteUrl(origin, e.url) }));
}

// Regex anchor extraction for pages whose markup breaks the DOM parser
// (linkedom returns an empty tree on some large/malformed documents, e.g.
// nested <body> tags in AJAX archive fragments).
function regexLinks(html, base, hrefRe) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const rawHref = m[1].replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&quot;/g, '"');
    const url = absoluteUrl(base, unwrapProxyUrl(rawHref));
    if (!hrefRe.test(url)) continue;
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ url, title });
  }
  return out;
}

// --- Libread (libread.com, FreeWebNovel-family layout): the book page
// server-renders range 1 (40 chapters) and links further ranges at
// /libread/{slug}-{id}/{n}. Walk the ranges and sort by chapter number.
async function tocLibread(startUrl) {
  const u = new URL(startUrl);
  const bookPath = u.pathname.replace(/\/$/, '');
  const chapNum = (href) => parseInt(href.match(/chapter-(\d+)/)?.[1] || '0', 10);
  const collect = (html, base) => regexLinks(html, base, /\/chapter-\d+/).filter((i) => i.url.includes(bookPath));
  const byUrl = new Map();
  const merge = (items) => {
    let added = 0;
    for (const it of items) {
      const prev = byUrl.get(it.url);
      if (!prev) { byUrl.set(it.url, it); added++; }
      else if ((it.title || '').length > (prev.title || '').length) byUrl.set(it.url, it);
    }
    return added;
  };
  merge(collect(await smartGetText(startUrl), startUrl));
  for (let n = 2; n <= 80; n++) {
    let html;
    try { html = await smartGetText(`${u.origin}${bookPath}/${n}`); } catch { break; }
    if (!merge(collect(html, startUrl))) break;
  }
  return [...byUrl.values()].sort((a, b) => chapNum(a.url) - chapNum(b.url));
}

// --- Naver Webnovel (novel.naver.com): the series list paginates with
// ?novelId={id}&page={n}, 10 episodes per page, newest first.
async function tocNaver(startUrl) {
  const u = new URL(startUrl);
  const novelId = u.searchParams.get('novelId');
  if (!novelId) return [];
  const volOf = (href) => parseInt(new URL(href, u.origin).searchParams.get('volumeNo') || '0', 10);
  const byVol = new Map();
  for (let page = 1; page <= 200; page++) {
    let html;
    try { html = await getText(`${u.origin}/webnovel/list?novelId=${novelId}&page=${page}`); } catch { break; }
    let found = 0;
    for (const item of regexLinks(html, u.origin, /\/webnovel\/detail/)) {
      if (item.url.includes(`novelId=${novelId}`) && item.url.includes('volumeNo=') && !byVol.has(item.url)) {
        byVol.set(item.url, item); found++;
      }
    }
    if (!found) break;
  }
  return [...byVol.values()].sort((a, b) => volOf(a.url) - volOf(b.url));
}

// --- NovelCEO (novelceo.com, incl. noveldrama.org redirects): the book page
// only embeds the first 30 chapters, but its own JS loads the full list from
// /ajax/chapter-archive?novelId={slug} in one call (NovelBin-family endpoint).
async function tocNovelCeo(startUrl) {
  const u = new URL(startUrl);
  const slug = u.pathname.split('/').filter(Boolean).pop();
  if (!slug) return [];
  try {
    const html = await getText(`${u.origin}/ajax/chapter-archive?novelId=${encodeURIComponent(slug)}`);
    const out = regexLinks(html, u.origin, /\/chapter-\d+/);
    if (out.length) return dedupeByUrl(out);
  } catch { /* fall through */ }
  return [];
}

// --- Nine Heavens (nineheavens.org): the chapter list lives on
// /novels/{slug}/?tab=chapters&page={n}, 50 per page, newest chunk first.
async function tocNineHeavens(startUrl) {
  const u = new URL(startUrl);
  const base = `${u.origin}${u.pathname.replace(/\/?$/, '/')}`;
  const chapNum = (href) => parseInt(href.match(/chapter-(\d+)/)?.[1] || '0', 10);
  const byUrl = new Map();
  for (let page = 1; page <= 60; page++) {
    let html;
    try { html = await smartGetText(`${base}?tab=chapters&page=${page}`); } catch { break; }
    let found = 0;
    for (const item of regexLinks(html, u.origin, /\/chapter-\d+-/)) {
      if (!byUrl.has(item.url)) { byUrl.set(item.url, item); found++; }
    }
    if (!found) break;
  }
  return [...byUrl.values()].sort((a, b) => chapNum(a.url) - chapNum(b.url));
}


// --- LNMTL (lnmtl.com): the book page is a Vue app embedding lnmtl.volumes;
// each volume's chapters paginate as JSON at /chapter?volumeId={id}&page={n}
// (50 per page, rows carry the chapter slug).
async function tocLnmtl(startUrl) {
  // LNMTL rejects the proxy routes (401/deadline) but serves direct fetches.
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const direct = async (u, json = false) => {
    const r = await fetch(u, { headers: { 'User-Agent': UA, ...(json ? { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } : {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  // www.lnmtl.com answers 401 while the bare domain serves fine — normalize.
  const bare = startUrl.replace('://www.', '://');
  const html = await direct(bare);
  const origin = new URL(bare).origin;
  const volIds = [];
  const vm = html.match(/lnmtl\.volumes\s*=\s*(\[[\s\S]*?\]);/);
  if (vm) {
    try {
      for (const v of JSON.parse(vm[1])) if (v && v.id) volIds.push(v.id);
    } catch { /* fall through */ }
  }
  if (!volIds.length) {
    for (const m of html.matchAll(/"id"\s*:\s*(\d+)[^}]*?"number"\s*:/g)) volIds.push(m[1]);
  }
  const out = [];
  for (const vid of volIds) {
    for (let page = 1; page <= 60; page++) {
      let data;
      try { data = JSON.parse(await direct(`${origin}/chapter?volumeId=${vid}&page=${page}`, true)); } catch { break; }
      const rows = data?.data || [];
      if (!rows.length) break;
      for (const r of rows) if (r?.slug) out.push({ url: `${origin}/chapter/${r.slug}`, title: String(r.title || r.name || r.slug) });
      if (page >= (data.last_page || page)) break;
    }
  }
  return dedupeByUrl(out);
}

// --- Novel-Bin mirrors (novel-bin.com/.net): no index endpoint exists by
// design ("Showing the first 30 chapters"); chapter URLs are purely
// sequential /novel-bin/{slug}/chapter-{n} and the book page prints the
// total (and links the latest chapter). Synthesize the full list.
async function tocNovelBinMirror(startUrl) {
  const html = await smartGetText(startUrl);
  const u = new URL(startUrl);
  const slug = u.pathname.split('/').filter(Boolean).pop();
  if (!slug) return [];
  const titled = new Map();
  let maxSeen = 0;
  for (const item of regexLinks(html, u.origin, /\/chapter-\d+$/)) {
    const n = parseInt(item.url.match(/chapter-(\d+)$/)?.[1] || '0', 10);
    if (n) { titled.set(n, item); if (n > maxSeen) maxSeen = n; }
  }
  const printed = parseInt(html.replace(/<[^>]+>/g, ' ').match(/(\d[\d,]*)\s*total/i)?.[1]?.replace(/,/g, '') || '0', 10);
  const total = Math.max(maxSeen, printed);
  if (!total) return [...titled.values()];
  const out = [];
  for (let n = 1; n <= total; n++) {
    out.push(titled.get(n) || { url: `${u.origin}/novel-bin/${slug}/chapter-${n}`, title: `Chapter ${n}` });
  }
  return out;
}

// --- ttshu8 (m.ttshu8.com): the book page's range <select> enumerates
// /book/{id}_{n}/ pages of 50 chapters. Walk the ranges in order.
async function tocTtshu8(startUrl) {
  const u = new URL(startUrl);
  const bookM = u.pathname.match(/^(\/book\/\d+)\/?(?:_\d+\/?)?$/);
  if (!bookM) return [];
  const bookPath = bookM[1];
  const byUrl = new Map();
  const merge = (html) => {
    let added = 0;
    for (const item of regexLinks(html, u.origin, /\.html$/)) {
      if (item.url.includes(bookPath + '/') && !byUrl.has(item.url)) { byUrl.set(item.url, item); added++; }
    }
    return added;
  };
  merge(await smartGetText(startUrl));
  for (let n = 2; n <= 60; n++) {
    let html;
    try { html = await smartGetText(`${u.origin}${bookPath}_${n}/`); } catch { break; }
    if (!merge(html)) break;
  }
  return [...byUrl.values()];
}

// --- xpaoshuba (m.xpaoshuba.com): chapter lists paginate as
// /Partlist/{id}_{n}/ (50 per page); page 1 links the last page.
async function tocXpaoshuba(startUrl) {
  const u = new URL(startUrl);
  const m = u.pathname.match(/\/Partlist\/(\d+)(?:_\d+)?\/?$/i) ||
    u.pathname.match(/\/book\/(\d+)(?:\/index\.html)?\/?$/i);
  if (!m) return [];
  const id = m[1];
  // Direct fetches are fast here (~1s); the proxy sweep is not, and a big
  // book has 250+ list pages — fetch them with a small concurrency pool.
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const direct = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  const pageItems = (html) => regexLinks(html, u.origin, /\.shtml$/).filter((i) => i.url.includes(`/Partlist/${id}/`));
  const first = await direct(`${u.origin}/Partlist/${id}/`);
  let lastPage = 1;
  for (const mm of first.matchAll(new RegExp(`/Partlist/${id}_(\\d+)/`, 'g'))) lastPage = Math.max(lastPage, parseInt(mm[1], 10));
  const pages = new Map([[1, pageItems(first)]]);
  const queue = [];
  for (let n = 2; n <= Math.min(lastPage, 400); n++) queue.push(n);
  let qi = 0;
  const worker = async () => {
    while (qi < queue.length) {
      const n = queue[qi++];
      try { pages.set(n, pageItems(await direct(`${u.origin}/Partlist/${id}_${n}/`))); } catch { /* skip page */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const byUrl = new Map();
  for (let n = 1; n <= lastPage; n++) for (const it of pages.get(n) || []) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
  const out = [...byUrl.values()];
  // Desktop serves the whole catalog on one page (newest-first) and the
  // book page's embedded latest block lands ahead of it; mobile pages
  // ascend. When titles carry chapter numbers, sort ascending outright.
  const chapNo = (t) => parseInt((String(t).match(/第\s*(\d+)\s*章/) || [])[1] || '0', 10);
  const numbered = out.filter((x) => chapNo(x.title) > 0).length;
  if (numbered >= Math.max(10, out.length * 0.9)) out.sort((a, b) => chapNo(a.title) - chapNo(b.title));
  return out;
}


// --- Ilwxs mobile (m.ilwxs.com): the book list paginates on the book URL
// itself — /shu/{id}/ then /shu/{id}_{n}/ (~50 per page, ascending).
async function tocIlwxsMobile(startUrl) {
  const u = new URL(startUrl);
  const m = u.pathname.match(/^\/(shu\/\d+)(?:_\d+)?\/?$/);
  if (!m) return [];
  const bookPath = '/' + m[1];
  const byUrl = new Map();
  const merge = (html) => {
    let added = 0;
    for (const item of regexLinks(html, u.origin, /\.html$/)) {
      if (item.url.includes(bookPath + '/') && !byUrl.has(item.url)) { byUrl.set(item.url, item); added++; }
    }
    return added;
  };
  const first = await smartGetText(startUrl);
  merge(first);
  let lastPage = 1;
  for (const mm of first.matchAll(new RegExp(bookPath.replace('/', '\\/') + '_(\\d+)/', 'g'))) lastPage = Math.max(lastPage, parseInt(mm[1], 10));
  for (let n = 2; n <= Math.min(lastPage, 200); n++) {
    let html;
    try { html = await smartGetText(`${u.origin}${bookPath}_${n}/`); } catch { break; }
    if (!merge(html) && n > lastPage) break;
  }
  return [...byUrl.values()];
}

// --- WuxiaWorld.com: gRPC-web binary chapter list decoder ---
async function tocWuxiaWorld(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const novelIdx = parts.indexOf('novel');
  const slug = novelIdx >= 0 ? parts[novelIdx + 1] : parts[0];
  if (!slug) throw new Error('WuxiaWorld: novel slug not found');

  const novelUrl = `https://www.wuxiaworld.com/novel/${slug}`;
  const html = await getText(novelUrl);

  let novelId = null;
  const match = html.match(/window\.__REACT_QUERY_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:window|\n|<\/script>)/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      novelId = data.queries?.[0]?.state?.data?.item?.id;
    } catch {}
  }
  if (!novelId) {
    const idMatch = html.match(/"item"\s*:\s*\{\s*"id"\s*:\s*(\d+)/) || html.match(/"id"\s*:\s*(\d+)/);
    if (idMatch) novelId = Number(idMatch[1]);
  }

  if (novelId) {
    try {
      const protoPayload = Buffer.from([0x08, novelId]);
      const header = Buffer.alloc(5);
      header.writeUInt8(0, 0);
      header.writeUInt32BE(protoPayload.length, 1);
      const body = Buffer.concat([header, protoPayload]);

      const gRes = await fetch("https://api2.wuxiaworld.com/wuxiaworld.api.v2.Chapters/GetChapterList", {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/grpc-web+proto",
          "Accept": "application/grpc-web+proto",
          "x-grpc-web": "1"
        },
        body
      });

      if (gRes.ok) {
        const buf = Buffer.from(await gRes.arrayBuffer());
        const chapters = [];
        let pos = 5;
        while (pos < buf.length - 10) {
          if (buf[pos] === 0x12) {
            let nameLen = buf[pos + 1];
            let nameOffset = pos + 2;
            if (nameLen & 0x80) {
              nameLen = (nameLen & 0x7f) | (buf[pos + 2] << 7);
              nameOffset = pos + 3;
            }
            if (nameLen > 0 && nameLen < 250 && nameOffset + nameLen < buf.length) {
              const name = buf.subarray(nameOffset, nameOffset + nameLen).toString("utf-8");
              const nextTagPos = nameOffset + nameLen;
              if (buf[nextTagPos] === 0x1a) {
                let slugLen = buf[nextTagPos + 1];
                let slugOffset = nextTagPos + 2;
                if (slugLen & 0x80) {
                  slugLen = (slugLen & 0x7f) | (buf[nextTagPos + 2] << 7);
                  slugOffset = nextTagPos + 3;
                }
                if (slugLen > 0 && slugLen < 250 && slugOffset + slugLen <= buf.length) {
                  const chapSlug = buf.subarray(slugOffset, slugOffset + slugLen).toString("utf-8");
                  if (chapSlug.includes("-") && !chapSlug.includes("http") && !chapSlug.includes("/")) {
                    chapters.push({
                      url: `https://www.wuxiaworld.com/novel/${slug}/${chapSlug}`,
                      title: name.trim() || chapSlug
                    });
                  }
                  pos = slugOffset + slugLen;
                  continue;
                }
              }
            }
          }
          pos++;
        }
        if (chapters.length > 0) return chapters;
      }
    } catch (e) {
      console.warn("[fetcher] WuxiaWorld gRPC fetch failed", e?.message || e);
    }
  }

  // Fallback: scrape links from the novel page
  const items = linksFrom(html, novelUrl, 'a[href*="/novel/"][href*="-chapter-"]');
  return dedupeByUrl(items);
}

async function bodyWuxiaWorld(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '.chapter-content, #chapter-content, .cha-words, .chapter-text, article .content');
}

// --- Inkitt: story reader API ---
async function tocInkitt(url) {
  const storyId = url.match(/stories\/(?:[^\/]+\/)?(\d+)/)?.[1] ||
    url.match(/stories\/(\d+)/)?.[1] ||
    url.match(/story\/(\d+)/)?.[1];
  if (!storyId) return [];

  try {
    const json = await getJson(`https://www.inkitt.com/api/stories/${storyId}`);
    const chapters = json?.chapters || [];
    if (chapters.length) {
      return chapters.map((c, i) => ({
        url: `https://www.inkitt.com/stories/${storyId}/chapters/${c.chapter_number || i + 1}`,
        title: c.name || c.title || `Chapter ${c.chapter_number || i + 1}`,
      }));
    }
  } catch {}

  // Fallback: scrape the story landing page
  const html = await getText(`https://www.inkitt.com/stories/${storyId}`);
  const items = linksFrom(html, `https://www.inkitt.com/stories/${storyId}`, 'a[href*="/chapters/"]');
  return dedupeByUrl(items);
}

async function bodyInkitt(url) {
  // Inkitt only serves the first few chapters anonymously; the rest come back
  // with an empty `#chapterText` inside a `story-page-text_folded` wrapper.
  // The logged-in cookie unlocks them, but public CORS proxies strip Cookie
  // headers — so retry (direct fetch carries the cookie) before giving up.
  // If scraping fails, we hit the internal API if we can extract a chapter ID.
  const attempts = 4;
  let last = "";
  for (let i = 0; i < attempts; i++) {
    let html = "";
    try {
      html = await getText(url);
    } catch {
      await sleep(800 * (i + 1));
      continue;
    }
    const doc = parseHtml(html);
    let content = extractWithSelector(doc, '#chapterText, .story-page-text, .story-body, article');
    let text = (content || "").replace(/<[^>]+>/g, "").trim();

    // If blank/gated, try the chapter API fallback
    if (text.length < 50) {
      const chapterId = url.match(/chapters\/(\d+)/)?.[1];
      if (chapterId) {
        try {
          const apiJson = await getJson(`https://www.inkitt.com/api/chapters/${chapterId}`);
          const apiContent = apiJson?.chapter?.text || apiJson?.text || "";
          if (apiContent.length > 50) {
             content = apiContent.split('\n').map(p => `<p>${p}</p>`).join('');
             text = apiContent;
          }
        } catch {}
      }
    }

    if (text.length > 50) return content;
    last = content || last;

    if (/story-page-text_folded/.test(html) || text.includes("Writers Write") || text.includes("Galatea app")) {
      // Gated response — the cookie didn't reach the origin or was ignored.
      blockedHosts.delete(new URL(url).hostname);
      await sleep(1500 * (i + 1));
      continue;
    }
    await sleep(800 * (i + 1));
  }
  return last;
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

// --- Chrysanthemum Garden: WP-based BL/danmei translations ---

// --- Genesis Translations: WP-based translation group ---

// --- Novel Nest: aggregator with chapter list ---

// --- NovelMtl: simple HTML chapter list ---

// --- Literotica: a series' chapters all sit on ONE series page
// (/series/se/{id-or-slug}) inside a "Table of Contents" section; story
// pages (/s/{slug}) link their series and otherwise paginate themselves
// with ?page=N anchors. Page-wide /s/ sweeps pollute the TOC with the
// series URL's own ?dialog=new-story variant, /comments links and other
// stories' footer slugs, so every result is cleaned of those.
function litCleanToc(items) {
  return dedupeByUrl((items || []).filter((i) =>
    i.url && !i.url.includes('?dialog=') && !/\/comments\/?($|\?)/.test(i.url)));
}

async function tocLiterotica(url) {
  const origin = 'https://www.literotica.com';
  const u = new URL(url);
  const html = await smartGetText(url);
  const doc = parseHtml(html);

  if (u.pathname.includes('/series/')) {
    // Primary: the anchors inside the "Table of Contents" container.
    const heads = [...doc.querySelectorAll('h1, h2, h3')];
    const h = heads.find((el) => textOf(el).toLowerCase() === 'table of contents');
    if (h) {
      let node = h;
      for (let up = 0; up < 4 && node; up++) {
        node = node.parentElement;
        if (!node) break;
        const items = [...node.querySelectorAll('a[href*="/s/"]')].map((a) => ({
          url: absoluteUrl(origin, a.getAttribute('href')),
          title: textOf(a),
        }));
        const cleaned = litCleanToc(items);
        if (cleaned.length) return cleaned;
      }
    }
    // Fallback: on the sampled series pages the page-wide /s/ anchor set is
    // exactly the chapter set once dialog/comment variants are removed.
    return litCleanToc(linksFrom(html, origin, 'a[href*="/s/"]'));
  }

  if (u.pathname.startsWith('/s/')) {
    // A story in a series: recurse into the series page for the full list.
    const seriesLink = linksFrom(html, origin, 'a[href*="/series/se/"]')
      .find((i) => new URL(i.url).pathname.startsWith('/series/se/'));
    if (seriesLink) return tocLiterotica(seriesLink.url);
    // Single story: its own pagination anchors give the page count.
    const base = url.split('?')[0];
    let maxPage = 1;
    for (const a of linksFrom(html, origin, 'a[href*="?page="]')) {
      const au = new URL(a.url);
      if (au.pathname === u.pathname) {
        maxPage = Math.max(maxPage, parseInt(au.searchParams.get('page') || '1', 10));
      }
    }
    const title = textOf(doc.querySelector('h1')) || 'Chapter 1';
    if (maxPage <= 1) return [{ url: base, title }];
    const pages = [{ url: base, title }];
    for (let p = 2; p <= maxPage; p++) pages.push({ url: `${base}?page=${p}`, title: `Page ${p}` });
    return pages;
  }

  // Author page (legacy selectors).
  return litCleanToc(linksFrom(html, origin, 'table.st a[href], .a-story-link a[href]'));
}

async function bodyLiterotica(url) {
  const doc = parseHtml(await getText(url));
  return extractWithSelector(doc, '[class*="article__content"], .aa_ht, .b-story-body-x, #story_text, .story-body');
}

// --- NovelStar: CN novel site, AJAX chapter archive ---

// --- 69shuba.com: CN raw fiction, paginated TOC ---
async function toc69shuba(url) {
  // Normalize: /book/<id>/ or /txt/<id>/ or /<id>/
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const idPart = parts.find(p => /^\d+$/.test(p)) || parts[parts.length - 1].replace(/\D/g, '');
  const origin = u.origin;
  // Try both URL patterns
  const candidates = [
    url,
    idPart ? `${origin}/book/${idPart}/` : null,
    idPart ? `${origin}/txt/${idPart}/` : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const html = await getText(candidate);
      const doc = parseHtml(html);
      const out = [];
      doc.querySelectorAll('#catalog a[href], .catalog a[href], dl dd a[href], #list a[href], .book-list a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && !/login|register|search/.test(href))
          out.push({ url: absoluteUrl(origin, href), title: textOf(a) });
      });
      if (out.length) return dedupeByUrl(out);
    } catch {}
  }
  return [];
}


// --- NovelHi (novelhi.com): chapter pages render a "Loading chapter..."
// shell; the real text comes from a tokenized /content endpoint whose JSON
// payload is ROT13-obfuscated. Tokens are per-page and short-lived, so the
// page and the endpoint are fetched back-to-back in one direct session.
function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
async function bodyNovelHi(url) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    const grab = (id) =>
      html.match(new RegExp(`id="${id}"[^>]*value="([^"]+)"`))?.[1] ||
      html.match(new RegExp(`value="([^"]+)"[^>]*id="${id}"`))?.[1];
    const path = grab('chapterContentPath');
    const token = grab('chapterContentToken');
    if (path && token) {
      const ep = new URL(path, url).href + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
      const r2 = await fetch(ep, { headers: { 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
      const data = await r2.json().catch(() => null);
      const content = data?.data?.content;
      if (content) return `<div>${rot13(content)}</div>`;
    }
  } catch { /* fall through */ }
  return bodyGeneric(url, '#chr-content, #chapter-content, div.chapter-content');
}

// --- MVLEmpyr (mvlempyr.com/.io): the Webflow book page carries only a
// #novel-code; the chapter list lives in a backend WordPress whose tag id
// is 7^code mod 1999999997 (the site's own JS computes it the same way).
async function tocMvlempyr(startUrl) {
  const html = await smartGetText(startUrl);
  const u = new URL(startUrl);
  const code = html.match(/id="novel-code"[^>]*>\s*(\d+)/)?.[1] ||
    html.match(/novel-code[^0-9]{0,20}(\d{3,})/)?.[1];
  if (!code) return [];
  let tag = 1n;
  const base = 7n, mod = 1999999997n;
  let exp = BigInt(code);
  let b = base % mod;
  while (exp > 0n) { if (exp & 1n) tag = (tag * b) % mod; b = (b * b) % mod; exp >>= 1n; }
  const api = 'https://chap.heliosarchive.online/wp-json/wp/v2/posts';
  const byNum = new Map();
  for (let page = 1; page <= 12; page++) {
    const r = await fetch(`${api}?tags=${tag}&per_page=500&page=${page}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) break;
    const posts = await r.json().catch(() => []);
    if (!Array.isArray(posts) || !posts.length) break;
    for (const p of posts) {
      const n = parseInt(p?.acf?.chapter_number ?? '', 10);
      if (!n) continue;
      byNum.set(n, { url: `${u.origin}/chapter/${code}-${n}`, title: String(p?.acf?.ch_name || `Chapter ${n}`) });
    }
    const totalPages = parseInt(r.headers.get('x-wp-totalpages') || '1', 10);
    if (page >= totalPages) break;
  }
  return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}


// --- Foxteller (foxteller.com): chapter text comes from POST /aux_dem with
// the page's own d (novel id) / e (chapter id) variables + CSRF token; the
// payload is base64 with A-F substituted by %R?& tokens.
async function bodyFoxteller(url) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  try {
    const r1 = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await r1.text();
    const d = html.match(/let d\s*=\s*'(\d+)'/)?.[1];
    const e = html.match(/let e\s*=\s*'(\d+)'/)?.[1];
    const csrf = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
    if (d && e) {
      const cookies = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
      const r2 = await fetch('https://www.foxteller.com/aux_dem', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}),
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({ x1: d, x2: e }),
      });
      const data = await r2.json().catch(() => null);
      if (data?.aux) {
        const b64 = data.aux
          .replaceAll('%Ra&', 'A').replaceAll('%Rc&', 'B').replaceAll('%Rb&', 'C')
          .replaceAll('%Rd&', 'D').replaceAll('%Rf&', 'E').replaceAll('%Re&', 'F');
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.length > 200) return `<div>${decoded}</div>`;
      }
    }
  } catch { /* fall through */ }
  return bodyGeneric(url, 'article');
}


// --- Timotxt (timotxt.com): the book page shows only the latest-12 window;
// the full ordered list lives at /{bookId}/dir.
async function tocTimotxt(startUrl) {
  const u = new URL(startUrl);
  const id = u.pathname.split('/').filter(Boolean)[0];
  if (!id) return [];
  const html = await smartGetText(`${u.origin}/${id}/dir`);
  const items = regexLinks(html, u.origin, /\.html$/)
    .filter((i) => new RegExp(`/${id}/\\d+\\.html$`).test(i.url));
  const num = (x) => parseInt(x.url.match(/(\d+)\.html$/)?.[1] || '0', 10);
  return dedupeByUrl(items).sort((a, b) => num(a) - num(b));
}


// --- Wuxia.click (WuxiaWorld.eu-family software): the book page paginates
// its chapter list inline at ?page=N (~100 per page); chapters live at
// /chapter/{slug}-{n}.
async function tocWuxiaClick(startUrl) {
  const u = new URL(startUrl);
  const slug = u.pathname.split('/').filter(Boolean).pop();
  if (!slug) return [];
  const base = `${u.origin}/novel/${slug}`;
  const byNum = new Map();
  const collect = (html) => {
    for (const item of regexLinks(html, u.origin, /\/chapter\//)) {
      const n = parseInt(item.url.match(/-(\d+)\/?$/)?.[1] || '0', 10);
      if (n && item.url.includes(`/chapter/${slug}-`)) byNum.set(n, item);
    }
  };
  const first = await smartGetText(base);
  collect(first);
  let maxPage = 1;
  for (const m of first.matchAll(/[?&]page=(\d+)/g)) maxPage = Math.max(maxPage, parseInt(m[1], 10));
  for (let p = 2; p <= Math.min(maxPage, 80); p++) {
    let html;
    try { html = await smartGetText(`${base}?page=${p}`); } catch { break; }
    collect(html);
  }
  return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}


// --- Piaotia (piaotia.com / ptwxz.com): chapter prose has no container at
// all — paragraphs are direct <body> children between div.toplink and
// div.bottomlink. Slice that region and strip the remaining furniture.
async function bodyPiaotia(url) {
  try {
    const html = await smartGetText(url);
    const startM = html.match(/<div class="toplink">/.source ? /<div class="toplink">[\s\S]*?<\/div>/ : null);
    const start = startM ? startM.index + startM[0].length : 0;
    let end = html.indexOf('<div class="bottomlink"', start);
    if (end < 0) end = html.indexOf('<!--', start);
    if (end > start) {
      const slice = html.slice(start, end)
        .replace(/<table[\s\S]*?<\/table>/gi, '')
        .replace(/<center>[\s\S]*?<\/center>/gi, '');
      const text = slice.replace(/<[^>]+>/g, '').trim();
      if (text.length > 300) return `<div>${slice}</div>`;
    }
  } catch { /* fall through */ }
  return bodyGeneric(url, 'body');
}

// --- Quanben (quanben.io): the app's proxy routes barely answer this host
// (direct fetches work instantly). Book pages are shells; the list page
// shows head+tail chapter blocks and the URLs are purely sequential
// /n/{slug}/{n}.html, so synthesize the middle from the tail's max.
async function tocQuanben(startUrl) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const u = new URL(startUrl);
  const slug = u.pathname.match(/\/n\/([a-z0-9-]+)/i)?.[1];
  if (!slug) return [];
  const r = await fetch(`${u.origin}/n/${slug}/list.html`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const titled = new Map();
  let max = 0;
  for (const item of regexLinks(html, u.origin, /\.html$/)) {
    const n = parseInt(item.url.match(new RegExp(`/n/${slug}/(\\d+)\\.html$`))?.[1] || '0', 10);
    if (n) { titled.set(n, item); if (n > max) max = n; }
  }
  if (!max) return [...titled.values()];
  const out = [];
  for (let n = 1; n <= max; n++) out.push(titled.get(n) || { url: `${u.origin}/n/${slug}/${n}.html`, title: `Chapter ${n}` });
  return out;
}
async function bodyQuanben(url) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const html = await r.text();
      const out = extractWithSelector(parseHtml(html), 'div#content, div.articlebody');
      if (out && out.replace(/<[^>]+>/g, '').trim().length > 200) return out;
    }
  } catch { /* fall through */ }
  return bodyGeneric(url, 'div#content');
}


// --- WoopRead (woopread.com): a Next.js app (not Madara, despite the old
// routing). The series page's RSC flight payload embeds the complete
// chapter array as escaped JSON: {"number":N,"slug":"chapter-…",…}.
async function tocWoopRead(startUrl) {
  const raw = await smartGetText(startUrl);
  const html = raw.replaceAll('\\"', '"');
  const u = new URL(startUrl);
  const bookPath = u.pathname.replace(/\/$/, '');
  const byNum = new Map();
  for (const m of html.matchAll(/"number":\s*(\d+)\s*,\s*"slug":\s*"(chapter-[^"]+)"/g)) {
    const n = parseInt(m[1], 10);
    if (!byNum.has(n)) byNum.set(n, { url: `${u.origin}${bookPath}/${m[2]}`, title: `Chapter ${n}` });
  }
  // Titles ride along in the same objects when present.
  for (const m of html.matchAll(/"title":\s*"([^"]{1,120})"\s*,\s*"number":\s*(\d+)/g)) {
    const it = byNum.get(parseInt(m[2], 10));
    if (it) it.title = m[1];
  }
  return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}


// --- TomoTranslations (tomotranslations.com): the series page links ALL
// chapters, but the early ones live on the old tomotranslations.wordpress.com
// host — the generic sweep's same-host scoping drops them.
async function tocTomoTranslations(startUrl) {
  const html = await smartGetText(startUrl);
  const items = regexLinks(html, startUrl, /\/(19|20)\d{2}\//)
    .filter((i) => /tomotranslations\.(wordpress\.)?com/.test(i.url) && /chapter/i.test(i.url));
  return dedupeByUrl(items);
}

// --- SHMTranslations (shmtranslations.com): the (large) series page links
// every chapter post; harvest the dated /chapter-{N}-… links, deduped by
// path (hrefs mix www and bare hosts).
async function tocShmTranslations(startUrl) {
  const html = await smartGetText(startUrl);
  const byPath = new Map();
  for (const item of regexLinks(html, startUrl, /\/chapter-/)) {
    const p = new URL(item.url).pathname;
    if (/\/chapter-\d+/.test(p) && !byPath.has(p)) byPath.set(p, item);
  }
  const num = (x) => parseInt(new URL(x.url).pathname.match(/chapter-(\d+)/)?.[1] || '0', 10);
  return [...byPath.values()].sort((a, b) => num(a) - num(b));
}

// --- NovelVerseTranslations (novelversetranslations.com): the series page
// paginates its own list at 20/page via ?lcp_page0={N} (List Category Posts).
async function tocNovelVerseTranslations(startUrl) {
  const u = new URL(startUrl);
  const base = `${u.origin}${u.pathname}`;
  const byUrl = new Map();
  const merge = (html) => {
    let added = 0;
    for (const item of regexLinks(html, u.origin, /-chapter-\d+\/?$/)) {
      if (!byUrl.has(item.url)) { byUrl.set(item.url, item); added++; }
    }
    return added;
  };
  const first = await smartGetText(base);
  merge(first);
  let pages = 1;
  for (const m of first.matchAll(/lcp_page0=(\d+)/g)) pages = Math.max(pages, parseInt(m[1], 10));
  for (let p = 2; p <= Math.min(pages, 60); p++) {
    let html;
    try { html = await smartGetText(`${base}?lcp_page0=${p}`); } catch { break; }
    if (!merge(html)) break;
  }
  const num = (x) => parseInt(x.url.match(/-chapter-(\d+)\/?$/)?.[1] || '0', 10);
  return [...byUrl.values()].sort((a, b) => num(a) - num(b));
}

// --- ZirusMusings (zirusmusings.net): only Vol 0 renders as anchors; the
// full list is an embedded JSON blob (volumes[].chapters[] with string ids
// like "119" for main chapters and "0-01" for omake).
async function tocZirusMusings(startUrl) {
  const html = await smartGetText(startUrl);
  const u = new URL(startUrl);
  const series = u.pathname.split('/').filter(Boolean).pop();
  const out = [];
  const seen = new Set();
  // The page embeds every series on the site — scope to this series' slug.
  const scoped = new RegExp(`"series":\\s*"${series}","volume":\\s*\\d+,\\s*"chapter":\\s*"([0-9]+(?:-[0-9]+)?)"`, 'g');
  for (const m of html.matchAll(scoped)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ url: `${u.origin}/series/${series}/${id}`, title: id.startsWith('0-') ? `Omake ${id}` : `Chapter ${id}` });
  }
  const key = (x) => {
    const id = x.url.split('/').pop();
    return id.includes('-') ? parseFloat('0.' + id.split('-')[1]) : parseInt(id, 10);
  };
  return out.sort((a, b) => key(a) - key(b));
}


// --- PawRead (pawread.com): the full chapter list IS in the book page, but
// as onclick divs (goC('id')), not anchors — only "Latest Release" is a link.
// Extract the ids + titles from #chapter-list-1 and synthesize reader URLs.
async function tocPawRead(startUrl) {
  const html = await smartGetText(startUrl);
  const u = new URL(startUrl);
  const slug = u.pathname.split('/').filter(Boolean).pop();
  const out = [];
  const region = html.slice(html.indexOf('chapter-list-1'));
  for (const m of region.matchAll(/onclick="goC\('(\d+)'\);?"[\s\S]{0,400}?<span class="c_title">([^<]+)<\/span>/g)) {
    out.push({ url: `${u.origin}/novel/${slug}/${m[1]}.html`, title: m[2].trim() });
  }
  return out;
}

// --- Teanovel (teanovel.com): book pages embed only the latest chapter;
// the full list is a first-party JSON endpoint keyed by the book slug.
async function tocTeanovel(startUrl) {
  const u = new URL(startUrl);
  const slug = u.pathname.split('/').filter(Boolean).pop();
  const r = await fetch(`${u.origin}/api/novel/chapter-list?slug=${encodeURIComponent(slug)}`, { headers: { ...DEFAULT_HEADERS, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const rows = Array.isArray(j?.data) ? j.data : [];
  return rows
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({ url: `${u.origin}/novel/${slug}/${c.order}`, title: c.title || `Chapter ${c.order}` }));
}

// --- WeTriedTLS (wetriedtls.com): a Next.js front over an external API at
// api.wetriedtls.com. The series page's payload carries series_id; chapters
// come from /chapters/{id} (free) plus /chapters/{id}/paid.
async function tocWeTriedTls(startUrl) {
  const u = new URL(startUrl);
  let html = await smartGetText(startUrl);
  let seriesId = html.match(/series_id[^0-9]{0,8}(\d+)/)?.[1];
  if (!seriesId) {
    try {
      const r = await fetch(startUrl, { headers: DEFAULT_HEADERS });
      if (r.ok) { html = await r.text(); seriesId = html.match(/series_id[^0-9]{0,8}(\d+)/)?.[1]; }
    } catch { /* fall through */ }
  }
  if (!seriesId) return [];
  const api = 'https://api.wetriedtls.com';
  const get = async (path) => {
    const r = await fetch(`${api}${path}`, { headers: { ...DEFAULT_HEADERS, Accept: 'application/json' } });
    if (!r.ok) return null;
    return r.json();
  };
  const byIndex = new Map();
  const addRows = (rows) => {
    for (const c of rows || []) {
      const idx = c.index != null ? parseFloat(c.index) : parseInt(String(c.chapter_name).replace(/\D+/g, ''), 10);
      if (c.chapter_slug && !byIndex.has(idx)) byIndex.set(idx, { url: `${u.origin}${u.pathname.replace(/\/$/, '')}/${c.chapter_slug}`, title: c.chapter_title || c.chapter_name || 'Chapter' });
    }
  };
  const first = await get(`/chapters/${seriesId}?page=1&perPage=100&query=&order=asc`);
  addRows(first?.data);
  const lastPage = first?.meta?.last_page || 1;
  for (let p = 2; p <= lastPage; p++) addRows((await get(`/chapters/${seriesId}?page=${p}&perPage=100&query=&order=asc`))?.data);
  addRows((await get(`/chapters/${seriesId}/paid?query=&order=asc`))?.data);
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}


// --- CkandaWrites (ckandawrites.online): WP series pages server-render the
// complete episode list inside .eplister (newest-first). Scope collection
// to that block (the generic sweep also catches ~0.5% foreign furniture
// links) and reverse into reading order.
async function tocCkandaWrites(startUrl) {
  const html = await smartGetText(startUrl);
  const start = html.indexOf('eplister');
  if (start < 0) return [];
  const end = html.indexOf('</ul>', start);
  const region = html.slice(start, end > start ? end : start + 400000);
  const items = regexLinks(region, startUrl, /chapter|\-\d+\-\d+\/?$/);
  return dedupeByUrl(items).reverse();
}

// --- SnoutAndCo (snoutandco.ca): the JS directory is backed by a static
// JSON index per book: /{folder}/chapters.json; chapter prose lives in
// plain-text files at /{folder}/chapters/{filename}.
async function tocSnoutAndCo(startUrl) {
  const u = new URL(startUrl);
  const folder = u.searchParams.get('folder');
  if (!folder) return [];
  const r = await fetch(`${u.origin}/${folder}/chapters.json`, { headers: DEFAULT_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.chapters || []).map((c) => ({ url: `${u.origin}/${folder}/chapters/${c.filename}`, title: c.title || c.filename }));
}
async function bodySnoutAndCo(url) {
  const r = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return `<div>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`;
}


// --- Metanovel (m.metanovel.org): the book page embeds only a latest-10
// block plus the head of the list; the complete ascending list paginates
// at /book/{id}/chapters/{n} (200 per page, page count linked on page 1).
// The site also prepends a sequential "\u7b2c{seq}\u7ae0 " to each original
// chapter title (which usually carries its own Chinese-numeral heading),
// producing doubled headings — strip the prepended prefix.
async function tocMetanovel(startUrl) {
  const u = new URL(startUrl);
  const id = u.pathname.match(/\/book\/(\d+)/)?.[1];
  if (!id) return [];
  const pageItems = (html) => regexLinks(html, u.origin, /\/chapter\/\d+\/?$/)
    .filter((i) => i.url.includes(`/book/${id}/chapter/`))
    .map((i) => ({ ...i, title: (i.title || '').replace(/^\u7b2c\s*\d+\s*\u7ae0\s*/, '') || i.title }));
  const first = await smartGetText(`${u.origin}/book/${id}/chapters/1`);
  let maxPage = 1;
  for (const mm of first.matchAll(/\/chapters\/(\d+)/g)) maxPage = Math.max(maxPage, parseInt(mm[1], 10));
  const pages = new Map([[1, pageItems(first)]]);
  const queue = [];
  for (let n = 2; n <= Math.min(maxPage, 100); n++) queue.push(n);
  let qi = 0;
  const worker = async () => {
    while (qi < queue.length) {
      const n = queue[qi++];
      try { pages.set(n, pageItems(await smartGetText(`${u.origin}/book/${id}/chapters/${n}`))); } catch { /* skip page */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const byUrl = new Map();
  for (let n = 1; n <= Math.min(maxPage, 100); n++) for (const it of pages.get(n) || []) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
  return [...byUrl.values()];
}


// --- Konkon (konkon.ink, the new home of Zetro Translations): a Nuxt front
// over a public API at api-k.konkon.ink. The SSR series page exposes only a
// slice of the chapters and the chapter page renders "not found" while
// loading via the API, so both TOC and content come from the API.
const KONKON_API = 'https://api-k.konkon.ink/api/public';
async function konkonGet(path) {
  const r = await fetch(`${KONKON_API}${path}`, { headers: { ...DEFAULT_HEADERS, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function tocKonkon(startUrl) {
  const u = new URL(startUrl);
  const slug = u.pathname.match(/^\/read\/([a-z0-9-]+)\/?$/i)?.[1];
  if (!slug) return [];
  const byId = new Map();
  const collect = (j) => {
    for (const vol of j?.data?.volumes || []) {
      const chs = [...(vol.chapters || [])].sort((a, b) => (a.sort_order ?? a.order ?? 0) - (b.sort_order ?? b.order ?? 0));
      for (const c of chs) {
        if (!byId.has(c.id)) byId.set(c.id, { url: `https://konkon.ink/read/chapter/${c.id}/${c.slug}`, title: c.title || `Chapter ${c.order ?? ''}`.trim() });
      }
    }
  };
  const first = await konkonGet(`/novels/${encodeURIComponent(slug)}`);
  collect(first);
  const lastPage = first?.data?.chapters_pagination?.last_page || 1;
  for (let p = 2; p <= Math.min(lastPage, 50); p++) {
    collect(await konkonGet(`/novels/${encodeURIComponent(slug)}?page=${p}`));
  }
  return [...byId.values()];
}
async function bodyKonkon(chapterUrl) {
  const id = new URL(chapterUrl).pathname.match(/\/read\/chapter\/(\d+)/)?.[1];
  if (!id) return bodyGeneric(chapterUrl, 'article');
  const j = await konkonGet(`/chapters/${id}`);
  const content = j?.data?.content;
  if (typeof content === 'string' && content.trim()) return content;
  // Coin-locked chapters return no content field at all (paywall by design).
  throw new Error('Chapter is locked on konkon.ink (no public content)');
}


// --- JonaxxStories (jonaxxstories.com): a book's landing page carries no
// full chapter list; the chapters are dated WP posts filed under
// /category/{book-slug}/ (10 per archive page, newest-first).
async function tocJonaxxStories(startUrl) {
  const u = new URL(startUrl);
  const bookSlug = u.pathname.split('/').filter(Boolean).pop();
  if (!bookSlug) return [];
  const postRe = new RegExp(`/\\d{4}/\\d{2}/\\d{2}/${bookSlug}-`);
  const byUrl = new Map();
  const merge = (html) => {
    let added = 0;
    for (const item of regexLinks(html, u.origin, postRe)) {
      const clean = item.url.split('#')[0];
      if (!byUrl.has(clean)) { byUrl.set(clean, { ...item, url: clean }); added++; }
    }
    return added;
  };
  const first = await smartGetText(`${u.origin}/category/${bookSlug}/`);
  merge(first);
  let pages = 1;
  for (const m of first.matchAll(new RegExp(`/category/${bookSlug}/page/(\\d+)`, 'g'))) pages = Math.max(pages, parseInt(m[1], 10));
  for (let p = 2; p <= Math.min(pages, 60); p++) {
    let html;
    try { html = await smartGetText(`${u.origin}/category/${bookSlug}/page/${p}/`); } catch { break; }
    if (!merge(html)) break;
  }
  const num = (x) => {
    const k = x.url.match(/-kabanata-(\d+)/);
    if (k) return parseInt(k[1], 10);
    if (/wakas|epilog/i.test(x.url)) return Number.MAX_SAFE_INTEGER; // "Wakas" = finale
    return 0; // prologue/special posts sort first, in path order among themselves
  };
  return [...byUrl.values()].sort((a, b) => num(a) - num(b) || a.url.localeCompare(b.url));
}


// --- TigerTranslations (tigertranslations.org): the config's div.the-content
// selector is dead (the theme changed); the series page's div.entry-content
// holds plain runs of chapter anchors. Slice that region and keep the
// series' own dated/short chapter posts, sorted by chapter number.
async function tocTigerTranslations(startUrl) {
  const html = await smartGetText(startUrl);
  const start = html.indexOf('entry-content');
  const region = start >= 0 ? html.slice(start, start + 600000) : html;
  const items = regexLinks(region, startUrl, /\/(\d{4}\/\d{2}\/\d{2}\/)?[a-z0-9-]+-?\d+\/?$/)
    .filter((i) => /chapter\s*\d/i.test(i.title) || /-\d+\/?$/.test(new URL(i.url).pathname));
  const num = (x) => parseInt((x.title.match(/chapter\s*(\d+)/i) || x.url.match(/-(\d+)\/?$/))?.[1] || '0', 10);
  return dedupeByUrl(items).sort((a, b) => num(a) - num(b));
}

// --- UniversalNovel (universalnovel.com): /series/{slug}/ pages work via
// the eplister config, but a pasted CHAPTER URL has no eplister and the
// sweep harvests the comments widget. Normalize any input to the series
// page and read its eplister.
async function tocUniversalNovel(startUrl) {
  const u = new URL(startUrl);
  let slug = u.pathname.match(/^\/series\/([a-z0-9-]+)\/?$/i)?.[1];
  if (!slug) slug = u.pathname.match(/^\/([a-z0-9-]+?)-chapter-\d+(?:-\d+)?\/?$/i)?.[1];
  if (!slug) return [];
  const html = await smartGetText(`${u.origin}/series/${slug}/`);
  const start = html.indexOf('eplister');
  if (start < 0) return [];
  const end = html.indexOf('</ul>', start);
  const region = html.slice(start, end > start ? end : start + 400000);
  return dedupeByUrl(regexLinks(region, u.origin, /-chapter-/));
}

// --- WtNovels (wtnovels.com): book pages embed only first+latest links;
// the complete list is server-rendered at /novels/{slug}/chapters/.
async function tocWtNovels(startUrl) {
  const u = new URL(startUrl);
  const slug = u.pathname.match(/\/novels\/([a-z0-9-]+)/i)?.[1];
  if (!slug) return [];
  const html = await smartGetText(`${u.origin}/novels/${slug}/chapters/`);
  const items = regexLinks(html, u.origin, new RegExp(`/novels/${slug}/[^/]+-chapter-\\d+-`));
  const num = (x) => parseInt(x.url.match(/-chapter-(\d+)-/)?.[1] || '0', 10);
  return dedupeByUrl(items).sort((a, b) => num(a) - num(b));
}

// --- Twkan (twkan.com): /book/{id}/index.html renders only a preview
// (first 15 + latest ~21); the page's LoadMore() pulls the complete list
// from /ajax_novels/chapterlist/{id}.html as an HTML fragment.
async function tocTwkan(startUrl) {
  const u = new URL(startUrl);
  const id = u.pathname.match(/\/book\/(\d+)/i)?.[1];
  if (!id) return [];
  const html = await smartGetText(`${u.origin}/ajax_novels/chapterlist/${id}.html`);
  return regexLinks(html, u.origin, new RegExp(`/txt/${id}/`));
}


// --- Novel543 (novel543.com): book pages show Ch 1 + latest 12; the full
// list is the book's /{id}/dir page (single fetch, any length). Chapters
// are /{bookId}/8096_{n}.html; chapter TEXT is split across continuation
// pages 8096_{n}_2.html, _3… which the body parser stitches back together.
async function tocNovel543(startUrl) {
  const u = new URL(startUrl);
  const id = u.pathname.split('/').filter(Boolean)[0];
  if (!/^\d+$/.test(id || '')) return [];
  const html = await smartGetText(`${u.origin}/${id}/dir`);
  const items = dedupeByUrl(regexLinks(html, u.origin, /\/\d+_\d+\.html$/));
  const num = (x) => parseInt(x.url.match(/_(\d+)\.html$/)?.[1] || '0', 10);
  return items.sort((a, b) => num(a) - num(b));
}
async function bodyNovel543(url) {
  const parts = [];
  const first = await bodyGeneric(url, 'div.chapter-content');
  if (first) parts.push(first);
  for (let n = 2; n <= 6; n++) {
    const cont = url.replace(/\.html$/, `_${n}.html`);
    try {
      const html = await bodyGeneric(cont, 'div.chapter-content');
      if (html && html.replace(/<[^>]+>/g, '').trim().length > 100) { parts.push(html); continue; }
    } catch { /* no more parts */ }
    break;
  }
  return parts.join('\n');
}

// --- Novelingua (novelingua.com): hand-maintained SitePad series pages.
// Most series are complete on one page (what exists is all the site hosts);
// the newest tail of long series lives on a sibling /{series}-front/ page
// linked as "Next Chapters". Merge both, sorted numerically.
async function tocNovelingua(startUrl) {
  const u = new URL(startUrl);
  const byUrl = new Map();
  const merge = (html) => {
    for (const item of regexLinks(html, u.origin, /-chapter-/)) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  };
  const first = await smartGetText(startUrl);
  merge(first);
  const front = first.match(/href="(?:https?:\/\/[^"/]+)?(\/[a-z0-9-]+-front\/?)"/i)?.[1];
  if (front) {
    try { merge(await smartGetText(u.origin + front)); } catch { /* tail stays partial */ }
  }
  const num = (x) => {
    const m = x.url.match(/-chapter-(\d+)/);
    return m ? parseInt(m[1], 10) : -1; // extras (side stories, α) first
  };
  return [...byUrl.values()].sort((a, b) => num(a) - num(b));
}

// --- SciFiStories (scifistories.com): storyInfo.php?id=N is metadata only
// (no chapter links at all). It links a reader index at /s/{id}/{slug} (or
// /n/… for novels) listing every chapter at /s|n/{id}/{slug}/{n}.
// NOTE: anonymous chapter text is truncated mid-chapter by the site
// ("To read the complete story you need to be logged in") — preview-only
// by design; the TOC is the fixable part.
async function tocScifiStories(startUrl) {
  const html = await smartGetText(startUrl);
  const u = new URL(startUrl);
  const idx = html.match(new RegExp(`href="(/(?:s|n)/\\d+/[^"]+)"`))?.[1];
  if (!idx) return [];
  const indexHtml = await smartGetText(u.origin + idx);
  const items = regexLinks(indexHtml, u.origin, new RegExp(`${idx.replace(/[.*+?^${'{}'}()|[\]\\]/g, '\\$&')}/\\d+$`));
  return items.sort((a, b) => parseInt(a.url.split('/').pop(), 10) - parseInt(b.url.split('/').pop(), 10));
}

// --- OnTimeStory (ontimestory.eu): the series page holds the complete
// list in ONE fetch; the app's generic pagination then invents hundreds of
// templated page URLs from furniture numbers and hangs. Collect the dated
// chapter posts directly, sorted by their slug numbers.
async function tocOntimestory(startUrl) {
  const html = await smartGetText(startUrl);
  const series = new URL(startUrl).pathname.split('/').filter(Boolean).pop();
  const items = regexLinks(html, startUrl, new RegExp(`${series}-chapter-[\\d]`))
    .map((i) => ({ ...i, url: i.url.split('#')[0] })); // drop #comment- furniture variants
  const key = (x) => (x.url.match(/-chapter-([\d-]+)\/?$/)?.[1] || '0').split('-').map((n) => parseInt(n, 10));
  return dedupeByUrl(items).sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const d = (ka[i] || 0) - (kb[i] || 0);
      if (d) return d;
    }
    return 0;
  });
}

// --- Asianovel (asianovel.net): story pages server-render the complete
// list and www works end-to-end; the bare-domain form returns TOC 0
// because every chapter href is an absolute www URL and the sweep drops
// cross-origin links. Normalize the input to www and collect here.
async function tocAsianovel(startUrl) {
  const u = new URL(startUrl.replace('://asianovel.net', '://www.asianovel.net'));
  const html = await smartGetText(u.toString());
  const start = html.indexOf('chapter-group__list');
  if (start < 0) return [];
  const region = html.slice(start, start + 500000);
  return dedupeByUrl(regexLinks(region, u.origin, /\/chapter\//));
}


// --- Sonako wiki (sonako.fandom.com / sonako.wikia.com): series pages are
// MediaWiki project pages; the sweep harvests wiki furniture. The series
// page's WIKITEXT (via the MW API) is the authoritative ordered chapter
// listing — filter it to the series' own prose pages, drop illustration
// pages, bare volume compilations and redlinks, order by volume.
async function tocSonako(startUrl) {
  const u = new URL(startUrl);
  const origin = 'https://sonako.fandom.com';
  const series = decodeURIComponent(u.pathname.split('/wiki/')[1] || '').replace(/_/g, ' ').trim();
  if (!series) return [];
  const api = async (params) => {
    const r = await fetch(`${origin}/api.php?${params}`, { headers: { ...DEFAULT_HEADERS, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const j = await api(`action=parse&page=${encodeURIComponent(series)}&prop=wikitext&format=json`);
  const wikitext = j?.parse?.wikitext?.['*'] || '';
  const seen = new Set();
  const entries = [];
  for (const m of wikitext.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
    const title = m[1].replace(/_/g, ' ').trim();
    if (!title || seen.has(title)) continue;
    if (/^(category|file|image|mediawiki|template|help|special|sonako|user|talk)/i.test(title)) continue;
    const low = title.toLowerCase();
    const sLow = series.toLowerCase();
    if (!(low === sLow || low.startsWith(sLow + ':') || low.startsWith(sLow + ' '))) continue;
    if (low === sLow) continue;
    if (/minh h[ọo]a/i.test(title)) continue; // illustration pages
    if (new RegExp(`^${series.replace(/[.*+?^${'{}'}()|[\]\\]/g, '\\$&')} (tập|vol\\.?|volume) \\d+(\\.\\d+)?$`, 'i').test(title)) continue; // bare volume compilations
    seen.add(title);
    entries.push(title);
  }
  // Existence filter — drop redlinks in batches of 40.
  const existing = new Set();
  for (let i = 0; i < entries.length; i += 40) {
    const batch = entries.slice(i, i + 40);
    const q = await api(`action=query&titles=${batch.map(encodeURIComponent).join('%7C')}&format=json`);
    const pages = q?.query?.pages || {};
    const normalized = new Map((q?.query?.normalized || []).map((n) => [n.from, n.to]));
    const validTitles = new Set(Object.values(pages).filter((pg) => !('missing' in pg)).map((pg) => pg.title));
    for (const t of batch) {
      const norm = normalized.get(t) || t;
      if (validTitles.has(norm) || validTitles.has(t)) existing.add(t);
    }
  }
  const kept = entries.filter((t) => existing.has(t));
  const volOf = (t) => {
    const m = t.match(/(?:tập|vol\.?|volume)\s*(\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return kept
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (volOf(a.t) - volOf(b.t)) || (a.i - b.i))
    .map(({ t }) => ({ url: `${origin}/vi/wiki/${encodeURIComponent(t.replace(/ /g, '_')).replace(/%3A/gi, ':')}`, title: t }));
}


// --- Readingpia (readingpia.me): prose is server-rendered but interleaved
// with decoy blocks carrying inline display:none styles and garbage text.
// Strip every display:none element inside the chapter container, then
// extract as usual.
async function bodyReadingpia(url) {
  const html = await smartGetText(url);
  const doc = parseHtml(html);
  doc.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach((el) => el.remove());
  const out = extractWithSelector(doc, 'div#chapter-body, div.chapter-body, main, article');
  if (out && out.replace(/<[^>]+>/g, '').trim().length > 200) return out;
  return bodyGeneric(url, 'div#chapter-body, div.chapter-body, main, article');
}

// --- Neobook (neobook.org): book and reader pages embed a full state
// object (`var data = {...}`) — the chapters array lists every chapter,
// and the reader page's copy has the requested chapter's complete HTML in
// its entry (loaded:"1"). Parse the embedded JSON; there is no API.
function neobookData(html) {
  const start = html.indexOf('var data = ');
  if (start < 0) return null;
  const open = html.indexOf('{', start);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) {
      try { return JSON.parse(html.slice(open, i + 1)); } catch { return null; }
    } }
  }
  return null;
}
async function tocNeobook(startUrl) {
  const u = new URL(startUrl);
  const book = u.pathname.match(/\/book\/([^/]+)/)?.[1] || u.searchParams.get('book');
  if (!book) return [];
  const data = neobookData(await smartGetText(startUrl));
  const chapters = data?.chapters || [];
  return chapters
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((c) => ({ url: `${u.origin}/reader/?book=${book}&chapter=${c.token}`, title: c.title || `Chapter ${c.sort}` }));
}
async function bodyNeobook(url) {
  const u = new URL(url);
  const token = u.searchParams.get('chapter');
  const data = neobookData(await smartGetText(url));
  const entry = (data?.chapters || []).find((c) => c.token === token && String(c.loaded) === '1' && (c.data?.html || c.html));
  if (entry) return entry.data?.html || entry.html;
  return bodyGeneric(url, 'div.book-text, article');
}

// --- TruyenNhabo (truyennhabo.com): a Blogger blog; each series is a
// label. Derive the series label from a chapter post (reader nav carries
// data-label), then enumerate the label feed (newest-first JSON), keeping
// the "Chapter NN" posts in numeric order.
async function tocTruyenNhabo(startUrl) {
  const u = new URL(startUrl);
  let label = u.pathname.match(/\/search\/label\/([^/]+)/)?.[1] ? decodeURIComponent(u.pathname.match(/\/search\/label\/([^/]+)/)[1]) : null;
  if (!label) {
    const html = await smartGetText(startUrl);
    label = html.match(/data-label=['"]([^'"]+)['"]/)?.[1]
      || html.match(/<title>([^<]+?)\s*-\s*Chapter/i)?.[1]?.trim()
      || null;
  }
  if (!label) return [];
  const out = [];
  for (let startIndex = 1; startIndex <= 2000; startIndex += 500) {
    const r = await fetch(`https://www.truyennhabo.com/feeds/posts/default/-/${encodeURIComponent(label)}?alt=json&max-results=500&start-index=${startIndex}`, { headers: { ...DEFAULT_HEADERS, Accept: 'application/json' } });
    if (!r.ok) break;
    const j = await r.json();
    const entries = j?.feed?.entry || [];
    if (!entries.length) break;
    for (const e of entries) {
      const title = e.title?.$t || '';
      const href = (e.link || []).find((l) => l.rel === 'alternate')?.href;
      const num = title.match(/chapter\s*(\d+)/i)?.[1];
      if (href && num) out.push({ url: href, title, n: parseInt(num, 10) });
    }
    if (entries.length < 500) break;
  }
  return out.sort((a, b) => a.n - b.n).map(({ url, title }) => ({ url, title }));
}

// --- ixdzs8.com: chapter pages sit behind a JS browser-verification stub
// ("let token = ...; location = ?challenge=<token>") that also sets session
// cookies. Replay the redirect manually in one session to get the real page.
async function bodyIxdzs8(url) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  try {
    const r1 = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    let html = await r1.text();
    const token = html.match(/let token\s*=\s*"([^"]+)"/)?.[1];
    if (token && html.length < 3000) {
      const cookies = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
      const sep = url.includes('?') ? '&' : '?';
      const r2 = await fetch(`${url}${sep}challenge=${encodeURIComponent(token)}`, {
        headers: { 'User-Agent': UA, ...(cookies ? { Cookie: cookies } : {}) },
        redirect: 'follow',
      });
      const h2 = await r2.text();
      if (h2.length > html.length) html = h2;
    }
    if (html.length >= 3000) return extractWithSelector(parseHtml(html), 'article.page-content > section, section');
  } catch { /* fall through */ }
  return bodyGeneric(url, 'section');
}

async function body69shuba(url) {
  return extractWithSelector(parseHtml(await getText(url)),
    '#content, #booktxt, .booktxt, .readcontent');
}

// --- UUKanshu: CN raw fiction ---


// --- Shanghai Fantasy: chapter list comes from a WordPress JSON API keyed by data-cat ---
async function tocAlicesw(url) {
  let html = await getText(url);
  let doc = parseHtml(html);
  if (!doc.querySelector(".mulu_list")) {
    const id = url.match(/\/novel\/(\d+)/)?.[1] || html.match(/\/other\/chapters\/id\/(\d+)/)?.[1];
    if (!id) throw new Error("AliceSW: book id not found");
    doc = parseHtml(await getText(`https://www.alicesw.com/other/chapters/id/${id}.html`));
  }
  const out = [...doc.querySelectorAll(".mulu_list a[href]")].map((a) => ({
    url: new URL(a.getAttribute("href"), "https://www.alicesw.com/").href,
    title: a.textContent.trim(),
  }));
  return dedupeByUrl(out);
}

async function tocMatchaNovels(url) {
  const base = url.match(/^(https?:\/\/[^/]+\/novela\/[^/?#]+)/i)?.[1];
  if (!base) throw new Error("MatchaNovels: open the novel page, not a chapter");
  const html = (await getText(base)).replace(/\\"/g, '"');
  const i = html.indexOf('"capitulos":[');
  const out = [];
  if (i >= 0) {
    const re = /\["(\d+)","[^"]*",(true|false),(null|"[^"]*")/g;
    re.lastIndex = i;
    const seg = html.slice(i, i + 400000);
    for (const m of seg.matchAll(/\["(\d+)","[^"]*",(true|false),(null|"(?:[^"\\]|\\.)*")/g)) {
      if (m[2] === "true") continue; // VIP / locked
      const name = m[3] === "null" ? "" : m[3].slice(1, -1);
      out.push({ url: `${base}/capitulo/${m[1]}`, title: name ? `Capítulo ${m[1]} - ${name}` : `Capítulo ${m[1]}` });
    }
  }
  if (!out.length) {
    for (const m of html.matchAll(/href="(\/novela\/[^"]+\/capitulo\/(\d+))"/g))
      out.push({ url: new URL(m[1], base).href, title: `Capítulo ${m[2]}` });
  }
  return dedupeByUrl(out).sort((a, b) => Number(a.url.split("/").pop()) - Number(b.url.split("/").pop()));
}

async function tocShanghaiFantasy(url) {
  let html = await getText(url);
  let cat = html.match(/data-cat=["']?(\d+)/i)?.[1];
  if (!cat) {
    const novel = html.match(/href=["'](https?:\/\/shanghaifantasy\.com\/novel\/[^"']+)["']/i)?.[1];
    if (novel) {
      html = await getText(novel);
      cat = html.match(/data-cat=["']?(\d+)/i)?.[1];
    }
  }
  if (!cat) throw new Error("Shanghai Fantasy: chapter list id not found");
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const json = await getJson(
      `https://shanghaifantasy.com/wp-json/fiction/v1/chapters?category=${cat}&order=asc&page=${page}&per_page=100`
    );
    if (!Array.isArray(json) || !json.length) break;
    json
      .filter((c) => c && c.permalink && !c.locked)
      .forEach((c) => out.push({ url: c.permalink, title: String(c.title || "").trim() }));
    if (json.length < 100) break;
  }
  return dedupeByUrl(out);
}

async function bodyShanghaiFantasy(url) {
  const doc = parseHtml(await getText(url));
  doc.querySelectorAll(".patreon1, nav, button, template, #comments, footer, .hideme, .ai-viewports, .code-block, script, ins").forEach((e) => e.remove());
  return extractWithSelector(doc, "div.contenta, body > div.flex, article");
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

// --- Novelight (novelight.net) ---
async function tocNovelight(url) {
  const html = await getText(url);
  const origin = new URL(url).origin;

  const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => unwrapProxyUrl(m[1]));
  const chapterUrls = Array.from(new Set(matches.filter(u => u && u.includes("/book/chapter/"))));

  const pageItems = chapterUrls.map(u => {
    const chapterId = u.match(/chapter\/(\d+)/)?.[1] || "";
    return {
      url: absoluteUrl(origin, u),
      title: chapterId ? `Chapter ${chapterId}` : "Chapter"
    };
  });

  pageItems.reverse();
  return dedupeByUrl(pageItems);
}

async function bodyNovelight(url) {
  const html = await getText(url);
  const doc = parseHtml(html);
  const content = extractWithSelector(doc, '.chapter-text, .chapter-text__limit, .chapter-text__place, #chapter-content, article');
  if (content && content.replace(/<[^>]+>/g, '').trim().length > 30) {
    return content;
  }
  const chapterId = url.match(/chapter\/(\d+)/)?.[1];
  if (chapterId) {
    try {
      const origin = new URL(url).origin;
      const apiUrl = `${origin}/book/ajax/read-chapter/${chapterId}`;
      const res = await httpGet(apiUrl, { "X-Requested-With": "XMLHttpRequest" });
      const json = await res.json();
      const c = json?.content || "";
      if (c && c.replace(/<[^>]+>/g, "").trim().length > 30) return c;
    } catch {}
  }
  return content;
}


/** Hosts covered by the dedicated parsers above (used by supportedDomains). */
const MAJOR_DOMAINS = [
  "novelight.net",
  "scribblehub.com",
  "fanfiction.net",
  "fictionpress.com",
  "pandanovel.co",
  "webnovel.com",
  "readnovelfull.com",
  "wuxiaworld.site",
  "wuxiaworld.com",
  "sonicmtl.com",
  "hiraethtranslation.com",
  "wetriedtls.com",
  "mvlempyr.com",
  "wuxiabox.com",
  "novgo.net",
  "69shuba.com",
  "ptwxz.com",
  // New sites
  "inkitt.com",
  "literotica.com",
  "akknovel.com",
];

/** Chapter-body selectors for the dedicated sites, tried in order. */
const MAJOR_BODY_SELECTORS = {
  parahumans: ".entry-content",
  scribblehub: "div#chp_raw, div.chp_raw, div.fic_row",
  fanfiction: "div.storytext, #storytext",
  lightnovelworld: "#chapter-container, div.chapter-content, .chapter-container",
  ranobes: "div#arrticle, .story, #dle-content .text-story",
  webnovel: "div.chapter_content, .cha-words, .cha-content",
  readnovelfull: "#chr-content, #chapter-content, div.chapter-content",
  madara: "div.reading-content .text-left, div.reading-content, div.entry-content, .text-left",
  novelcool: ".chapter-content, .text-content, #chapterContent, .reading-content",
  allnovelfull: ".chr-c, #chapter-content, .reading-content, div.chapter-content",
  syosetu: "#novel_honbun, .p-novel__body, div#novel_color",
  kakuyomu: ".widget-episodeBody, .js-episode-body, article.widget-episodeBody",
  wuxiaworld_eu: "#chapter-content, .reader-text",
  alphapolis: "div#novelBody",
  libread: "div#article, div.txt",
  naver: "div.viewer_container",
  novelceo: "#chr-content, #chapter-content, div.chapter-content, .chapter-c",
  nineheavens: "article.chapter__article",
  lnmtl: "div.chapter-body",
  novelbinmirror: "#chr-content, #chapter-content, div.chapter-content, .chapter-c, #chapterContent",
  ttshu8: "div.content",
  wuxiaclick: "#chapterText",
  xpaoshuba: "div#content, div.content",
  tigertl: "div.entry-content",
  universalnovel: ".entry-content",
  wtnovels: "div.entry-content, div.post-content",
  twkan: "#txtcontent0",
  novel543: "div.chapter-content",
  novelingua: ".entry-content, article",
  scifistories: "article",
  ontimestory: "div.post-content, div.entry-content",
  asianovel: "#chapter-content",
  sonako: "div.mw-content-ltr",
  readingpia: "div#chapter-body, div.chapter-body",
  neobook: "div.book-text, article",
  truyennhabo: "article.blog, article",
  ilwxsm: "div.content",
  piaotia: "body",
  quanben: "div#content",
  woopread: "div[id^='chapter']",
  tomotranslations: "section.entry, .entry-content",
  shmtranslations: "article .entry-content, .entry-content",
  novelversetl: "article .entry-content, .entry-content",
  zirusmusings: "article, .chapter-content, main",
  metanovel: "#content",
  pawread: "#chapter_item",
  teanovel: "div.prose",
  wetriedtls: "div.entry-content, #chaptercontent, article, main",
  bakatsuki: ".mw-parser-output",
  xenforo: "article.message-body .bbWrapper, .message-body .bbWrapper, .message-userContent",
  creativenovels: ".entry-content, .chapter-content, article .post-content",
  nextjs: ".chapter-content, .reader-content, main article",
  novelhi: "#chr-content, #chapter-content, div.chapter-content",
  foxteller: "article",
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
  [/(^|\.)scribblehub\.com$/, "scribblehub"],
  [/(^|\.)(fanfiction|fictionpress)\.net$/, "fanfiction"],
  [/(^|\.)parahumans\.wordpress\.com$/, "parahumans"],
  [/(^|\.)fictionpress\.com$/, "fanfiction"],
  [/(^|\.)pandanovel\.co$/, "lightnovelworld"],
  [/(^|\.)mvlempyr\.(com|io)$/, "mvlempyr"],
  [/(^|\.)timotxt\.com$/, "timotxt"],
  [/(^|\.)wuxia\.click$/, "wuxiaclick"],
  [/(^|\.)piaotia\.com$/, "piaotia"],
  [/(^|\.)ptwxz\.com$/, "piaotia"],
  [/(^|\.)quanben\.io$/, "quanben"],
  [/(^|\.)woopread\.com$/, "woopread"],
  [/(^|\.)konkon\.ink$/, "konkon"],
  [/(^|\.)tomotranslations\.com$/, "tomotranslations"],
  [/(^|\.)shmtranslations\.com$/, "shmtranslations"],
  [/(^|\.)novelversetranslations\.com$/, "novelversetl"],
  [/(^|\.)zirusmusings\.net$/, "zirusmusings"],
  [/(^|\.)pawread\.com$/, "pawread"],
  [/(^|\.)teanovel\.com$/, "teanovel"],
  [/(^|\.)wetriedtls\.com$/, "wetriedtls"],
  [/(^|\.)ckandawrites\.online$/, "ckanda"],
  [/(^|\.)snoutandco\.ca$/, "snoutandco"],
  [/(^|\.)jonaxxstories\.com$/, "jonaxx"],
  [/(^|\.)tigertranslations\.org$/, "tigertl"],
  [/(^|\.)universalnovel\.com$/, "universalnovel"],
  [/(^|\.)wtnovels\.com$/, "wtnovels"],
  [/(^|\.)twkan\.com$/, "twkan"],
  [/(^|\.)novel543\.com$/, "novel543"],
  [/(^|\.)novelingua\.com$/, "novelingua"],
  [/(^|\.)scifistories\.com$/, "scifistories"],
  [/(^|\.)ontimestory\.eu$/, "ontimestory"],
  [/(^|\.)asianovel\.net$/, "asianovel"],
  [/(^|\.)sonako\.(fandom\.com|wikia\.com)$/, "sonako"],
  [/(^|\.)readingpia\.me$/, "readingpia"],
  [/(^|\.)neobook\.org$/, "neobook"],
  [/(^|\.)truyennhabo\.com$/, "truyennhabo"],
  [/(^|\.)ranobes\.com$/, "ranobes"],
  [/(^|\.)webnovel\.com$/, "webnovel"],
  [/(^|\.)(readnovelfull\.com|wuxiabox\.com)$/, "readnovelfull"],
    [
    /(^|\.)(wuxiaworld\.site|novelnice\.com|woopread\.com|sonicmtl\.com|hiraethtranslation\.com|wetriedtls\.com|mvlempyr\.com)$/,
    "madara",
  ],
  [/(^|\.)ncode\.syosetu\.com$/, "syosetu"],
  [/(^|\.)kakuyomu\.jp$/, "kakuyomu"],
  [/(^|\.)novelcool\.com$/, "novelcool"],
  [/(^|\.)allnovelfull\.(com|net)$/, "allnovelfull"],
  [/(^|\.)wuxiaworld\.eu$/, "wuxiaworld_eu"],
  [/(^|\.)baka-tsuki\.org$/, "bakatsuki"],
  [/(^|\.)alternatehistory\.com$/, "xenforo"],
  [/(^|\.)alphapolis\.co\.jp$/, "alphapolis"],
  [/(^|\.)libread\.com$/, "libread"],
  [/(^|\.)novel\.naver\.com$/, "naver"],
  [/(^|\.)novelceo\.com$/, "novelceo"],
  [/(^|\.)noveldrama\.org$/, "novelceo"],
  [/(^|\.)nineheavens\.org$/, "nineheavens"],
  [/(^|\.)ixdzs8\.com$/, "ixdzs8"],
  [/(^|\.)lnmtl\.com$/, "lnmtl"],
  [/(^|\.)novel-bin\.(com|net)$/, "novelbinmirror"],
  [/(^|\.)ttshu8\.com$/, "ttshu8"],
  [/(^|\.)xpaoshuba\.com$/, "xpaoshuba"],
  [/(^|\.)forum\.questionablequesting\.com$/, "xenforo"],
  [/(^|\.)creative-novels\.com$/, "creativenovels"],
  [/(^|\.)jjwxc\.net$/, "jjwxc"],
  [/(^|\.)novel\.pixiv\.net$/, "pixivnovel"],
  [/(^|\.)storiesonline\.net$/, "storiesonline"],
  [/(^|\.)ficwad\.com$/, "ficwad"],
  [/(^|\.)wuxiaworld\.com$/, "wuxiaworld"],
  [/(^|\.)inkitt\.com$/, "inkitt"],
  [/(^|\.)akknovel\.com$/, "readlightnovel"],
  [/(^|\.)literotica\.com$/, "literotica"],
  [/(^|\.)69shuba\.com$/, "69shuba"],
];

function siteKey(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (host.includes("freewebnovel.com")) return "freewebnovel";
  if (host.includes("novelfire.") || host.includes("novelcake.") || host.includes("readfromhome.")) return "novelfire";
  if (host.includes("jadescrolls.com")) return "jadescrolls";
  if (host.includes("snowytranslations.com")) return "snowytranslations";
  if (host.includes("novgo.")) return "novgo";
  if (host.includes("zenithtls.com")) return "zenithtls";
  if (host.includes("hako.vn") || host.includes("docln.")) return "hako";
  if (host.includes("tianyabooks.com")) return "tianya";
  if (host.includes("novelbuddy.")) return "novelbuddy";
  if (host.includes("crescentmoon.blog") || host.includes("ikigainovels.wordpress.com")) return "crescentmoon";
  if (host.includes("novelarrow.com")) return "novelarrow";
  if (host.includes("readnovelfull.")) return "readnovelfull";
  if (host.includes("novelfull.net")) return "novelfullnet";
  if (host.includes("novelfull.com")) return "novelfullcom";
  if (host.includes("novelfull.")) return "novelfull";
  if (host.includes("wtr-lab.com")) return "wtrlab";
  if (host.includes("wattpad.com")) return "wattpad";
  if (host.includes("novelhi.com")) return "novelhi";
  if (host.includes("foxteller.com")) return "foxteller";
  if (host === "m.88xiaoshuo.net") return "xpaoshuba";
  if (host === "m.ilwxs.com") return "ilwxsm";
  if (host === "m.metanovel.org") return "metanovel";
  if (host.includes("creative-novels.com")) return "creativenovels";
  if (host.includes("readnovelmtl.com")) return "readnovelmtl";
  if (host.includes("shanghaifantasy.com")) return "shanghaifantasy";
  if (host.includes("alicesw.")) return "alicesw";
  if (host.includes("matchanovels.com")) return "matchanovels";
  // New sites
  if (host === "wuxiaworld.com" || host.endsWith(".wuxiaworld.com")) return "wuxiaworld";
  if (host.includes("inkitt.com")) return "inkitt";
  if (host === "akknovel.com") return "readlightnovel";
  if (host.includes("literotica.com")) return "literotica";
  if (host.includes("69shuba.com")) return "69shuba";
  if (host.includes("novelight.net")) return "novelight";

  for (const [re, key] of MAJOR_SITES) {
    if (re.test(host)) return key;
  }
  return "generic";
}



// --- JonaxxStories (jonaxxstories.com): WordPress comment machinery leaks
// into the swept TOC — the a.comment-reply-link "Reply" anchor
// (?replytocom={id}#respond, plus bare #respond self-links), #comment-
// permalinks, ?share= links, and
// /amp/ + /feed/ self-variants of a post URL. Filter them from whatever
// route produced the list (cleanup only; the book landing page carries no
// fuller list to walk).
function cleanJonaxxToc(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    let url = item.url || '';
    if (!url) continue;
    if (url.includes('replytocom') || url.includes('#comment-') || url.includes('#respond') || url.includes('?share=')) continue;
    url = url.replace(/\/(amp|feed)\/?$/, '/');
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ ...item, url });
  }
  return out;
}

/** Returns [{ url, title }]. */
export async function fetchChapterLinks(tocUrl, linkSelector = "") {
  const key = siteKey(new URL(tocUrl).hostname);
  const isJonaxx = new URL(tocUrl).hostname.includes("jonaxxstories.com");
  const dedicated = async () => {
    switch (key) {
      case "freewebnovel":
        return tocFreeWebNovel(tocUrl);
      case "novelfire":
        return tocNovelFire(tocUrl);
      case "jadescrolls":
        return tocJadeScrolls(tocUrl);
      case "snowytranslations":
        return tocSnowyTranslations(tocUrl);
      case "novgo":
        return tocNovGo(tocUrl);
      case "novelbuddy":
        return tocNovelBuddy(tocUrl);
      case "crescentmoon":
        return tocCrescentMoon(tocUrl);
      case "novelarrow":
        return tocNovelArrow(tocUrl);
      case "novelfullnet":
      case "novelfullcom":
      case "novelfull":
        return tocNovelFull(tocUrl);
      case "wtrlab":
        return tocWtrLab(tocUrl);
      case "wattpad":
        return tocWattpad(tocUrl);
      case "hako":
        return tocHako(tocUrl);
      case "tianya":
        return tocTianya(tocUrl);
      case "scribblehub":
        return tocScribbleHub(tocUrl);
      case "fanfiction":
        return tocFanFiction(tocUrl);
      case "parahumans":
        return tocParahumans(tocUrl);
      case "lightnovelworld":
        return tocLightNovelWorld(tocUrl);
      case "ranobes":
        return tocRanobes(tocUrl);
      case "webnovel":
        return tocWebnovel(tocUrl);
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
      case "wuxiaworld_eu":
        return tocWuxiaWorldEu(tocUrl);
      case "bakatsuki":
        return tocBakaTsuki(tocUrl);
      case "alphapolis":
        return tocAlphapolis(tocUrl);
      case "libread":
        return tocLibread(tocUrl);
      case "naver":
        return tocNaver(tocUrl);
      case "novelceo":
        return tocNovelCeo(tocUrl);
      case "nineheavens":
        return tocNineHeavens(tocUrl);
      case "lnmtl":
        return tocLnmtl(tocUrl);
      case "novelbinmirror":
        return tocNovelBinMirror(tocUrl);
      case "ttshu8":
        return tocTtshu8(tocUrl);
      case "xpaoshuba":
        return tocXpaoshuba(tocUrl);
      case "ilwxsm":
        return tocIlwxsMobile(tocUrl);
      case "quanben":
        return tocQuanben(tocUrl);
      case "woopread":
        return tocWoopRead(tocUrl);
      case "metanovel":
        return tocMetanovel(tocUrl);
      case "konkon":
        return tocKonkon(tocUrl);
      case "tomotranslations":
        return tocTomoTranslations(tocUrl);
      case "shmtranslations":
        return tocShmTranslations(tocUrl);
      case "novelversetl":
        return tocNovelVerseTranslations(tocUrl);
      case "zirusmusings":
        return tocZirusMusings(tocUrl);
      case "pawread":
        return tocPawRead(tocUrl);
      case "teanovel":
        return tocTeanovel(tocUrl);
      case "wetriedtls":
        return tocWeTriedTls(tocUrl);
      case "ckanda":
        return tocCkandaWrites(tocUrl);
      case "snoutandco":
        return tocSnoutAndCo(tocUrl);
      case "jonaxx":
        return tocJonaxxStories(tocUrl);
      case "tigertl":
        return tocTigerTranslations(tocUrl);
      case "universalnovel":
        return tocUniversalNovel(tocUrl);
      case "wtnovels":
        return tocWtNovels(tocUrl);
      case "twkan":
        return tocTwkan(tocUrl);
      case "novel543":
        return tocNovel543(tocUrl);
      case "novelingua":
        return tocNovelingua(tocUrl);
      case "scifistories":
        return tocScifiStories(tocUrl);
      case "ontimestory":
        return tocOntimestory(tocUrl);
      case "asianovel":
        return tocAsianovel(tocUrl);
      case "sonako":
        return tocSonako(tocUrl);
      case "neobook":
        return tocNeobook(tocUrl);
      case "truyennhabo":
        return tocTruyenNhabo(tocUrl);
      case "mvlempyr":
        return tocMvlempyr(tocUrl);
      case "timotxt":
        return tocTimotxt(tocUrl);
      case "wuxiaclick":
        return tocWuxiaClick(tocUrl);
      case "xenforo":
        return tocXenForo(tocUrl);
      case "creativenovels":
        return tocCreativeNovels(tocUrl);
      case "novelhi":
        return tocNovelHi(tocUrl);
      case "jjwxc":
        return tocJjwxc(tocUrl);
      case "pixivnovel":
        return tocPixivNovel(tocUrl);
      case "storiesonline":
        return tocStoriesOnline(tocUrl);
      case "ficwad":
        return tocFicwad(tocUrl);
      case "readnovelmtl":
        return tocReadNovelMtl(tocUrl);
      case "shanghaifantasy":
        return tocShanghaiFantasy(tocUrl);
      case "alicesw":
        return tocAlicesw(tocUrl);
      case "matchanovels":
        return tocMatchaNovels(tocUrl);
      // New sites
      case "wuxiaworld":
        return tocWuxiaWorld(tocUrl);
      case "inkitt":
        return tocInkitt(tocUrl);
      case "readlightnovel":
        return tocReadLightNovel(tocUrl);
      case "literotica":
        return tocLiterotica(tocUrl);
      case "69shuba":
        return toc69shuba(tocUrl);
      case "novelight":
        return tocNovelight(tocUrl);

      default:
        return [];
    }
  };

  if (key !== "generic") {
    try {
      const items = await dedicated();
      if (items?.length) return isJonaxx ? cleanJonaxxToc(items) : items;
    } catch (e) {
      // A proven bot wall applies to every fallback too — don't re-churn.
      if (e?.blocked) throw e;
      console.warn("[fetcher] dedicated TOC parser failed", key, e?.message || e);
    }
  }

  // Unknown site, or the dedicated parser came back empty: config selectors,
  // then AI-detected selectors, then a raw same-origin link sweep.
  const config = lookupSiteConfig(new URL(tocUrl).hostname);
  const items = await tocFromConfig(tocUrl, config, linkSelector).catch((e) => {
    if (e?.blocked) throw e;
    return [];
  });
  if (items.length) return isJonaxx ? cleanJonaxxToc(items) : items;
  const doc = parseHtml(await getText(tocUrl));
  const swept = collectTocLinks(doc, tocUrl, [linkSelector || "a[href]"]);
  return isJonaxx ? cleanJonaxxToc(swept) : swept;
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
      case "freewebnovel":
        return bodyFreeWebNovel(chapterUrl);
      case "novelfire":
        return bodyNovelFire(chapterUrl);
      case "jadescrolls":
        return bodyJadeScrolls(chapterUrl);
      case "snowytranslations":
        return bodySnowyTranslations(chapterUrl);
      case "novgo":
        return bodyNovGo(chapterUrl);
      case "novelbuddy":
        return bodyNovelBuddy(chapterUrl);
      case "crescentmoon":
        return bodyGeneric(chapterUrl, ".entry-content");
      case "novelarrow":
        return bodyNovelArrow(chapterUrl);
      case "wattpad":
        return bodyWattpad(chapterUrl);
      case "wtrlab":
        return bodyWtrLab(chapterUrl);
      case "hako":
        return bodyHako(chapterUrl);
      case "tianya":
        return bodyTianya(chapterUrl);
      case "zenithtls":
        return bodyGeneric(chapterUrl, '.chapter__content, article, .entry-content');
      case "readnovelmtl":
        return bodyReadNovelMtl(chapterUrl);
      case "shanghaifantasy":
        return bodyShanghaiFantasy(chapterUrl);
      case "alicesw":
        return bodyGeneric(chapterUrl, ".read-content, .j_readContent");
      case "matchanovels":
        return bodyGeneric(chapterUrl, ".mn-lector");
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
      case "ixdzs8":
        return bodyIxdzs8(chapterUrl);
      case "novelhi":
        return bodyNovelHi(chapterUrl);
      case "foxteller":
        return bodyFoxteller(chapterUrl);
      case "piaotia":
        return bodyPiaotia(chapterUrl);
      case "quanben":
        return bodyQuanben(chapterUrl);
      case "konkon":
        return bodyKonkon(chapterUrl);
      case "snoutandco":
        return bodySnoutAndCo(chapterUrl);
      case "novel543":
        return bodyNovel543(chapterUrl);
      case "readingpia":
        return bodyReadingpia(chapterUrl);
      case "neobook":
        return bodyNeobook(chapterUrl);
      case "novelight":
        return bodyNovelight(chapterUrl);

      default:
        if (MAJOR_BODY_SELECTORS[key]) {
          return bodyGeneric(chapterUrl, contentSelector || MAJOR_BODY_SELECTORS[key]);
        }
        return bodyGeneric(chapterUrl, contentSelector);
    }
  };

  const textLen = (h) => (h ? h.replace(/<[^>]+>/g, "").trim().length : 0);
  const enough = (h) => textLen(h) >= 20;
  // Some parsers already retry internally against metered APIs (WTR-LAB makes
  // up to 5 reader calls per attempt) — restarting those from this outer loop
  // multiplies straight into the site's rate limit, so they get one attempt.
  const maxAttempts = key === "wtrlab" ? 1 : 3;
  let last = "";
  let thinTries = 0;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const html = await attempt();
      if (enough(html)) return html;
      if (textLen(html) > 0) {
        // The parser DID return content — the chapter is genuinely short (an
        // author's note, a prologue card). Re-downloading cannot change that:
        // allow one second chance in case the first hit was a partial page,
        // then accept the longest version instead of burning more requests.
        if (textLen(html) > textLen(last)) last = html;
        if (++thinTries >= 2) break;
      }
    } catch (e) {
      if (e?.blocked) throw e; // bot wall — retrying cannot help
      /* retry */
    }
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  // Only when the parser produced nothing at all (site changed its markup) —
  // retry through the generic path, which includes the AI selector fallback.
  if (!last && key !== "generic") {
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
  // Ridibooks series pages render the book header (title / author / cover)
  // into __NEXT_DATA__; read the meta from there.
  try {
    if (new URL(tocUrl).hostname.includes("ridibooks.com")) {
      const { header, html } = await ridiSeriesPage(ridiSeriesId(tocUrl));
      const info = (header && header.information) || {};
      const title = (info.title && info.title.title) || "";
      const authors = [];
      for (const g of info.authorGroups || [])
        for (const a of g.authors || []) if (a.name) authors.push(a.name);
      const cover =
        (header &&
          header.thumbnail &&
          header.thumbnail.cover &&
          (header.thumbnail.cover.xxlarge || header.thumbnail.cover.large)) ||
        "";
      const ogDesc = (html.match(/property="og:description" content="([^"]*)"/) || [])[1] || "";
      if (title) {
        return {
          title,
          author: authors.join(", "),
          cover,
          description: ogDesc
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
            .trim(),
        };
      }
    }
  } catch {
    /* fall through to HTML scraping */
  }
  // JadeScrolls pages are client-side shells with no book meta in the HTML;
  // take the meta from the same API the TOC parser uses.
  try {
    if (new URL(tocUrl).hostname.includes("jadescrolls.com")) {
      const slug = new URL(tocUrl).pathname.split("/").filter(Boolean)[1];
      if (slug) {
        const novel = await jadescrollsNovel(slug);
        return {
          title: novel.title || "",
          author: novel.author_name || "",
          cover: novel.cover_image || "",
          description: String(novel.synopsis || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        };
      }
    }
  } catch {
    /* fall through to HTML scraping */
  }
  // NovelBuddy pages are client-side shells with no book meta in the HTML;
  // take the meta from the same API the TOC parser uses.
  try {
    const host = new URL(tocUrl).hostname;
    if (host.includes("novelbuddy.")) {
      const id = await novelBuddyTitleId(tocUrl);
      const titleJson = await getJson(`https://api.novelbuddy.me/titles/${id}`);
      const t = titleJson?.data?.title || {};
      const authors = [...new Set((t.authors || []).map((a) => a.name).filter(Boolean))];
      if (t.name) {
        return {
          title: t.name,
          author: authors.join(", "),
          cover: t.cover || "",
          description: String(t.summary || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        };
      }
    }
  } catch {
    /* fall through to HTML scraping */
  }
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
    const pickSrc = (sels) => {
      for (const s of sels) {
        const el = doc.querySelector(s);
        const v = (
          el?.getAttribute?.("content") ||
          el?.getAttribute?.("src") ||
          el?.getAttribute?.("data-src") ||
          ""
        ).trim();
        if (v) {
          try {
            return new URL(v, tocUrl).href;
          } catch {
            return v;
          }
        }
      }
      return "";
    };
    return {
      // NovelFull-family pages have no og:title and their first <h1> is the
      // genre link (e.g. "Action"), while the real title is <h3 class="title">.
      title: pick(['meta[property="og:title"]', 'meta[name="twitter:title"]', ".desc h3.title", "h3.title", "h1", "title"]),
      author: pick(['meta[property="og:novel:author"]', '[itemprop="author"]', ".author a", 'a[href*="/author/"]', ".author"]),
      cover: pickSrc(['meta[property="og:image"]', ".book img", ".book-img img", ".novel-cover img", "img.cover"]),
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
