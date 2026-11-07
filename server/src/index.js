// Link to EPUB — server-side conversion API.
// Jobs run on the dyno and keep going after the browser tab closes.
import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  fetchChapterLinks,
  fetchChapterContent,
  fetchWholePage,
  fetchBookMeta,
  mapPool,
  supportedDomains,
  lookupSiteConfig,
  stealthGet,
  smartGetText,
  siteKey,
  detectChapterSelectors,
  searchLncrawl,
  lncrawlAuthHeader,
} from "./fetcher.js";
import { buildEpub, sanitizeFilename, writeChapterFile, countEpubChapters, epubTitle } from "./epub.js";
import { createWorkPool, DEFAULT_MAX_ACTIVE_JOBS } from "./workPool.js";
import { uploadToLibrary, libraryEnabled, deleteFromLibrary, downloadFromLibrary } from "./library.js";
import { sendEpub } from "./download.js";
import { getLibraryIndex, startLibraryIndex, refreshLibraryIndex } from "./libraryIndex.js";


const app = express();
app.use(cors({ origin: true, exposedHeaders: ["Content-Disposition"] }));
app.use(compression());
app.use(express.json({ limit: "10mb" }));

// Handle invalid JSON payload errors gracefully (e.g. probes/bots sending non-JSON body)
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 16);
const chapterPool = createWorkPool(Number(process.env.GLOBAL_FETCH_CONCURRENCY || 40));
const packingPool = createWorkPool(1);
const uploadPool = createWorkPool(1);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 6 * 60 * 60 * 1000); // 6h
// Raw translation jobs stay downloadable for 24h, not 6h: a book the
// community library refuses (under 100 KB) must still be
// downloadable from linktoepub for a full day after it finishes.
const RAW_JOB_TTL_MS = Number(process.env.RAW_JOB_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const OUT_DIR = path.join(os.tmpdir(), "link-to-epub");
fs.mkdirSync(OUT_DIR, { recursive: true });

/** jobId -> job */
const jobs = new Map();
/** jobId -> the original request, so a restarted server can resume the work. */
const jobSpecs = new Map();

// Jobs survive dyno/Space restarts: state + request are mirrored to disk and
// anything that was still running is picked up again on boot.
const STATE_DIR = process.env.JOB_STATE_DIR || path.join(OUT_DIR, "state");
fs.mkdirSync(STATE_DIR, { recursive: true });

const lastPersist = new Map();

function persistJob(job, force = false) {
  const now = Date.now();
  if (!force && now - (lastPersist.get(job.id) || 0) < 3000) return;
  lastPersist.set(job.id, now);
  const spec = jobSpecs.get(job.id) || null;
  fs.promises
    .writeFile(path.join(STATE_DIR, `${job.id}.json`), JSON.stringify({ job, spec }))
    .catch(() => {});
}

function forgetJob(id) {
  jobs.delete(id);
  jobSpecs.delete(id);
  lastPersist.delete(id);
  fs.promises.unlink(path.join(STATE_DIR, `${id}.json`)).catch(() => {});
}

function publicJob(job) {
  const { file, chapters, ...rest } = job;
  return { ...rest, ready: job.status === "done" };
}

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const ttl = job.kind === "raw" ? RAW_JOB_TTL_MS : JOB_TTL_MS;
    if (now - job.updatedAt > ttl) {
      if (job.file) fs.promises.unlink(job.file).catch(() => {});
      forgetJob(id);
    }
  }
}
setInterval(cleanup, 10 * 60 * 1000).unref();

app.get("/health", (_req, res) => res.json({ ok: true, jobs: jobs.size, uptime: process.uptime(), runningJobs: activeJobs, queuedJobs: jobQueue.length, maxActiveJobs: MAX_ACTIVE_JOBS, chapterFetches: chapterPool.active }));

// ---- Live stats (active jobs + active users) -------------------------------
const visitors = new Map(); // visitorId -> lastSeen ms
const VISITOR_TTL_MS = 90 * 1000;

app.get("/api/library", async (req, res) => {
  try {
    const idx = await getLibraryIndex();
    if (!idx) return res.status(503).json({ error: "library list not ready" });
    res.set("Cache-Control", "public, max-age=60");
    res.json(idx);
  } catch (e) {
    res.status(503).json({ error: String(e?.message || e) });
  }
});

// Community share: a forum reader uploads an EPUB for a book request and the
// file is committed to the shared library so everyone can download it. The
// raw request body IS the EPUB; the book title and sharer name travel in
// headers. Public by design (the forum has no accounts), so validate the
// file properly and throttle per connection.
function isEpubBuffer(buf) {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return false; // "PK" zip magic
  const probe =
    buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString("latin1") +
    buf.subarray(Math.max(0, buf.length - 128 * 1024)).toString("latin1");
  return probe.includes("application/epub+zip") && probe.includes("META-INF/container.xml");
}

