// Client for the Translate Me Hugging Face Space, used as the
// backend for linktoepub's /raw translation section.
//
// The Space exposes its Books functions through Gradio's API
// (see /config: book_search, book_fetch_toc, book_use_result,
// book_start_job, book_check_progress, book_get_epub).
// Gradio 6's direct POST /gradio_api/call/<name> and
// /gradio_api/call/v2/<name> endpoints refuse plain clients
// (405 / 500, verified 2026-11-01), but the classic queue
// protocol works with no Space changes at all:
//   POST /gradio_api/queue/join {data, fn_index, session_hash}
//   GET  /gradio_api/queue/data?session_hash=...  (SSE stream)
//   -> process_completed with output.data
//
// No Space code changes are needed for /raw. Caveats, kept
// deliberately visible here rather than hidden:
//  - Progress comes back as book_check_progress display text
//    (Status / Chapters / EPUB-ready lines), parsed below —
//    there is no JSON progress endpoint on the Space.
//  - There is no Space-side stop function. Cancelling a /raw
//    job stops linktoepub's tracking; a Space worker already
//    running finishes harmlessly in the Space's /tmp.
//  - If the Space password gate is ever re-enabled, these
//    calls will need auth and will fail openly.

const SPACE_URL = (process.env.TRANSLATE_SPACE_URL ||
  "https://learningtrade-translate-me.hf.space").replace(/\/$/, "");

let fnIndexCache = null; // api_name -> fn_index
let fnIndexAt = 0;

async function getFnIndex() {
  if (fnIndexCache && Date.now() - fnIndexAt < 60 * 60_000) {
    return fnIndexCache;
  }
  const res = await fetch(`${SPACE_URL}/config`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Space /config failed (${res.status})`);
  const cfg = await res.json();
  const map = {};
  for (let i = 0; i < (cfg.dependencies || []).length; i++) {
    const name = cfg.dependencies[i]?.api_name;
    if (name) map[name] = i;
  }
  if (!map.book_search) throw new Error("Space /config has no Books API");
  fnIndexCache = map;
  fnIndexAt = Date.now();
  return map;
}

/**
 * Call one Space Books function and wait for its result.
 * @param {string} apiName e.g. "book_search"
 * @param {Array} data positional inputs, exactly as the Gradio
 *   function takes them
 * @param {number} timeoutMs overall wait (TOC fetches and
 *   translations can take minutes; callers pass more)
 * @returns {Promise<Array>} output.data, positional outputs
 */
export async function callSpace(apiName, data, timeoutMs = 300_000) {
  const fnMap = await getFnIndex();
  const fnIndex = fnMap[apiName];
  if (fnIndex === undefined) {
    throw new Error(`Space has no function ${apiName}`);
  }
  const session = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const join = await fetch(`${SPACE_URL}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: session }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!join.ok) {
    const t = await join.text().catch(() => "");
    throw new Error(`Space queue join failed (${join.status}): ${t.slice(0, 200)}`);
  }
  const started = Date.now();
  const res = await fetch(
    `${SPACE_URL}/gradio_api/queue/data?session_hash=${session}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Space queue stream failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Space call ${apiName} timed out`);
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          let msg;
          try {
            msg = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (msg.msg === "process_completed") {
            return msg.output?.data ?? [];
          }
          if (msg.msg === "process_failed" || msg.msg === "error") {
            throw new Error(
              `Space ${apiName} failed: ${msg.output?.error || msg.message || "unknown"}`,
            );
          }
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
  throw new Error(`Space call ${apiName} ended without a result`);
}

/** Parse book_check_progress display text into fields. */
export function parseSpaceProgress(text) {
  const out = {
    status: "running",
    done: 0,
    failed: 0,
    total: 0,
    epubReady: false,
    failedChapters: [],
  };
  const t = String(text || "");
  const status = t.match(/Status:\s*([A-Za-z_]+)/);
  if (status) out.status = status[1];
  const ch = t.match(
    /Chapters:\s*(\d+)\s*done,\s*(\d+)\s*failed,\s*(\d+)\s*total/,
  );
  if (ch) {
    out.done = Number(ch[1]);
    out.failed = Number(ch[2]);
    out.total = Number(ch[3]);
  }
  out.epubReady = /EPUB ready:\s*yes/i.test(t);
  const failSection = t.split(/Failed chapters:/i)[1];
  if (failSection) {
    out.failedChapters = failSection
      .split("\n")
      .map((l) => l.replace(/^[-•\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  return out;
}

/**
 * Download a Gradio file output (book_get_epub's first output).
 * Gradio returns {path, url, orig_name, size, mime_type}; url is
 * usually "/gradio_api/file=..." relative to the Space.
 */
export async function downloadSpaceFile(fileObj) {
  const url = fileObj?.url || fileObj?.path;
  if (!url) throw new Error("Space returned no EPUB file");
  const full = /^https?:\/\//i.test(url)
    ? url
    : `${SPACE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  const res = await fetch(full, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Space EPUB download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function spaceUrl() {
  return SPACE_URL;
}
