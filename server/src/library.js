// Uploads finished EPUBs to the shared Hugging Face dataset library so users
// get a permanent download link in addition to the local file.
//
// Dataset: https://huggingface.co/datasets/prasadonly/webtoepub-library
// Requires the HUGGINGFACE_TOKEN (write scope) env var. Without it the upload
// is silently skipped — conversions keep working exactly as before.

const REPO = process.env.HF_LIBRARY_REPO || "prasadonly/webtoepub-library";
const MAX_BYTES = Number(process.env.HF_LIBRARY_MAX_BYTES || 40 * 1024 * 1024);

function token() {
  return process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || "";
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
  if (buffer.length > MAX_BYTES) throw new Error("file too large for the library");

  const base = slug(filename.replace(/\.epub$/i, ""));
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `books/${stamp}/${base}-${rand}.epub`;

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
    JSON.stringify({
      key: "file",
      value: { path, encoding: "base64", content: Buffer.from(buffer).toString("base64") },
    }),
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
    throw new Error(`HF upload failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return {
    path,
    url: `https://huggingface.co/datasets/${REPO}/resolve/main/${path}?download=true`,
    pageUrl: `https://huggingface.co/datasets/${REPO}/blob/main/${path}`,
  };
}
