// Human-sounding TTS via Lovable AI (openai/gpt-4o-mini-tts) → MP3 bytes
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { text, voice = 'alloy', instructions, speed = 1.0 } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini-tts',
        input: text,
        voice,
        instructions:
          instructions ||
          'Read in a warm, natural, expressive human narrator voice. Pace naturally, honor punctuation, add gentle emotion appropriate to the story. Do not sound robotic or monotone.',
        speed,
        response_format: 'mp3',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('TTS gateway error', resp.status, errText);
      return new Response(
        JSON.stringify({ error: 'tts_failed', status: resp.status, details: errText }),
        { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(resp.body, {
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('tts crash', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
