import { test, expect, Page } from "@playwright/test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
async function setup(page: Page) {
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/models", (r) =>
    r.fulfill({ json: { sortModels: [], analysisModels: [] } }),
  );
  await page.route("**/api/analyze", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Canon R5 Camera",
          description: "Visible scuff. Untested.",
          brand: "Canon",
          item_type: "Camera",
          condition: "GOOD",
          suggested_price: 200,
          item_specifics: { Brand: "Canon", Model: "R5" },
        },
        usage: [],
      },
    }),
  );
  await page.route("**/api/ebay/prepare", (r) => {
    const l = r.request().postDataJSON().listing;
    return r.fulfill({
      json: {
        ok: true,
        listing: { ...l, category_id: "625", ebay_condition: "" },
        preparation: {
          categoryId: "625",
          categoryName: "Cameras",
          aspects: [
            {
              name: "Brand",
              required: true,
              usage: "REQUIRED",
              mode: "FREE_TEXT",
              cardinality: "SINGLE",
              values: [],
            },
          ],
          conditions: [{ value: "USED_EXCELLENT", label: "Used" }],
          expiresAt: Date.now() + 3600000,
          signature: "test",
          issues: [],
        },
      },
    });
  });
  await page.route("**/api/ebay/comps", (r) =>
    r.fulfill({ json: { ok: false, error: "Research unavailable" } }),
  );
  await page.route("**/api/ebay/options", (r) =>
    r.fulfill({
      json: {
        ok: true,
        options: {
          fulfillment: [{ id: "ship", name: "My shipping" }],
          payment: [{ id: "pay", name: "My payment" }],
          returns: [{ id: "ret", name: "My returns" }],
          locations: [{ id: "home", name: "My real origin" }],
        },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Gespeicherte Arbeit wird geladen…"),
  ).toBeHidden();
}
async function draft(page: Page) {
  await page.locator("input[type=file]").setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: png },
    { name: "label.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.locator(".thumb")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Diese Fotos gehören zu einem Artikel" })
    .click();
  await page.getByRole("button", { name: /Entwürfe erstellen/i }).click();
  await expect(page.getByText("Cameras", { exact: true })).toBeVisible();
}
async function shipping(page: Page) {
  await expect(
    page.getByRole("button", { name: "Auf eBay.de veröffentlichen…" }),
  ).toBeDisabled();
  await page
    .getByLabel("eBay-Zustand", { exact: true })
    .selectOption("USED_EXCELLENT");
  await page
    .getByRole("button", { name: "Meine eBay-Rahmenbedingungen laden" })
    .click();
  await page.getByLabel("Versandregel", { exact: true }).selectOption("ship");
  await page.getByLabel("Zahlungsregel", { exact: true }).selectOption("pay");
  await page.getByLabel("Rückgaberegel", { exact: true }).selectOption("ret");
  await page
    .getByLabel("Artikelstandort", { exact: true })
    .selectOption("home");
}
test("retains good photos when one cannot decode; preserves original blobs across reload", async ({
  page,
}) => {
  await setup(page);
  await page.locator("input[type=file]").setInputFiles([
    { name: "valid.png", mimeType: "image/png", buffer: png },
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("bad") },
  ]);
  await expect(page.locator(".thumb")).toHaveCount(1);
  await expect(page.locator(".note-error")).toContainText("broken.png");
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  await page.reload();
  await expect(page.locator(".thumb")).toHaveCount(1);
});
test("restores edited drafts and blocks publication with missing facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await draft(page);
  await page.locator(".title-input").fill("Seller reviewed camera");
  await page.getByLabel("Brand", { exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "Auf eBay.de veröffentlichen…" }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  await page.reload();
  await expect(page.locator(".title-input")).toHaveValue(
    "Seller reviewed camera",
  );
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
});
test("partial image upload stops publication; retry preserves reviewed fields", async ({
  page,
}) => {
  let calls = 0;
  let fail = true;
  await setup(page);
  await page.route("**/api/ebay/upload-photos", (r) =>
    r.fulfill({
      json: {
        ok: true,
        urls: fail
          ? ["https://i.ebayimg.com/1.jpg"]
          : ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"],
      },
    }),
  );
  await page.route("**/api/ebay/publish", (r) => {
    calls++;
    const b = r.request().postDataJSON();
    expect(b.listing.title).toBe("Canon R5 Camera");
    expect(b.shipping.weightOz).toBeUndefined();
    expect(b.expectedPhotoCount).toBe(2);
    return r.fulfill({ json: { success: true, listingId: "12345" } });
  });
  await draft(page);
  await shipping(page);
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  await page
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(
    page.getByText(/Some selected photos failed to upload/),
  ).toBeVisible();
  expect(calls).toBe(0);
  fail = false;
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  await page
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(page.locator(".post-result.ok")).toBeVisible();
  expect(calls).toBe(1);
});
test("verification never publishes; a single publication requires confirmation with exact EUR price", async ({
  page,
}) => {
  await setup(page);
  let verified = 0,
    published = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/ebay/upload-photos", (r) =>
    r.fulfill({
      json: {
        ok: true,
        urls: ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"],
      },
    }),
  );
  await page.route("**/api/ebay/verify", (r) => {
    verified++;
    expect(r.request().postDataJSON().confirmed).toBe(false);
    return r.fulfill({
      json: {
        success: true,
        verified: true,
        fees: [{ name: "InsertionFee", amount: "0.35", currency: "EUR" }],
      },
    });
  });
  await page.route("**/api/ebay/publish", (r) => {
    published++;
    expect(r.request().postDataJSON().confirmed).toBe(true);
    expect(r.request().postDataJSON().listing.suggested_price).toBe(9999);
    return r.fulfill({ json: { success: true, listingId: "123456789012" } });
  });
  await draft(page);
  await shipping(page);
  await page.getByLabel("Preis", { exact: true }).fill("9999");
  await page
    .getByRole("button", { name: "Bei eBay prüfen · nicht veröffentlichen" })
    .click();
  await expect(
    page.getByText(/eBay-Prüfung erfolgreich. Nicht veröffentlicht/),
  ).toBeVisible();
  expect(verified).toBe(1);
  expect(published).toBe(0);
  await expect(
    page.getByText(/Geschätzte Gebühren: InsertionFee: 0.35 EUR/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Veröffentlichung bestätigen",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("9999.00 EUR");
  await expect(confirmation).toContainText("kein Entwurf");
  expect(published).toBe(0);
  await confirmation.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirmation).not.toBeVisible();
  expect(published).toBe(0);
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  await confirmation
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(
    page.getByRole("link", { name: "Angebot bei eBay öffnen" }),
  ).toHaveAttribute("href", "https://www.ebay.de/itm/123456789012");
  expect(published).toBe(1);
  expect(errors).toEqual([]);
});
test("second tab cannot overwrite the active workspace", async ({
  page,
  context,
}) => {
  await setup(page);
  await expect(page.getByText("Auf diesem Gerät gespeichert")).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByText(/already open in another tab/)).toBeVisible();
  await other.close();
});

