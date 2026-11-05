import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

test("fake camera: local queue, next article, reload, export, paired draft", async ({
  page,
  browser,
}, info) => {
  let offline = true;
  const stored = new Map<string, Map<string, Buffer>>();
  const attempts: { batch: string; photo: string }[] = [];
  const drafts: Record<string, any>[] = [];
  const opened = new Map<string, any>();
  const measured: string[] = [];
  const stub = async (route: import("@playwright/test").Route) => {
    const body = route.request().postDataJSON();
    const ok = (data = {}) => route.fulfill({ json: { ok: true, ...data } });
    if (body.action === "authorize" || body.action === "session") return ok();
    if (body.action === "open") {
      opened.set(body.batch, body);
      return ok();
    }
    if (body.action === "upload") {
      attempts.push(body);
      const map = stored.get(body.batch) ?? new Map();
      map.set(body.photo, Buffer.from(body.data, "base64"));
      stored.set(body.batch, map);
      if (offline)
        return route.fulfill({
          status: 503,
          json: { error: "Simulierter Verbindungsausfall" },
        });
      return ok();
    }
    if (body.action === "seal") {
      expect(
        body.photoIds.every((p: string) => stored.get(body.batch)?.has(p)),
      ).toBe(true);
      if (!drafts.some((d) => d.batch === body.batch))
        drafts.push({
          id: opened.get(body.batch).article,
          revision: opened.get(body.batch).revision,
          batch: body.batch,
          sku: body.sku,
          photoIds: body.photoIds,
          status: "succeeded",
          processingMs: 0,
        });
      return ok();
    }
    if (body.action === "list") return ok({ drafts });
    if (body.action === "code") return ok({ code: "simulated-code" });
    if (body.action === "pair")
      return ok({ session: [...opened.values()][0].session });
    if (body.action === "result")
      return ok({
        draft: drafts.find((d) => d.batch === body.batch),
        prepared: {
          listing: {
            title: "Testbrille Live-Foto",
            category: "Brillen",
            description: "Simulierter Entwurf",
            item_specifics: {},
          },
        },
      });
    if (body.action === "image")
      return route.fulfill({
        body: stored.get(body.batch)?.get(body.photo),
        contentType: "image/jpeg",
      });
    throw new Error(`Unexpected action ${body.action}`);
  };
  await page.route("**/api/live-foto", stub);
  // Block any real eBay call while Snaplist renders the prepared draft.
  await page.route("**/api/ebay/**", (route) =>
    route.fulfill({ json: { ok: false, connected: false } }),
  );
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(15);
      let frame = 0;
      const timer = setInterval(() => {
        if (stream.getVideoTracks()[0].readyState === "ended")
          return clearInterval(timer);
        ctx.fillStyle = "#1b7061";
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = "white";
        ctx.font = "42px sans-serif";
        ctx.fillText(`Testbrille ${frame++}`, 60, 200);
      }, 65);
      return stream;
    };
  });
  const response = await page.goto("/live-foto");
  expect(response?.headers()["permissions-policy"]).toContain("camera=(self)");
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBeGreaterThan(0);
  await page.getByLabel("SKU (optional)").fill("PILOT-A");
  const capture = async (n: number) => {
    await page.getByRole("button", { name: "Foto aufnehmen" }).click();
    await expect(page.getByText(new RegExp(` · ${n} Fotos$`))).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Foto aufnehmen" }),
    ).toBeEnabled();
    measured.push(
      await page.getByText(/Aufnahme und Aufbereitung/).innerText(),
    );
  };
  await page.getByRole("button", { name: "Vollbild", exact: true }).click();
  await page.getByRole("slider", { name: "Kamera-Zoom" }).fill("2");
  await capture(1);
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  const first = await sharp(
    stored.get(attempts[0].batch)!.get(attempts[0].photo)!,
  ).metadata();
  expect([first.width, first.height]).toEqual([320, 240]);
  await page.getByRole("button", { name: "Vollbild verlassen" }).click();
  await capture(2);
  await page.getByRole("button", { name: "Foto 2 ersetzen" }).click();
  await capture(2);
  await page.getByRole("button", { name: "Foto 2 entfernen" }).click();
  await expect(page.getByText(/^1 \/ 12 Fotos/)).toBeVisible();
  await page.getByRole("button", { name: "Artikel fertig → nächster" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByLabel("SKU (optional)")).toHaveValue("");
  await page.getByLabel("SKU (optional)").fill("PILOT-B");
  await page.getByRole("button", { name: "Vollbild", exact: true }).click();
  await capture(1);
  await page.getByRole("button", { name: "Artikel fertig → nächster" }).click();
  await expect(page.getByText("Aktueller Artikel · 0 Fotos")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vollbild verlassen" }),
  ).toBeVisible();
  await expect(page.getByRole("slider", { name: "Kamera-Zoom" })).toHaveValue(
    "2",
  );
  await page.getByRole("button", { name: "Kamera schließen" }).click();
  await expect(
    page.getByRole("button", { name: "Kamera öffnen" }),
  ).toBeVisible();
  expect(drafts).toHaveLength(0);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Fotos der Sitzung exportieren" })
    .click();
  const download = await downloadPromise;
  const path = (await download.path())!;
  expect(readFileSync(path).subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toMatch(
    /No errors/,
  );
  expect(execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })).toMatch(
    /PILOT-A[\s\S]+PILOT-B/,
  );
  offline = false;
  await page.reload();
  await expect.poll(() => drafts.length).toBe(2);
  expect(drafts.map((d) => d.sku).sort()).toEqual(["PILOT-A", "PILOT-B"]);
  expect(drafts.every((d) => d.photoIds.length === 1)).toBe(true);
  expect(new Set(drafts.flatMap((d) => d.photoIds)).size).toBe(2);
  expect(
    drafts.some(
      (d) => attempts.filter((a) => a.photo === d.photoIds[0]).length >= 2,
    ),
  ).toBe(true);
  measured.push(
    await page.getByText(/Anfrage bis Serverbestätigung/).innerText(),
  );
  await page.getByRole("button", { name: "Computer koppeln" }).click();
  await expect(page.getByLabel(/Kopplungscode ·/)).toHaveValue(
    "simulated-code",
  );

  const desktop = await browser.newContext({
    baseURL: "http://127.0.0.1:3191",
  });
  await desktop.route("**/api/live-foto", stub);
  await desktop.route("**/api/ebay/**", (route) =>
    route.fulfill({ json: { ok: false, connected: false } }),
  );
  const pc = await desktop.newPage();
  await pc.goto("/");
  await pc.getByRole("button", { name: "Live-Foto-Entwürfe" }).click();
  await pc.getByLabel("Kopplungscode").fill("simulated-code");
  await pc.getByRole("button", { name: "Sitzung koppeln" }).click();
  await pc.getByRole("button", { name: "Entwurf übernehmen" }).first().click();
  await expect(
    pc.getByText("Entwurf wurde in Snaplist gespeichert."),
  ).toBeVisible();
  await pc.reload();
  await expect(pc.locator('input[value="Testbrille Live-Foto"]')).toBeVisible();
  await desktop.close();
  await info.attach("local-browser-timings", {
    body: JSON.stringify(measured),
    contentType: "application/json",
  });
  console.log("Live-Foto local fixture timings:", measured);
});

test("camera denial and local quota errors do not acknowledge storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/live-foto");
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect(page.locator("main p[role=alert]")).toContainText(
    "Kamera nicht verfügbar",
  );
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "photos")
        throw new DOMException("Test quota exceeded", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator("main p[role=alert]")).toContainText(
    "Foto nicht gespeichert",
  );
  await expect(page.getByText(/^0 \/ 12 Fotos/)).toBeVisible();
});

test("only the capture route allows the native camera API with a fake Chrome device", async ({
  page,
}) => {
  const root = await page.goto("/");
  expect(root?.headers()["permissions-policy"]).toContain("camera=()");
  await page.goto("/live-foto");
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Kamera schließen" }).click();
  await expect(
    page.getByRole("button", { name: "Kamera öffnen" }),
  ).toBeVisible();
});
