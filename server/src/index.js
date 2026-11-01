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
} from "./fetcher.js";
import { buildEpub, sanitizeFilename, writeChapterFile, countEpubChapters } from "./epub.js";
import { createWorkPool, DEFAULT_MAX_ACTIVE_JOBS } from "./workPool.js";
import { uploadToLibrary, libraryEnabled, deleteFromLibrary, downloadFromLibrary } from "./library.js";
import { callSpace, parseSpaceProgress, downloadSpaceFile } from "./spaceClient.js";
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
  // Raw (translation) jobs resume through the Space, not through
  // the conversion pipeline: with a Space job id, polling on the
  // next GET picks it up; without one, start it on the Space.
  if (job.kind === "raw") {
    if (job.spaceJobId) {
      job.status = "running";
      job.phase = "Resuming translation on Translate Me";
      job.updatedAt = Date.now();
      persistJob(job, true);
    } else {
      await startRawJob(job, spec);
    }
    return;
  }
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

// ---- /raw: translation jobs via the Translate Me Space -------------
// The Space (Translate Me) is the translation backend: search, TOC,
// translation and EPUB building all run there, through its Gradio
// API (see spaceClient.js). linktoepub owns only the /raw UI,
// its own job records, the one-at-a-time guard, the
// already-available check against the community library, the
// download serving, and the library save on completion.
// Main conversion jobs are untouched and keep running in parallel;
// the one-book-at-a-time rule applies to /raw jobs only.
// Translation jobs deliberately do NOT repeat the old silent-drop
// failure mode (failed chapters counted as completed, "100%"
// with chapters missing): a partial job reports
// status "done_with_errors" with its failed chapters named,
// and a fully failed job reports "error".
// Retention: a finished raw EPUB stays downloadable for 24h
// (RAW_JOB_TTL_MS), even when the community library refuses it
// for being under 100 KB — the library refusal never removes
// the user's download.

function rawJobs() {
  return [...jobs.values()]
    .filter((j) => j.kind === "raw")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function publicRawJob(job) {
  const pub = publicJob(job);
  // publicJob's ready flag only covers status "done"; a
  // done_with_errors raw job also has a downloadable EPUB.
  pub.ready = (job.status === "done" || job.status === "done_with_errors") && Boolean(job.file);
  return pub;
}

function activeRawJob() {
  return rawJobs().find((j) => j.status === "queued" || j.status === "running") || null;
}

// \b does NOT work after CJK characters (they are not \w), so
// "作品情報" never matched /...情報\b/ — the info-page retry and
// the fallback check silently never fired until this helper.
// CJK info titles match exactly; Latin ones use a word boundary.
function isInfoPageTitle(t) {
  const s = String(t || "").trim();
  return s === "作品情報" || s === "作品信息" || /^(Information|Book info)\b/.test(s);
}

function parseTitleCount(titleCount) {
  const m = String(titleCount || "").match(/^(.*) — (\d+) chapters$/);
  if (m) return { title: m[1].trim(), count: Number(m[2]) };
  return { title: String(titleCount || "").trim(), count: 0 };
}

// Fetch a TOC from the Space, retrying when the first entry is
// the site's info page instead of a chapter. Known flake
// (2026-11-01): the Space's Syosetu adapter intermittently
// fails on its Worker stage and falls back to the generic
// extractor, whose first "chapter" is the 作品情報 info page —
// and chapter indices then shift, so a job started on that
// TOC translates the info page instead of chapter 1. Retrying
// a few times almost always lands the dedicated TOC.
async function fetchSpaceToc(url) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const outs = await callSpace("book_fetch_toc", [url], 300_000);
    const { title, count } = parseTitleCount(outs && outs[0]);
    const chaptersText = String((outs && outs[1]) || "");
    const info = String((outs && outs[2]) || "");
    last = { title, count, chaptersText, info };
    const firstLine = chaptersText.split("\n")[0] || "";
    const infoFirst = isInfoPageTitle(firstLine.replace(/^\d+\.\s*/, ""));
    if (!infoFirst) return last;
    console.warn(`[raw] TOC first entry is an info page (attempt ${attempt + 1}), retrying`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last;
}

// Info-page markers: text that only ever appears on a book's
// info/landing page, never in chapter prose. If a finished
// "translation" is actually the info page, it must fail honestly
// instead of being served (or library-saved) as a chapter.
const INFO_PAGE_MARKERS = [
  "Currently serializing",
  "Total 799 episodes",
  "Read Episode 1",
  "Read Latest Episode",
  "Send via LINE",
];

async function epubLooksLikeInfoPage(buffer) {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    let text = "";
    for (const name of Object.keys(zip.files)) {
      if (/\.x?html$/i.test(name)) {
        const html = await zip.files[name].async("string");
        text += html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") + " ";
      }
    }
    return INFO_PAGE_MARKERS.some((m) => text.includes(m));
  } catch {
    return false;
  }
}

