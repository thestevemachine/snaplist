/** A missing personal vault object is allowed; permission/network errors are not. */
export function isMissingVaultObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; statusCode?: string | number; code?: string };
  const code = value.code ?? String(value.statusCode ?? "");
  if (code === "NoSuchKey" || code === "NotFound" || code === "404") return true;
  // Older Storage servers reported missing objects as a bare HTTP 400.
  // Never treat a named service error (AccessDenied, InvalidJWT, etc.) as missing.
  return code === "400" && !value.code;
}
