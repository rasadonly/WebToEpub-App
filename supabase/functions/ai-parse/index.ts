// AI proxy for the WebToEpub AiClient — OpenAI-compatible chat completions.
// Provider chain: Lovable AI Gateway -> NVIDIA (auto model discovery).
// Used to auto-detect selectors on unknown/failed sites.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const passthrough = (text: string, status: number, contentType?: string | null) =>
  new Response(text, {
    status,
    headers: { ...corsHeaders, "Content-Type": contentType ?? "application/json" },
  });

// ---------------------------------------------------------------------------
// NVIDIA free endpoint: models there are retired without notice, so instead
// of hardcoding ids, discover what the endpoint serves (GET /v1/models),
// pick the best chat model by preference, cache the pick for an hour, and
// rediscover + retry once if a chat call 404s (model dropped). Mirrors the
// logic in server/src/aiParser.js — keep the two in step.
// ---------------------------------------------------------------------------
const NV_BASE = "https://integrate.api.nvidia.com/v1";
const NV_PREFERRED_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "qwen/qwen2.5-72b-instruct",
  "mistralai/mixtral-8x7b-instruct-v0.1",
  "meta/llama-3.1-405b-instruct",
  "meta/llama-3.1-8b-instruct",
];
const NV_MODEL_TTL_MS = 60 * 60 * 1000;
let nvModelCache: { model: string; at: number } = { model: "", at: 0 };

function pickNvidiaModel(ids: string[]): string {
  if (!ids.length) return "";
  const byLower = new Map(ids.map((id) => [String(id).toLowerCase(), String(id)]));
  for (const want of NV_PREFERRED_MODELS) {
    if (byLower.has(want)) return byLower.get(want) as string;
  }
  const notChat = /(embed|rerank|reward|guard|vision|clip|ocr|detect|moderation|asr|tts|image|video|diffusion|vila|kosmos|deplot)/i;
  const families = [/llama/, /nemotron/, /qwen/, /mistral|mixtral/, /gemma/, /phi/, /deepseek/];
  const scored: { id: string; score: number }[] = [];
  for (const raw of ids) {
    const id = String(raw);
    if (!/instruct|chat/i.test(id) || notChat.test(id)) continue;
    const m = id.match(/(\d+(?:\.\d+)?)\s*b\b/i);
    const size = m ? parseFloat(m[1]) : 0;
    const fam = families.findIndex((f) => f.test(id.toLowerCase()));
    const sizeScore = size >= 30 && size <= 130 ? 3 : size >= 7 ? 2 : size > 130 ? 1 : 0;
    scored.push({ id, score: (fam === -1 ? 0 : (families.length - fam) * 10) + sizeScore });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.length ? scored[0].id : "";
}

async function discoverNvidiaModel(nvKey: string): Promise<string> {
  try {
    const res = await fetch(`${NV_BASE}/models`, {
      headers: { Authorization: `Bearer ${nvKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const j = await res.json();
    const ids = (Array.isArray(j?.data) ? j.data : []).map((m: { id?: string }) => m?.id ?? "");
    return pickNvidiaModel(ids);
  } catch {
    return "";
  }
}

async function nvidiaModel(nvKey: string, forceRediscover = false): Promise<string> {
  if (!forceRediscover && nvModelCache.model && Date.now() - nvModelCache.at < NV_MODEL_TTL_MS) {
    return nvModelCache.model;
  }
  const model = await discoverNvidiaModel(nvKey);
  if (model) nvModelCache = { model, at: Date.now() };
  return model || nvModelCache.model;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovKey = Deno.env.get("LOVABLE_API_KEY");
    const nvKey = Deno.env.get("NVIDIA_API_KEY");

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return json({ error: "messages required" }, 400);

    const temperature = typeof body?.temperature === "number" ? body.temperature : 0;
    // Optional: force a provider ("lovable" | "nvidia") for diagnostics.
    const provider = typeof body?.provider === "string" ? body.provider : "";
    const errors: string[] = [];

    // 1) Lovable AI Gateway (primary)
    if (lovKey && (!provider || provider === "lovable")) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": lovKey },
          body: JSON.stringify({ model: "google/gemini-3.5-flash", messages, temperature }),
        });
        if (res.ok) return passthrough(await res.text(), res.status, res.headers.get("Content-Type"));
        errors.push(`lovable:${res.status}`);
        console.warn(`[ai-parse] Lovable AI failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        errors.push(`lovable:${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2) NVIDIA free endpoint — model auto-discovered from /v1/models, with
    // one rediscover-and-retry if the cached model has been retired.
    if (nvKey && (!provider || provider === "nvidia" || provider === "lovable")) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const model = await nvidiaModel(nvKey, attempt === 1);
        if (!model) {
          errors.push("nvidia:no-chat-model-available");
          break;
        }
        try {
          const res = await fetch(`${NV_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvKey}` },
            body: JSON.stringify({ model, messages, temperature, stream: false }),
            signal: AbortSignal.timeout(20000),
          });
          if (res.ok) return passthrough(await res.text(), res.status, res.headers.get("Content-Type"));
          const t = await res.text();
          errors.push(`nvidia(${model}):${res.status}`);
          console.warn(`[ai-parse] NVIDIA ${model} failed ${res.status}: ${t.slice(0, 200)}`);
          if (res.status === 401 || res.status === 403) break; // bad key, don't retry
          if ((res.status === 404 || res.status === 400) && attempt === 0) {
            nvModelCache = { model: "", at: 0 }; // model likely retired — rediscover
            continue;
          }
          break;
        } catch (e) {
          errors.push(`nvidia(${model}):${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }

    return json({ error: "All AI providers failed", details: errors }, 502);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
