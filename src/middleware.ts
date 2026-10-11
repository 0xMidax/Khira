import { NextResponse, type NextRequest } from "next/server";

/** Per-request nonce CSP: only our own scripts run, even if some user content slipped through. */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1";
  const connect = [
    "'self'",
    process.env.NEXT_PUBLIC_PUSHER_KEY && `wss://ws-${cluster}.pusher.com https://sockjs-${cluster}.pusher.com`,
    process.env.NEXT_PUBLIC_SENTRY_DSN && "https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
    process.env.S3_ENDPOINT && new URL(process.env.S3_ENDPOINT).origin,
  ]
    .filter(Boolean)
    .join(" ");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico|icon|sw.js|offline.html|pwa-icon|manifest.webmanifest).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
