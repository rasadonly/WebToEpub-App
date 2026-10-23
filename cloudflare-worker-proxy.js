/**
 * epub-cors-proxy — CORS proxy for LinkToEpub.
 * Plain targets are fetched directly. ridibooks.com targets are relayed
 * through a Durable Object placed in Asia-Pacific: Ridi's firewall
 * challenges this worker's US egress, while APAC egress passes.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

async function fetchTarget(request, targetUrl) {
  const target = new URL(targetUrl);
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
    headers["Accept"] = request.headers.get("Accept") || "application/json";
    const ct = request.headers.get("Content-Type");
    if (ct) headers["Content-Type"] = ct;
    const preflight = request.headers.get("Apollo-Require-Preflight");
    if (preflight) headers["Apollo-Require-Preflight"] = preflight;
    const opName = request.headers.get("x-apollo-operation-name");
    if (opName) headers["x-apollo-operation-name"] = opName;
    headers["Origin"] = target.origin;
    headers["Referer"] = target.origin + "/";
    init.body = await request.arrayBuffer();
  }
  return fetch(targetUrl, init);
}

function wrapResponse(upstream) {
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
}

export class RidiRelay {
  async fetch(request) {
    const targetUrl = request.headers.get("x-target-url");
    if (!targetUrl)
      return new Response("missing x-target-url", { status: 400 });
    const method = request.headers.get("x-target-method") || "GET";
    const inner = new Request(targetUrl, {
      method,
      headers: request.headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
    });
    const upstream = await fetchTarget(inner, targetUrl);
    return wrapResponse(upstream);
  }
}

export default {
  async fetch(request, env) {
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
      if (/(^|\.)ridibooks\.com$/i.test(target.hostname) && env.RIDI_RELAY) {
        const stub = env.RIDI_RELAY.get(
          env.RIDI_RELAY.idFromName("ridi-relay-apac-1"),
          { locationHint: "apac" }
        );
        const headers = new Headers(request.headers);
        headers.set("x-target-url", targetUrl);
        headers.set("x-target-method", request.method);
        const relayed = await stub.fetch("https://do.relay/", {
          method: request.method,
          headers,
          body:
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : await request.arrayBuffer(),
        });
        return relayed;
      }
      const upstream = await fetchTarget(request, targetUrl);
      return wrapResponse(upstream);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  },
};
