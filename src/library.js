// Uploads finished EPUBs to the shared Hugging Face dataset library so users
// get a permanent download link in addition to the local file.
//
// Dataset: https://huggingface.co/datasets/prasadonly/webtoepub-library
// Requires the HUGGINGFACE_TOKEN (write scope) env var. Without it the upload
// is silently skipped — conversions keep working exactly as before.

import { createHash } from "node:crypto";

const REPO = process.env.HF_LIBRARY_REPO || "prasadonly/webtoepub-library";
const MAX_BYTES = Number(process.env.HF_LIBRARY_MAX_BYTES || 40 * 1024 * 1024);

function token() {
  return (process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || "").trim();
}

export function libraryEnabled() {
  return Boolean(token());
}

function slug(name) {
  return (
    String(name || "book")
      .normalize("NFKD")
      .replace(/[^\w\s.-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 80) || "book"
  );
}

/**
 * Commits one EPUB to the dataset repo.
 * @returns {Promise<{path:string,url:string,pageUrl:string}>}
 */
export async function uploadToLibrary(buffer, filename, meta = {}) {
  if (!libraryEnabled()) throw new Error("HUGGINGFACE_TOKEN not configured");
  if (buffer.length < 100 * 1024) throw new Error("file too small for community library (min 100 KB)");
  if (buffer.length > MAX_BYTES) throw new Error("file too large for the library");

  const base = slug(filename.replace(/\.epub$/i, ""));
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `books/${stamp}/${base}-${rand}.epub`;

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

  const res = await fetch(`https://huggingface.co/api/datasets/${REPO}/commit/main`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/x-ndjson",
    },
    body: lines,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HF commit failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return {
    path,
    url: `https://huggingface.co/datasets/${REPO}/resolve/main/${path}?download=true`,
    pageUrl: `https://huggingface.co/datasets/${REPO}/blob/main/${path}`,
  };
}
