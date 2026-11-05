import { createHmac, timingSafeEqual } from "node:crypto";
import { environment } from "@/lib/cloud/store";

export const READ_COOKIE = "lister_live_reader";
export function issue(
  session: string,
  purpose: "pair" | "read",
  now = Date.now(),
) {
  const exp = now + (purpose === "pair" ? 10 * 60_000 : 12 * 3600_000);
  return `${session}.${exp}.${mac(session, exp, purpose)}`;
}
function mac(session: string, exp: number, purpose: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Session unavailable");
  return createHmac("sha256", secret)
    .update(`live:${environment()}:${purpose}:${session}:${exp}`)
    .digest("hex");
}
export function verify(
  value: string | undefined,
  purpose: "pair" | "read",
  now = Date.now(),
) {
  const parts = value?.trim().split(".") ?? [];
  const [session, raw, signature] = parts;
  const exp = Number(raw);
  if (
    parts.length !== 3 ||
    !/^[a-f0-9-]{36}$/.test(session) ||
    !Number.isSafeInteger(exp) ||
    exp <= now ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null;
  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(mac(session, exp, purpose)),
  )
    ? session
    : null;
}
