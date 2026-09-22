#!/usr/bin/env python3
"""
Stealth fetch sidecar.

Small local HTTP service used by the Node server when a site blocks plain
fetch (Cloudflare "Just a moment...", 403, 429).

Chain, in order:
  1. curl_cffi with a real Chrome TLS/JA3 fingerprint  (beats most CF checks)
  2. cloudscraper                                      (solves JS challenges)
  3. the same two again through Tor (socks5h://127.0.0.1:9050) for IP bans

Endpoints:
  GET /health
  GET /fetch?url=<encoded>&tor=0|1|auto&timeout=<seconds>
      -> body of the page, with headers:
         X-Stealth-Route : which engine/route succeeded
         X-Stealth-Error : failure reason (on 5xx)
"""

import json
import os
import socket
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("STEALTH_PORT", "8191"))
TOR_PROXY = os.environ.get("TOR_PROXY", "socks5h://127.0.0.1:9050")
DEFAULT_TIMEOUT = int(os.environ.get("STEALTH_TIMEOUT", "45"))

try:
    from curl_cffi import requests as cffi_requests
except Exception:  # pragma: no cover
    cffi_requests = None

try:
    import cloudscraper
except Exception:  # pragma: no cover
    cloudscraper = None

IMPERSONATE = os.environ.get("CURL_IMPERSONATE", "chrome124")

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}

CHALLENGE_MARKERS = (
    "just a moment",
    "cf-browser-verification",
    "challenge-platform",
    "cf_chl_opt",
    "checking your browser before",
    "enable javascript and cookies to continue",
)


def looks_like_challenge(text: str) -> bool:
    head = (text or "")[:5000].lower()
    return any(m in head for m in CHALLENGE_MARKERS)


def tor_up() -> bool:
    try:
        host_port = TOR_PROXY.split("://", 1)[-1]
        host, port = host_port.split(":")
        with socket.create_connection((host, int(port)), timeout=2):
            return True
    except Exception:
        return False


def try_cffi(url, timeout, proxy=None):
    if cffi_requests is None:
        raise RuntimeError("curl_cffi not installed")
    proxies = {"http": proxy, "https": proxy} if proxy else None
    r = cffi_requests.get(
        url,
        impersonate=IMPERSONATE,
        headers=HEADERS,
        timeout=timeout,
        proxies=proxies,
        allow_redirects=True,
    )
    return r.status_code, r.text, r.headers.get("content-type", "")


def try_cloudscraper(url, timeout, proxy=None):
    if cloudscraper is None:
        raise RuntimeError("cloudscraper not installed")
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    proxies = {"http": proxy, "https": proxy} if proxy else None
    r = scraper.get(url, headers=HEADERS, timeout=timeout, proxies=proxies)
    return r.status_code, r.text, r.headers.get("content-type", "")


def fetch(url, tor_mode="auto", timeout=DEFAULT_TIMEOUT):
    routes = [("curl_cffi", try_cffi, None), ("cloudscraper", try_cloudscraper, None)]
    if tor_mode != "0" and tor_up():
        routes += [
            ("curl_cffi+tor", try_cffi, TOR_PROXY),
            ("cloudscraper+tor", try_cloudscraper, TOR_PROXY),
        ]
    if tor_mode == "1" and tor_up():
        routes.reverse()

    last = "no route available"
    for name, fn, proxy in routes:
        try:
            status, text, ctype = fn(url, timeout, proxy)
            if status < 400 and text and not looks_like_challenge(text):
                return name, text, ctype
            last = f"{name}: HTTP {status}" + (" (challenge)" if looks_like_challenge(text) else "")
        except Exception as exc:  # keep trying the next route
            last = f"{name}: {exc}"
    raise RuntimeError(last)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):  # quiet
        pass

    def _send(self, code, body: bytes, headers=None):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/health":
            payload = json.dumps(
                {
                    "ok": True,
                    "curl_cffi": cffi_requests is not None,
                    "cloudscraper": cloudscraper is not None,
                    "tor": tor_up(),
                }
            ).encode()
            return self._send(200, payload, {"Content-Type": "application/json"})

        if parsed.path != "/fetch":
            return self._send(404, b"not found", {"Content-Type": "text/plain"})

        url = (qs.get("url") or [""])[0]
        if not url.startswith("http"):
            return self._send(400, b"bad url", {"Content-Type": "text/plain"})

        tor_mode = (qs.get("tor") or ["auto"])[0]
        try:
            timeout = min(int((qs.get("timeout") or [DEFAULT_TIMEOUT])[0]), 90)
        except ValueError:
            timeout = DEFAULT_TIMEOUT

        try:
            route, text, ctype = fetch(url, tor_mode, timeout)
            self._send(
                200,
                text.encode("utf-8", "replace"),
                {
                    "Content-Type": ctype or "text/html; charset=utf-8",
                    "X-Stealth-Route": route,
                },
            )
        except Exception as exc:
            self._send(
                502,
                str(exc).encode("utf-8", "replace")[:2000],
                {"Content-Type": "text/plain", "X-Stealth-Error": "1"},
            )


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"[stealth] listening on 127.0.0.1:{PORT} "
          f"(curl_cffi={cffi_requests is not None}, cloudscraper={cloudscraper is not None})",
          file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    threading.current_thread().name = "stealth"
    main()
