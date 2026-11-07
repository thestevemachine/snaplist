import type { NextRequest } from "next/server";
// Next's internal URL can use localhost behind a proxy. Compare the browser
// Origin to the request Host and proxy protocol rather than that internal host.
export function resellerSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const requestUrl = new URL(req.url);
  const host = req.headers.get("host") ?? requestUrl.host;
  const protocol =
    req.headers.get("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1);
  if (protocol !== "https" && protocol !== "http") return false;
  return origin === `${protocol}://${host}`;
}
