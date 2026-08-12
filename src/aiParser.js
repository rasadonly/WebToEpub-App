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
const POLL_KEY = process.env.POLLINATIONS_API_KEY || "";

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

  let res = null;

  // 1. Try Pollinations free text API (fastest, no key needed, ~1-2s response)
  try {
    const r = await fetchWithTimeout("https://text.pollinations.ai/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages,
        temperature: 0,
      }),
    }, 10000);
    if (r.ok) res = r;
  } catch {
    /* try next */
  }

  // 2. Try NVIDIA API key if configured
  if (!res && NV_KEY) {
    try {
      const r = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${NV_KEY}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-70b-instruct",
          temperature: 0,
          response_format: { type: "json_object" },
          messages,
        }),
      }, 10000);
      if (r.ok) res = r;
    } catch {
      /* try next */
    }
  }

  // 3. Try Pollinations key endpoint if configured
  if (!res && POLL_KEY) {
    try {
      const r = await fetchWithTimeout("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${POLL_KEY}`,
        },
        body: JSON.stringify({ model: "nova-fast", temperature: 0, messages }),
      }, 10000);
      if (r.ok) res = r;
    } catch {
      /* try next */
    }
  }

  // 4. Fallback to Supabase Edge Function proxy
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
    const toc = list.map((s) => String(s || "").trim()).filter(Boolean);
    if (toc.length) {
      result = { toc, nextPage: typeof parsed.nextPage === "string" ? parsed.nextPage.trim() : "" };
    }
  }
  if (host) tocCache.set(host, result);
  return result;
}