test("late preparation never overwrites a seller edit", async ({ page }) => {
  await setup(page);
  await draft(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const called = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/ebay/prepare", async (r) => {
    started();
    await pending;
    await r.fulfill({
      json: {
        ok: true,
        listing: {
          ...r.request().postDataJSON().listing,
          title: "Stale AI response",
        },
        preparation: {},
      },
    });
  });
  await page
    .getByRole("button", { name: "Kategorie und Merkmale vorbereiten" })
    .click();
  await called;
  await page.locator(".title-input").fill("My newer correction");
  finish();
  await expect(
    page.getByText(
      "Der Entwurf wurde während der Vorbereitung geändert. Bitte erneut vorbereiten; deine Änderungen bleiben erhalten.",
    ),
  ).toBeVisible();
  await expect(page.locator(".title-input")).toHaveValue("My newer correction");
});
test("phone review fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await draft(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/phone-review.png",
    fullPage: true,
  });
});

test("eBay sign-in uses an in-page access form and a user-clicked link", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.prompt = () => {
      throw new Error("prompt() is not supported.");
    };
    window.open = () => {
      throw new Error("Automatic popups are not supported.");
    };
  });
  await setup(page);
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { configured: true, connected: false } }),
  );
  await page.route("**/api/ebay/auth", (r) => {
    const valid = r.request().headers()["x-app-secret"] === "test-correct-code";
    return r.fulfill({
      status: valid ? 200 : 401,
      json: valid
        ? { ok: true, url: "https://auth.ebay.com/oauth2/authorize?test=1" }
        : { ok: false, code: "ACCESS_CODE_REQUIRED" },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Open eBay" }).click();
  const dialog = page.getByRole("dialog", { name: "App access code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input")).toHaveAttribute("type", "password");
  await dialog.locator("input").fill("wrong-code");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toContainText("try again");
  await dialog.locator("input").fill("test-correct-code");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Continue to eBay" }),
  ).toHaveAttribute("href", "https://auth.ebay.com/oauth2/authorize?test=1");
});

test("cancelling access entry closes the form and allows another attempt", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { configured: true, connected: false } }),
  );
  await page.route("**/api/ebay/auth", (r) =>
    r.fulfill({
      status: 401,
      json: {
        ok: false,
        code: "ACCESS_CODE_REQUIRED",
        error: "Access code required.",
      },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Open eBay" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open eBay" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("defaults the seller policies and allows review without package measurements", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/options", (r) =>
    r.fulfill({
      json: {
        ok: true,
        options: {
          sellerKey: "test-seller",
          sellerName: "Test",
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
    }),
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "snaplist-shop-v1:test-seller",
      JSON.stringify({
        version: 1,
        shipping: {
          fulfillmentPolicyId: "usual",
          paymentPolicyId: "pay",
          returnPolicyId: "ret",
          locationKey: "home",
        },
        descriptionTemplate: "",
      }),
    ),
  );
  await draft(page);
  await expect(page.getByLabel("Versandregel", { exact: true })).toHaveValue(
    "usual",
  );
  await expect(page.getByLabel("Artikelstandort", { exact: true })).toHaveValue(
    "home",
  );
  await page
    .getByLabel("eBay-Zustand", { exact: true })
    .selectOption("USED_EXCELLENT");
  await expect(
    page.getByRole("button", { name: "Auf eBay.de veröffentlichen…" }),
  ).toBeEnabled();
  await page.getByLabel("Versandregel", { exact: true }).selectOption("heavy");
  await page
    .getByRole("button", { name: "Meine eBay-Rahmenbedingungen laden" })
    .click();
  await expect(page.getByLabel("Versandregel", { exact: true })).toHaveValue(
    "heavy",
  );
});
test("start new batch warns about unposted drafts, then clears saved work across reload", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  const messages: string[] = [];
  page.once("dialog", (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Neuen Stapel beginnen" }).click();
  expect(messages[0]).toContain("1 written listing has not been posted");
  await expect(page.locator(".title-input")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Neuen Stapel beginnen" }).click();
  await expect(page.locator(".title-input")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neuen Stapel beginnen" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  await page.reload();
  await expect(
    page.getByText("Gespeicherte Arbeit wird geladen…"),
  ).toBeHidden();
  await expect(page.locator(".thumb")).toHaveCount(0);
  await expect(page.locator(".title-input")).toHaveCount(0);
});

test("SNAPLIST saves an incomplete draft locally without an eBay connection", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { connected: false } }),
  );
  let ebayWrites = 0;
  await page.route(/\/api\/ebay\/(?:verify|publish|upload-photos)$/, (r) => {
    ebayWrites++;
    return r.abort();
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "SNAPLIST", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/SNAPLIST/);
  await draft(page);
  await page
    .locator(".title-input")
    .fill("Mein unvollständiger Brillenentwurf");
  await page.getByLabel("Preis", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page.getByText(
      "Entwurf auf diesem Gerät gespeichert. Nicht an eBay übertragen.",
    ),
  ).toBeVisible();
  expect(ebayWrites).toBe(0);
  await page.reload();
  await expect(page.locator(".title-input")).toHaveValue(
    "Mein unvollständiger Brillenentwurf",
  );
  await expect(page.getByLabel("Preis", { exact: true })).toHaveValue("");
});

test("shop preferences persist, fill future drafts and keep card overrides for eBay", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/options", (r) =>
    r.fulfill({
      json: {
        ok: true,
        options: {
          sellerKey: "seller-one",
          sellerName: "StefanTest",
          fulfillment: [{ id: "ship", name: "DHL" }],
          payment: [{ id: "pay", name: "Zahlung" }],
          returns: [{ id: "ret", name: "Rückgabe" }],
          locations: [{ id: "home", name: "Berlin" }],
        },
      },
    }),
  );
  await page.getByText("Shop- und Batch-Vorgaben", { exact: true }).click();
  await page
    .getByRole("button", { name: "eBay-Konto und Vorgaben laden" })
    .click();
  await expect(page.getByText("StefanTest", { exact: true })).toBeVisible();
  await page
    .getByLabel("Versand als Standard", { exact: true })
    .selectOption("ship");
  await page
    .getByLabel("Zahlung als Standard", { exact: true })
    .selectOption("pay");
  await page
    .getByLabel("Rückgabe als Standard", { exact: true })
    .selectOption("ret");
  await page
    .getByLabel("Artikelstandort als Standard", { exact: true })
    .selectOption("home");
  await page
    .getByLabel("Beschreibungsvorlage", { exact: true })
    .fill("DE: Meine geprüfte Brille\nEN: My glasses\n{{beschreibung}}");
  await page
    .getByRole("button", {
      name: "Als Standard für künftige Batches speichern",
    })
    .click();
  await expect(
    page.getByText(
      /Vorgaben für künftige Batches auf diesem Gerät gespeichert/,
    ),
  ).toBeVisible();
  await page.reload();
  await draft(page);
  await expect(page.getByLabel("Versandregel", { exact: true })).toHaveValue(
    "ship",
  );
  await expect(page.getByLabel("Zustand", { exact: true })).toHaveValue(
    "NEW_NO_TAGS",
  );
  const description = page.getByLabel("Beschreibung", { exact: true });
  await expect(description).toHaveValue(
    "DE: Meine geprüfte Brille\nEN: My glasses\nVisible scuff. Untested.",
  );
  await expect(page.getByLabel("Preisvorschläge zulassen", {exact:true})).toBeChecked();
  await page.getByLabel("Preisvorschläge zulassen", {exact:true}).uncheck();
  await description.fill("Individuell geändert");
  await page
    .getByLabel("eBay-Zustand", { exact: true })
    .selectOption("USED_EXCELLENT");
  await page.route("**/api/ebay/upload-photos", (r) =>
    r.fulfill({
      json: {
        ok: true,
        urls: ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"],
      },
    }),
  );
  let verified = false;
  await page.route("**/api/ebay/verify", (r) => {
    const b = r.request().postDataJSON();
    expect(b.listing.best_offer_enabled).toBe(false);
    expect(b.listing.description).toBe("Individuell geändert");
    expect(b.listing.ebay_condition).toBe("USED_EXCELLENT");
    expect(b.listing.item_specifics.EAN).toBe("Nicht zutreffend");
    expect(b.shipping.fulfillmentPolicyId).toBe("ship");
    verified = true;
    return r.fulfill({ json: { success: true, verified: true } });
  });
  await page
    .getByRole("button", { name: "Bei eBay prüfen · nicht veröffentlichen" })
    .click();
  await expect(page.getByText(/eBay-Prüfung erfolgreich/)).toBeVisible();
  expect(verified).toBe(true);
});

