// AI-assisted parsing fallback for unknown sites or sites whose selectors fail.
// Talks to the `ai-parse` edge function (Lovable AI Gateway proxy), which keeps
// the API key server-side. Results are cached per hostname for the process life.

const AI_ENDPOINT =
  process.env.AI_PARSE_URL ||
  `${process.env.SUPABASE_URL || "https://nvsxxxqlmxaompwpyfpd.supabase.co"}/functions/v1/ai-parse`;
const AI_ANON =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_d5jXjEV-OtLnfTw5YI2Nww_qH34njT8";

const selectorCache = new Map(); // host -> { content, title, remove } | null
const tocCache = new Map(); // host -> { toc } | null

export function aiEnabled() {
  return process.env.AI_PARSE_DISABLED !== "1";
}

/** Strip scripts/styles/noise and collapse long text so the model sees DOM structure instantly. */
export function simplifyHtml(html) {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+data-[\w-]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+(aria-[\w-]+|role)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+(srcset|sizes|loading|decoding)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+(src|href)\s*=\s*("data:[^"]*"|'data:[^']*')/gi, "")
    .replace(/>([^<]{25,})</g, (_m, t) => `>${t.trim().slice(0, 20)}...<`)
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1");
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

const NV_KEY = process.env.NVIDIA_API_KEY || "";

// ---------------------------------------------------------------------------
// NVIDIA free endpoint (OpenAI-compatible). Two failure modes make a
// hardcoded model id useless: models are retired without notice, and the
// /v1/models catalog lists models that are not actually deployed for the
// account (chat calls 404 with "Function not found for account"). So:
// discover the catalog, rank candidates by preference, walk them with the
// real chat call until one answers, cache the WORKING model for an hour,
// and remember the dead ones. If the cached model later drops, the walk
// runs again automatically. No code change is ever needed when NVIDIA
// rotates its free models.
// ---------------------------------------------------------------------------
const NV_BASE = "https://integrate.api.nvidia.com/v1";
const NV_PREFERRED_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "qwen/qwen2.5-72b-instruct",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "mistralai/mixtral-8x7b-instruct-v0.1",
  "meta/llama-3.1-405b-instruct",
  "meta/llama-3.1-8b-instruct",
];
const NV_MODEL_TTL_MS = 60 * 60 * 1000; // working-model + catalog cache
const NV_DEAD_TTL_MS = 30 * 60 * 1000; // how long a 404ing model stays skipped
const NV_MAX_ATTEMPTS = 4; // chat attempts per call, to stay fast
let nvWorking = { model: "", at: 0 };
let nvCatalog = { candidates: [], at: 0 };
const nvDead = new Map(); // model -> timestamp it last 404'd

/** Rank the endpoint's catalog: preferred ids first (in order), then the
 *  best-scoring remaining chat models. Returns at most 8 candidates. */
