import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  send: vi.fn(),
  sync: vi.fn(),
  process: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("../../lib/cloud/inngest", () => ({
  inngest: {
    send: m.send,
    createFunction: (config: unknown, handler: unknown) => ({
      config,
      handler,
    }),
  },
}));
vi.mock("../../lib/relister/sync", () => ({ syncStep: m.sync }));
vi.mock("../../lib/relister/jobs", () => ({ processJob: m.process }));
vi.mock("../../lib/accounts/server", () => ({
  accountDb: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => m.queue(table) }) }),
      }),
    }),
  }),
}));
import { relisterTick, wakeRelister } from "../../lib/relister/worker";
const tick = relisterTick as unknown as {
  handler: (x: any) => Promise<unknown>;
};
const steps = () => ({
  run: vi.fn(async (_id: string, fn: () => unknown) => fn()),
  sleep: vi.fn(),
  sendEvent: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  m.queue.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("stops idle recovery without scheduling another event", async () => {
  const step = steps();
  expect(await tick.handler({ step })).toEqual({ idle: true });
  expect(step.sleep).not.toHaveBeenCalled();
  expect(step.sendEvent).not.toHaveBeenCalled();
});
it("drains persisted work then stops when the database queue is empty", async () => {
  m.queue
    .mockResolvedValueOnce({ data: [{ account_id: "a" }] })
    .mockResolvedValueOnce({ data: [{ id: "j" }] });
  const step = steps();
  await tick.handler({ step });
  expect(m.sync).toHaveBeenCalledWith("a");
  expect(m.process).toHaveBeenCalledWith("j");
  expect(step.sleep).toHaveBeenCalledTimes(1);
  expect(step.sendEvent).not.toHaveBeenCalled();
});
it("continues through a durable event after a bounded batch", async () => {
  m.queue.mockImplementation(async (table: string) => ({
    data: table === "relister_jobs" ? [{ id: "j" }] : [],
  }));
  const step = steps();
  expect(await tick.handler({ step })).toEqual({ continued: true });
  expect(m.process).toHaveBeenCalledTimes(20);
  expect(step.sendEvent).toHaveBeenCalledWith("continue-work", {
    name: "relister/work.requested",
    data: {},
  });
});
it("keeps database work recoverable when event delivery fails", async () => {
  vi.stubEnv("INNGEST_EVENT_KEY", "test");
  vi.stubEnv("INNGEST_SIGNING_KEY", "test");
  m.send.mockRejectedValueOnce(Error("offline"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(wakeRelister()).resolves.toBeUndefined();
  expect(m.send).toHaveBeenCalled();
  warning.mockRestore();
});