test("sunglasses show both categories and send one confirmed listing", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/analyze", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Vintage Sunglasses",
          description: "Test",
          suggested_price: 9999,
          item_specifics: { Brand: "Test" },
        },
      },
    }),
  );
  await page.route("**/api/ebay/prepare", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          ...r.request().postDataJSON().listing,
          category_id: "11",
          secondary_category_id: "22",
          ebay_condition: "NEW_OTHER",
        },
        preparation: {
          categoryId: "11",
          categoryName: "Herren > Sonnenbrillen",
          secondaryCategoryId: "22",
          secondaryCategoryName: "Damen > Sonnenbrillen",
          aspects: [],
          conditions: [{ value: "NEW_OTHER", label: "Neu ohne Etikett" }],
          expiresAt: Date.now() + 3600000,
          signature: "dual",
          issues: [],
        },
      },
    }),
  );
  await page
    .locator("input[type=file]")
    .setInputFiles([{ name: "sun.png", mimeType: "image/png", buffer: png }]);
  await page
    .getByRole("button", { name: "Diese Fotos gehören zu einem Artikel" })
    .click();
  await page.getByRole("button", { name: /Entwürfe erstellen/i }).click();
  await expect(
    page.getByText("Zweitkategorie: Damen > Sonnenbrillen (22)"),
  ).toBeVisible();
  for (const [label, value] of [
    ["Versandregel", "ship"],
    ["Zahlungsregel", "pay"],
    ["Rückgaberegel", "ret"],
    ["Artikelstandort", "home"],
  ])
    await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.route("**/api/ebay/upload-photos", (r) =>
    r.fulfill({ json: { ok: true, urls: ["https://i.ebayimg.com/sun.jpg"] } }),
  );
  let published = 0;
  await page.route("**/api/ebay/publish", (r) => {
    const body = r.request().postDataJSON();
    expect(body.listing.secondary_category_id).toBe("22");
    expect(body.review.secondaryCategoryId).toBe("22");
    published++;
    return r.fulfill({ json: { success: true, listingId: "123456789012" } });
  });
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Veröffentlichung bestätigen",
  });
  await expect(confirmation).toContainText("Herren > Sonnenbrillen");
  await expect(confirmation).toContainText("Damen > Sonnenbrillen");
  expect(published).toBe(0);
  await confirmation
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(
    page.getByRole("link", { name: "Angebot bei eBay öffnen" }),
  ).toBeVisible();
  expect(published).toBe(1);
  await expect(
    page.getByText("Bei eBay veröffentlicht", { exact: false }).first(),
  ).toBeVisible();
});

