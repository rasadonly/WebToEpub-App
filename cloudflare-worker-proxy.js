/**
 * Cloudflare Worker - CORS Proxy for epub-novel-forge
 *
 * DEPLOY FREE (100k requests/day):
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Click "Edit Code", paste this entire file, click "Deploy"
 *   3. Your proxy URL: https://<name>.<subdomain>.workers.dev/api/proxy?url=
 *
 * Add that URL to HttpClient.CORS_PROXIES in HttpClient.js
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "url parameter required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "invalid url" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return new Response(JSON.stringify({ error: "only http/https allowed" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
        redirect: "follow",
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.delete("X-Frame-Options");
      responseHeaders.delete("Content-Security-Policy");

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  },
};