/** Same title key the library UI dedupes by (bridge.ts).
 * Unicode-aware (2026-11-01, /raw fix): the old ASCII-only
 * [^a-z0-9] key collapsed every CJK title to "" so Japanese /
 * Korean / Chinese books could never match a stored copy —
 * duplicate detection and "already available" suggestions
 * silently never fired for them. */
const libraryTitleKey = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Title for a stored library file, mirroring prettyTitleFromPath in bridge.ts. */
function titleFromLibraryPath(p) {
  const file = String(p || "").split("/").pop() || "";
  return file
    .replace(/\.epub(\.txt)?$/i, "")
    .replace(/-[a-z0-9]{6}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** All stored EPUBs whose derived title matches the given book title. */
async function findLibraryCopies(title) {
  const key = libraryTitleKey(title);
  if (!key) return [];
  const idx = await getLibraryIndex();
  if (!idx || !Array.isArray(idx.f)) return [];
  return idx.f
    .filter(([p]) => /\.epub$/i.test(p) && libraryTitleKey(titleFromLibraryPath(p)) === key)
    .map(([p, size]) => ({ path: p, size: typeof size === "number" ? size : 0 }));
}

const shareAttempts = new Map(); // ip -> [timestamps]
app.post("/api/library/share", express.raw({ type: "*/*", limit: "45mb" }), async (req, res) => {
  try {
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    const now = Date.now();
    const hits = (shareAttempts.get(ip) || []).filter((t) => now - t < 3600_000);
    if (hits.length >= 10) {
      return res.status(429).json({ error: "Too many uploads from this connection — please try again in an hour." });
    }
    hits.push(now);
    shareAttempts.set(ip, hits);

    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: "No file received." });
    if (!isEpubBuffer(buf)) return res.status(400).json({ error: "That file is not a valid EPUB." });

    const title = decodeURIComponent(String(req.headers["x-book-title"] || "Shared Book")).slice(0, 160);
    const by = decodeURIComponent(String(req.headers["x-shared-by"] || "Reader")).slice(0, 60);

    // Duplicate handling: if the library already holds this title, don't
    // store another copy. The upload replaces the stored copies only when
    // it is strictly better on BOTH measures the owner cares about — a
    // bigger file AND more chapters than the biggest stored copy. Any doubt
    // (unreadable EPUB, unknown chapter counts, index unavailable) keeps
    // the stored copy and simply thanks the sharer.
    const copies = await findLibraryCopies(title).catch((e) => {
      console.warn("[library-share] copy lookup failed:", e.message);
      return [];
    });
    if (copies.length) {
      const biggest = copies.reduce((a, b) => (b.size > a.size ? b : a));
      let better = false;
      let newChapters = 0;
      let oldChapters = 0;
      if (buf.length > biggest.size) {
        newChapters = await countEpubChapters(buf);
        if (newChapters > 0) {
          const existing = await downloadFromLibrary(biggest.path).catch(() => null);
          if (existing) {
            oldChapters = await countEpubChapters(existing);
            better = oldChapters > 0 && newChapters > oldChapters;
          }
        }
      }
      if (!better) {
        return res.json({
          ok: true,
          action: "duplicate",
          path: biggest.path,
          url: `https://huggingface.co/datasets/prasaduser/webtoepub-library/resolve/main/${biggest.path}?download=true`,
        });
      }
      // Save the better copy first, then remove the old ones, so the title
      // is never missing from the library in between.
      const out = await uploadToLibrary(buf, `${title}.epub`, { title, source: "forum-share", author: by });
      const removed = [];
      for (const c of copies) {
        try {
          await deleteFromLibrary(c.path);
          removed.push(c.path);
        } catch (e) {
          console.error("[library-share] failed to remove old copy", c.path, e.message);
        }
      }
      refreshLibraryIndex();
      return res.json({ ok: true, action: "replaced", path: out.path, url: out.url, removed, newChapters, oldChapters });
    }

    const out = await uploadToLibrary(buf, `${title}.epub`, { title, source: "forum-share", author: by });
    refreshLibraryIndex();
    res.json({ ok: true, action: "saved", path: out.path, url: out.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/stats", (req, res) => {
  const now = Date.now();
  const uid = String(req.query.uid || "").slice(0, 64);
  const origin = String(req.query.origin || "").toLowerCase();

  // Track the visitor
  if (uid) visitors.set(uid, now);

  // Clean up stale visitors
  for (const [id, seen] of visitors) {
    if (now - seen > VISITOR_TTL_MS) visitors.delete(id);
  }

  // Active jobs: global across all origins (server-wide)
  let activeJobs = 0;
  for (const job of jobs.values()) {
    if (job.status === "queued" || job.status === "running") activeJobs++;
  }

  // Active users: total global users across all domains
  const globalUsers = Math.max(visitors.size, uid ? 1 : 0);

  res.json({
    activeJobs,
    activeUsers: globalUsers,
    totalJobs: jobs.size
  });
});


// Every domain the backend can parse (hand-written parsers + the generated
// selector table extracted from the WebToEpub parser library).
app.get("/api/sites", (_req, res) => {
  const domains = supportedDomains();
  res.json({ count: domains.length, domains });
});

// Selector config for one host, useful for debugging an unsupported site.
app.get("/api/sites/lookup", (req, res) => {
  const url = String(req.query.url || "");
  let hostname = url;
  try {
    hostname = new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    /* treat the input as a bare hostname */
  }
  res.json({ hostname, config: lookupSiteConfig(hostname) });
});

// Search the lncrawl catalogue (existing novels only — no cross-source
// search job). Uses the server-held lncrawl login (LNCRAWL_EMAIL /
// LNCRAWL_PASSWORD in the server config).
app.get("/api/lncrawl/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "10"), 10) || 10, 1),
      50
    );
    const results = await searchLncrawl(q, limit);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── CORS proxy ────────────────────────────────────────────────────────────────
// The browser can't fetch most novel sites directly due to CORS restrictions.
// This endpoint forwards the raw response so the browser's WebToEpub engine
// (with all 386 parsers) can process the HTML/JSON locally.
// Replaces the need for third-party public CORS proxies.
// Few slow backup fetches at once, so one blocked site never stalls a search.
let proxyFallbacks = 0;
app.get("/api/proxy", async (req, res) => {
  const target = String(req.query.url || "");
  if (!target) return res.status(400).json({ error: "url required" });
  try {
    const url = new URL(target); // validate
    if (!["http:", "https:"].includes(url.protocol)) {
      return res.status(400).json({ error: "only http/https allowed" });
    }
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // Lncrawl's API needs auth; the server holds the login (Heroku
    // config), so inject it here for the browser engine's parser calls.
    // The credential never reaches the browser.
    let lncrawlAuth = null;
    try {
      if (new URL(target).hostname === "lncrawl.bitanon.dev") {
        lncrawlAuth = lncrawlAuthHeader();
      }
    } catch {
      /* invalid url already handled above */
    }
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        ...(req.headers["x-proxy-cookie"] ? { Cookie: String(req.headers["x-proxy-cookie"]) } : {}),
        ...(lncrawlAuth ? { Authorization: lncrawlAuth } : {}),
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // Forward content-type so browser parses correctly
    const ct = upstream.headers.get("content-type") || "text/html";
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buf = Buffer.from(await upstream.arrayBuffer());
    const blocked = upstream.status === 403 || upstream.status === 429 || upstream.status >= 500 ||
      /<title>Just a moment|cf-chl|challenge-platform/i.test(buf.subarray(0, 4000).toString());
    if (blocked && proxyFallbacks < 6) {
      proxyFallbacks++;
      try {
        const html = await smartGetText(target, 5000, 7000);
        if (html && !/<title>Just a moment/i.test(html.slice(0, 4000))) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.status(200).send(html);
        }
      } catch {} finally { proxyFallbacks--; }
    }
    res.status(upstream.status);
    res.send(buf);
  } catch (e) {
    clearTimeout(timer);
    if (proxyFallbacks < 6) try {
      proxyFallbacks++;
      const html = await smartGetText(target, 5000, 7000);
      proxyFallbacks--;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch { proxyFallbacks--; }
    res.status(502).json({ error: e.message });
  }
});

// Stealth fetch (curl_cffi TLS fingerprint / cloudscraper / Tor).
// Available where the Python sidecar runs (Hugging Face image); the Heroku
// dyno calls this endpoint remotely so both backends get the same power.
app.get("/api/stealth", async (req, res) => {
  const target = String(req.query.url || "");
  try {
    const u = new URL(target);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  const tor = String(req.query.tor || "auto");
  const timeout = Math.min(Number(req.query.timeout) || 45, 90) * 1000;
  try {
    const html = await stealthGet(target, timeout, tor);
    if (!html) return res.status(502).json({ error: "stealth routes exhausted" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(html);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Also handle POST proxying (needed for API-style parser endpoints)
app.post("/api/proxy", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
  const target = String(req.query.url || "");
  if (!target) return res.status(400).json({ error: "url required" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Content-Type": req.headers["content-type"] || "application/json",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(req.headers["x-proxy-cookie"] ? { Cookie: String(req.headers["x-proxy-cookie"]) } : {}),
        ...(req.headers["x-proxy-origin"] ? { Origin: String(req.headers["x-proxy-origin"]), Referer: String(req.headers["x-proxy-origin"]) + "/" } : {}),
      },
      body: req.body,
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ct = upstream.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(upstream.status);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: e.message });
  }
});

// Fast TOC listing — streams chapter batches via NDJSON so Heroku's 30 s
// router timeout is never hit. Each line is a JSON object:
//   {"type":"chapters", "items":[{url,title},...]}  — zero or more times
//   {"type":"meta",     ...}                          — once
//   {"type":"done"}                                   — always last
// The legacy GET /api/toc still works but buffers all chapters first (kept
// for backward-compat with older front-end versions).
// Short-lived TOC cache shared by the stream and legacy endpoints. The
// client falls back from the stream to /api/toc whenever the stream errors
// or stalls; without this, that fallback re-crawls every TOC page (and every
// site request) from scratch seconds after the first crawl finished.
const tocCache = new Map(); // key -> { at, promise }
function getTocCached(url, selector) {
  const key = `${url}\n${selector || ""}`;
  const hit = tocCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.promise;
  const promise = Promise.all([fetchChapterLinks(url, selector), fetchBookMeta(url)]).then(
    ([chapters, meta]) => ({ chapters, meta })
  );
  tocCache.set(key, { at: Date.now(), promise });
  // A failed crawl is only worth reusing for ~10s (long enough for the
  // client's immediate fallback, short enough not to mask a recovery).
  promise.catch(() => {
    const cur = tocCache.get(key);
    if (cur && cur.promise === promise) cur.at = Date.now() - 50_000;
  });
  if (tocCache.size > 50) tocCache.delete(tocCache.keys().next().value);
  return promise;
}

app.get("/api/toc/stream", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) {
    res.status(400).json({ error: "url required" });
    return;
  }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const flush = (obj) => res.write(JSON.stringify(obj) + "\n");
  // Heroku drops a response that sends no bytes for 55s (H15), which made the
  // browser give up and fetch the chapter list again. Keep it alive.
  flush({ type: "ping" });
  const heartbeat = setInterval(() => flush({ type: "ping" }), 15_000);

  try {
    const { chapters, meta } = await getTocCached(url, String(req.query.selector || ""));
    // Send in batches of 100 so the client can start showing chapters early.
    const BATCH = 100;
    for (let i = 0; i < chapters.length; i += BATCH) {
      flush({ type: "chapters", items: chapters.slice(i, i + BATCH) });
    }
    flush({ type: "meta", ...meta });
  } catch (e) {
    flush({ type: "error", message: e.message });
  }
  clearInterval(heartbeat);
  flush({ type: "done" });
  res.end();
});

// Legacy buffered endpoint (kept for compat — times out on very large TOCs).
app.get("/api/toc", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ error: "url required" });
    // Heroku's router kills requests at 30s with an HTML 503, leaving the
    // client hanging; answer with JSON before that so it can fall back fast.
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(Object.assign(new Error("Site took too long to respond"), { code: 504 })), 24_000)
    );
    const toc = getTocCached(url, String(req.query.selector || ""));
    const chapters = await Promise.race([toc.then((r) => r.chapters), timeout]);
    const meta = await Promise.race([
      toc.then((r) => r.meta).catch(() => ({})),
      new Promise((r) => setTimeout(() => r({}), 3000)),
    ]);
    res.json({ chapters, meta });
  } catch (e) {
    if (!res.headersSent) res.status(e.code === 504 ? 504 : 500).json({ error: e.message });
  }
});

