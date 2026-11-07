import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sealConnection, openConnection } from "./ebay/session";
import { RESELLER_MODELS } from "./reseller-options";
export const RESELLER_COOKIE = "reseller_checker_session";
export const RESELLER_TTL = 30 * 24 * 60 * 60;
const sessionSchema = z.object({
  purpose: z.literal("reseller-checker-v1"),
  id: z.string().uuid(),
  model: z.string(),
  key: z.string().min(16).max(512),
  expires: z.number().finite(),
});
export type ResellerSession = z.infer<typeof sessionSchema>;
export async function createResellerSession(model: string, key: string) {
  if (
    !RESELLER_MODELS.some((m) => m.id === model) ||
    key.length < 16 ||
    key.length > 512 ||
    /\s/.test(key)
  )
    throw Error("Invalid credentials");
  const session: ResellerSession = {
    purpose: "reseller-checker-v1",
    id: randomUUID(),
    model,
    key,
    expires: Date.now() + RESELLER_TTL * 1000,
  };
  return sealConnection({
    refreshToken: JSON.stringify(session),
    refreshExpiresAt: session.expires,
  });
}
export async function readResellerSession(
  value: string | undefined,
): Promise<ResellerSession | null> {
  const opened = await openConnection(value);
  if (!opened) return null;
  try {
    const session = sessionSchema.parse(JSON.parse(opened.refreshToken));
    if (
      session.expires <= Date.now() ||
      !RESELLER_MODELS.some((m) => m.id === session.model)
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
