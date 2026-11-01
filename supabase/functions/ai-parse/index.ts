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


// ---- NVIDIA auto-fallback ----
// Preferred chat models, best first. Only ids NVIDIA currently lists for this key are tried,
// plus any other "instruct"/"-it" chat model it lists, so retired ids are skipped automatically.
const NV_PREFERRED = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "deepseek-ai/deepseek-v4.1-flash",
  "google/gemma-4-31b-it",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "mistralai/mistral-large-2-instruct",
  "nvidia/nemotron-nano-3-30b-a3b",
];
const NV_SKIP = /embed|guard|safety|reward|parse|retriever|vision|vlm|omni|code|diffusion|-vl-|base|v0\.1$/i;
const NV_TIMEOUT_MS = 20000;
const NV_PENALTY_MS = 10 * 60 * 1000;
const nvPenalty = new Map<string, number>(); // model -> retry-after timestamp
let nvLastGood: string | null = null;
let nvList: { at: number; ids: string[] } | null = null;

async function nvAvailable(key: string): Promise<string[]> {
  if (nvList && Date.now() - nvList.at < 30 * 60 * 1000) return nvList.ids;
  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const ids = ((await r.json())?.data ?? []).map((m: { id: string }) => m.id);
      nvList = { at: Date.now(), ids };
      return ids;
    }
  } catch { /* fall back to preferred list */ }
  return NV_PREFERRED;
}

async function nvCandidates(key: string): Promise<string[]> {
  const listed = new Set(await nvAvailable(key));
  const extras = [...listed].filter((id) =>
    !NV_PREFERRED.includes(id) && /instruct|-it$|nemotron-3|flash/i.test(id) && !NV_SKIP.test(id));
  const order = [...NV_PREFERRED.filter((id) => listed.has(id)), ...extras];
  if (nvLastGood && order.includes(nvLastGood)) order.unshift(...order.splice(order.indexOf(nvLastGood), 1));
  const now = Date.now();
  const healthy = order.filter((m) => (nvPenalty.get(m) ?? 0) < now);
  return (healthy.length ? healthy : order).slice(0, 5);
}

async function tryNvidia(key: string, messages: unknown[], temperature: number, errors: string[]) {
  for (const model of await nvCandidates(key)) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(NV_TIMEOUT_MS),
        body: JSON.stringify({ model, messages, temperature, stream: false, chat_template_kwargs: { enable_thinking: false } }),
      });
      const text = await res.text();
      if (res.ok) {
        let content: unknown = null;
        try { content = JSON.parse(text)?.choices?.[0]?.message?.content; } catch { /* ignore */ }
        if (typeof content === "string" && content.trim()) {
          nvLastGood = model;
          nvPenalty.delete(model);
          return passthrough(text, 200, res.headers.get("Content-Type"));
        }
        errors.push(`nvidia(${model}):empty`);
      } else {
        errors.push(`nvidia(${model}):${res.status}`);
        console.warn(`[ai-parse] NVIDIA ${model} failed ${res.status}: ${text.slice(0, 200)}`);
        if (res.status === 401 || res.status === 403) return null; // bad key
      }
    } catch (e) {
      errors.push(`nvidia(${model}):${e instanceof Error ? e.name : String(e)}`);
      console.warn(`[ai-parse] NVIDIA ${model} slow/down: ${e instanceof Error ? e.message : e}`);
    }
    nvPenalty.set(model, Date.now() + NV_PENALTY_MS);
    if (nvLastGood === model) nvLastGood = null;
  }
  return null;
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

    // 2) NVIDIA (fallback) — auto-picks a working model; skips models that are down or slow.
    if (nvKey && (!provider || provider === "nvidia" || provider === "lovable")) {
      const r = await tryNvidia(nvKey, messages, temperature, errors);
      if (r) return r;

    }

    return json({ error: "All AI providers failed", details: errors }, 502);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