// Single chapter (used by the live reader)
app.get("/api/chapter", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ error: "url required" });
    const content = await fetchChapterContent(url, String(req.query.selector || ""));
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start a conversion job
app.post("/api/jobs", async (req, res) => {
  const {
    tocUrl = "",
    chapters: providedChapters,
    metadata = {},
    options = {},
    selector = "",
  } = req.body || {};

  if (!tocUrl && !Array.isArray(providedChapters)) {
    return res.status(400).json({ error: "tocUrl or chapters required" });
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    phase: "Queued",
    total: Array.isArray(providedChapters) ? providedChapters.length : 0,
    completed: 0,
    failed: 0,
    title: metadata.title || "Untitled",
    error: null,
    size: 0,
    filename: `${sanitizeFilename(metadata.title || "book")}.epub`,
    file: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const spec = { tocUrl, providedChapters, metadata, options, selector };
  jobs.set(id, job);
  jobSpecs.set(id, spec);
  persistJob(job, true);
  res.status(202).json(publicJob(job));

  startJob(job, spec);
});

// Keep 40 jobs moving; shared fetch/packing pools bound the expensive work.
const MAX_ACTIVE_JOBS = Number(process.env.MAX_ACTIVE_JOBS || DEFAULT_MAX_ACTIVE_JOBS);
let activeJobs = 0;
const JOB_IDLE_MS = Number(process.env.JOB_IDLE_MS || 5 * 60 * 1000);
const JOB_MAX_MS = Number(process.env.JOB_MAX_MS || 60 * 60 * 1000);
const jobQueue = [];
function pumpJobs() {
  while (activeJobs < MAX_ACTIVE_JOBS && jobQueue.length) {
    const { job, spec } = jobQueue.shift();
    if (job.status === "cancelled") continue;
    activeJobs++;
    // Free the slot even if a fetch hangs forever, or when a job sits idle.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearInterval(watchdog);
      activeJobs--;
      jobSpecs.delete(job.id);
      if (global.gc) try { global.gc(); } catch { /* ignore */ }
      pumpJobs();
    };
    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const idle = Date.now() - (job.updatedAt || startedAt);
      const total = Date.now() - startedAt;
      if (job.status === "cancelled" || idle > JOB_IDLE_MS || total > JOB_MAX_MS) {
        job.stopped = true;
        if (job.status !== "done" && job.status !== "cancelled") {
          job.status = "error";
          job.error = idle > JOB_IDLE_MS ? "Stalled: no progress for too long" : "Took too long";
          job.updatedAt = Date.now();
          persistJob(job, true);
        }
        release();
      }
    }, 15000);
    runJob(job, spec)
      .catch((e) => {
        if (released) return;
        job.status = "error";
        job.error = e.message;
        job.updatedAt = Date.now();
        persistJob(job, true);
      })
      .finally(release);
  }
}
function startJob(job, spec) {
  jobQueue.push({ job, spec });
  if (activeJobs >= MAX_ACTIVE_JOBS) {
    job.phase = `queued (${jobQueue.length} ahead)`;
    job.updatedAt = Date.now();
  }
  pumpJobs();
  return Promise.resolve();
}

