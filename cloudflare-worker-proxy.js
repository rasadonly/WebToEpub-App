/**
 * Cloudflare Worker - CORS Proxy for epub-novel-forge
 *
 * DEPLOY FREE (100k requests/day):
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Click "Edit Code", paste this entire file, click "Deploy"
 *   3. Your proxy URL: https://<name>.<subdomain>.workers.dev/api/proxy?url=
 *
 * Add that URL to HttpClient.CORS_PROXIES in HttpClient.js
 *
 * GET requests are proxied as before. Other methods (POST) are forwarded
 * with their body, Content-Type and Apollo preflight headers so JSON APIs
 * that reject GET-only proxies (e.g. Ridibooks' GraphQL + web viewer) can
 * be reached through the worker as well.
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
      const isGet = request.method === "GET" || request.method === "HEAD";
      const headers = {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      };
      const init = { method: request.method, headers, redirect: "follow" };

      if (isGet) {
        headers["Accept"] =
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      } else {
        // Forward the caller's payload and the headers JSON APIs check.
        headers["Accept"] = request.headers.get("Accept") || "application/json";
        const ct = request.headers.get("Content-Type");
        if (ct) headers["Content-Type"] = ct;
        // Apollo Server's CSRF guard accepts requests carrying either of
        // these headers even when a proxy rewrote the Content-Type.
        const preflight = request.headers.get("Apollo-Require-Preflight");
        if (preflight) headers["Apollo-Require-Preflight"] = preflight;
        const opName = request.headers.get("x-apollo-operation-name");
        if (opName) headers["x-apollo-operation-name"] = opName;
        // Same-origin context some APIs require (e.g. Ridibooks' viewer).
        headers["Origin"] = target.origin;
        headers["Referer"] = target.origin + "/";
        init.body = await request.arrayBuffer();
      }

      const upstream = await fetch(targetUrl, init);

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
