// Server-only: node:crypto cannot be bundled into a browser component.
// The shared database is a read-only credential source. Never update its row.
import { createDecipheriv } from "node:crypto";
import { boundedFetch } from "@/lib/network";
import {
  EBAY_ACC_BASE,
  EBAY_MARKETPLACE_ID,
  EBAY_TOKEN_URL,
  getEbayAppCreds,
  basicAuthHeader,
} from "./config";

export class SharedEbayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function checkedStep<T>(
  code: string,
  message: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SharedEbayError) throw error;
    // Report only allowlisted exception categories, never an exception's
    // message, stack, URL, headers, response body or arbitrary cause object.
    const cause =
      error instanceof Error
        ? (error as Error & { cause?: { code?: unknown } }).cause?.code
        : undefined;
    const category = [
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ERR_INVALID_URL",
      "UND_ERR_INVALID_ARG",
      "ERR_INVALID_CHAR",
    ].includes(String(cause))
      ? String(cause)
      : error instanceof SyntaxError
        ? "INVALID_JSON"
        : error instanceof Error &&
            ["TimeoutError", "AbortError", "TypeError"].includes(error.name)
          ? error.name
          : "UNEXPECTED_ERROR";
    console.error("[ebay/test-connection]", code, category);
    throw new SharedEbayError(code, `${message} (${category})`);
  }
}

export function isSharedEbayConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_EU_URL &&
    process.env.SUPABASE_EU_SECRET_KEY &&
    process.env.EBAY_TOKEN_ENCRYPTION_KEY,
  );
}

export function decryptSharedRefreshToken(
  encrypted: unknown,
  keyHex: string,
): string {
  try {
    if (!/^[a-f\d]{64}$/i.test(keyHex) || typeof encrypted !== "string")
      throw new Error();
    const parts = encrypted.split(":");
    if (
      parts.length !== 4 ||
      parts[0] !== "v1" ||
      !/^[a-f\d]{24}$/i.test(parts[1]) ||
      !/^[a-f\d]{32}$/i.test(parts[2]) ||
      !/^(?:[a-f\d]{2})+$/i.test(parts[3])
    )
      throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keyHex, "hex"),
      Buffer.from(parts[1], "hex"),
    );
    decipher.setAuthTag(Buffer.from(parts[2], "hex"));
    const token = Buffer.concat([
      decipher.update(Buffer.from(parts[3], "hex")),
      decipher.final(),
    ]).toString("utf8");
    if (!token.trim()) throw new Error();
    return token;
  } catch {
    throw new SharedEbayError(
      "DECRYPTION_FAILED",
      "Der gespeicherte eBay-Schlüssel konnte nicht entschlüsselt werden. Verschlüsselungsschlüssel und Speicherformat prüfen.",
    );
  }
}