/** A spooled chapter file counts as reusable only if a previous run wrote it
 * completely (chapter files are full XHTML documents). */
async function spoolIsComplete(file) {
  try {
    const fh = await fs.promises.open(file, "r");
    try {
      const st = await fh.stat();
      if (st.size < 100) return false;
      const buf = Buffer.alloc(32);
      await fh.read(buf, 0, 32, st.size - 32);
      return buf.toString("utf8").includes("</html>");
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

async function runJob(job, spec) {
  const chapterDir = path.join(OUT_DIR, `${job.id}-chapters`);
  await fs.promises.mkdir(chapterDir, { recursive: true });
  // Heartbeat: job.updatedAt must keep moving while ANY chapter is in flight,
  // not only when one completes — a single slow chapter (multi-route fetches,
  // long timeouts) could otherwise exceed the idle limit and get the whole
  // job marked "stalled" while it is actively downloading.
  const heartbeat = setInterval(() => {
    job.updatedAt = Date.now();
  }, 30_000);
  try {
    await convertJob(job, spec, chapterDir);
  } finally {
    clearInterval(heartbeat);
    await fs.promises.rm(chapterDir, { recursive: true, force: true });
  }
}

async function convertJob(job, { tocUrl, providedChapters, metadata, options, selector }, chapterDir) {
  const stopped = () => job.cancelled || job.stopped;
  const touch = () => {
    job.updatedAt = Date.now();
    persistJob(job);
  };

  job.status = "running";
  job.phase = "Fetching chapter list";
  touch();

  let list = Array.isArray(providedChapters) && providedChapters.length
    ? providedChapters.map((c, i) =>
        typeof c === "string" ? { url: c, title: `Chapter ${i + 1}` } : c
      )
    : await fetchChapterLinks(tocUrl, selector);

  if (stopped()) return job.cancelled ? finishCancelled(job) : undefined;

  const range = options.chapterRange;
  if (range && !range.useAll) {
    list = list.slice(Math.max(0, (range.start || 1) - 1), range.end || list.length);
  }

  if (!list.length) throw new Error("No chapters found for this URL");

  // Differential chapter-selector detection (generic hosts only, no
  // user-supplied selector): compare the first two chapters - page
  // furniture is identical on both, so the container whose text actually
  // differs IS the chapter content. The detected selector is then used
  // for every chapter in this job. Best-effort: any failure falls back
  // to the normal per-chapter path.
  // The main URL is chapter 1 on undefined-parser hosts, but it is a
  // landing page, not a chapter page - never compare it, and never apply
  // a chapter selector to it (it downloads whole, with no selector).
  const normJobUrl = (u) => String(u || "").split("#")[0].replace(/\/$/, "");
  const isMainUrl = (u) => normJobUrl(u) === normJobUrl(tocUrl);
  const realChapters = list.filter((c) => !isMainUrl(c.url));
  let detectedSelector = "";
  if (!selector && realChapters.length >= 2) {
    try {
      const host = new URL(realChapters[0].url).hostname;
      if (siteKey(host) === "generic") {
        const detected = await detectChapterSelectors(realChapters[0].url, realChapters[1].url);
        if (detected?.content) {
          detectedSelector = detected.content;
          job.phase = `Detected chapter selector: ${detectedSelector}`;
          touch();
        }
      }
    } catch {
      /* detection failed - proceed with the normal path */
    }
  }

  job.total = list.length;
  job.phase = `Downloading ${list.length} chapters`;
  touch();

  // snowytranslations.com throttles the server IP after a burst of its heavy
  // ~250 KB chapter pages: at full concurrency every fetch fell into the
  // multi-proxy retry cascade and the job appeared stuck (observed frozen at
  // 33 of 317 with all 16 pool slots wedged). Gentle pacing avoids the burst.
  const gentle = /snowytranslations\.com/i.test(list[0]?.url || "");
  const poolSize = gentle ? 2 : CONCURRENCY;

  const results = await mapPool(list, poolSize, async (c, i) => {

    if (stopped()) return null;
    try {
      const file = path.join(chapterDir, `${i}.xhtml`);
      // A previous run of this same job (e.g. resumed after a restart) may
      // already have downloaded this chapter — reuse the spooled file
      // instead of downloading it again.
      if (await spoolIsComplete(file)) {
        job.completed++;
        touch();
        return { title: c.title || `Chapter ${i + 1}`, file };
      }
      const saved = await chapterPool.run(async () => {
        if (stopped()) return false;
        const content = isMainUrl(c.url)
          ? await fetchWholePage(c.url)
          : await fetchChapterContent(c.url, selector || detectedSelector);
        if (stopped()) return false;
        await writeChapterFile(file, { title: c.title || `Chapter ${i + 1}`, content });
        return true;
      });
      if (!saved || stopped()) return null;
      job.completed++;
      touch();
      return { title: c.title || `Chapter ${i + 1}`, file };
    } catch {
      if (stopped()) return null;
      job.failed++;
      job.completed++;
      touch();
      return null;
    }
  });

  if (stopped()) return job.cancelled ? finishCancelled(job) : undefined;

  const chapters = results.filter(Boolean);
  if (!chapters.length) throw new Error("All chapters failed to download");

  job.phase = "Packing EPUB";
  touch();

  const file = path.join(OUT_DIR, `${job.id}.epub`);
  await packingPool.run(async () => {
    if (stopped()) return;
    touch();
    await buildEpub(chapters, metadata, options, file);
  });
  if (stopped()) {
    await fs.promises.unlink(file).catch(() => {});
    return job.cancelled ? finishCancelled(job) : undefined;
  }

  job.file = file;
  job.size = (await fs.promises.stat(file)).size;

  // Best-effort copy to the shared Hugging Face library (never fails the job).
  // Done before flipping to "done" so the client's poll sees the link.
  if (libraryEnabled()) {
    job.phase = "Saving a copy to the library";
    job.libraryStatus = "uploading";
    touch();
    try {
      const up = await uploadPool.run(async () => {
        if (stopped()) return null;
        touch();
        const buffer = await fs.promises.readFile(file);
        return uploadToLibrary(buffer, job.filename, {
          title: metadata.title,
          author: metadata.author,
          source: tocUrl,
        });
      });
      if (!up || stopped()) return job.cancelled ? finishCancelled(job) : undefined;
      job.libraryUrl = up.url;
      job.libraryPageUrl = up.pageUrl;
      job.libraryStatus = "saved";
    } catch (e) {
      console.error("Library upload failed:", e);
      job.libraryStatus = "failed";
      job.libraryError = e.message;
    }
  }

  if (stopped()) return job.cancelled ? finishCancelled(job) : undefined;
  job.status = "done";
  job.phase = "Ready to download";
  job.updatedAt = Date.now();
  persistJob(job, true);

}


function finishCancelled(job) {
  job.status = "cancelled";
  job.phase = "Cancelled";
  job.updatedAt = Date.now();
  persistJob(job, true);
}

/**
 * Restores jobs written to disk before the last restart. Finished jobs stay
 * downloadable (when the file survived); anything that was mid-flight is
 * started again from the saved request, so no conversion is lost.
 */
function restoreJobs() {
  let files = [];
  try {
    files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      const { job, spec } = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf8"));
      if (!job?.id) continue;
      const ttl = job.kind === "raw" ? RAW_JOB_TTL_MS : JOB_TTL_MS;
      if (Date.now() - (job.updatedAt || 0) > ttl) {
        forgetJob(job.id);
        continue;
      }
      // A finished job (including a raw done_with_errors job, whose
      // EPUB exists) stays as-is across restarts so its download
      // survives for the full retention window. Anything else that
      // was queued/running resumes below.
      if ((job.status === "done" || job.status === "done_with_errors") && job.file && fs.existsSync(job.file)) {
        jobs.set(job.id, job);
        if (spec) jobSpecs.set(job.id, spec);
        continue;
      }
      if (job.status === "cancelled" || job.status === "error" || !spec) {
        jobs.set(job.id, job);
        continue;
      }
      // Was queued/running (or the packed file is gone) — run it again.
      job.status = "queued";
      job.phase = "Resuming after server restart";
      job.completed = 0;
      job.failed = 0;
      job.file = null;
      job.cancelled = false;
      job.stopped = false;
      job.error = null;
      job.updatedAt = Date.now();
      jobs.set(job.id, job);
      jobSpecs.set(job.id, spec);
      startJob(job, spec);
      console.log(`[jobs] resumed ${job.id} (${job.title})`);
    } catch {
      /* skip corrupt state file */
    }
  }
}

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(publicJob(job));
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
    return res.json(publicJob(job));
  }
  job.cancelled = true;
  finishCancelled(job);
  res.json(publicJob(job));
});

