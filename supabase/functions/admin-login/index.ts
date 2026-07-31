import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!password || password.length > 200) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const expected = Deno.env.get('ADMIN_PASSWORD') ?? ''
    // constant-time-ish comparison
    const enc = new TextEncoder()
    const a = enc.encode(password)
    const b = enc.encode(expected)
    let diff = a.length ^ b.length
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
    }
    const ok = expected.length > 0 && diff === 0

    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
