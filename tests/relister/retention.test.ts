import { expect, it } from "vitest";
import { expiredCompletedBackups } from "../../lib/relister/retention";
import type { Job, Row } from "../../lib/relister/domain";

const cutoff = Date.parse("2026-11-08T12:00:00Z");
const row = (id: string, phase: Row["phase"], completedAt: string) => ({
  id, phase, newId: "123456789",
  history: [{ phase, at: completedAt, note: "Ergebnis gespeichert" }],
  backup: { images: [{ path: `owner/${id}/image-0` }] },
  outgoing: { Title: "Brille" },
}) as Row;
const job = (...rows: Row[]) => ({ account: "owner", rows }) as Job;

it("expires only the old, successfully checked article in a mixed batch", () => {
  const completed = row("complete", "completed", "2026-11-08T11:00:00Z");
  const recent = row("recent", "completed", "2026-11-08T13:00:00Z");
  const review = row("review", "review", "2026-11-07T11:00:00Z");
  const result = expiredCompletedBackups(job(completed, recent, review), cutoff)!;
  expect(result.paths).toEqual(["owner/complete/image-0", "owner/complete/backup.json"]);
  expect(result.document.rows[0]).toMatchObject({phase: "completed", newId: completed.newId, history: completed.history});
  expect(result.document.rows[0]).not.toHaveProperty("backup");
  expect(result.document.rows[0]).not.toHaveProperty("outgoing");
  expect(result.document.rows.slice(1)).toEqual([recent, review]);
  expect(expiredCompletedBackups(result.document, cutoff)).toBeUndefined();
});

it("leaves backups with an unverified timestamp or foreign storage path intact", () => {
  const unknown = row("unknown", "completed", "invalid");
  const foreign = row("foreign", "completed", "2026-11-07T11:00:00Z");
  foreign.backup!.images[0].path = "another-account/foreign/image-0";
  expect(expiredCompletedBackups(job(unknown, foreign), cutoff)).toBeUndefined();
});