app.get("/api/jobs/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  // Raw jobs also download when done_with_errors: the EPUB exists
  // (translated chapters + a notes page for the failed ones) and
  // refusing it would hide a usable book. Main jobs keep the
  // strict "done" rule.
  const downloadable =
    job && job.file && (job.status === "done" || (job.kind === "raw" && job.status === "done_with_errors"));
  if (!downloadable) {
    return res.status(404).json({ error: "epub not ready" });
  }
  sendEpub(res, job.file, job.filename);
});

// ---- /raw: direct-to-HF architecture (2026-11-01) ----------------
// The /raw frontend now talks to the Translate Me Space DIRECTLY
// for search, TOC, jobs, progress and EPUB downloads — the Space
// is the translation backend, separate from this server. The ONLY
// /raw call that still comes here is the library save below: it
// needs the library token, which must never reach the browser or
// the public Space. Everything that used to live here (proxy
// routes, job tracking, parser fallback, one-job guard, library
// suggestions) was removed when the frontend went direct.
const SPACE_ORIGIN = (process.env.TRANSLATE_SPACE_URL ||
  "https://learningtrade-translate-me.hf.space").replace(/\/$/, "");

// Library saves are idempotent per Space job: the browser and the
// server-side tracker below may both try, but a book is uploaded once.
const rawSaves = new Map(); // key -> Promise<{libraryUrl, libraryPageUrl, path}>
const RAW_SAVE_MAX = 500;

