// AI proxy for the WebToEpub AiClient — OpenAI-compatible chat completions.
// Provider chain: Lovable AI Gateway -> NVIDIA -> Pollinations.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovKey = Deno.env.get("LOVABLE_API_KEY");
    const nvKey = Deno.env.get("NVIDIA_API_KEY");
    const pollKey = Deno.env.get("POLLINATIONS_API_KEY");

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return json({ error: "messages required" }, 400);

    const temperature = typeof body?.temperature === "number" ? body.temperature : 0;
    // Optional: force a provider ("lovable" | "nvidia" | "pollinations") for diagnostics.
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

    // 2) NVIDIA (fallback) — try a couple of model ids in case one is retired
    if (nvKey && (!provider || provider === "nvidia" || provider === "lovable")) {
      const models = ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct"];
      for (const model of models) {
        try {
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${nvKey}` },
            body: JSON.stringify({ model, messages, temperature, stream: false }),
          });
          if (res.ok) return passthrough(await res.text(), res.status, res.headers.get("Content-Type"));
          const t = await res.text();
          errors.push(`nvidia(${model}):${res.status}`);
          console.warn(`[ai-parse] NVIDIA ${model} failed ${res.status}: ${t.slice(0, 200)}`);
          if (res.status === 401 || res.status === 403) break; // bad key, don't retry other models
        } catch (e) {
          errors.push(`nvidia(${model}):${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // 3) Pollinations (last resort)
    try {
      const res = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(pollKey ? { Authorization: `Bearer ${pollKey}` } : {}),
        },
        body: JSON.stringify({ model: "nova-fast", messages, temperature, stream: false }),
      });
      if (res.ok) return passthrough(await res.text(), res.status, res.headers.get("Content-Type"));
      errors.push(`pollinations:${res.status}`);
    } catch (e) {
      errors.push(`pollinations:${e instanceof Error ? e.message : String(e)}`);
    }

    return json({ error: "All AI providers failed", details: errors }, 502);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
