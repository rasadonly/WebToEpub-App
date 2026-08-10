// Free AI proxy for the WebToEpub AiClient — routes OpenAI-compatible chat
// requests to NVIDIA API, with a fallback to Pollinations AI.
// Used to auto-detect selectors on unknown/failed sites.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const nvKey = Deno.env.get("NVIDIA_API_KEY");
    const pollKey = Deno.env.get("POLLINATIONS_API_KEY");

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const temperature = typeof body?.temperature === "number" ? body.temperature : 0;

    let responseText = "";
    let statusCode = 500;
    let contentType = "application/json";

    // Try NVIDIA first if key is available
    if (nvKey) {
      const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${nvKey}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-70b-instruct",
          messages,
          temperature,
          stream: false,
        }),
      });
      if (nvRes.ok) {
        return new Response(await nvRes.text(), {
          status: nvRes.status,
          headers: {
            ...corsHeaders,
            "Content-Type": nvRes.headers.get("Content-Type") ?? "application/json",
          },
        });
      } else {
        console.warn(`[ai-parse] NVIDIA request failed with status ${nvRes.status}`);
      }
    }

    // Fallback to Pollinations AI
    const pollRes = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(pollKey ? { "Authorization": `Bearer ${pollKey}` } : {}),
      },
      body: JSON.stringify({
        model: "nova-fast",
        messages,
        temperature,
        stream: false,
      }),
    });
    
    return new Response(await pollRes.text(), {
      status: pollRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": pollRes.headers.get("Content-Type") ?? "application/json",
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
