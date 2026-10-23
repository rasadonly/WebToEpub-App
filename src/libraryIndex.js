// Server-side cache of the Community Library file list so browsers get the
// whole list in one compressed request instead of crawling the dataset.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.env.HF_LIBRARY_REPO || "prasaduser/webtoepub-library";
const REFRESH_MS = 10 * 60_000;
const CACHE_FILE = path.join(os.tmpdir(), "library-index.json");

let index = null; // { at, repo, f: [[path, size], ...] }
let refreshing = null;

try {
  const d = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  if (d && Array.isArray(d.f) && d.f.length) index = d;
} catch { /* no saved copy */ }

function authHeaders() {
  const t = (process.env.HF_LIBRARY_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || "").trim();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function paged(url) {
  const out = [];
  let pages = 0;
  while (url && pages < 100) {
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(30_000) });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (!res.ok) throw new Error(`HF tree ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page)) break;
    out.push(...page);
    pages++;
    const next = (res.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/);
    url = next && page.length ? next[1] : null;
  }
  return out;
}

async function build() {
  const base = `https://huggingface.co/api/datasets/${REPO}/tree/main/`;
  const top = await paged(`${base}books?limit=1000`);
  const dirs = top.filter((e) => e.type === "directory").map((e) => e.path);
  const files = top.filter((e) => e.type === "file");
  const queue = [...dirs];
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift();
      files.push(...(await paged(`${base}${d.split("/").map(encodeURIComponent).join("/")}?recursive=true&limit=1000`)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, dirs.length) }, worker));
  const f = files.filter((e) => e.type === "file").map((e) => [e.path, e.size ?? null]);
  if (!f.length) throw new Error("empty listing");
  // A drastically shorter list is probably a partial crawl; keep the fuller
  // one. 50% rather than 90%: a deliberate library cleanup can legitimately
  // remove a large share of files, and a 90% guard would reject the cleaned
  // listing forever and keep serving the stale index.
  if (index && f.length < index.f.length * 0.5) throw new Error(`partial listing ${f.length}/${index.f.length}`);
  index = { at: Date.now(), repo: REPO, f };
  fs.promises.writeFile(CACHE_FILE, JSON.stringify(index)).catch(() => {});
  return index;
}

export function refreshLibraryIndex() {
  if (!refreshing) {
    refreshing = build()
      .catch((e) => { console.warn("[library-index]", e.message); return index; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function getLibraryIndex() {
  if (!index) return refreshLibraryIndex();
  if (Date.now() - index.at > REFRESH_MS) refreshLibraryIndex();
  return index;
}

export function startLibraryIndex() {
  refreshLibraryIndex();
  setInterval(refreshLibraryIndex, REFRESH_MS).unref();
}