export function rankNvidiaModels(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const byLower = new Map(ids.map((id) => [String(id).toLowerCase(), String(id)]));
  const out = [];
  for (const want of NV_PREFERRED_MODELS) {
    if (byLower.has(want)) out.push(byLower.get(want));
  }
  const notChat = /(embed|rerank|reward|guard|vision|clip|ocr|detect|moderation|safety|content-safety|topic-control|asr|tts|image|video|diffusion|vila|kosmos|deplot|parse)/i;
  const families = [/llama/, /nemotron/, /qwen/, /gpt-oss/, /mistral|mixtral/, /gemma/, /phi/, /deepseek/];
  const scored = [];
  for (const raw of ids) {
    const id = String(raw);
    if (out.includes(id)) continue;
    if (!/instruct|chat|-it\b/i.test(id) || notChat.test(id)) continue;
    const m = id.match(/(\d+(?:\.\d+)?)\s*b\b/i);
    const size = m ? parseFloat(m[1]) : 0;
    const fam = families.findIndex((f) => f.test(id.toLowerCase()));
    const sizeScore = size >= 30 && size <= 130 ? 3 : size >= 7 ? 2 : size > 130 ? 1 : 0;
    scored.push({ id, score: (fam === -1 ? 0 : (families.length - fam) * 10) + sizeScore });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  for (const s of scored) {
    if (out.length >= 8) break;
    out.push(s.id);
  }
  return out;
}

async function nvidiaCandidates(forceRefresh = false) {
  if (!forceRefresh && nvCatalog.candidates.length && Date.now() - nvCatalog.at < NV_MODEL_TTL_MS) {
    return nvCatalog.candidates;
  }
  try {
    const r = await fetchWithTimeout(`${NV_BASE}/models`, {
      headers: { Authorization: `Bearer ${NV_KEY}` },
    }, 6000);
    if (r.ok) {
      const j = await r.json();
      const candidates = rankNvidiaModels((j?.data || []).map((m) => m?.id));
      if (candidates.length) nvCatalog = { candidates, at: Date.now() };
      return candidates;
    }
  } catch {
    /* fall through to the cached list */
  }
  return nvCatalog.candidates;
}

const nvRecentlyDead = (model) => {
  const at = nvDead.get(model);
  return at !== undefined && Date.now() - at < NV_DEAD_TTL_MS;
};

async function nvidiaChat(messages, timeoutMs = 10000) {
  if (!NV_KEY) return null;
  const tried = new Set();
  for (let attempt = 0; attempt < NV_MAX_ATTEMPTS; attempt++) {
    let model = "";
    if (attempt === 0 && nvWorking.model && Date.now() - nvWorking.at < NV_MODEL_TTL_MS && !nvRecentlyDead(nvWorking.model)) {
      model = nvWorking.model; // fast path: last known working model
    } else {
      const candidates = await nvidiaCandidates(attempt === 1);
      model = candidates.find((c) => !tried.has(c) && !nvRecentlyDead(c)) || "";
    }
    if (!model) return null;
    tried.add(model);
    try {
      const payload = { model, temperature: 0, messages };
      // response_format is not supported by every NIM model; the meta
      // family (a common pick) takes it, others rely on the prompt.
      if (model.startsWith("meta/")) payload.response_format = { type: "json_object" };
      const r = await fetchWithTimeout(`${NV_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NV_KEY}`,
        },
        body: JSON.stringify(payload),
      }, timeoutMs);
      if (r.ok) {
        nvWorking = { model, at: Date.now() };
        return r;
      }
      // 404 (or a model-flavoured 400): the model is retired or not
      // deployed for this account - mark it dead and try the next one.
      if (r.status === 404 || r.status === 400) {
        nvDead.set(model, Date.now());
        if (nvWorking.model === model) nvWorking = { model: "", at: 0 };
        continue;
      }
      return null; // 401/403/429/5xx - another model won't fix it, stay fast
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function chatJson(system, user, timeoutMs = 15000) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  // 1. NVIDIA free endpoint, with automatic model discovery/failover.
  let res = await nvidiaChat(messages);

  // 2. Fallback to Supabase Edge Function proxy (Lovable AI Gateway chain)
  if (!res) {
    try {
      const r = await fetchWithTimeout(AI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_ANON}`,
        },
        body: JSON.stringify({ temperature: 0, messages }),
      }, 12000);
      if (r.ok) {
        res = r;
      }
    } catch (e) {
      console.warn("[aiParser] proxy error:", e?.name === 'AbortError' ? 'timed out' : (e?.message || e));
    }
  }

  if (!res) return null;

  try {
    const json = await res.json();
    if (json?.error) return null;
    return extractJson(json?.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}


/** Ask the model for chapter-content selectors. Cached per hostname. */
export async function aiContentSelectors(html, url) {
  if (!aiEnabled()) return null;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  if (host && selectorCache.has(host)) return selectorCache.get(host);

  const parsed = await chatJson(
    "You are a web-scraping expert. Output ONLY minified JSON.",
    `Given this web-novel CHAPTER page, identify CSS selectors.
URL: ${url}

Return JSON: {"content":"selector for the element holding the story text","title":"selector for the chapter title","remove":"comma separated selectors of junk inside content (ads, nav, share, comments)"}
Prefer a single specific selector for "content". Never return "body".

HTML:
${simplifyHtml(html).slice(0, 6000)}`
  );

  let result = null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
    if (content && content.toLowerCase() !== "body") {
      result = {
        content,
        title: typeof parsed.title === "string" ? parsed.title.trim() : "",
        remove: typeof parsed.remove === "string" ? parsed.remove.trim() : "",
      };
    }
  }
  if (host) selectorCache.set(host, result);
  return result;
}

/** Ask the model for TOC chapter-link selectors. Cached per hostname. */
export async function aiTocSelectors(html, url) {
  if (!aiEnabled()) return null;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  if (host && tocCache.has(host)) return tocCache.get(host);

  const parsed = await chatJson(
    "You are a web-scraping expert. Output ONLY minified JSON.",
    `Given this web-novel TABLE OF CONTENTS page, identify how to collect chapter links.
URL: ${url}

Return JSON: {"toc":["css selector matching the chapter <a> links, most specific first"],"nextPage":"selector for the next TOC page link or empty string"}
The "toc" selectors must match anchor elements (or their direct container). Exclude navigation, recommendations and footer links.

HTML:
${simplifyHtml(html).slice(0, 6000)}`
  );

  let result = null;
  if (parsed && typeof parsed === "object") {
    const list = Array.isArray(parsed.toc)
      ? parsed.toc
      : typeof parsed.toc === "string"
        ? [parsed.toc]
        : [];
    const toc = list
      .flatMap((s) => String(s || "").split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (toc.length) {
      result = { toc, nextPage: typeof parsed.nextPage === "string" ? parsed.nextPage.trim() : "" };
    }
  }
  if (host) tocCache.set(host, result);
  return result;
}