async function saveSpaceEpub(spaceFileUrl, title) {
  const u = new URL(spaceFileUrl);
  // SSRF guard: only the Translate Me Space may be fetched here.
  if (u.protocol !== "https:" || `${u.protocol}//${u.host}` !== SPACE_ORIGIN) {
    const err = new Error("spaceFileUrl must point at the Translate Me Space");
    err.status = 400;
    throw err;
  }
  const r = await fetch(spaceFileUrl, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw Object.assign(new Error(`Space EPUB download failed (${r.status})`), { status: 502 });
  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw Object.assign(new Error("spaceFileUrl did not return an EPUB file"), { status: 400 });
  }
  // Name the library copy by the EPUB's own title — the title the
  // Space queue and the EPUB itself carry — not the title the
  // browser stored when the job started. The start-time title is
  // the raw translated page title and can be a different
  // translation of the same book (e.g. "The Sentiments of a Young
  // Girl Are Always Poetry..." vs "A Girl's Feelings Are Always
  // Poetic..."), which made the file unfindable by title lookup.
  // Falls back to the passed title when the EPUB carries none, so
  // a save never fails over this. Covers both callers (the browser
  // library-save endpoint and the server-side tracker) — they both
  // funnel through here.
  const epubTitleText = await epubTitle(buffer);
  const finalTitle = (epubTitleText || title || "book").trim() || "book";
  const filename = `${sanitizeFilename(finalTitle)}.epub`;
  const up = await uploadToLibrary(buffer, filename, { title: finalTitle });
  return { libraryUrl: up.url, libraryPageUrl: up.pageUrl, path: up.path };
}