// Similar books already in the community library, searched the
// usual way: titles derived from stored paths with the shared
// Unicode-aware helpers (titleFromLibraryPath + libraryTitleKey),
// so non-Latin titles match too. Empty and one-letter query
// keys are rejected — they would match nearly everything.
// Exact title matches first, then starts-with, then contains.
async function searchLibrarySimilar(query) {
  const qkey = libraryTitleKey(query);
  if (qkey.length < 2) return [];
  const idx = await getLibraryIndex().catch(() => null);
  if (!idx || !Array.isArray(idx.f)) return [];
  const repo = process.env.HF_LIBRARY_REPO || "prasaduser/webtoepub-library";
  const scored = [];
  for (const [p, size] of idx.f) {
    if (!/\.epub$/i.test(p)) continue;
    const title = titleFromLibraryPath(p);
    const key = libraryTitleKey(title);
    // One-letter titles ("7", "2") would match nearly every query
    // by containment — rejected, same as one-letter queries.
    if (key.length < 2) continue;
    let score = 0;
    if (key === qkey) score = 3;
    else if (key.startsWith(qkey) || qkey.startsWith(key)) score = 2;
    else if (key.includes(qkey) || qkey.includes(key)) score = 1;
    else continue;
    scored.push({
      score,
      title,
      path: p,
      size: typeof size === "number" ? size : 0,
      url: `https://huggingface.co/datasets/${repo}/resolve/main/${p}?download=true`,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.size - a.size);
  return scored.slice(0, 10).map(({ score, ...rest }) => rest);
}

async function finalizeRawJob(job) {
  // Download the finished EPUB from the Space into linktoepub's
  // own out dir so /api/jobs/:id/download serves it, then save
  // a copy to the community library under the correct
  // (translated) title — best-effort, never fails the job.
  // A library refusal (e.g. under 100 KB) only sets
  // libraryStatus "failed"; the EPUB itself stays downloadable
  // from linktoepub for the full 24h raw retention.
  const outs = await callSpace("book_get_epub", [job.spaceJobId], 120_000);
  const fileObj = outs && outs[0];
  const buffer = await downloadSpaceFile(fileObj);
  // Quality gate: never serve or library-save an info page
  // mistaken for a chapter (see fetchSpaceToc note).
  if (await epubLooksLikeInfoPage(buffer)) {
    throw new Error(
      "The Space returned the book's info page instead of chapter text " +
        "(its TOC was incomplete this time) — please retry the job; " +
        "no incorrect EPUB was saved.",
    );
  }
  const file = path.join(OUT_DIR, `${job.id}.epub`);
  await fs.promises.writeFile(file, buffer);
  job.file = file;
  job.size = buffer.length;
  job.filename = `${sanitizeFilename(job.title || "book")}.epub`;
  if (libraryEnabled()) {
    job.phase = "Saving a copy to the library";
    job.libraryStatus = "uploading";
    job.updatedAt = Date.now();
    persistJob(job, true);
    try {
      const up = await uploadPool.run(async () => {
        const buf = await fs.promises.readFile(file);
        return uploadToLibrary(buf, job.filename, {
          title: job.title,
          author: job.author || "",
          source: job.tocUrl,
        });
      });
      job.libraryUrl = up.url;
      job.libraryPageUrl = up.pageUrl;
      job.libraryStatus = "saved";
    } catch (e) {
      console.error("[raw] library upload failed:", e.message);
      job.libraryStatus = "failed";
      job.libraryError = e.message;
    }
  }
  // The upload attempt is over either way: the job card must read
  // "Ready to download", not stick on "Saving a copy to the
  // library" (cosmetic bug seen on production 2026-11-01).
  job.phase = "Ready to download";
  job.updatedAt = Date.now();
  persistJob(job, true);
}

async function refreshRawJob(job, force = false) {
  if (!job.spaceJobId) return;
  if (job.status !== "queued" && job.status !== "running") return;
  if (!force && job.lastSpacePoll && Date.now() - job.lastSpacePoll < 10_000) return;
  job.lastSpacePoll = Date.now();
  let text = "";
  try {
    const outs = await callSpace("book_check_progress", [job.spaceJobId], 60_000);
    text = String((outs && outs[0]) || "");
  } catch (e) {
    console.warn("[raw] progress check failed:", e.message);
    return;
  }
  const prog = parseSpaceProgress(text);
  job.completed = prog.done;
  job.failed = prog.failed;
  job.total = prog.total || job.total;
  job.failedChapters = prog.failedChapters;
  const map = {
    done: "done",
    done_with_errors: "done_with_errors",
    failed: "error",
    stopped: "cancelled",
  };
  const next = map[prog.status];
  if (next) {
    job.status = next;
    job.phase =
      next === "done"
        ? "Ready to download"
        : next === "done_with_errors"
          ? `Ready with ${prog.failed} failed chapter(s)`
          : next === "error"
            ? "Translation failed"
            : "Cancelled";
    if ((next === "done" || next === "done_with_errors") && prog.epubReady && !job.file) {
      try {
        await finalizeRawJob(job);
      } catch (e) {
        // A finalize failure (e.g. the info-page quality gate)
        // means there is no valid EPUB: the job is an error,
        // never a "done" job with nothing to download.
        console.error("[raw] finalize failed:", e.message);
        job.status = "error";
        job.phase = "Failed";
        job.error = e.message;
        job.file = null;
      }
    }
    if (next === "error") job.error = "Translation failed on the Space";
  } else {
    job.phase = `Translating (${prog.done}/${prog.total || "?"} chapters)`;
  }
  job.updatedAt = Date.now();
  persistJob(job, true);
}

async function startRawJob(job, spec) {
  try {
    job.status = "running";
    job.phase = "Starting translation on Translate Me";
    job.updatedAt = Date.now();
    persistJob(job, true);
    const outs = await callSpace(
      "book_start_job",
      [spec.tocUrl, spec.source, spec.target, spec.engine, spec.from, spec.to],
      300_000,
    );
    const spaceJobId = outs && outs[0];
    const msg = String((outs && outs[1]) || "");
    if (!spaceJobId) throw new Error(`Space did not return a job id: ${msg.slice(0, 200)}`);
    job.spaceJobId = spaceJobId;
    const total = msg.match(/(\d+) chapters/);
    if (total) job.total = Number(total[1]);
    job.phase = "Translating on Translate Me";
    job.updatedAt = Date.now();
    persistJob(job, true);
  } catch (e) {
    job.status = "error";
    job.phase = "Failed to start";
    job.error = e.message;
    job.updatedAt = Date.now();
    persistJob(job, true);
  }
}

// Search original-language sites through the Space (same search
// the Translate Me Books tab runs: per-site + translated search),
// plus similar books already in the community library, searched
// the usual way — so a book that is already translated never
// needs a new job.
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
// Search labels look like "Re:Zero — Japanese ncode.syosetu.com
// (Ｒｅ：ゼロから始める異世界生活)" or "Title — host". Before the
// user picks, translate the trailing parenthesised CJK title to
// English (requested 2026-11-01: show English titles to choose
// from). MyMemory via the Space is fast and is the proven title
// path; all titles translate in parallel with an 8s per-call
// budget, and anything untranslated keeps its original label
// rather than delaying the search.
async function translateResultTitles(choices) {
  return Promise.all(
    choices.map(async ([label, url]) => {
      const m = String(label).match(/^(.*?) — (.*?) \(([^)]*)\)$/);
      if (!m || !CJK_RE.test(m[3])) return { label, url };
      try {
        const outs = await callSpace("translate_text", [m[3], "auto", "en", "mymemory"], 8_000);
        const translated = String((outs && outs[0]) || "").trim();
        if (!translated || translated === m[3]) return { label, url };
        return { label: `${translated} — ${m[2]} (${m[3]})`, url };
      } catch {
        return { label, url };
      }
    }),
  );
}

app.post("/api/raw/search", async (req, res) => {
  try {
    const query = String((req.body || {}).query || "").trim();
    if (!query) return res.status(400).json({ error: "query required" });
    const outs = await callSpace("book_search", [query], 300_000);
    const dropdown = outs && outs[0];
    const choices = Array.isArray(dropdown?.choices) ? dropdown.choices : [];
    const libraryResults = await searchLibrarySimilar(query).catch(() => []);
    const results = await translateResultTitles(choices);
    res.json({
      results,
      status: String((outs && outs[1]) || ""),
      libraryResults,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch a TOC for a pasted URL. First the Space (its TOC is what
// the translation job itself uses, so its chapter indices are
// authoritative). The Space result is only trusted when it looks
// like a real chapter list; otherwise fall back to linktoepub's
// own default parser (178 supported sites, proxy routes) — the
// superior breadth — and say so. The job still translates
// through the Space, whose own chapter order is what the range
// then refers to.
//
// Distrust triggers, all found by live testing 2026-11-01:
//  - 0 chapters (Space fetch failed outright)
//  - under 5 chapters (a 1-entry "TOC" is footer junk, e.g.
//    LightNovelHeaven returning "2019-2020" as its only chapter)
//  - first entry is the site's info page (Syosetu's flaky 101
//    generic TOC starts with 作品情報, and its indices shift)
//  - chapters in descending numeric order (FreeWebNovel's 46
//    latest-first list: chapter 1432 first, not chapter 1)
function spaceTocUsable(toc) {
  if (!toc || toc.count <= 0) return false;
  if (toc.count < 5) return false;
  const lines = toc.chaptersText.split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  const firstTitle = lines[0].replace(/^\d+\.\s*/, "");
  if (isInfoPageTitle(firstTitle)) return false;
  const num = (s) => {
    const m = s.match(/(\d{1,5})/);
    return m ? Number(m[1]) : null;
  };
  const firstNum = num(firstTitle);
  const lastNum = num(lines[lines.length - 1].replace(/^\d+\.\s*/, ""));
  if (firstNum !== null && lastNum !== null && firstNum > lastNum) return false;
  return true;
}

app.post("/api/raw/toc", async (req, res) => {
  const startedAt = Date.now();
  try {
    const url = String((req.body || {}).url || "").trim();
    if (!url) return res.status(400).json({ error: "url required" });
    let spaceError = null;
    let spaceToc = null;
    try {
      // Heroku's router kills requests at 30s with an HTML 503
      // (same reason the main /api/toc races at 24s), and a Space
      // TOC fetch with retries takes 30-46s — that is exactly why
      // Fetch TOC failed on production with "Failed to fetch"
      // while it worked locally, where no router limit exists.
      // Budgets (measured on production 2026-11-01: the parser
      // alone takes ~12s for Syosetu's 8 pages from Heroku
      // egress): the Space gets 12s, the parser gets whatever
      // remains of a 28s overall cap, so the handler always
      // answers JSON inside 30s instead of letting the
      // connection die. A 24s Space budget was tried first and
      // still died on production (24s + 12s parser > 30s); a 15s
      // budget was tried second and still squeezed too tight
      // once the parser ran cold, so 12s it is — worst case
      // 12s + 12s = 24s, with the 28s cap as the backstop that
      // returns a readable retry error instead of a dead
      // connection (and the background parser usually warms
      // the cache for that retry).
      const spaceAttempt = fetchSpaceToc(url);
      spaceAttempt.catch(() => {}); // keep the loser of the race from becoming an unhandled rejection
      const spaceBudget = new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Space TOC fetch timed out (12s budget)")), 12_000),
      );
      spaceToc = await Promise.race([spaceAttempt, spaceBudget]);
      if (spaceTocUsable(spaceToc)) {
        return res.json({ ...spaceToc, source: "space" });
      }
      spaceError = spaceToc.count <= 0
        ? "Space found no chapters"
        : "Space returned an unusable chapter list (partial, reversed, or info page first)";
    } catch (e) {
      spaceError = e.message;
    }
    const remainingMs = Math.max(5_000, 28_000 - (Date.now() - startedAt));
    const parserAttempt = getTocCached(url, "");
    parserAttempt.catch(() => {}); // same unhandled-rejection guard as above
    const parserBudget = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("TOC fetch timed out — please retry (the chapter list is usually cached by then, so a retry is fast)")), remainingMs),
    );
    const { chapters, meta } = await Promise.race([parserAttempt, parserBudget]);
    if (!chapters.length) {
      throw new Error(spaceError || "No chapters found");
    }
    const title = meta.title || url;
    const info = [meta.author ? `Author: ${meta.author}` : "", meta.description || ""]
      .filter(Boolean)
      .join("\n");
    res.json({
      title,
      count: chapters.length,
      chaptersText: chapters.slice(0, 30).map((c, i) => `${i + 1}. ${c.title}`).join("\n"),
      info,
      source: "linktoepub",
      note: "TOC via linktoepub's parser (the Space could not fetch a usable chapter list for this URL: " +
        `${spaceError}). The translation job still runs through the Space, ` +
        "so chapter numbers follow the Space's own chapter order for this book.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start a translation job: one book at a time, and only when the
// translated book is not already available.
app.post("/api/raw/jobs", async (req, res) => {
  try {
    const body = req.body || {};
    const tocUrl = String(body.tocUrl || "").trim();
    if (!tocUrl) return res.status(400).json({ error: "tocUrl required" });
    const source = String(body.source || "auto");
    const target = String(body.target || "en");
    const engine = String(body.engine || "auto");
    const from = Number.isFinite(Number(body.from)) ? Number(body.from) : 0;
    const to = Number.isFinite(Number(body.to)) ? Number(body.to) : -1;

    // One book at a time: an active raw job blocks a new one.
    const active = activeRawJob();
    if (active) {
      return res.status(409).json({
        error: "A translation job is already running — one book at a time.",
        job: publicRawJob(active),
      });
    }
    // Same book already translated here: point at that job.
    const existing = rawJobs().find(
      (j) => j.tocUrl === tocUrl && (j.status === "done" || j.status === "done_with_errors") && j.file,
    );
    if (existing) {
      return res.json({ suggestion: "job", job: publicRawJob(existing) });
    }

    // Resolve the book title (frontend usually passes the title
    // it got from /api/raw/toc; otherwise fetch it via the Space).
    let originalTitle = String(body.title || "").trim();
    if (!originalTitle) {
      const toc = await fetchSpaceToc(tocUrl);
      originalTitle = toc.title || tocUrl;
    }
    // Correct name for the finished book: the translated title
    // (falling back to the original when title translation fails).
    let title = originalTitle;
    try {
      const outs = await callSpace("translate_text", [originalTitle, source, target, engine], 120_000);
      const translated = String((outs && outs[0]) || "").trim();
      if (translated) title = translated;
    } catch (e) {
      console.warn("[raw] title translation failed, keeping original:", e.message);
    }
    // Already available in the community library? Suggest it
    // instead of translating again (translated title first, then
    // the original title for copies saved under it).
    for (const candidate of [title, originalTitle]) {
      const copies = await findLibraryCopies(candidate).catch(() => []);
      if (copies.length) {
        const biggest = copies.reduce((a, b) => (b.size > a.size ? b : a));
        return res.json({
          suggestion: "library",
          title: candidate,
          path: biggest.path,
          url: `https://huggingface.co/datasets/prasaduser/webtoepub-library/resolve/main/${biggest.path}?download=true`,
        });
      }
    }

    const id = crypto.randomUUID();
    const job = {
      id,
      kind: "raw",
      status: "queued",
      phase: "Queued",
      title,
      originalTitle,
      tocUrl,
      source,
      target,
      engine,
      from,
      to,
      spaceJobId: null,
      total: 0,
      completed: 0,
      failed: 0,
      failedChapters: [],
      error: null,
      size: 0,
      filename: `${sanitizeFilename(title || "book")}.epub`,
      file: null,
      libraryStatus: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const spec = { kind: "raw", tocUrl, source, target, engine, from, to, title, originalTitle };
    jobs.set(id, job);
    jobSpecs.set(id, spec);
    persistJob(job, true);
    res.status(202).json(publicRawJob(job));
    startRawJob(job, spec);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List current translation jobs (refreshes active ones from the Space).
app.get("/api/raw/jobs", async (_req, res) => {
  const list = rawJobs();
  for (const job of list) {
    if (job.status === "queued" || job.status === "running") {
      try {
        await refreshRawJob(job);
      } catch {
        /* keep last known state */
      }
    }
  }
  res.json({ jobs: list.map(publicRawJob) });
});

app.get("/api/raw/jobs/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.kind !== "raw") return res.status(404).json({ error: "raw job not found" });
  if (job.status === "queued" || job.status === "running") {
    try {
      await refreshRawJob(job, true);
    } catch {
      /* keep last known state */
    }
  }
  res.json(publicRawJob(job));
});

// Cancel tracking for a raw job. Note: there is no Space-side
// stop, so a Space worker already running finishes in the Space's
// /tmp; linktoepub simply stops following it and frees the
// one-at-a-time slot.
app.post("/api/raw/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.kind !== "raw") return res.status(404).json({ error: "raw job not found" });
  if (job.status === "done" || job.status === "done_with_errors" || job.status === "error" || job.status === "cancelled") {
    return res.json(publicRawJob(job));
  }
  job.status = "cancelled";
  job.phase = "Cancelled";
  job.updatedAt = Date.now();
  persistJob(job, true);
  res.json(publicRawJob(job));
});

restoreJobs();

app.listen(PORT, () => console.log(`link-to-epub server listening on ${PORT}`));
startLibraryIndex();
