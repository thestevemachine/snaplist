import { test, expect, type Page } from "@playwright/test";
const picture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const options = [
  {
    id: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    isDefault: true,
    configured: true,
  },
  { id: "gpt-6-luna", displayName: "OpenAI GPT-6 Luna", configured: true },
  {
    id: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    configured: true,
  },
];
const usage = [
  {
    id: "test-call",
    stage: "analysis",
    model: "gpt-6-luna",
    requestedModel: "gpt-6-luna",
    input: 1000,
    output: 100,
    cacheRead: 0,
    cacheWrite: 0,
    ms: 10,
    ok: true,
    usageReported: true,
    estimatedUsd: 0.00015,
  },
];
async function setup(page: Page) {
  // All eBay endpoints are intercepted. These tests never reach eBay.
  await page.route("**/api/ebay/**", (r) =>
    r.fulfill({ json: { ok: false, connected: false, configured: false } }),
  );
  await page.route("**/api/cloud", (r) =>
    r.fulfill({ json: { enabled: false } }),
  );
  await page.route("**/api/models", (r) =>
    r.fulfill({ json: { sortModels: options, analysisModels: options } }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
}
test("independent model choices survive reload; switching and cancelling do not spend", async ({
  page,
}) => {
  let tests = 0,
    analyses = 0;
  await page.route("**/api/ai/test", (r) => {
    tests++;
    expect(r.request().postDataJSON()).toEqual({
      model: "gpt-6-luna",
      confirmed: true,
    });
    return r.fulfill({ json: { ok: true, message: "Test bestätigt", usage } });
  });
  await page.route("**/api/analyze", (r) => {
    analyses++;
    return r.fulfill({ json: { ok: false } });
  });
  await setup(page);
  await page.getByRole("button", { name: /KI-Einstellungen/ }).click();
  await page
    .getByLabel("KI für die Fotosortierung")
    .selectOption("gemini-3.5-flash-lite");
  await page
    .getByLabel("KI für die Angebotserstellung")
    .selectOption("gpt-6-luna");
  expect(tests).toBe(0);
  expect(analyses).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: /KI-Einstellungen/ }).click();
  await expect(page.getByLabel("KI für die Fotosortierung")).toHaveValue(
    "gemini-3.5-flash-lite",
  );
  await expect(page.getByLabel("KI für die Angebotserstellung")).toHaveValue(
    "gpt-6-luna",
  );
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", {
      name: "Listingmodell: Verbindung testen (kostenpflichtig)",
    })
    .click();
  expect(tests).toBe(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: "Listingmodell: Verbindung testen (kostenpflichtig)",
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Test bestätigt" }),
  ).toBeVisible();
  expect(tests).toBe(1);
  expect(analyses).toBe(0);
});
test("comparison keeps draft, SKU and manual changes and persists the separate variant", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/analyze", (r) => {
    calls++;
    const b = r.request().postDataJSON();
    expect(b.analysisModel).toBe("gpt-6-luna");
    expect(b.routerModel).toBeUndefined();
    expect(b.images).toEqual([
      { mediaType: "image/jpeg", data: picture.split(",")[1] },
    ]);
    return r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Vergleichstitel",
          description: "Vergleichsbeschreibung",
          brand: "Testmarke",
          item_specifics: { Material: "Titan" },
        },
        usage,
      },
    });
  });
  await setup(page);
  await page.evaluate(async (picture) => {
    const photo = {
      id: "p1",
      mediaType: "image/png",
      previewUrl: picture,
      data: picture.split(",")[1],
      uploadData: picture.split(",")[1],
    };
    const group = {
      id: "g1",
      sku: "MEINE-SKU",
      name: "Brille",
      photoIds: ["p1"],
      evidencePhotoIds: ["p1"],
      status: "done",
      listing: {
        title: "Mein manuell bearbeiteter Titel",
        description: "Meine manuelle Beschreibung",
        brand: "Mein Hersteller",
        category_id: "123",
        suggested_price: 30,
        item_specifics: { Material: "Gold" },
      },
      usage: [],
    };
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("listing-writer-drafts");
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(
          {
            version: 1,
            photos: [photo],
            groups: [group],
            orphanIds: [],
            binPrefix: "",
            skuStart: 0,
            step: "listings",
            updatedAt: Date.now(),
          },
          "current",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, picture);
  await page.reload();

  await page
    .getByText("Modelle vergleichen · Entwurf bleibt erhalten", { exact: true })
    .click();
  await page.getByLabel("Vergleichsmodell").selectOption("gpt-6-luna");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Kostenpflichtigen Vergleich starten" })
    .click();
  expect(calls).toBe(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Kostenpflichtigen Vergleich starten" })
    .click();
  await expect(
    page.locator("details summary").filter({ hasText: /gpt-6-luna ·/ }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  await page.waitForTimeout(450);
  const check = () =>
    page.evaluate(
      () =>
        new Promise<any>((resolve) => {
          const r = indexedDB.open("listing-writer-drafts");
          r.onsuccess = () => {
            const db = r.result;
            const q = db
              .transaction("workspace")
              .objectStore("workspace")
              .get("current");
            q.onsuccess = () => {
              const g = q.result.groups[0];
              db.close();
              resolve(g);
            };
          };
        }),
    );
  const saved = await check();
  expect(saved.listing.title).toBe("Mein manuell bearbeiteter Titel");
  expect(saved.listing.item_specifics.Material).toBe("Gold");
  expect(saved.sku).toBe("MEINE-SKU");
  expect(saved.comparisons[0].listing.title).toBe("Vergleichstitel");
  expect(saved.comparisons[0].usage[0].input).toBe(1000);
  expect(calls).toBe(1);
  await page.reload();
  await page
    .getByText("Modelle vergleichen · Entwurf bleibt erhalten", { exact: true })
    .click();
  await expect(
    page.locator("details summary").filter({ hasText: /gpt-6-luna ·/ }),
  ).toHaveCount(1);
  expect(calls).toBe(1);
});
