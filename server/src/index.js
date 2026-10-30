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
  fetchBookMeta,
  mapPool,
  supportedDomains,
  lookupSiteConfig,
  stealthGet,
  smartGetText,
} from "./fetcher.js";
import { buildEpub, sanitizeFilename, writeChapterFile, countEpubChapters } from "./epub.js";
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
    if (now - job.updatedAt > JOB_TTL_MS) {
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

/** Same title key the library UI dedupes by (bridge.ts). */
const libraryTitleKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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
        const content = await fetchChapterContent(c.url, selector);
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
      if (Date.now() - (job.updatedAt || 0) > JOB_TTL_MS) {
        forgetJob(job.id);
        continue;
      }
      if (job.status === "done" && job.file && fs.existsSync(job.file)) {
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
  if (!job || job.status !== "done" || !job.file) {
    return res.status(404).json({ error: "epub not ready" });
  }
  sendEpub(res, job.file, job.filename);
});

restoreJobs();

app.listen(PORT, () => console.log(`link-to-epub server listening on ${PORT}`));
startLibraryIndex();
