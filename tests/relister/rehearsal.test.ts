import { it, expect } from "vitest";
import { rehearsal } from "../../scripts/relister-rehearsal";
it("runs the complete documented rehearsal with real local persistence and restart", async () => {
  const r = await rehearsal("/tmp/snaplist-relister-rehearsal");
  expect(r.passed).toBe(true);
  expect(new Set(r.rows.map((x) => x.newId)).size).toBe(2);
});