function saveOnce(key, fn) {
  if (rawSaves.has(key)) return rawSaves.get(key);
  const p = fn().catch((e) => {
    rawSaves.delete(key); // allow a retry after a failure
    throw e;
  });
  rawSaves.set(key, p);
  if (rawSaves.size > RAW_SAVE_MAX) rawSaves.delete(rawSaves.keys().next().value);
  return p;
}

function spaceJobKeyFromUrl(url) {
  const m = String(url).match(/([0-9a-f]{8,})\.epub/i);
  return m ? `job:${m[1]}` : `url:${url}`;
}

app.post("/api/raw/library-save", async (req, res) => {
  try {
    const body = req.body || {};
    const spaceFileUrl = String(body.spaceFileUrl || "").trim();
    const title = String(body.title || "book").trim();
    if (!spaceFileUrl) return res.status(400).json({ error: "spaceFileUrl required" });
    try {
      new URL(spaceFileUrl);
    } catch {
      return res.status(400).json({ error: "spaceFileUrl is not a URL" });
    }
    const key = body.spaceJobId ? `job:${String(body.spaceJobId)}` : spaceJobKeyFromUrl(spaceFileUrl);
    const out = await saveOnce(key, () => saveSpaceEpub(spaceFileUrl, title));
    res.json(out);
  } catch (e) {
    // uploadToLibrary's own errors (not configured, too small,
    // too large) are honest answers, displayed as-is by the UI.
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Server-side tracker: the browser registers each Space job
// here when it starts, and this server follows it to completion
// and saves the EPUB to the Community Library — so finished
// translations reach the library even if the visitor closed the tab.
let spaceFnMap = null;
async function spaceCall(apiName, data, timeoutMs = 120_000) {
  if (!spaceFnMap) {
    const cfg = await (await fetch(`${SPACE_ORIGIN}/config`, { signal: AbortSignal.timeout(30_000) })).json();
    spaceFnMap = {};
    (cfg.dependencies || []).forEach((d, i) => d?.api_name && (spaceFnMap[d.api_name] = i));
  }
  const fnIndex = spaceFnMap[apiName];
  if (fnIndex === undefined) {
    spaceFnMap = null;
    throw new Error(`Space has no function ${apiName}`);
  }
  const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const join = await fetch(`${SPACE_ORIGIN}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: session }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!join.ok) throw new Error(`Space join ${join.status}`);
  const r = await fetch(`${SPACE_ORIGIN}/gradio_api/queue/data?session_hash=${session}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let msg;
    try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
    if (msg.msg === "process_completed") {
      if (msg.success === false) throw new Error(msg.output?.error || "Space call failed");
      return msg.output?.data || [];
    }
  }
  throw new Error(`Space ${apiName} ended without a result`);
}

const rawTracked = new Map(); // spaceJobId -> {title, since}
const RAW_TRACK_MAX_MS = 24 * 3600_000;

async function pollRawJob(id) {
  const t = rawTracked.get(id);
  if (!t) return;
  if (Date.now() - t.since > RAW_TRACK_MAX_MS) return rawTracked.delete(id);
  try {
    const outs = await spaceCall("book_check_progress", [id], 60_000);
    const txt = String(outs[0] || "");
    const status = (txt.match(/Status:\s*([A-Za-z_]+)/) || [])[1] || "";
    if (/^(failed|stopped)$/.test(status) || /Job not found/.test(txt)) return rawTracked.delete(id);
    if (/^done/.test(status)) {
      const ep = await spaceCall("book_get_epub", [id], 120_000);
      const f = ep[0] || {};
      let url = f.url || f.path;
      if (url && !/^https?:/i.test(url)) url = `${SPACE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
      if (url) {
        await saveOnce(`job:${id}`, () => saveSpaceEpub(url, t.title));
        console.log(`[raw] saved ${id} to library: ${t.title}`);
      }
      return rawTracked.delete(id);
    }
  } catch (e) {
    console.warn(`[raw] track ${id}: ${e.message}`);
    // Library refusals (too small / too large / not configured)
    // are final answers; stop retrying them.
    if (/too small|too large|not configured|did not return an EPUB/i.test(e.message)) rawTracked.delete(id);
  }
}

setInterval(() => {
  for (const id of rawTracked.keys()) pollRawJob(id);
}, 30_000).unref();

app.post("/api/raw/track", (req, res) => {
  const id = String(req.body?.spaceJobId || "").trim();
  const title = String(req.body?.title || "book").trim().slice(0, 300);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return res.status(400).json({ error: "spaceJobId required" });
  if (rawTracked.size > 500) return res.status(429).json({ error: "too many tracked jobs" });
  const prev = rawTracked.get(id);
  rawTracked.set(id, { title: title || prev?.title || "book", since: prev?.since || Date.now() });
  res.json({ tracked: true });
});

restoreJobs();

app.listen(PORT, () => console.log(`link-to-epub server listening on ${PORT}`));
startLibraryIndex();
