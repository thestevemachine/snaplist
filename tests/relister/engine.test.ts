import { describe, it, expect } from "vitest";
import {
  advance,
  TemporaryError,
  AuthorizationError,
  type Repository,
} from "../../lib/relister/engine";
import { preview } from "../../lib/relister/jobs";
import { Simulation, sampleListing } from "../../lib/relister/simulation";
import type { Job } from "../../lib/relister/domain";
function fixture() {
  const job = preview(
    "account",
    "SIMULATION",
    [sampleListing("100000000001")],
    "6",
  );
  job.confirmed = true;
  const saved: Job[] = [];
  const repo: Repository = {
    save: async (j) => {
      saved.push(structuredClone(j));
    },
    lock: async () => true,
  };
  return { job, saved, repo };
}
describe("durable re-list simulation", () => {
  it("allows only read-only postcheck recovery after a live mutation grant expires", async () => {
    const { job, repo, saved } = fixture();
    const adapter = new Simulation(job.rows);
    const row = job.rows[0];
    row.backup = await adapter.backup(row, "account");
    row.phase = "created";
    row.newId = "SIM-confirmed";
    row.createAttempted = true;
    job.mode = "live";
    repo.authorized = async () => false;
    adapter.end = async () => {
      throw Error("must not end");
    };
    adapter.create = async () => {
      throw Error("must not create");
    };
    await advance(job, row, adapter, repo);
    expect(saved.at(-1)?.rows[0].phase).toBe("completed");
    row.phase = "ready";
    await expect(advance(job, row, adapter, repo)).rejects.toThrow(
      "nicht freigegeben",
    );
  });
  it("persists clearing an earlier error only after a successful postcheck", async () => {
    const { job, repo, saved } = fixture();
    const adapter = new Simulation(job.rows);
    const row = job.rows[0];
    row.backup = await adapter.backup(row, "account");
    row.newId = "SIM-confirmed";
    row.phase = "created";
    row.error = "Previous mismatch";
    adapter.compare = async () => false;
    await advance(job, row, adapter, repo);
    expect(saved.at(-1)?.rows[0].phase).toBe("review");
    expect(saved.at(-1)?.rows[0].error).toBeTruthy();
    row.phase = "created";
    adapter.compare = async () => true;
    await advance(job, row, adapter, repo);
    expect(saved.at(-1)?.rows[0].phase).toBe("completed");
    expect(saved.at(-1)?.rows[0].error).toBeUndefined();
  });
  it("completes backup through postcheck with immutable discounted price", async () => {
    const { job, repo, saved } = fixture();
    await advance(job, job.rows[0], new Simulation(job.rows), repo);
    expect(job.rows[0].phase).toBe("completed");
    expect(job.rows[0].targetCents).toBe(4699);
    expect(saved.some((j) => j.rows[0].phase === "end_requested")).toBe(true);
    expect(job.rows[0].backup!.images[0].sha256).toHaveLength(64);
  });
  it.each(["end", "create"] as const)(
    "recovers %s timeout after serialized process restart without duplicate creation",
    async (fault) => {
      const { job, repo } = fixture();
      await advance(
        job,
        job.rows[0],
        new Simulation(job.rows, undefined, fault),
        repo,
      );
      const resumed = JSON.parse(JSON.stringify(job)) as Job;
      resumed.rows[0].nextAttemptAt = 0;
      await advance(
        resumed,
        resumed.rows[0],
        new Simulation(resumed.rows),
        repo,
      );
      expect(resumed.rows[0].phase).toBe("completed");
      expect(resumed.rows[0].targetCents).toBe(4699);
      expect(resumed.rows[0].uuid).toBe(job.rows[0].uuid);
    },
  );
  it("does not end after price changes", async () => {
    const { job, repo } = fixture(),
      adapter = new Simulation(job.rows);
    adapter.read = async () => ({
      ...sampleListing("100000000001"),
      priceCents: 5000,
    });
    await advance(job, job.rows[0], adapter, repo);
    expect(job.rows[0].phase).toBe("review");
    expect(job.rows[0].backup).toBeUndefined();
  });
  it("does not end when paused or locked by another job", async () => {
    const { job, repo } = fixture();
    job.paused = true;
    await advance(job, job.rows[0], new Simulation(job.rows), repo);
    expect(job.rows[0].phase).toBe("selected");
    job.paused = false;
    repo.lock = async () => false;
    await advance(job, job.rows[0], new Simulation(job.rows), repo);
    expect(job.rows[0].phase).toBe("skipped");
  });
  it("blocks unclear create reconciliation", async () => {
    const { job, repo } = fixture(),
      a = new Simulation(job.rows);
    job.rows[0].createAttempted = true;
    a.reconcile = async () => "unknown";
    await advance(job, job.rows[0], a, repo);
    expect(job.rows[0].phase).toBe("review");
    expect(job.rows[0].newId).toBeUndefined();
  });
  it("pauses on expired authorization and bounds rate-limit retries", async () => {
    const { job, repo } = fixture(),
      a = new Simulation(job.rows);
    a.read = async () => {
      throw new AuthorizationError();
    };
    await advance(job, job.rows[0], a, repo);
    expect(job.paused).toBe(true);
    job.paused = false;
    a.read = async () => {
      throw new TemporaryError();
    };
    job.rows[0].attempts = 5;
    await advance(job, job.rows[0], a, repo);
    expect(job.rows[0].phase).toBe("review");
  });
  it("blocks live calls even if a client forges mode", async () => {
    const { job, repo } = fixture();
    job.mode = "live";
    await expect(
      advance(job, job.rows[0], new Simulation(job.rows), repo),
    ).rejects.toThrow("nicht freigegeben");
  });
  it("blocks missing backup images and a sale in the transition", async () => {
    const f = fixture(),
      a = new Simulation(f.job.rows);
    a.backup = async () => ({
      ...(await new Simulation(f.job.rows).backup(f.job.rows[0], "account")),
      images: [],
    });
    await advance(f.job, f.job.rows[0], a, f.repo);
    expect(f.job.rows[0].phase).toBe("review");
    const g = fixture(),
      b = new Simulation(g.job.rows),
      read = b.read.bind(b);
    b.read = async (id) => ({
      ...(await read(id)),
      sold: g.job.rows[0].phase === "end_requested" ? 1 : 0,
    });
    await advance(g.job, g.job.rows[0], b, g.repo);
    expect(g.job.rows[0].phase).toBe("review");
    expect(g.job.rows[0].newId).toBeUndefined();
  });
});
