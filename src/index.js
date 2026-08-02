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
} from "./fetcher.js";
import { buildEpub, sanitizeFilename } from "./epub.js";
import { uploadToLibrary, libraryEnabled } from "./library.js";


const app = express();
app.use(cors({ origin: true, exposedHeaders: ["Content-Disposition"] }));
app.use(compression());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 12);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const OUT_DIR = path.join(os.tmpdir(), "link-to-epub");
fs.mkdirSync(OUT_DIR, { recursive: true });

/** jobId -> job */
const jobs = new Map();

function publicJob(job) {
  const { file, chapters, ...rest } = job;
  return { ...rest, ready: job.status === "done" };
}

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      if (job.file) fs.promises.unlink(job.file).catch(() => {});
      jobs.delete(id);
    }
  }
}
setInterval(cleanup, 10 * 60 * 1000).unref();

app.get("/health", (_req, res) => res.json({ ok: true, jobs: jobs.size, uptime: process.uptime() }));

// ---- Live stats (active jobs + active users) -------------------------------
const visitors = new Map(); // visitorId -> lastSeen ms
const VISITOR_TTL_MS = 90 * 1000;

app.get("/api/stats", (req, res) => {
  const now = Date.now();
  const uid = String(req.query.uid || "").slice(0, 64);
  if (uid) visitors.set(uid, now);
  for (const [id, seen] of visitors) if (now - seen > VISITOR_TTL_MS) visitors.delete(id);

  let activeJobs = 0;
  for (const job of jobs.values()) {
    if (job.status === "queued" || job.status === "running") activeJobs++;
  }
  res.json({ activeJobs, activeUsers: Math.max(visitors.size, uid ? 1 : 0), totalJobs: jobs.size });
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
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
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
    res.status(upstream.status);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: e.message });
  }
});

// Also handle POST proxying (needed for wtr-lab and similar API endpoints)
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

  try {
    const [chapters, meta] = await Promise.all([
      fetchChapterLinks(url, String(req.query.selector || "")),
      fetchBookMeta(url),
    ]);
    // Send in batches of 100 so the client can start showing chapters early.
    const BATCH = 100;
    for (let i = 0; i < chapters.length; i += BATCH) {
      flush({ type: "chapters", items: chapters.slice(i, i + BATCH) });
    }
    flush({ type: "meta", ...meta });
  } catch (e) {
    flush({ type: "error", message: e.message });
  }
  flush({ type: "done" });
  res.end();
});

// Legacy buffered endpoint (kept for compat — times out on very large TOCs).
app.get("/api/toc", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ error: "url required" });
    const [chapters, meta] = await Promise.all([
      fetchChapterLinks(url, String(req.query.selector || "")),
      fetchBookMeta(url),
    ]);
    res.json({ chapters, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
  jobs.set(id, job);
  res.status(202).json(publicJob(job));

  runJob(job, { tocUrl, providedChapters, metadata, options, selector }).catch((e) => {
    job.status = "error";
    job.error = e.message;
    job.updatedAt = Date.now();
  });
});

async function runJob(job, { tocUrl, providedChapters, metadata, options, selector }) {
  const touch = () => {
    job.updatedAt = Date.now();
  };

  job.status = "running";
  job.phase = "Fetching chapter list";
  touch();

  let list = Array.isArray(providedChapters) && providedChapters.length
    ? providedChapters.map((c, i) =>
        typeof c === "string" ? { url: c, title: `Chapter ${i + 1}` } : c
      )
    : await fetchChapterLinks(tocUrl, selector);

  if (job.cancelled) return finishCancelled(job);

  const range = options.chapterRange;
  if (range && !range.useAll) {
    list = list.slice(Math.max(0, (range.start || 1) - 1), range.end || list.length);
  }

  if (!list.length) throw new Error("No chapters found for this URL");

  job.total = list.length;
  job.phase = `Downloading ${list.length} chapters`;
  touch();

  // wtr-lab meters anonymous reads per IP behind Cloudflare Turnstile, so it
  // must be crawled gently; other sites can use the full pool.
  const gentle = /wtr-lab\.com/i.test(list[0]?.url || "");
  const poolSize = gentle ? 2 : CONCURRENCY;

  const results = await mapPool(list, poolSize, async (c, i) => {

    if (job.cancelled) return null;
    try {
      const content = await fetchChapterContent(c.url, selector);
      job.completed++;
      touch();
      return { title: c.title || `Chapter ${i + 1}`, content };
    } catch {
      job.failed++;
      job.completed++;
      touch();
      return null;
    }
  });

  if (job.cancelled) return finishCancelled(job);

  const chapters = results.filter(Boolean);
  if (!chapters.length) throw new Error("All chapters failed to download");

  job.phase = "Packing EPUB";
  touch();

  const buffer = await buildEpub(chapters, metadata, options);
  const file = path.join(OUT_DIR, `${job.id}.epub`);
  await fs.promises.writeFile(file, buffer);

  job.file = file;
  job.size = buffer.length;

  // Best-effort copy to the shared Hugging Face library (never fails the job).
  // Done before flipping to "done" so the client's poll sees the link.
  if (libraryEnabled()) {
    job.phase = "Saving a copy to the library";
    job.libraryStatus = "uploading";
    touch();
    try {
      const up = await uploadToLibrary(buffer, job.filename, {
        title: metadata.title,
        author: metadata.author,
        source: tocUrl,
      });
      job.libraryUrl = up.url;
      job.libraryPageUrl = up.pageUrl;
      job.libraryStatus = "saved";
    } catch (e) {
      console.error("Library upload failed:", e);
      job.libraryStatus = "failed";
      job.libraryError = e.message;
    }
  }

  job.status = "done";
  job.phase = "Ready to download";
  touch();

}


function finishCancelled(job) {
  job.status = "cancelled";
  job.phase = "Cancelled";
  job.updatedAt = Date.now();
}

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(publicJob(job));
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  job.cancelled = true;
  res.json(publicJob(job));
});

app.get("/api/jobs/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "done" || !job.file) {
    return res.status(404).json({ error: "epub not ready" });
  }
  res.setHeader("Content-Type", "application/epub+zip");
  res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
  fs.createReadStream(job.file).pipe(res);
});

app.listen(PORT, () => console.log(`link-to-epub server listening on ${PORT}`));
