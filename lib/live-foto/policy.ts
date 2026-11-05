export const LIVE = "live-foto";
export const SESSION = "live-foto-session";
export const MAX_PHOTOS = 12;
export const MAX_BYTES = 2_000_000;
export const RETAIN = "9999-12-31T00:00:00Z";

export function sameManifest(
  a: { sku: string; photoIds: string[] },
  b: typeof a,
) {
  return a.sku === b.sku && a.photoIds.join() === b.photoIds.join();
}

export function hasCompleteManifest(ids: string[], uploaded: string[]) {
  const present = new Set(uploaded);
  return (
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => present.has(id))
  );
}

export function orphanCandidates(
  rows: { client_id: string; created_at: string }[],
  used: string[],
  now: number,
) {
  return rows.filter(
    (p) =>
      !used.includes(p.client_id) &&
      Date.parse(p.created_at) + 7 * 86400_000 <= now,
  );
}

export type PublicationProof = {
  result: "success" | "failed" | "unknown";
  independentlyVerified: boolean;
  verifiedAt?: number;
  ebayOwnsAllImages: boolean;
  activeReferences: number;
  retainUntil?: number;
};
export function scheduledDeletion(proof: PublicationProof) {
  if (
    proof.result !== "success" ||
    !proof.independentlyVerified ||
    !proof.ebayOwnsAllImages ||
    proof.activeReferences !== 0 ||
    !Number.isFinite(proof.verifiedAt)
  )
    return null;
  return Math.max(proof.verifiedAt! + 86400_000, proof.retainUntil ?? 0);
}
