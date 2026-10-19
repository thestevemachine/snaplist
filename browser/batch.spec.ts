import { test, expect, type Page } from "@playwright/test";
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
async function seed(page: Page, count: number, unfinished = false) {
  let optionsCalls = 0;
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/models", (r) =>
    r.fulfill({ json: { sortModels: [], analysisModels: [] } }),
  );
  await page.route("**/api/ebay/options", (r) => {
    optionsCalls++;
    return r.fulfill({
      json: {
        ok: true,
        options: {
          fulfillment: [
            {
              id: "usual",
              name: "USPS Ground Advantage ($7.95), 2 day handling",
            },
            { id: "heavy", name: "$9.95" },
          ],
          payment: [{ id: "pay", name: "Managed Payments" }],
          returns: [
            { id: "ret", name: "Returns Accepted,Seller,30 Days,Money Back#1" },
          ],
          locations: [
            { id: "home", name: "Hustle at Home Mom HQ · 84095 · US" },
          ],
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Gespeicherte Arbeit wird geladen…"),
  ).toBeHidden();
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  await page.evaluate(
    async ({ count, photo, unfinished }) => {
      const photos = Array.from({ length: count * 5 }, (_, i) => ({
        id: `p${i}`,
        mediaType: "image/png",
        previewUrl: photo,
        data: photo.split(",")[1],
        uploadData: photo.split(",")[1],
      }));
      const groups = Array.from({ length: count }, (_, i) => ({
        id: `g${i}`,
        sku: `BATCH-${i}`,
        name: `Item ${i}`,
        photoIds: photos.slice(i * 5, i * 5 + 5).map((p) => p.id),
        status: unfinished ? "idle" : "done",
        shipping: {
          fulfillmentPolicyId: "usual",
          paymentPolicyId: "pay",
          returnPolicyId: "ret",
          locationKey: "home",
        },
        listing: {
          title: `Item ${i}`,
          description: "Seller description",
          size: "M",
          category_id: "123",
          ebay_condition: "PRE_OWNED_EXCELLENT",
          suggested_price: 30,
          item_specifics: { "Size Type": "Regular" },
        },
        preparation: {
          categoryId: "123",
          categoryName: "Shirts",
          aspects: [],
          conditions: [
            { value: "PRE_OWNED_EXCELLENT", label: "Pre-owned Excellent" },
          ],
          expiresAt: Date.now() + 3600000,
          signature: "test",
          issues: [],
        },
      }));
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("listing-writer-drafts");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            {
              version: 1,
              photos,
              groups,
              orphanIds: [],
              binPrefix: "BATCH",
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
    },
    { count, photo, unfinished },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Deine Angebote" }),
  ).toBeVisible();
  return () => optionsCalls;
}
for (const count of [10, 25, 100])
  test(`${count} items: edits persist while bulk publication stays unavailable for the single-item test`, async ({
    page,
  }) => {
    const optionsCalls = await seed(page, count);
    await expect(page.locator(".batch-table tbody > tr")).toHaveCount(
      Math.min(count, 25),
    );
    expect(optionsCalls()).toBe(1);
    await expect(
      page.getByRole("button", { name: /Post all|Post selected/ }),
    ).toHaveCount(0);
    await page
      .getByLabel("Titel BATCH-0", { exact: true })
      .fill("Reviewed first item");
    await page.getByLabel("Auswahl BATCH-0", { exact: true }).check();
    await page
      .getByLabel("Versand für Auswahl", { exact: true })
      .selectOption("heavy");
    await page
      .getByRole("button", { name: "Versand übernehmen", exact: true })
      .click();
    await expect(
      page.getByLabel("Versand BATCH-0", { exact: true }),
    ).toHaveValue("heavy");
    await expect(page.getByRole("status")).toContainText(
      "Auf diesem Gerät gespeichert",
    );
    await page.reload();
    await expect(page.getByLabel("Titel BATCH-0", { exact: true })).toHaveValue(
      "Reviewed first item",
    );
    await expect(
      page.getByLabel("Versand BATCH-0", { exact: true }),
    ).toHaveValue("heavy");
    await expect(
      page.getByRole("button", { name: /Post all|Post selected/ }),
    ).toHaveCount(0);
  });
test("batch table fits a phone and exposes missing fields through attention filter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, 100);
  await page.getByLabel("Preis BATCH-0", { exact: true }).fill("");
  await page.getByLabel("Anzeigen", { exact: true }).selectOption("attention");
  await expect(page.locator(".batch-table tbody > tr")).toHaveCount(1);
  await expect(
    page.getByText("Bitte einen Preis größer als null eingeben.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/batch-phone.png",
    fullPage: true,
  });
});

test("100 draft writes use three workers; failed items retry without rewriting successes", async ({
  page,
}) => {
  await seed(page, 100, true);
  let analyzeCalls = 0,
    active = 0,
    maximum = 0,
    failOnce = true;
  await page.route("**/api/analyze", async (r) => {
    analyzeCalls++;
    active++;
    maximum = Math.max(maximum, active);
    const fail = analyzeCalls === 7 && failOnce;
    await new Promise((resolve) => setTimeout(resolve, 15));
    active--;
    if (fail) {
      failOnce = false;
      return r.fulfill({
        status: 422,
        json: { ok: false, error: "Simulated analysis failure" },
      });
    }
    return r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Generated shirt",
          description: "Reviewed description",
          suggested_price: 30,
          size: "M",
          item_specifics: {},
        },
      },
    });
  });
  await page.route("**/api/ebay/prepare", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          ...r.request().postDataJSON().listing,
          category_id: "123",
          ebay_condition: "PRE_OWNED_EXCELLENT",
        },
        preparation: {
          categoryId: "123",
          categoryName: "Shirts",
          aspects: [],
          conditions: [
            { value: "PRE_OWNED_EXCELLENT", label: "Pre-owned Excellent" },
          ],
          signature: "test",
          expiresAt: Date.now() + 3600000,
          issues: [],
        },
      },
    }),
  );
  await page.route("**/api/ebay/comps", (r) =>
    r.fulfill({ json: { ok: false } }),
  );
  await page
    .getByRole("button", {
      name: "100 verbleibende Entwürfe erstellen / erneut versuchen",
      exact: true,
    })
    .click();
  await expect(page.locator(".result-head .badge")).toContainText(
    "99/100 Entwürfe erstellt",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", {
      name: "1 verbleibende Entwürfe erstellen / erneut versuchen",
      exact: true,
    }),
  ).toBeEnabled();
  expect(analyzeCalls).toBe(100);
  expect(maximum).toBe(3);
  await page
    .getByRole("button", {
      name: "1 verbleibende Entwürfe erstellen / erneut versuchen",
      exact: true,
    })
    .click();
  await expect(page.locator(".result-head .badge")).toContainText(
    "100/100 Entwürfe erstellt",
  );
  expect(analyzeCalls).toBe(101);
});
