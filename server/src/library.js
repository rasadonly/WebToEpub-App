// Uploads finished EPUBs to the shared Hugging Face dataset library so users
// get a permanent download link in addition to the local file.
//
// Dataset: https://huggingface.co/datasets/prasaduser/webtoepub-library
// (all older books were migrated into this dataset).
// Requires HF_LIBRARY_TOKEN (or HUGGINGFACE_TOKEN) with write scope. Without it
// the upload is silently skipped — conversions keep working exactly as before.

import { createHash } from "node:crypto";

const REPO = process.env.HF_LIBRARY_REPO || "prasaduser/webtoepub-library";
const MAX_BYTES = Number(process.env.HF_LIBRARY_MAX_BYTES || 40 * 1024 * 1024);
const JOB_STATE_PREFIX = "job-state/";

function token() {
  return (process.env.HF_LIBRARY_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || "").trim();
}

export function libraryEnabled() {
  return Boolean(token());
}

function slug(name) {
  return (
    String(name || "book")
      .normalize("NFKD")
      // Unicode-aware (2026-11-01, /raw fix): the old [^\w\s.-]
      // stripped every CJK character, so a Japanese / Chinese /
      // Korean book saved to the library as "book-<rand>.epub"
      // instead of under its correct name. \p{L}\p{N} keeps
      // letters and numbers in every script.
      .replace(/[^\p{L}\p{N}_\s.-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 80) || "book"
  );
}

// ── HF commit helper (rate-limit resilient) ─────────────────────
// Hugging Face caps dataset commits at 128/hour. A burst of finished
// books trips it (429 "You have exceeded the rate limit for repository
// commit creation"). The cap is a ROLLING hourly window, so slots free
// up continuously as older commits age out — a retry after a few minutes
// usually succeeds. Retry a 429 after 1m, 5m, then 15m; anything else
// (or an exhausted retry) throws. The library upload is best-effort, so
// a failed commit must never break a conversion — callers catch it.
const HF_COMMIT_RETRY_DELAYS_MS = [60_000, 300_000, 900_000];

async function hfCommit(lines, summary = "commit", { retry = true } = {}) {
  const delays = retry ? HF_COMMIT_RETRY_DELAYS_MS : [];
  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`https://huggingface.co/api/datasets/${REPO}/commit/main`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/x-ndjson",
      },
      body: lines,
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    lastErr = new Error(`HF commit failed (${res.status}): ${text.slice(0, 200)}`);
    if (res.status === 429 && attempt < delays.length) {
      const delay = delays[attempt];
      console.warn(
        `HF commit 429 (${summary}) — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${delays.length})`
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// LFS upload for one EPUB (preupload + batch + PUT + verify). Returns
// {oid, size}. This does NOT commit — the caller commits the lfsFile
// pointer (alone, or together with other files in one commit).
async function lfsUploadEpub(buffer, path) {
  const oid = createHash("sha256").update(buffer).digest("hex");
  const size = buffer.length;

  // Datasets reject inline binary content — EPUBs must go through LFS/Xet.
  const pre = await fetch(`https://huggingface.co/api/datasets/${REPO}/preupload/main`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ path, size, sample: buffer.subarray(0, 512).toString("base64") }] }),
  });
  if (!pre.ok) {
    const t = await pre.text().catch(() => "");
    throw new Error(`HF preupload failed (${pre.status}): ${t.slice(0, 200)}`);
  }

  // LFS batch: ask where to PUT the object.
  const batchRes = await fetch(`https://huggingface.co/datasets/${REPO}.git/info/lfs/objects/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/vnd.git-lfs+json",
      Accept: "application/vnd.git-lfs+json",
    },
    body: JSON.stringify({ operation: "upload", transfers: ["basic"], hash_algo: "sha256", objects: [{ oid, size }] }),
  });
  if (!batchRes.ok) {
    const t = await batchRes.text().catch(() => "");
    throw new Error(`HF LFS batch failed (${batchRes.status}): ${t.slice(0, 200)}`);
  }
  const batch = await batchRes.json();
  const obj = batch?.objects?.[0] || {};
  if (obj.error) throw new Error(`HF LFS batch error: ${obj.error.message || obj.error.code}`);

  const upload = obj.actions?.upload;
  if (upload) {
    const put = await fetch(upload.href, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", ...(upload.header || {}) },
      body: buffer,
    });
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      throw new Error(`HF LFS upload failed (${put.status}): ${t.slice(0, 200)}`);
    }
    const verify = obj.actions?.verify;
    if (verify) {
      await fetch(verify.href, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(verify.header || {}) },
        body: JSON.stringify({ oid, size }),
      }).catch(() => {});
    }
  }

  return { oid, size };
}

function libraryEpubPath(filename) {
  const base = slug(filename.replace(/\.epub$/i, ""));
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return { path: `books/${stamp}/${base}-${rand}.epub`, base };
}

function libraryEpubUrls(path) {
  return {
    path,
    url: `https://huggingface.co/datasets/${REPO}/resolve/main/${path}?download=true`,
    pageUrl: `https://huggingface.co/datasets/${REPO}/blob/main/${path}`,
  };
}

