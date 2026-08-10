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

/** Strip scripts/styles/noise so the model sees structure, not payload. */
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

async function chatJson(system, user, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  try {
    let res = null;

    if (NV_KEY) {
      res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${NV_KEY}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "meta/llama-3.1-70b-instruct",
          temperature: 0,
          response_format: { type: "json_object" },
          messages,
        }),
      });
      if (!res.ok) {
        console.warn("[aiParser] NVIDIA request failed", res.status);
        res = null;
      }
    }

    if (!res && POLL_KEY) {
      res = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${POLL_KEY}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({ model: "nova-fast", temperature: 0, messages }),
      });
      if (!res.ok) {
        console.warn("[aiParser] Pollinations request failed", res.status);
        res = null;
      }
    }

    // No local provider keys (or both failed) — use the ai-parse proxy, which
    // holds the keys server-side.
    if (!res) {
      res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_ANON}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({ temperature: 0, messages }),
      });
    }

    if (!res.ok) {
      console.warn("[aiParser] request failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    if (json?.error) {
      console.warn("[aiParser] provider error", JSON.stringify(json.error).slice(0, 200));
      return null;
    }
    return extractJson(json?.choices?.[0]?.message?.content || "");
  } catch (e) {
    console.warn("[aiParser] request error", e?.message || e);
    return null;
  } finally {
    clearTimeout(timer);
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
${simplifyHtml(html).slice(0, 30000)}`
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
${simplifyHtml(html).slice(0, 30000)}`
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