test("restored sunglasses prepare automatically once, retain descriptions and never publish", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  await expect(
    page.getByText("Auf diesem Gerät gespeichert", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  let prepares = 0,
    publishes = 0;
  await page.route("**/api/ebay/publish", (route) => {
    publishes++;
    return route.fulfill({ json: { ok: false } });
  });
  await page.route("**/api/ebay/prepare", (route) => {
    prepares++;
    const listing = route.request().postDataJSON().listing;
    return route.fulfill({
      json: {
        ok: true,
        listing: {
          ...listing,
          title: "Test Sonnenbrille Herren Damen Braun",
          glasses_rules_version: 4,
          category_fields_version: 3,
          category_id: "11",
          secondary_category_id: "22",
        },
        preparation: {
          categoryId: "11",
          secondaryCategoryId: "22",
          categoryName: "Herren > Sonnenbrillen",
          secondaryCategoryName: "Damen > Sonnenbrillen",
          aspects: [],
          conditions: [{ value: "NEW_OTHER", label: "Neu ohne Etikett" }],
          expiresAt: Date.now() + 3600000,
          signature: "test",
          issues: [],
        },
      },
    });
  });
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("listing-writer-drafts");
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("workspace", "readwrite"),
          store = tx.objectStore("workspace"),
          get = store.get("current");
        get.onsuccess = () => {
          const d = get.result,
            g = d.groups[0];
          g.listing.title = "Test Sunglasses";
          g.listing.description = "Mein eigener Beschreibungstext";
          g.preparation = undefined;
          d.groups.push({
            ...g,
            id: "already-posted",
            sku: "POSTED",
            postStatus: "posted",
            listing: { ...g.listing, title: "Veröffentlichte Sonnenbrille" },
          });
          store.put(d, "current");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /Titel / }).first(),
  ).toHaveValue("Test Sonnenbrille Herren Damen Braun");
  expect(prepares).toBe(1);
  await page.getByRole("button", { name: "Detailkarten", exact: true }).click();
  await expect(
    page.getByLabel("Beschreibung", { exact: true }).first(),
  ).toHaveValue("Mein eigener Beschreibungstext");
  await page
    .locator(".title-input")
    .first()
    .fill("Meine eigene deutsche Korrektur");
  await expect(
    page.getByText("Auf diesem Gerät gespeichert", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /Titel / }).first(),
  ).toHaveValue("Meine eigene deutsche Korrektur");
  expect(prepares).toBe(1);
  expect(publishes).toBe(0);
});
test("only category fields appear and material supports multiple reviewed choices", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/prepare", (route) => {
    const listing = route.request().postDataJSON().listing;
    return route.fulfill({
      json: {
        ok: true,
        listing: {
          ...listing,
          category_id: "625",
          ebay_condition: "USED_EXCELLENT",
          item_specifics: {
            Brand: "Canon",
            "Hinge Type": "Invented",
            "Nose Pad Type": "Invented",
            "Temple Tip Material": "Invented",
            "Lens Treatment": "Invented",
            Fassungsmaterial: "Metall",
          },
        },
        preparation: {
          categoryId: "625",
          categoryName: "Cameras",
          aspects: [
            {
              name: "Brand",
              required: true,
              mode: "FREE_TEXT",
              cardinality: "SINGLE",
              values: [],
            },
            {
              name: "Fassungsmaterial",
              required: false,
              mode: "SELECTION_ONLY",
              cardinality: "MULTI",
              values: ["Metall", "Kunststoff"],
            },
          ],
          conditions: [{ value: "USED_EXCELLENT", label: "Gebraucht" }],
          expiresAt: Date.now() + 3600000,
          signature: "test",
          issues: [],
        },
      },
    });
  });
  await draft(page);
  for (const name of [
    "Hinge Type",
    "Nose Pad Type",
    "Temple Tip Material",
    "Lens Treatment",
  ])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Merkmal hinzufügen", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Kunststoff", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "Metall", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Kunststoff", exact: true }),
  ).toBeChecked();
  await page.getByLabel("Versandregel", { exact: true }).selectOption("ship");
  await page.getByLabel("Zahlungsregel", { exact: true }).selectOption("pay");
  await page.getByLabel("Rückgaberegel", { exact: true }).selectOption("ret");
  await page
    .getByLabel("Artikelstandort", { exact: true })
    .selectOption("home");
  await page.route("**/api/ebay/upload-photos", (r) =>
    r.fulfill({
      json: {
        ok: true,
        urls: ["https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg"],
      },
    }),
  );
  let verified = false;
  await page.route("**/api/ebay/verify", (r) => {
    expect(
      r.request().postDataJSON().listing.item_specifics.Fassungsmaterial,
    ).toBe("Metall | Kunststoff");
    verified = true;
    return r.fulfill({ json: { ok: true, verified: true } });
  });
  await page
    .getByRole("button", {
      name: "Bei eBay prüfen · nicht veröffentlichen",
      exact: true,
    })
    .click();
  await expect.poll(() => verified).toBe(true);
});
test("inscription data remains editable, persists, and only explicitly rebuilds title", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/analyze", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Lindberg Brille",
          description: "Text",
          brand: "Lindberg",
          item_type: "Brille",
          suggested_price: 200,
          glasses_rules_version: 4,
          category_fields_version: 3,
          item_specifics: { Brand: "Lindberg" },
          eyewear: {
            fields: {
              brand: {
                value: "Lindberg",
                source: "label",
                quote: "Lindberg 46□18-140",
                photos: [1],
              },
              lensWidth: {
                value: "46",
                source: "label",
                quote: "46□18-140",
                photos: [1],
              },
              material: { value: "Titan", source: "shop" },
              modelNumber: {
                value: "1234",
                source: "label",
                quote: "1234",
                photos: [1],
              },
            },
            warnings: [],
          },
        },
        usage: [],
      },
    }),
  );
  await draft(page);
  const panel = page.locator("details").filter({
    has: page.getByText("Erkannte Bügelaufdrucke und Maße", { exact: true }),
  });
  await expect(panel.getByLabel("Glasbreite", { exact: false })).toHaveValue(
    "46",
  );
  await panel.getByLabel("Modellnummer", { exact: false }).fill("5678");
  await expect(page.locator(".title-input")).toHaveValue("Lindberg Brille");
  await page.locator(".title-input").fill("Mein geprüfter Titel");
  await panel.getByLabel("Glasbreite", { exact: false }).fill("45");
  await expect(page.locator(".title-input")).toHaveValue(
    "Mein geprüfter Titel",
  );
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page.getByText(
      "Entwurf auf diesem Gerät gespeichert. Nicht an eBay übertragen.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".title-input")).toHaveValue(
    "Mein geprüfter Titel",
  );
  await expect(panel.getByLabel("Glasbreite", { exact: false })).toHaveValue(
    "45",
  );
  await panel
    .getByRole("button", { name: "Titel aus geprüften Angaben neu bilden" })
    .click();
  await expect(page.locator(".title-input")).toHaveValue(/5678.*kleine Gläser/);
});
test("seller corrects optical frame and removes both sunglasses categories", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/analyze", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Lindberg Sonnenbrille",
          description: "Text",
          item_type: "Sonnenbrille",
          eyewear_kind: "sunglasses",
          suggested_price: 200,
          condition_notes: "Foto zeigt Kratzer",
          item_specifics: { Brand: "Lindberg" },
        },
        usage: [
          {
            stage: "analysis",
            model: "test-analysis-model",
            input: 10,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            ms: 1,
            ok: true,
          },
        ],
      },
    }),
  );
  let last: any;
  await page.route("**/api/ebay/prepare", (r) => {
    const l = r.request().postDataJSON().listing;
    last = l;
    const optical = l.eyewear_kind === "optical";
    return r.fulfill({
      json: {
        ok: true,
        listing: {
          ...l,
          category_id: optical ? "180957" : "79720",
          secondary_category_id: optical ? undefined : "45246",
          glasses_rules_version: 4,
          category_fields_version: 3,
        },
        preparation: {
          categoryId: optical ? "180957" : "79720",
          secondaryCategoryId: optical ? undefined : "45246",
          categoryName: "Cameras",
          aspects: [],
          conditions: [],
          expiresAt: Date.now() + 3600000,
          signature: "test",
        },
      },
    });
  });
  await draft(page);
  await expect(page.getByLabel("Zustand und Hinweise")).toHaveValue(
    "Ungetragen ohne Etui",
  );
  await expect(
    page.getByText("Verwendetes Analysemodell: test-analysis-model"),
  ).toBeVisible();
  await page.getByLabel("Brillenart", { exact: true }).selectOption("optical");
  await expect(page.locator(".title-input")).toHaveValue("Lindberg Brille");
  await page
    .getByRole("button", {
      name: "Kategorie und Merkmale vorbereiten",
      exact: true,
    })
    .click();
  await expect.poll(() => last?.eyewear_kind).toBe("optical");
  expect(["", "180957"]).toContain(last.category_id);
  expect(last.secondary_category_id).toBeUndefined();
  await expect(page.getByLabel("Kategorie-ID", { exact: true })).toHaveValue(
    "180957",
  );
});
test("reanalysis reuses existing photos and replaces draft content while keeping SKU", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  const sku = await page.getByLabel("SKU", { exact: true }).inputValue();
  await page.locator(".title-input").fill("Manuell bearbeiteter alter Titel");
  let analysisCalls = 0;
  await page.route("**/api/analyze", (r) => {
    analysisCalls++;
    expect(r.request().postDataJSON().images).toHaveLength(2);
    return r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Neu bewertete Brille Pilot",
          description: "Neu erstellter Text",
          brand: "Test",
          item_type: "Brille",
          eyewear_kind: "optical",
          glasses_rules_version: 4,
          category_fields_version: 3,
          content_rules_version: 3,
          suggested_price: 100,
          item_specifics: { Brand: "Test" },
        },
        usage: [],
      },
    });
  });
  await page
    .getByRole("button", {
      name: "Ausgewählte Fotos neu analysieren (ersetzt diesen Entwurf)",
      exact: true,
    })
    .click();
  await expect(page.locator(".title-input")).toHaveValue(
    "Neu bewertete Brille Pilot",
  );
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue(sku);
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue(
    "Neu erstellter Text",
  );
  expect(analysisCalls).toBe(1);
});