/**
 * Commits one EPUB to the dataset repo.
 * @returns {Promise<{path:string,url:string,pageUrl:string}>}
 */
export async function uploadToLibrary(buffer, filename, meta = {}) {
  if (!libraryEnabled()) throw new Error("HUGGINGFACE_TOKEN not configured");
  if (buffer.length < 100 * 1024) throw new Error("file too small for community library (min 100 KB)");
  if (buffer.length > MAX_BYTES) throw new Error("file too large for the library");

  const { path, base } = libraryEpubPath(filename);
  const { oid, size } = await lfsUploadEpub(buffer, path);

  const lines = [
    JSON.stringify({
      key: "header",
      value: {
        summary: `Add ${meta.title || base}`,
        description: [meta.author && `Author: ${meta.author}`, meta.source && `Source: ${meta.source}`]
          .filter(Boolean)
          .join("\n"),
      },
    }),
    JSON.stringify({ key: "lfsFile", value: { path, algo: "sha256", oid, size } }),
  ].join("\n");

  await hfCommit(lines, `Add ${meta.title || base}`);

  return libraryEpubUrls(path);
}

/**
 * One HF commit carrying BOTH the finished EPUB and the finished job
 * state — instead of two separate commits (uploadToLibrary + saveJobState).
 * A finished book used to cost ~3 commits (create state, EPUB, done state);
 * this cuts it to ~2, which is what keeps the 128/hour cap from tripping
 * during a burst, while the library stays instant (no batching delay).
 * The `job` passed in must already carry the final done state.
 * `runInPool` (the upload pool's run) wraps ONLY the LFS upload — the
 * commit (and its 429 retry wait) runs outside the pool, so a slow retry
 * never holds the single upload slot and never blocks other books.
 * @returns {Promise<{path:string,url:string,pageUrl:string}>}
 */
export async function uploadToLibraryWithJobState(buffer, filename, meta, job, spec, runInPool) {
  if (!libraryEnabled()) throw new Error("HUGGINGFACE_TOKEN not configured");
  if (buffer.length < 100 * 1024) throw new Error("file too small for community library (min 100 KB)");
  if (buffer.length > MAX_BYTES) throw new Error("file too large for the library");

  const { path, base } = libraryEpubPath(filename);
  const { oid, size } = await runInPool(() => lfsUploadEpub(buffer, path));

  const statePath = `${JOB_STATE_PREFIX}${job.id}.json`;
  const stateContent = Buffer.from(JSON.stringify({ job, spec }), "utf8").toString("base64");
  const lines = [
    JSON.stringify({
      key: "header",
      value: {
        summary: `Add ${meta.title || base} (+ job state)`,
        description: [meta.author && `Author: ${meta.author}`, meta.source && `Source: ${meta.source}`]
          .filter(Boolean)
          .join("\n"),
      },
    }),
    JSON.stringify({ key: "lfsFile", value: { path, algo: "sha256", oid, size } }),
    JSON.stringify({ key: "file", value: { path: statePath, content: stateContent, encoding: "base64" } }),
  ].join("\n");

  await hfCommit(lines, `Add ${meta.title || base} + job state`);

  return libraryEpubUrls(path);
}