// Intentionally private: testing this connection must not enable publishing or
// copy the shared refresh token into the existing browser-cookie OAuth flow.
async function sharedAccessToken(): Promise<string> {
  const url = process.env.SUPABASE_EU_URL?.trim();
  const secret = process.env.SUPABASE_EU_SECRET_KEY?.trim();
  const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY?.trim();
  if (
    !url ||
    !secret ||
    !key ||
    !process.env.EBAY_CLIENT_ID ||
    !process.env.EBAY_CLIENT_SECRET
  ) {
    throw new SharedEbayError(
      "CONFIGURATION_MISSING",
      "Server-Einstellungen für die gespeicherte eBay-Verbindung fehlen.",
    );
  }
  if (!/^[a-f\d]{64}$/i.test(key)) {
    throw new SharedEbayError(
      "DECRYPTION_FAILED",
      "Der Verschlüsselungsschlüssel muss aus 64 Hex-Zeichen bestehen.",
    );
  }
  const endpoint = await checkedStep(
    "CONFIGURATION_INVALID",
    "Die Supabase-Adresse ist ungültig. SUPABASE_EU_URL im Vercel-Projekt SNAPLIST prüfen.",
    async () => new URL("/rest/v1/ebay_oauth_tokens", url),
  );
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new SharedEbayError(
      "CONFIGURATION_INVALID",
      "Die Supabase-Adresse muss eine gültige HTTPS-Adresse sein.",
    );
  }
  endpoint.search = new URLSearchParams({
    select: "refresh_token_encrypted",
    id: "eq.1",
    limit: "1",
  }).toString();
  // sb_secret_* keys authenticate through apikey; only legacy JWT service-role
  // keys should also be sent as a Bearer token to PostgREST.
  const headers: Record<string, string> = { apikey: secret };
  if (!secret.startsWith("sb_secret_"))
    headers.Authorization = `Bearer ${secret}`;
  const stored = await checkedStep(
    "DATABASE_REQUEST_FAILED",
    "Die Verbindung zur EU-Supabase-Datenbank ist fehlgeschlagen. Projektadresse und Erreichbarkeit prüfen.",
    () =>
      boundedFetch(endpoint, {
        headers,
        cache: "no-store",
        redirect: "error",
      }),
  );
  if (!stored.ok)
    throw new SharedEbayError(
      "DATABASE_FAILED",
      "Der gespeicherte eBay-Zugang konnte nicht aus Supabase gelesen werden.",
    );
  const rows = await checkedStep(
    "DATABASE_RESPONSE_INVALID",
    "Supabase hat keine gültigen Daten geliefert. SUPABASE_EU_URL muss die Supabase-Projektadresse sein.",
    () => stored.json(),
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new SharedEbayError(
      "TOKEN_MISSING",
      "In ebay_oauth_tokens fehlt der gespeicherte Zugang mit id = 1.",
    );
  }
  const refreshToken = decryptSharedRefreshToken(
    rows[0]?.refresh_token_encrypted,
    key,
  );
  const response = await checkedStep(
    "EBAY_REQUEST_FAILED",
    "Die Verbindung zum eBay-Anmeldeserver ist fehlgeschlagen.",
    () =>
      boundedFetch(EBAY_TOKEN_URL, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuthHeader(getEbayAppCreds()),
        },
        // Omit scope, as in ebay-ki-tools: retain the original consent's scopes.
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      }),
  );
  if (!response.ok) {
    // Do not echo or log upstream response bodies, which may contain secrets.
    if (response.status === 401)
      throw new SharedEbayError(
        "APP_CREDENTIALS_REJECTED",
        "eBay lehnt die App-Zugangsdaten ab. EBAY_CLIENT_ID und EBAY_CLIENT_SECRET müssen zum selben Production-Schlüsselpaar wie in ebay-ki-tools gehören.",
      );
    throw new SharedEbayError(
      "TOKEN_REFRESH_FAILED",
      "eBay konnte den Zugang nicht erneuern. App-Schlüsselpaar und Gültigkeit der ursprünglichen Freigabe prüfen.",
    );
  }
  const result = await checkedStep(
    "TOKEN_RESPONSE_INVALID",
    "eBay hat eine ungültige Antwort auf die Zugangserneuerung geliefert.",
    () => response.json(),
  );
  if (
    typeof result.access_token !== "string" ||
    !result.access_token ||
    !Number.isFinite(result.expires_in) ||
    result.expires_in <= 0
  ) {
    throw new SharedEbayError(
      "TOKEN_RESPONSE_INVALID",
      "eBay hat keinen gültigen kurzlebigen Zugang geliefert.",
    );
  }
  return result.access_token;
}

export async function testSharedEbayConnection(): Promise<void> {
  const token = await sharedAccessToken();
  const endpoint = new URL(`${EBAY_ACC_BASE}/fulfillment_policy`);
  endpoint.searchParams.set("marketplace_id", EBAY_MARKETPLACE_ID);
  const response = await checkedStep(
    "ACCOUNT_REQUEST_FAILED",
    "Der Zugang wurde erneuert, aber der eBay-Kontoserver ist nicht erreichbar.",
    () =>
      boundedFetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      }),
  );
  if (!response.ok)
    throw new SharedEbayError(
      "ACCOUNT_READ_FAILED",
      "Der Zugang wurde erneuert, aber eBay erlaubt das Lesen der Versandrichtlinien nicht. Kontofreigabe und Marktplatz prüfen.",
    );
  // A successful account read proves more than merely finding a stored token.
  // No account data or tokens are returned to the browser or persisted here.
}
