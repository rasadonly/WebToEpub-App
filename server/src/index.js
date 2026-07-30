// Link to EPUB — server-side conversion API.
// Jobs run on the dyno and keep going after the browser tab closes.
import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fetchChapterLinks, fetchChapterContent, fetchBookMeta, mapPool } from "./fetcher.js";
import { buildEpub, sanitizeFilename } from "./epub.js";

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

// Fast TOC listing (used by the UI before starting a job)
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
