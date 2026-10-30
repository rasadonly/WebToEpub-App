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
// NVIDIA free endpoint: models there are retired without notice, and the
// /v1/models catalog lists models not actually deployed for the account
// (chat calls 404 "Function not found for account"). So: discover the
// catalog, rank candidates by preference, walk them with the real chat
// call until one answers, cache the WORKING model for an hour, and
// remember the dead ones; the walk re-runs automatically when the cached
// model drops. Mirrors server/src/aiParser.js - keep the two in step.
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
const NV_MODEL_TTL_MS = 60 * 60 * 1000;
const NV_DEAD_TTL_MS = 30 * 60 * 1000;
const NV_MAX_ATTEMPTS = 4;
let nvWorking: { model: string; at: number } = { model: "", at: 0 };
let nvCatalog: { candidates: string[]; at: number } = { candidates: [], at: 0 };
const nvDead = new Map<string, number>();

function rankNvidiaModels(ids: string[]): string[] {
  if (!ids.length) return [];
  const byLower = new Map(ids.map((id) => [String(id).toLowerCase(), String(id)]));
  const out: string[] = [];
  for (const want of NV_PREFERRED_MODELS) {
    if (byLower.has(want)) out.push(byLower.get(want) as string);
  }
  const notChat = /(embed|rerank|reward|guard|vision|clip|ocr|detect|moderation|safety|content-safety|topic-control|asr|tts|image|video|diffusion|vila|kosmos|deplot|parse)/i;
  const families = [/llama/, /nemotron/, /qwen/, /gpt-oss/, /mistral|mixtral/, /gemma/, /phi/, /deepseek/];
  const scored: { id: string; score: number }[] = [];
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

async function nvidiaCandidates(nvKey: string, forceRefresh = false): Promise<string[]> {
  if (!forceRefresh && nvCatalog.candidates.length && Date.now() - nvCatalog.at < NV_MODEL_TTL_MS) {
    return nvCatalog.candidates;
  }
  try {
    const res = await fetch(`${NV_BASE}/models`, {
      headers: { Authorization: `Bearer ${nvKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const j = await res.json();
      const ids = (Array.isArray(j?.data) ? j.data : []).map((m: { id?: string }) => m?.id ?? "");
      const candidates = rankNvidiaModels(ids);
      if (candidates.length) nvCatalog = { candidates, at: Date.now() };
      return candidates;
    }
  } catch {
    /* fall through to the cached list */
  }
  return nvCatalog.candidates;
}

const nvRecentlyDead = (model: string) => {
  const at = nvDead.get(model);
  return at !== undefined && Date.now() - at < NV_DEAD_TTL_MS;
};

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

    // 2) NVIDIA free endpoint - walk ranked candidates until one answers.
    if (nvKey && (!provider || provider === "nvidia" || provider === "lovable")) {
      const tried = new Set<string>();
      for (let attempt = 0; attempt < NV_MAX_ATTEMPTS; attempt++) {
        let model = "";
        if (attempt === 0 && nvWorking.model && Date.now() - nvWorking.at < NV_MODEL_TTL_MS && !nvRecentlyDead(nvWorking.model)) {
          model = nvWorking.model;
        } else {
          const candidates = await nvidiaCandidates(nvKey, attempt === 1);
          model = candidates.find((c) => !tried.has(c) && !nvRecentlyDead(c)) ?? "";
        }
        if (!model) {
          errors.push("nvidia:no-chat-model-available");
          break;
        }
        tried.add(model);
        try {
          const res = await fetch(`${NV_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvKey}` },
            body: JSON.stringify({ model, messages, temperature, stream: false }),
            signal: AbortSignal.timeout(20000),
          });
          if (res.ok) {
            nvWorking = { model, at: Date.now() };
            return passthrough(await res.text(), res.status, res.headers.get("Content-Type"));
          }
          const t = await res.text();
          errors.push(`nvidia(${model}):${res.status}`);
          console.warn(`[ai-parse] NVIDIA ${model} failed ${res.status}: ${t.slice(0, 200)}`);
          if (res.status === 401 || res.status === 403) break; // bad key
          if (res.status === 404 || res.status === 400) {
            nvDead.set(model, Date.now());
            if (nvWorking.model === model) nvWorking = { model: "", at: 0 };
            continue; // retired or not deployed for this account - next candidate
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