/** Downloads one library file (used to inspect the copy already stored). */
export async function downloadFromLibrary(path) {
  const res = await fetch(
    `https://huggingface.co/datasets/${REPO}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}?download=true`,
    { headers: token() ? { Authorization: `Bearer ${token()}` } : {}, signal: AbortSignal.timeout(120_000) }
  );
  if (!res.ok) throw new Error(`HF download failed (${res.status}) for ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Removes one file from the dataset repo (single-file commit). Deletes are
 * cleanup, not content — a 429 on one is not retried, so a burst of
 * expiries cannot burn the commit budget on removals. */
export async function deleteFromLibrary(path) {
  if (!libraryEnabled()) throw new Error("HUGGINGFACE_TOKEN not configured");
  const lines = [
    JSON.stringify({
      key: "header",
      value: { summary: `Remove ${path}`, description: "Replaced by a better shared copy" },
    }),
    JSON.stringify({ key: "deletedFile", value: { path } }),
  ].join("\n");
  await hfCommit(lines, `Remove ${path}`, { retry: false });
}

// ── Durable job state (survives Heroku restarts) ─────────────
// Heroku's dyno filesystem is ephemeral: the local STATE_DIR (under
// os.tmpdir()) is wiped on every deploy/restart, so a running job's
// persisted {job, spec} vanished with it and restoreJobs() had nothing to
// resume. Job state is therefore ALSO kept in this dataset under
// job-state/<job-id>.json, so a restart can re-queue the job and it
// finishes instead of being lost. Small JSON files go through the same
// commit API as deleteFromLibrary (no LFS). All three helpers are
// best-effort: they throw when HF is unavailable, and callers must never
// let a state save/delete fail a conversion.

/** Save one job's {job, spec} to the dataset (overwrites the previous state). */
export async function saveJobState(job, spec) {
  if (!libraryEnabled()) throw new Error("HUGGINGFACE_TOKEN not configured");
  const path = `${JOB_STATE_PREFIX}${job.id}.json`;
  const content = Buffer.from(JSON.stringify({ job, spec }), "utf8").toString("base64");
  const lines = [
    JSON.stringify({ key: "header", value: { summary: `Save job state ${job.id}`, description: job.title || "" } }),
    // The commit API's file operation carries base64 content plus an
    // explicit encoding flag (see the HF commit NDJSON shape:
    // {"key": "file", "value": {"path", "content", "encoding": "base64"}}).
    JSON.stringify({ key: "file", value: { path, content, encoding: "base64" } }),
  ].join("\n");
  await hfCommit(lines, `Save job state ${job.id}`);
  return { path };
}

/** Remove one job's durable state file. Deletes are batched: forgetting a
 * job used to cost one commit each (~36/hour, a third of the 128/hour
 * cap) on pure cleanup. Paths are queued and committed together every
 * few minutes (or when enough pile up), so cleanup costs ~1 commit per
 * batch. A failed batch stays queued and retries on the next flush.
 * Best-effort: callers must never let a cleanup failure break a job. */
const DELETE_BATCH_MAX = 20;
const DELETE_FLUSH_MS = 5 * 60 * 1000;
const deleteQueue = new Set();
let deleteFlushTimer = null;

function scheduleDeleteFlush() {
  if (deleteFlushTimer) return;
  deleteFlushTimer = setTimeout(() => {
    deleteFlushTimer = null;
    flushDeleteQueue().catch(() => {});
  }, DELETE_FLUSH_MS);
  // Don't keep the process alive just for a pending cleanup flush.
  deleteFlushTimer.unref?.();
}

export async function flushDeleteQueue() {
  if (!deleteQueue.size || !libraryEnabled()) return;
  const paths = [...deleteQueue];
  deleteQueue.clear();
  const lines = [
    JSON.stringify({
      key: "header",
      value: { summary: `Remove ${paths.length} job-state file(s)`, description: "Expired/cancelled job cleanup" },
    }),
    ...paths.map((p) => JSON.stringify({ key: "deletedFile", value: { path: p } })),
  ].join("\n");
  try {
    await hfCommit(lines, `Remove ${paths.length} job-state file(s)`, { retry: false });
  } catch {
    // Keep them queued for the next flush.
    for (const p of paths) deleteQueue.add(p);
    throw new Error("HF delete batch failed");
  }
}

export function deleteJobState(id) {
  if (!libraryEnabled()) return Promise.resolve();
  deleteQueue.add(`${JOB_STATE_PREFIX}${id}.json`);
  if (deleteQueue.size >= DELETE_BATCH_MAX) {
    flushDeleteQueue().catch(() => {});
  } else {
    scheduleDeleteFlush();
  }
  return Promise.resolve();
}

/** List and download every durable job-state file. Returns [{job, spec}]. */
export async function listJobStates() {
  const res = await fetch(
    `https://huggingface.co/api/datasets/${REPO}/tree/main/${JOB_STATE_PREFIX}?recursive=true&limit=1000`,
    { headers: token() ? { Authorization: `Bearer ${token()}` } : {}, signal: AbortSignal.timeout(30_000) }
  );
  if (!res.ok) throw new Error(`HF job-state list failed (${res.status})`);
  const entries = await res.json();
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e?.type !== "file" || !/\.json$/i.test(e.path || "")) continue;
    try {
      const buf = await downloadFromLibrary(e.path);
      const parsed = JSON.parse(buf.toString("utf8"));
      if (parsed?.job?.id) out.push(parsed);
    } catch {
      /* skip a corrupt/unreadable state file */
    }
  }
  return out;
}
