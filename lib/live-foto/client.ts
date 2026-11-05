import { apiPost } from "@/lib/api-client";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function liveRequest<T = Record<string, never>>(
  body: object,
  image = false,
): Promise<T> {
  const r = await apiPost("/api/live-foto", body);
  if (image && r.ok) return (await r.blob()) as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok)
    throw new RequestError(
      data.error ?? "Übertragung fehlgeschlagen.",
      r.status,
    );
  return data as T;
}
export interface DraftRow {
  id: string;
  batch: string;
  sku: string;
  revision: number;
  photoIds: string[];
  status: string;
  processingMs?: number;
}
export function retryDelay(error: unknown, attempt: number) {
  const transient =
    !(error instanceof RequestError) ||
    [408, 429].includes(error.status) ||
    error.status >= 500;
  return transient && attempt <= 4
    ? Math.min(30_000, 1500 * 2 ** (attempt - 1))
    : Infinity;
}
