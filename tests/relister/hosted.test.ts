import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { accountDb } from "../../lib/accounts/server";
import { preview, processJob } from "../../lib/relister/jobs";
import {
  Simulation,
  sampleListing,
  fixtureImage,
} from "../../lib/relister/simulation";
import { secureBackup, restoreImages } from "../../lib/relister/backup";
import { samplePayload } from "../../lib/relister/simulation";
import { advance } from "../../lib/relister/engine";
import { repository } from "../../lib/relister/store";
// Explicit opt-in; no production URL can pass this guard. Secrets never logged.
const enabled = process.env.RELISTER_HOSTED_TEST === "true";
if (enabled) {
  const path = process.env.RELISTER_TEST_ENV_FILE;
  if (!path) throw Error("Testkonfiguration fehlt.");
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at > 0)
      process.env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (
    process.env.SUPABASE_EU_URL !== "https://xfprtvwsjlvwcaywgwyw.supabase.co"
  )
    throw Error("Nur isoliertes Testprojekt erlaubt.");
}
it.skipIf(!enabled)(
  "hosted test: actual protected storage, worker, durable job and ordered restore",
  async () => {
    const account = randomUUID(),
      row = randomUUID(),
      db = accountDb(),
      paths: string[] = [];
    const store = {
      put: async (path: string, bytes: Buffer, mime: string) => {
        paths.push(path);
        const r = await db.storage
          .from("snaplist-relister")
          .upload(path, bytes, { contentType: mime, upsert: true });
        if (r.error) throw Error("Testbild-Upload fehlgeschlagen.");
      },
      get: async (path: string) => {
        const r = await db.storage.from("snaplist-relister").download(path);
        if (r.error || !r.data)
          throw Error("Testbild-Download fehlgeschlagen.");
        return Buffer.from(await r.data.arrayBuffer());
      },
    };
    const job = preview(
      account,
      "SIMULATION",
      [sampleListing("100000000001"), sampleListing("100000000002")],
      "6",
    );
    job.confirmed = true;
    try {
      const backup = await secureBackup(
        {
          account,
          rowId: row,
          seller: "SIMULATION",
          listing: sampleListing("100000000001"),
          payload: samplePayload("100000000001"),
          targetCents: 4699,
        },
        store,
        async () => ({
          data: fixtureImage,
          mime: "image/png",
          sha256: createHash("sha256").update(fixtureImage).digest("hex"),
        }),
      );
      expect((await restoreImages(backup, store))[0].data).toBe(
        fixtureImage.toString("base64"),
      );
      const inserted = await db
        .from("relister_jobs")
        .insert({
          id: job.id,
          account_id: account,
          seller: job.seller,
          document: job,
          pending: true,
        });
      if (inserted.error)
        throw Error("Testauftrag konnte nicht gespeichert werden.");
      await advance(
        job,
        job.rows[0],
        new Simulation(
          job.rows,
          async (path, bytes) => store.put(path, bytes, "image/png"),
          "create",
        ),
        repository(account),
      );
      const interrupted = await db
        .from("relister_jobs")
        .select("document")
        .eq("id", job.id)
        .single();
      if (interrupted.error)
        throw Error("Unterbrochener Auftrag nicht lesbar.");
      expect(interrupted.data.document.rows[0].phase).toBe("create_requested");
      expect(interrupted.data.document.rows[0].newId).toBeTruthy();
      interrupted.data.document.rows[0].nextAttemptAt = 0;
      await repository(account).save(interrupted.data.document);
      // processJob reconstructs fresh adapter/state from PostgreSQL, not memory.
      await processJob(job.id);
      await processJob(job.id);
      const result = await db
        .from("relister_jobs")
        .select("document,pending")
        .eq("id", job.id)
        .single();
      if (result.error) throw Error("Testauftrag konnte nicht gelesen werden.");
      expect(result.data.pending).toBe(false);
      expect(
        result.data.document.rows.every(
          (r: any) => r.phase === "completed" && r.targetCents === 4699,
        ),
      ).toBe(true);
      for (const r of result.data.document.rows) {
        paths.push(...r.backup.images.map((i: any) => i.path));
        expect(
          (await store.get(r.backup.images[0].path)).equals(fixtureImage),
        ).toBe(true);
      }
    } finally {
      // Delete only this test's UUID-namespaced fixtures, never existing data.
      await db.storage.from("snaplist-relister").remove(paths);
      await db.from("relister_claims").delete().eq("job_id", job.id);
      await db.from("relister_item_locks").delete().eq("job_id", job.id);
      await db
        .from("relister_jobs")
        .delete()
        .eq("id", job.id)
        .eq("account_id", account);
    }
  },
  60000,
);
