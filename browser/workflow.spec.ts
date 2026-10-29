import { test, expect, Page } from "@playwright/test";
async function expandUnpostedCards(page: Page) {
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 for(const button of await page.locator(".listing-card:not(.is-posted) .card-details-toggle[aria-expanded=false]").all()) await button.click();
}
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
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
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
  await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
  await expect(page.getByText("Cameras", { exact: true })).toBeVisible();
  await page.getByLabel("SKU", { exact: true }).fill("65-23537");
  await page.getByText("Versand und Rückgabe", { exact: true }).click();
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
  if (!(await page.getByLabel("Versandregel", { exact: true }).isVisible()))
    await page.getByText("Versand und Rückgabe", { exact: true }).click();
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
  await expandUnpostedCards(page);
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
  await expandUnpostedCards(page);
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
  const uploadedCounts:number[]=[];
  await page.route("**/api/ebay/upload-photos", (r) => {
    const count=r.request().postDataJSON().images.length;uploadedCounts.push(count);
    return r.fulfill({json:fail ? {ok:true,urls:["https://i.ebayimg.com/1.jpg"],results:[{url:"https://i.ebayimg.com/1.jpg"},{url:null,error:"eBay-Bildserver vorübergehend nicht erreichbar"}],failed:1} : {ok:true,urls:["https://i.ebayimg.com/2.jpg"],results:[{url:"https://i.ebayimg.com/2.jpg"}],failed:0}});
  });
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
    page.getByText(/Foto 2:.*Nichts veröffentlicht/),
  ).toBeVisible();
  expect(calls).toBe(0);
  fail = false;
  await page
    .getByRole("button", { name: "Auf eBay.de veröffentlichen…" })
    .click();
  await page
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(page.locator(".listing-card-body")).toHaveCount(0);
  await expect(page.locator(".listing-card-head")).toContainText("Bei eBay veröffentlicht");
  expect(calls).toBe(1);
  expect(uploadedCounts).toEqual([2,1]);
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
  await page.getByRole("button",{name:"Angebotsdetails einklappen"}).click();
  await expect(page.getByLabel("Beschreibung",{exact:true})).not.toBeVisible();
  await expect(page.getByLabel("SKU",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Preis",{exact:true})).toBeVisible();
  await expect(page.locator(".copy-row").filter({has:page.getByRole("button",{name:"Titel kopieren"})}).getByRole("button",{name:"Auf eBay.de veröffentlichen…"})).toBeVisible();
  await page.getByRole("button",{name:"Auf eBay.de veröffentlichen…"}).click();
  const confirmation = page.getByRole("dialog", {
    name: "Veröffentlichung bestätigen",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("9999.00 EUR");
  await expect(confirmation).toContainText("kein Entwurf");
  expect(published).toBe(0);
  await confirmation.getByRole("button", { name: "Zurück zum Bearbeiten" }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByLabel("Beschreibung",{exact:true})).toBeVisible();
  expect(published).toBe(0);
  await page
    .getByRole("button", { name: "Veröffentlichen am Kartenende" })
    .click();
  await confirmation
    .getByRole("button", { name: "Jetzt verbindlich auf eBay veröffentlichen" })
    .click();
  await expect(
    page.getByRole("link", { name: "Angebot bei eBay öffnen" }),
  ).toHaveAttribute("href", "https://www.ebay.de/itm/123456789012");
  await expect(page.locator(".listing-card-body")).toHaveCount(0);
  await expect(page.locator(".listing-card-head")).toContainText("Bei eBay veröffentlicht");
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
  await expandUnpostedCards(page);
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
  await expandUnpostedCards(page);
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
  // Seller options are cached per document. Reload after replacing the API
  // fixture so this test starts with the intended seller, not setup's seller.
  await page.reload();
  await expandUnpostedCards(page);
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
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
  await expandUnpostedCards(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
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
  await expandUnpostedCards(page);
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
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Entwurf auf diesem Gerät gespeichert. Nicht an eBay übertragen.",
    ),
  ).toBeVisible();
  expect(ebayWrites).toBe(0);
  await page.reload();
  await expandUnpostedCards(page);
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
  await expandUnpostedCards(page);
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
  await expect(
    page.getByLabel("Preisvorschläge zulassen", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Preisvorschläge zulassen", { exact: true }).uncheck();
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
  await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
  await expect(
    page.getByText("Zweitkategorie: Damen · 22"),
  ).toBeVisible();
  await page.getByLabel("SKU", { exact: true }).fill("65-23537");
  await page.getByText("Versand und Rückgabe", { exact: true }).click();
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
          category_fields_version: 4,
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
          // The preceding fixture was a camera. Restored eyewear now has an
          // explicit reviewed classification; changing a title alone must not
          // override that classification.
          g.listing.eyewear_kind = "sunglasses";
          g.listing.item_type = "Sonnenbrille";
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
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ebay/prepare") &&
      response.request().postDataJSON()?.listing?.eyewear_kind === "sunglasses",
  );
  await page.reload();
  await expandUnpostedCards(page);
  await prepared;
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
  await expandUnpostedCards(page);
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
  await expect(
    page.getByRole("checkbox", { name: "Kunststoff", exact: true }),
  ).not.toBeVisible();
  await page
    .getByLabel("Fassungsmaterial: Auswahl bearbeiten", { exact: true })
    .click();
  await expect(
    page.locator(".aspect-options:visible input").first(),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Kunststoff", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "Metall", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Kunststoff", exact: true }),
  ).toBeChecked();
  if (!(await page.getByLabel("Versandregel", { exact: true }).isVisible()))
    await page.getByText("Versand und Rückgabe", { exact: true }).click();
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
          category_fields_version: 4,
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
    has: page.getByText("Aufdrucke & Maße", { exact: true }),
  });
  await expect(panel.getByLabel("Glasbreite", { exact: false })).toHaveValue(
    "46",
  );
  await panel.locator("summary").first().click();
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
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Entwurf auf diesem Gerät gespeichert. Nicht an eBay übertragen.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expandUnpostedCards(page);
  await expect(page.locator(".title-input")).toHaveValue(
    "Mein geprüfter Titel",
  );
  await expect(panel.getByLabel("Glasbreite", { exact: false })).toHaveValue(
    "45",
  );
  await panel.locator("summary").first().click();
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
          category_fields_version: 4,
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
  page.on("dialog", (dialog) => dialog.accept());
  await setup(page);
  await draft(page);
  const sku = await page.getByLabel("SKU", { exact: true }).inputValue();
  await page.locator(".title-input").fill("Manuell bearbeiteter alter Titel");
  let analysisCalls = 0;
  await page.route("**/api/analyze", (r) => {
    analysisCalls++;
    expect(r.request().postDataJSON().images).toHaveLength(2);
    expect(r.request().postDataJSON().hint).toBe("Das ist eine Sonnenbrille");
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
          category_fields_version: 4,
          content_rules_version: 3,
          suggested_price: 100,
          item_specifics: { Brand: "Test" },
        },
        usage: [],
      },
    });
  });
  await page.getByLabel("Hinweis für die Neuanalyse (optional)").fill("Das ist eine Sonnenbrille");
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
test("shows the current seller and saved policies without opening settings after reload", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({
      json: { configured: true, connected: true, sharedConfigured: true },
    }),
  );
  await page.route("**/api/ebay/options", (r) =>
    r.fulfill({
      json: {
        ok: true,
        options: {
          sellerKey: "summary-seller",
          sellerName: "AktuellesKonto",
          fulfillment: [{ id: "s", name: "DHL Standard" }],
          payment: [{ id: "p", name: "eBay Zahlung" }],
          returns: [{ id: "r", name: "60 Tage" }],
          locations: [{ id: "l", name: "Berlin" }],
        },
      },
    }),
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "snaplist-shop-v1:summary-seller",
      JSON.stringify({
        version: 1,
        shipping: {
          fulfillmentPolicyId: "s",
          paymentPolicyId: "p",
          returnPolicyId: "r",
          locationKey: "l",
        },
        descriptionTemplate: "Meine Vorlage",
      }),
    ),
  );
  await page.reload();
  await expandUnpostedCards(page);
  const summary = page.getByRole("region", {
    name: "Gespeicherte Shop-Vorgaben",
  });
  await expect(summary).toContainText("AktuellesKonto");
  await expect(summary).toContainText("DHL Standard");
  await expect(summary).toContainText("60 Tage");
  await expect(summary).toContainText("Gespeichert");
  await expect(page.locator(".ebay-bar")).toContainText("AktuellesKonto");
  await expect(page.locator(".shop-settings")).not.toHaveAttribute("open", "");
});

test("batch reanalysis asks before replacing drafts and retains SKU", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  const sku = await page.getByLabel("SKU", { exact: true }).inputValue();
  await page.locator(".title-input").fill("Manueller Titel");
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) calls++;
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", {
      name: "Alle offenen Brillen neu analysieren",
      exact: true,
    })
    .click();
  await expect(page.locator(".title-input")).toHaveValue("Manueller Titel");
  expect(calls).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Alle offenen Brillen neu analysieren",
      exact: true,
    })
    .click();
  await expect(page.locator(".title-input")).toHaveValue("Canon R5 Camera");
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue(sku);
  expect(calls).toBe(1);
});

test("eyewear condition notes can be edited and survive reload", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/analyze", (r) =>
    r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Test Brille",
          description: "Text",
          item_type: "Brille",
          eyewear_kind: "optical",
          condition_notes: "Ungetragen ohne Etui",
          suggested_price: 100,
          content_rules_version: 3,
          glasses_rules_version: 4,
          category_fields_version: 4,
          item_specifics: {},
        },
        usage: [],
      },
    }),
  );
  await draft(page);
  const notes = page.getByRole("textbox", {
    name: "Zustand und Hinweise",
    exact: true,
  });
  await notes.fill("Ungetragen, mit Originaletui");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  await page.reload();
  await expandUnpostedCards(page);
  await expect(
    page.getByRole("textbox", { name: "Zustand und Hinweise", exact: true }),
  ).toHaveValue("Ungetragen, mit Originaletui");
});

test("repairs a legacy UUID collision without losing the draft or publishing, and persists after reload", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listing-writer-drafts", 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data: any = await new Promise((resolve, reject) => {
      const r = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const g = data.groups[0];
    g.publicationId = undefined;
    g.publicationAttemptSku = g.sku;
    g.postStatus = "error";
    g.postError =
      "eBay 488: UUID bereits verwendet; Artikelnummer=940025900611.";
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return data;
  });
  let published = 0;
  await page.route("**/api/ebay/publish", (r) => {
    published++;
    return r.fulfill({ json: { success: false, error: "MUST NOT PUBLISH" } });
  });
  await page.route("**/api/ebay/publication-status", (r) => {
    const b = r.request().postDataJSON();
    expect(b.publicationId).toBe(`legacy:${before.groups[0].sku}`);
    return r.fulfill({
      json:
        b.action === "repair"
          ? {
              success: true,
              publicationId: `draft:${before.groups[0].id}`,
              sku: "65-23522-ABCDEF123456",
            }
          : {
              success: true,
              status: "conflict",
              listingId: "940025900611",
              sku: before.groups[0].sku,
              title: "Enni Marco",
            },
    });
  });
  await page.reload();
  await expandUnpostedCards(page);
  await page
    .getByRole("button", {
      name: "Veröffentlichungsstatus abgleichen",
      exact: true,
    })
    .click();
  await expect(page.getByText("Enni Marco", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Andere Brille – diesen Entwurf reparieren",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Entwurf repariert" }),
  ).toBeVisible();
  await page.reload();
  await expandUnpostedCards(page);
  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("listing-writer-drafts", 3);
      r.onsuccess = () => resolve(r.result);
    });
    const value: any = await new Promise((resolve) => {
      const r = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return value;
  });
  expect(after.groups[0].listing).toEqual(before.groups[0].listing);
  expect(after.groups[0].photoIds).toEqual(before.groups[0].photoIds);
  expect(after.photos).toEqual(before.photos);
  expect(after.groups[0].shipping).toEqual(before.groups[0].shipping);
  expect(after.groups[0].publicationId).toBe(`draft:${before.groups[0].id}`);
  expect(after.groups[0].sku).toBe("65-23522-ABCDEF123456");
  expect(after.groups[0].publicationAttemptSku).toBeUndefined();
  expect(published).toBe(0);
});

test("manual SKU changes after a failed attempt persist without rotating identity and check the original SKU", async ({
  page,
}) => {
  await setup(page);
  await draft(page);
  await shipping(page);
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listing-writer-drafts", 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data: any = await new Promise((resolve, reject) => {
      const r = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const g = data.groups[0];
    g.publicationId = `draft:${g.id}`;
    g.publicationAttemptSku = g.sku;
    g.postStatus = "error";
    g.postError =
      "eBay 488: UUID bereits verwendet; Artikelnummer=940025900611.";
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return data;
  });

  let lookups = 0;
  let publishes = 0;
  await page.route("**/api/ebay/publication-status", (r) => {
    const b = r.request().postDataJSON();
    expect(b.sku).toBe(before.groups[0].sku);
    expect(b.publicationId).toBe(before.groups[0].publicationId);
    lookups++;
    return r.fulfill({
      json: { success: true, status: "published", listingId: "940025900611" },
    });
  });
  await page.route("**/api/ebay/publish", (r) => {
    publishes++;
    return r.abort();
  });
  await page.reload();
  await expandUnpostedCards(page);
  await page.getByLabel("SKU", { exact: true }).fill("65-99999");
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("65-99999");
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Entwurf auf diesem Gerät gespeichert." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Auf diesem Gerät gespeichert" }),
  ).toBeVisible();
  await page.reload();
  await expandUnpostedCards(page);
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("65-99999");
  await page
    .getByRole("button", {
      name: "Bei eBay prüfen · nicht veröffentlichen",
      exact: true,
    })
    .click();
  await expect(page.locator(".listing-card-body")).toHaveCount(0);
  await page.locator(".listing-card-head").click();
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue(
    before.groups[0].sku,
  );
  await expect(page.getByLabel("SKU", { exact: true })).toBeDisabled();
  expect(lookups).toBe(1);
  expect(publishes).toBe(0);
});
test("new draft uses the eBay item-price recommendation instead of the provisional AI price", async ({page}) => {
  await setup(page);
  await page.route("**/api/ebay/comps", r => r.fulfill({json:{ok:true,comps:{ok:true,count:3,confidence:.3,query:"Canon R5",basis:"Active asking prices, not sold",median:75,recommendedPrice:75,low:60,high:90}}}));
  await draft(page);
  await expect(page.getByLabel("Preis",{exact:true})).toHaveValue("75");
  await expect(page.getByText(/aktive Angebote \(keine Verkaufspreise\)/)).toBeVisible();
});
test("late eBay research never replaces a seller's manually corrected price", async ({page}) => {
  await setup(page);
  let release: (()=>void) | undefined;
  let requested=false;
  const wait=new Promise<void>(resolve=>{release=resolve});
  await page.route("**/api/ebay/comps",async r=>{
    requested=true;
    await wait;
    await r.fulfill({json:{ok:true,comps:{ok:true,count:3,confidence:.3,query:"Canon R5",basis:"Active asking prices",median:75,recommendedPrice:75}}});
  });
  await draft(page);
  await expect.poll(()=>requested).toBe(true);
  await page.getByLabel("Preis",{exact:true}).fill("69");
  const completed=page.waitForResponse(r=>r.url().endsWith("…507 tokens truncated…"./taxonomy";
import {
  clipAspectValue,
  cleanAspectValue,
  splitAspectValues,
  matchAllowed,
  canonicalizeAspectKeys,
  enforceCardinality,
  sanitizeNumericAspects,
  snapStandardSizes,
} from "./aspects";
import { fillRecommendedAspects } from "./aspectFill";
import { applyShoeSize } from "./shoe-size";
import {
  extractProductIdentifiers,
  hasCatalogIdentifier,
  realBrand,
} from "./identifiers";
import { parseMeasurements } from "@/lib/measurements";
import { APPAREL_CATEGORIES, PANTS_CATEGORIES } from "@/lib/categories";
import type { ListingResult } from "@/lib/types";

// ── Constants (from the Python script) ───────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  womens_top: "15724",
  womens_dress: "63861",
  womens_skirt: "11554",
  womens_pants: "57988",
  womens_coat: "57990",
  womens_sweater: "63864",
  womens_jeans: "11554",
  womens_clothing: "15724",
  womens_shoes: "3034",
  mens_top: "57991",
  mens_pants: "57989",
  mens_coat: "57988",
  mens_sweater: "11484",
  mens_jeans: "11483",
  mens_clothing: "1059",
  mens_shoes: "93427",
  handbag: "169291",
  wallet: "2996",
  jewelry: "281",
  scarf: "45238",
  belt: "2996",
  sunglasses: "79720",
  hat: "52382",
  accessory: "4250",
  doll: "22733",
  collectible: "1463",
  collector_plate: "1467",
  toy: "2550",
  home_decor: "10033",
  book: "267",
  knife: "7313",
  sporting_goods: "159044",
  electronics: "293",
  camera: "625",
  audio: "293",
  video_game: "139973",
  media: "11232",
  vinyl_record: "176985",
  cd: "176984",
  dvd_bluray: "617",
  musical_instrument: "619",
  kitchenware: "20625",
  glassware: "50693",
  pottery_ceramics: "24",
  art: "550",
  craft: "14339",
  tool: "631",
  automotive: "6028",
  office: "25298",
  health_beauty: "26395",
  small_appliance: "20667",
  lighting: "20697",
  linens: "20444",
  holiday: "16086",
  board_game: "233",
  puzzle: "2613",
  plush: "2624",
  action_figure: "246",
  trading_card: "183050",
  sports_memorabilia: "64482",
  coin: "11116",
  stamp: "260",
  ephemera: "165800",
  other: "99",
};

// NOTE: category fallbacks used to be a static list of unrelated collectible
// leaves (dolls, plush, puzzles…) tried blindly whenever eBay rejected the
// chosen category. Publishing a dress into "Puzzles" technically succeeds and
// commercially fails — so fallbacks now come from eBay's own runner-up
// category suggestions for THIS item, and when none work the publish stops
// with an actionable error instead of landing in a wrong category.

const CONDITION_ALIASES: Record<string, string> = {
  NEW: "NEW_WITH_TAGS",
  NWT: "NEW_WITH_TAGS",
  NEW_WITH_TAGS: "NEW_WITH_TAGS",
  NEW_WITH_BOX: "NEW_WITH_TAGS",
  NEW_WITHOUT_TAGS: "NEW_NO_TAGS",
  NEW_WITHOUT_BOX: "NEW_NO_TAGS",
  NEW_NO_TAGS: "NEW_NO_TAGS",
  NEW_OTHER: "NEW_NO_TAGS",
  OPEN_BOX: "NEW_NO_TAGS",
  LIKE_NEW: "EXCELLENT",
  PREOWNED_EXCELLENT: "EXCELLENT",
  PRE_OWNED_EXCELLENT: "EXCELLENT",
  USED_EXCELLENT: "EXCELLENT",
  EXCELLENT: "EXCELLENT",
  VERY_GOOD: "VERY_GOOD",
  PREOWNED_VERY_GOOD: "VERY_GOOD",
  PRE_OWNED_VERY_GOOD: "VERY_GOOD",
  USED_VERY_GOOD: "VERY_GOOD",
  USED: "GOOD",
  PREOWNED: "GOOD",
  PRE_OWNED: "GOOD",
  USED_GOOD: "GOOD",
  PREOWNED_GOOD: "GOOD",
  PRE_OWNED_GOOD: "GOOD",
  GOOD: "GOOD",
  ACCEPTABLE: "FAIR",
  USED_ACCEPTABLE: "FAIR",
  FAIR: "FAIR",
  PREOWNED_FAIR: "FAIR",
  PRE_OWNED_FAIR: "FAIR",
  USED_FAIR: "FAIR",
  FOR_PARTS_OR_NOT_WORKING: "FOR_PARTS_OR_NOT_WORKING",
};

export const CONDITION_ID_ENUM: Record<number, string> = {
  1000: "NEW",
  1500: "NEW_OTHER",
  1750: "NEW_WITH_DEFECTS",
  2750: "LIKE_NEW",
  2990: "PRE_OWNED_EXCELLENT",
  3000: "USED_EXCELLENT",
  3010: "PRE_OWNED_FAIR",
  4000: "USED_VERY_GOOD",
  5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE",
  7000: "FOR_PARTS_OR_NOT_WORKING",
};

const GENERAL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [3000, 2750, 4000, 5000],
  VERY_GOOD: [4000, 3000, 5000, 2750],
  GOOD: [5000, 4000, 3000, 6000],
  FAIR: [6000, 5000, 4000, 3000],
};

const APPAREL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [2990, 3000, 3010],
  // eBay has no apparel "Very Good" tier. Use Good before overgrading as Excellent.
  VERY_GOOD: [3000, 2990, 3010],
  GOOD: [3000, 3010, 2990],
  FAIR: [3010, 3000, 2990],
};

const GENERAL_SAFE_CONDITION_IDS = [
  3000, 4000, 5000, 6000, 2750, 1500, 1000, 1750, 7000,
];
const APPAREL_SAFE_CONDITION_IDS = [3000, 2990, 3010, 1500, 1000, 1750];

const ASPECT_DEFAULTS: Record<string, string> = {};

// eBay's size standardization (enforced July 2026) blocks or holds listings
// whose Size is a placeholder or non-standard value, so size aspects are only
// ever filled from real listing data — never from defaults or guesses.
// "Size Type" (Regular/Plus/Petite/…) is exempt: it's a fit class, not a size.
function isSizeAspect(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("size") && !n.includes("size type");
}

const PLACEHOLDER_SIZE_RE =
  /^(see\s|refer\s|check\s|unknown\b|n\/?a\b|none\b|not\s|no\s(size|tag)|[-?]+$|tbd\b)/i;

function cleanSize(raw: unknown): string {
  const s = String(raw || "").trim();
  return PLACEHOLDER_SIZE_RE.test(s) ? "" : s;
}

// ── eBay REST client (token-authed) ──────────────────────────────────────────

interface EbayResp {
  ok: boolean;
  status: number;
  json: any;
  text: string;
}

async function ebayRequest(
  accessToken: string,
  method: string,
  url: string,
  opts: { body?: unknown; extraHeaders?: Record<string, string> } = {},
): Promise<EbayResp> {
  const resp = await boundedFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // Node's fetch defaults Accept-Language to "*", which eBay rejects
      // (error 25709). Pin it to a valid locale.
      "Accept-Language": "en-US",
      ...(opts.extraHeaders || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. empty 204) */
  }
  return { ok: resp.ok, status: resp.status, json, text };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// The price the seller reviewed and approved is the price that publishes.
// (This used to silently apply an 18% markup and quietly default a missing
// price to $29.99 → $35.39 — hiding unidentified items behind a made-up
// number instead of stopping for review.) Returns null when there is no
// usable price, which blocks the publish with an actionable error.
export function validListingPrice(
  raw: number | string | undefined,
): number | null {
  const base = typeof raw === "string" ? Number(raw) : raw;
  if (base === undefined || !Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * 100) / 100;
}

// eBay's CALCULATED-shipping business policies REQUIRE package weight (and
// dimensions) on the inventory item, or publish fails with error 25020 ("package
// weight is not valid or is missing"). Flat-rate policies don't need it.
//
// One 16 oz / 12×9×3 default for everything undercharged shipping badly for
// coats, boots, appliances, and framed art, so defaults are now profiled by
// item class. The seller can still refine weight/size on the listing afterward.
// Explicitly-set EBAY_DEFAULT_PACKAGE_* env vars override every profile.
// Weight is in ounces (16 oz = 1 lb); dimensions in inches.
//
// packageType is ALWAYS "PACKAGE_THICK_ENVELOPE" — eBay US's generic
// "Package (or thick envelope)" type used for ordinary boxes too. Other enum
// values from the Inventory API schema (e.g. MAILING_BOX) are rejected by the
// US marketplace with error 25101 "Invalid <ShippingPackage>", and only
// weight + dimensions actually drive calculated-shipping cost.
export const SAFE_PACKAGE_TYPE = "PACKAGE_THICK_ENVELOPE";

interface PackageProfile {
  oz: number;
  l: number;
  w: number;
  h: number;
}

const DEFAULT_PACKAGE: PackageProfile = { oz: 16, l: 12, w: 9, h: 3 };

const PACKAGE_PROFILES: Record<string, PackageProfile> = (() => {
  const size = (
    oz: number,
    l: number,
    w: number,
    h: number,
  ): PackageProfile => ({
    oz,
    l,
    w,
    h,
  });
  const profiles: Record<string, PackageProfile> = {};
  const assign = (keys: string[], p: PackageProfile) =>
    keys.forEach((k) => (profiles[k] = p));
  assign(["womens_coat", "mens_coat"], size(40, 16, 12, 5));
  assign(["womens_shoes", "mens_shoes"], size(48, 14, 10, 6));
  assign(["handbag"], size(24, 14, 11, 4));
  assign(
    [
      "small_appliance",
      "electronics",
      "camera",
      "audio",
      "musical_instrument",
      "tool",
      "automotive",
      "kitchenware",
      "sporting_goods",
    ],
    size(48, 14, 11, 6),
  );
  assign(["art", "collector_plate"], size(48, 20, 16, 4));
  assign(
    [
      "glassware",
      "pottery_ceramics",
      "doll",
      "collectible",
      "holiday",
      "home_decor",
      "lighting",
    ],
    size(32, 12, 10, 8),
  );
  assign(
    ["book", "media", "cd", "dvd_bluray", "video_game"],
    size(12, 12, 9, 2),
  );
  assign(["vinyl_record"], size(16, 14, 14, 2));
  assign(["linens", "plush"], size(20, 14, 11, 4));
  return profiles;
})();

export function defaultPackageWeightAndSize(
  catKey: string,
): Record<string, unknown> {
  const profile = PACKAGE_PROFILES[catKey] ?? DEFAULT_PACKAGE;
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    weight: {
      value: num(process.env.EBAY_DEFAULT_PACKAGE_WEIGHT_OZ, profile.oz),
      unit: "OUNCE",
    },
    dimensions: {
      length: num(process.env.EBAY_DEFAULT_PACKAGE_LENGTH_IN, profile.l),
      width: num(process.env.EBAY_DEFAULT_PACKAGE_WIDTH_IN, profile.w),
      height: num(process.env.EBAY_DEFAULT_PACKAGE_HEIGHT_IN, profile.h),
      unit: "INCH",
    },
    packageType: SAFE_PACKAGE_TYPE,
  };
}

function normalizeConditionInput(value: string | undefined): string {
  const cleaned = (value || "GOOD")
    .trim()
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return CONDITION_ALIASES[cleaned] || "GOOD";
}

function isApparelConditionPolicy(acceptedIds: Set<number>): boolean {
  return acceptedIds.has(2990) || acceptedIds.has(3010);
}

function conditionIdsForGrade(
  grade: string,
  acceptedIds: Set<number>,
  catKey: string,
): number[] {
  if (!acceptedIds.size) return [];
  let id: number | undefined;
  if (grade === "FOR_PARTS_OR_NOT_WORKING") id = 7000;
  else if (grade === "NEW_WITH_TAGS") id = 1000;
  else if (grade === "NEW_NO_TAGS") id = 1500;
  else if (isApparelConditionPolicy(acceptedIds))
    id = (
      { EXCELLENT: 2990, VERY_GOOD: 3000, GOOD: 3000, FAIR: 3010 } as Record<
        string,
        number
      >
    )[grade];
  else if (![2750, 4000, 5000, 6000].some((n) => acceptedIds.has(n)))
    id = 3000; // broad Used category
  else
    id = (
      { EXCELLENT: 2750, VERY_GOOD: 4000, GOOD: 5000, FAIR: 6000 } as Record<
        string,
        number
      >
    )[grade];
  return id && acceptedIds.has(id) ? [id] : [];
}

// Ordered eBay Inventory condition enums to try for an internal grade. The grade
// comes from photo analysis; the allowed IDs come from the chosen leaf category's
// Metadata policy, so apparel/books/electronics/etc. can each resolve differently.
export function conditionCandidates(
  grade: string | undefined,
  acceptedIds: Set<number>,
  catKey: string,
): string[] {
  const desired = normalizeConditionInput(grade);
  const out: string[] = [];
  for (const id of conditionIdsForGrade(desired, acceptedIds, catKey)) {
    const en = CONDITION_ID_ENUM[id];
    if (en && !out.includes(en)) out.push(en);
  }
  return out;
}

// Offline/static category resolution — used only when eBay's Taxonomy
// suggestions are unavailable.
function staticCategory(listing: ListingResult): string {
  const explicit = (listing.category_id || "").toString().trim();
  const catKey = (listing.category || "other").toString();
  return explicit || CATEGORY_MAP[catKey] || CATEGORY_MAP.other;
}

// First clean value of a possibly-compound field ("Cotton / Poly" → "Cotton").
// Placeholder phrases ("See tag in photos") come back as "".
function singleValue(v: unknown): string {
  return splitAspectValues(v)[0] || "";
}

function departmentForCategory(catKey: string): string {
  if (catKey.startsWith("womens_")) return "Women";
  if (catKey.startsWith("mens_")) return "Men";
  return "";
}

// Build the item-specifics (aspects) map from the listing. Values are kept as
// full arrays here ("Cotton / Polyester" → both parts survive); once eBay's
// aspect metadata arrives, enforceCardinality() trims single-value aspects.
// Placeholder phrases ("See tag in photos") never become aspect values —
// cleanAspectValue/splitAspectValues drop them at the door.
export function buildAspects(
  listing: ListingResult,
  catKey: string,
): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const putOne = (k: string, v: string) => {
    const val = cleanAspectValue(v);
    if (val) aspects[k] = [val];
  };
  const putMany = (k: string, v: unknown) => {
    const vals = splitAspectValues(v);
    if (vals.length) aspects[k] = vals;
  };

  putOne("Brand", String(listing.brand || "").trim());
  putOne("Size", cleanSize(listing.size));
  putMany("Color", listing.color);
  putMany("Material", listing.material);
  putOne("Type", String(listing.item_type || "").trim());

  const feats = Array.isArray(listing.key_features) ? listing.key_features : [];
  const cleanFeats = feats
    .map((f) => cleanAspectValue(String(f)))
    .filter(Boolean)
    .slice(0, 5);
  if (cleanFeats.length) aspects.Features = cleanFeats;

  if (departmentForCategory(catKey))
    aspects.Department = [departmentForCategory(catKey)];

  // Measurements go to eBay aspects only when explicitly labeled — never the
  // whole free-text blob (which once produced Inseam = "Waist 32 in, rise 11…").
  if (PANTS_CATEGORIES.has(catKey)) {
    const parsed = parseMeasurements(listing.measurements);
    if (parsed.inseam) aspects.Inseam = [parsed.inseam];
    if (parsed.waist && !aspects["Waist Size"])
      aspects["Waist Size"] = [parsed.waist];
    if (parsed.rise && !aspects.Rise) aspects.Rise = [parsed.rise];
  }

  // Merge in the model-provided item specifics (skip blanks + section labels).
  for (const [k, v] of Object.entries(listing.item_specifics || {})) {
    if (!k || k.startsWith("---")) continue;
    const vals = splitAspectValues(v);
    if (vals.length && !aspects[k]) aspects[k] = vals;
  }
  return aspects;
}

// ── Required-aspect reconciliation (driven by eBay's Taxonomy data) ──────────
//
// The static defaults above can't know what each leaf category requires, nor
// which values its SELECTION_ONLY aspects accept. We ask eBay for both and make
// every required aspect valid before publishing — eliminating the 25002 errors.

// Choose a valid Department from the category's own allowed values, biased by
// the item's gender cues. Kids categories only allow Boys/Girls/Unisex Kids, so
// a blind "Unisex Adults" default would still fail — we match against the list.
function pickDepartment(
  allowed: string[],
  listing: ListingResult,
  catKey: string,
): string {
  const text = `${catKey} ${listing.title || ""} ${listing.item_type || ""} ${
    listing.item_specifics?.Department || ""
  }`.toLowerCase();
  const women =
    catKey.startsWith("womens_") ||
    /\b(women|woman|ladies|female|girl)\b/.test(text);
  const men = catKey.startsWith("mens_") || /\b(men|man|male|boy)\b/.test(text);
  const pref = women
    ? ["Women", "Women's", "Girls", "Unisex Adults", "Unisex Kids", "Unisex"]
    : men
      ? ["Men", "Men's", "Boys", "Unisex Adults", "Unisex Kids", "Unisex"]
      : ["Unisex Adults", "Unisex Kids", "Unisex", "Women", "Men"];
  for (const p of pref) {
    const m = matchAllowed(p, allowed);
    if (m) return m;
  }
  return allowed[0] || "";
}

// Best free-text fill for a required aspect we don't already have, drawn from
// the listing itself. eBay accepts any string for FREE_TEXT aspects.
// "Unbranded"/"Multicolor" are eBay's own canonical values for genuinely
// unbranded/multicolored items; placeholder phrases are filtered out so
// "See tag in photos" can never become a searchable specific.
function freeTextDefault(name: string, listing: ListingResult): string {
  const n = name.toLowerCase();
  const clean = (v: unknown) => cleanAspectValue(String(v ?? "").trim());
  if (n.includes("brand")) return clean(listing.brand);
  if (n.includes("color")) return singleValue(listing.color);
  if (n.includes("shoe size") || n === "size") return cleanSize(listing.size);
  if (n.includes("material")) return singleValue(listing.material);
  if (n.includes("style"))
    return clean(listing.item_specifics?.Style || listing.item_type);
  if (n.includes("type")) return clean(listing.item_type);
  return "";
}

// Make every REQUIRED aspect present and valid. Mutates `aspects` in place.
export function reconcileAspects(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  listing: ListingResult,
  catKey: string,
): void {
  canonicalizeAspectKeys(aspects, meta);
  applyShoeSize(aspects, meta, cleanSize(listing.size), catKey);
  // Missing facts stay missing. Legal values are not evidence.
  for (const a of meta) {
    const values = aspects[a.name];
    if (!values) continue;
    if (a.mode === "SELECTION_ONLY") {
      const valid = values
        .map((v) => matchAllowed(v, a.values))
        .filter((v): v is string => Boolean(v));
      if (valid.length) aspects[a.name] = valid;
      else delete aspects[a.name];
    }
  }
}

// ── eBay error parsing (from the script) ─────────────────────────────────────

function errorIds(r: EbayResp): number[] {
  try {
    return (r.json?.errors || []).map((e: any) => Number(e.errorId || 0));
  } catch {
    return [];
  }
}

// eBay's Inventory API intermittently fails with 25001 ("A system error has
// occurred. Core Inventory Service internal error") or a bare 5xx. These are
// eBay-side blips that normally succeed on retry (issue #16), so every write
// call gets a short backoff-and-retry before we surface the failure.
const TRANSIENT_RETRIES = 2;
const TRANSIENT_BASE_DELAY_MS = 1500;

function isTransientEbayError(r: EbayResp): boolean {
  return r.status >= 500 || errorIds(r).includes(25001);
}

async function withTransientRetry(
  call: () => Promise<EbayResp>,
  label: string,
  sku: string,
): Promise<EbayResp> {
  let r = await call();
  for (
    let attempt = 1;
    attempt <= TRANSIENT_RETRIES && isTransientEbayError(r);
    attempt++
  ) {
    console.warn(
      `[ebay/publish] sku=${sku} ${label} hit transient eBay error ` +
        `(status=${r.status} ids=${errorIds(r).join(",") || "none"}) — retry ${attempt}/${TRANSIENT_RETRIES}`,
    );
    await new Promise((res) =>
      setTimeout(res, TRANSIENT_BASE_DELAY_MS * 2 ** (attempt - 1)),
    );
    r = await call();
  }
  return r;
}

// Extra guidance for eBay errors that a seller can act on directly. Keyed by
// errorId; appended to the raw eBay message when surfaced in the UI.
const EBAY_ERROR_HINTS: Record<number, string> = {
  25001:
    "This is a temporary glitch on eBay's side (we already retried automatically). Wait a minute and hit Post again — the listing data itself is fine.",
  25129:
    "eBay only accepts its own standard values for this size field now. Open the listing, pick a size from the dropdown (or clear it if it's optional), and post again.",
  25019:
    "eBay rejected the listing's content — usually a restricted or trademarked word in the title/description, or the item is already listed. Edit the title/description and try again.",
};

// Pull eBay's primary error (id + human message) from a failed response, so we
// can log it and show it cleanly instead of dumping raw JSON at the user.
function primaryEbayError(r: EbayResp): { errorId: number; message: string } {
  const err = r.json?.errors?.[0];
  if (err) {
    return {
      errorId: Number(err.errorId || 0),
      message: String(err.longMessage || err.message || "").trim(),
    };
  }
  return { errorId: 0, message: (r.text || "").slice(0, 300) };
}

// One structured log line per publish failure, so Vercel Function Logs actually
// show what eBay rejected. Without this the whole path logged nothing, which is
// why failed requests showed "No logs found for this request".
function logPublishFailure(stage: string, sku: string, r: EbayResp): void {
  const { errorId, message } = primaryEbayError(r);
  console.error(
    `[ebay/publish] ${stage} failed sku=${sku} http=${r.status} errorId=${errorId || "?"} ${message}`,
  );
}

// User-facing one-liner: eBay's own reason, tagged with its errorId, plus an
// actionable hint when we have one.
function publishErrorMessage(stage: string, r: EbayResp): string {
  const { errorId, message } = primaryEbayError(r);
  const detail = message || `HTTP ${r.status}`;
  const head = errorId
    ? `${stage} (eBay error ${errorId}): ${detail}`
    : `${stage} (${r.status}): ${detail}`;
  const hint = errorId ? EBAY_ERROR_HINTS[errorId] : undefined;
  return hint ? `${head} ${hint}` : head;
}

function extractExistingOfferId(r: EbayResp): string | null {
  for (const err of r.json?.errors || []) {
    if (err.errorId === 25002) {
      for (const p of err.parameters || []) {
        if (p.name === "offerId") return String(p.value);
      }
    }
  }
  return null;
}

function extractMissingAspects(r: EbayResp): string[] {
  const missing: string[] = [];
  for (const err of r.json?.errors || []) {
    const pieces = [err.message, err.longMessage].concat(
      (err.parameters || []).map((p: any) => String(p.value || "")),
    );
    const hay = pieces.join(" | ");
    const re = /item specific ([^|.,;]+?) is missing/gi;
    let m;
    while ((m = re.exec(hay))) {
      const name = m[1].trim();
      if (name) missing.push(name);
    }
  }
  return missing;
}

function addMissingAspects(
  aspects: Record<string, string[]>,
  missing: string[],
  listing: ListingResult,
): string[] {
  const added: string[] = [];
  for (const field of missing) {
    // Never stamp a default into a size aspect — let eBay's "missing item
    // specific" error surface so the seller supplies the real size.
    if (isSizeAspect(field)) continue;
    // Real listing data or a known safe default only. Stamping "Unbranded"
    // into arbitrary fields (the old fallback) produced junk like
    // Type = "Unbranded"; if nothing sensible exists, let eBay's error
    // surface and tell the seller exactly which specific is missing.
    const def = ASPECT_DEFAULTS[field] || freeTextDefault(field, listing);
    if (!def) continue;
    aspects[field] = [def];
    added.push(`${field}=${def}`);
  }
  return added;
}

// eBay rejected the VALUE of a specific aspect we sent (25002 "A user error
// has occurred. Fabric weight must be greater than 0. Enter up to 1 number
// after the decimal."). Find which sent aspect the error message names so the
// recovery can drop it and retry — the aspect name must appear as a whole
// word/phrase alongside validation-ish language. "Missing" errors are
// deliberately excluded (extractMissingAspects owns those), and word
// boundaries keep "Brand" from matching eBay's "<BrandMPN>" tag errors.
const ASPECT_VALUE_ERROR_RE =
  /must be|invalid|format|greater than|less than|number|decimal|numeric/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findInvalidValueAspects(
  r: EbayResp,
  aspects: Record<string, string[]>,
): string[] {
  const hits: string[] = [];
  for (const err of r.json?.errors || []) {
    for (const piece of [err.message, err.longMessage]) {
      const msg = String(piece || "");
      if (!msg || !ASPECT_VALUE_ERROR_RE.test(msg) || /is missing/i.test(msg))
        continue;
      for (const name of Object.keys(aspects)) {
        if (name.length < 3) continue;
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
        if (re.test(msg) && !hits.includes(name)) hits.push(name);
      }
    }
  }
  return hits;
}

// Recovery: drop the named aspects and retry once. Losing one searchable
// specific beats failing the whole publish; if the aspect was REQUIRED, eBay's
// next error says exactly which specific is missing, which the seller can act
// on directly.
export function applyInvalidAspectFallback(
  inventoryItem: { product: { aspects?: Record<string, string[]> } },
  aspects: Record<string, string[]>,
  names: string[],
  sku: string,
): void {
  for (const n of names) {
    console.warn(
      `[ebay/publish] sku=${sku} eBay rejected the value of aspect "${n}" (${JSON.stringify(
        aspects[n] ?? [],
      )}) — retrying without it`,
    );
    delete aspects[n];
  }
  inventoryItem.product.aspects = aspects;
}

// eBay's Brand/MPN pair validation (25002, tag <BrandMPN>): fires when an MPN
// arrives without a brand, when the pair doesn't match a catalog product, or
// when a category requires the Brand/MPN aspects and one is absent.
export function isBrandMpnError(r: EbayResp): boolean {
  return /BrandMPN/i.test(r.text || "");
}

// Recovery for a rejected Brand/MPN pair: drop the product-level pair and fall
// back to eBay's own aspect conventions — a Brand (or "Unbranded") plus MPN
// "Does Not Apply". Both are canonical eBay values, not placeholders.
export function applyBrandMpnFallback(
  inventoryItem: {
    product: {
      aspects?: Record<string, string[]>;
      brand?: string;
      mpn?: string;
    };
  },
  aspects: Record<string, string[]>,
  listing: ListingResult,
  sku: string,
): void {
  console.warn(
    `[ebay/publish] sku=${sku} eBay rejected the Brand/MPN pair (<BrandMPN>) — retrying with aspect-level fallbacks`,
  );
  delete inventoryItem.product.brand;
  delete inventoryItem.product.mpn;
  if (!aspects.Brand?.length) {
    aspects.Brand = [
      cleanAspectValue(String(listing.brand || "").trim()) || "Unbranded",
    ];
  }
  if (!aspects.MPN?.length) aspects.MPN = ["Does Not Apply"];
  inventoryItem.product.aspects = aspects;
}

// eBay rejected the package type for this marketplace (error 25101
// "Invalid <ShippingPackage>") — e.g. an enum value that exists in the
// Inventory API schema but isn't accepted by eBay US.
export function isShippingPackageError(r: EbayResp): boolean {
  return (
    errorIds(r).includes(25101) ||
    /Invalid\s*<?ShippingPackage/i.test(r.text || "")
  );
}

// Recovery for a rejected package: first snap the type to the one value eBay
// US always accepts; if it already was that value, drop the package block
// entirely — flat-rate policies publish fine without it, and calculated ones
// then surface eBay's clearer "package weight is missing" (25020) instead.
export function applyShippingPackageFallback(
  inventoryItem: { packageWeightAndSize?: { packageType?: string } },
  sku: string,
): void {
  const pkg = inventoryItem.packageWeightAndSize;
  if (pkg && pkg.packageType !== SAFE_PACKAGE_TYPE) {
    console.warn(
      `[ebay/publish] sku=${sku} eBay rejected packageType ${pkg.packageType} — retrying as ${SAFE_PACKAGE_TYPE}`,
    );
    pkg.packageType = SAFE_PACKAGE_TYPE;
  } else {
    console.warn(
      `[ebay/publish] sku=${sku} eBay rejected the shipping package — retrying without packageWeightAndSize`,
    );
    delete inventoryItem.packageWeightAndSize;
  }
}

function updateOfferBody(
  offer: Record<string, unknown>,
): Record<string, unknown> {
  const skip = new Set(["sku", "marketplaceId", "format"]);
  return Object.fromEntries(
    Object.entries(offer).filter(([k]) => !skip.has(k)),
  );
}

// ── Photo upload to eBay Picture Services (Trading API, XML) ──────────────────

// ── Policies & location ──────────────────────────────────────────────────────

export interface AccountSetup {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  locationKey: string;
}

export interface AccountOptions {
  sellerKey?: string;
  sellerName?: string;
  fulfillment: { id: string; name: string }[];
  payment: { id: string; name: string }[];
  returns: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}
export async function fetchAccountOptions(
  accessToken: string,
): Promise<AccountOptions> {
  const mp = "marketplace_id=" + EBAY_MARKETPLACE_ID;
  const results = await Promise.all([
    ebayRequest(
      accessToken,
      "GET",
      EBAY_ACC_BASE + "/fulfillment_policy?" + mp,
    ),
    ebayRequest(accessToken, "GET", EBAY_ACC_BASE + "/payment_policy?" + mp),
    ebayRequest(accessToken, "GET", EBAY_ACC_BASE + "/return_policy?" + mp),
    ebayRequest(accessToken, "GET", EBAY_INV_BASE + "/location?limit=100"),
  ]);
  if (results.some((r) => !r.ok))
    throw new Error(
      "Could not load all eBay policies and locations. Reconnect or retry.",
    );
  const rows = (r: EbayResp, key: string, id: string) =>
    (r.json?.[key] ?? []).map((x: any) => ({
      id: String(x[id]),
      name: String(x.name || x[id]),
    }));
  return {
    fulfillment: rows(results[0], "fulfillmentPolicies", "fulfillmentPolicyId"),
    payment: rows(results[1], "paymentPolicies", "paymentPolicyId"),
    returns: (results[2].json?.returnPolicies ?? [])
      .filter((policy: any) => policy.returnsAccepted === true)
      .map((policy: any) => ({
        id: String(policy.returnPolicyId),
        name: String(policy.name || policy.returnPolicyId),
      })),
    locations: (results[3].json?.locations ?? [])
      .filter((x: any) => x.merchantLocationStatus === "ENABLED")
      .map((x: any) => ({
        id: String(x.merchantLocationKey),
        name: [
          x.name,
          x.location?.address?.postalCode,
          x.location?.address?.country,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
  };
}

// ── The full publish flow for one item ───────────────────────────────────────

export interface PublishInput {
  publicationId?: string;
  shipping?: import("@/lib/validation").ShippingSelection;
  review?: {
    categoryId: string;
    secondaryCategoryId?: string;
    expiresAt: number;
    signature: string;
  };
  expectedPhotoCount?: number;
  sku: string;
  listing: ListingResult;
  // Base64 photos to upload to eBay in this request (legacy single-request
  // flow — the whole payload counts against Vercel's 4.5 MB body limit).
  images?: { mediaType: string; data: string }[];
  // eBay-hosted photo URLs from /api/ebay/upload-photos. The preferred flow:
  // photos ship in small batches beforehand, so the publish body stays tiny.
  imageUrls?: string[];
}

// Only accept photo URLs that eBay Picture Services itself minted — anything
// else in `imageUrls` is a malformed or tampered request, not our upload flow.
export function sanitizeEbayImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const isEps = host === "ebayimg.com" || host.endsWith(".ebayimg.com");
      if (u.protocol === "https:" && isEps && !out.includes(raw)) out.push(raw);
    } catch {
      /* not a URL — skip */
    }
  }
  return out.slice(0, 24);
}

export interface PublishResult {
  success: boolean;
  sku: string;
  listingId?: string;
  offerId?: string;
  error?: string;
  // The SKU already has a LIVE eBay listing — a duplicate bin batch, not a
  // transient failure. The client uses this to avoid clobbering the earlier item.
  alreadyListed?: boolean;
  // Non-fatal quality problems (e.g. eBay's aspect schema couldn't be
  // retrieved, so the listing published with generic specifics). Surfaced in
  // the UI so degraded listings stop failing silently.
  warnings?: string[];
}

// EBAY_STRICT_QUALITY=1 turns quality warnings into publish failures: better a
// stopped listing than one that quietly published without searchable specifics.
function strictQualityMode(): boolean {
  return (
    process.env.EBAY_STRICT_QUALITY === "1" ||
    /^true$/i.test(process.env.EBAY_STRICT_QUALITY || "")
  );
}

const CL = { "Content-Language": "en-US" };

// A published offer already exists for this SKU (e.g. the same bin code was
// reused for a second batch). Publishing again would silently overwrite the
// LIVE listing's photos/title with the new item's — so we refuse instead.
async function findPublishedOffer(
  accessToken: string,
  sku: string,
): Promise<{ offerId: string; listingId: string } | null> {
  const r = await ebayRequest(
    accessToken,
    "GET",
    `${EBAY_INV_BASE}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`,
  );
  if (!r.ok) {
    if (r.status === 404 || errorIds(r).includes(25713)) return null;
    throw new Error(
      "Could not verify whether this SKU is already live. Nothing was overwritten; retry later.",
    );
  }
  for (const o of r.json?.offers ?? []) {
    if (String(o?.status || "").toUpperCase() === "PUBLISHED") {
      return {
        offerId: String(o.offerId || ""),
        listingId: String(o?.listing?.listingId || ""),
      };
    }
  }
  return null;
}

// Upload photos with limited concurrency, preserving order. Sequential uploads
// were the slowest part of a publish (12 photos ≈ up to a minute on their own)
// and pushed long batches into Vercel's function timeout.
// Exported for /api/ebay/upload-photos, which runs this over small client-side
// batches so the publish request itself carries URLs instead of photo bytes.
export async function uploadPhotos(
  accessToken: string,
  images: { mediaType: string; data: string }[],
  sku: string,
  // Photo numbering offset, so batched uploads name photos K72-O-1 … K72-O-12
  // across batches instead of restarting at 1 in each.
  nameOffset = 0,
): Promise<string[]> {
  const result=await uploadPhotosDetailed(accessToken,images,sku,nameOffset);
  if(result.failed)throw new Error(result.results.find(r=>r.error)?.error || "Foto-Upload fehlgeschlagen.");
  return result.urls;
}

export async function publishListing(
  accessToken: string,
  input: PublishInput,
): Promise<PublishResult> {
  const sku = skuSchema.parse(input.sku);
  const listing = parseListing(input.listing);
  const shipping = shippingSchema.parse(input.shipping);
  const catId = listing.category_id || "";
  if (
    !input.review ||
    input.review.categoryId !== catId ||
    !verifyReview(catId, input.review.expiresAt, input.review.signature)
  )
    throw new Error("Prepare this category for review before publishing.");
  const price = validListingPrice(listing.suggested_price);
  if (!price || listing.title.length > 80 || !listing.description.trim())
    throw new Error(
      "A title of 1–80 characters, description and positive price are required.",
    );
  const photoUrls = sanitizeEbayImageUrls(input.imageUrls);
  if (
    !Number.isInteger(input.expectedPhotoCount) ||
    !photoUrls.length ||
    photoUrls.length !== input.expectedPhotoCount
  )
    throw new Error(
      "Every selected photo must upload before publication. Retry the failed uploads.",
    );
  const [meta, accepted, options] = await Promise.all([
    categoryAspects(catId),
    acceptedConditionIds(catId, accessToken),
    fetchAccountOptions(accessToken),
  ]);
  if (!meta.length || !accepted.size)
    throw new Error(
      "eBay category metadata is unavailable. Your draft is saved; retry later.",
    );
  const check = (rows: { id: string }[], id: string) =>
    rows.some((r) => r.id === id);
  if (
    !check(options.fulfillment, shipping.fulfillmentPolicyId) ||
    !check(options.payment, shipping.paymentPolicyId) ||
    !check(options.locations, shipping.locationKey)
  )
    throw new Error(
      "A selected shipping policy or location no longer exists. Select it again.",
    );
  if (!check(options.returns, shipping.returnPolicyId))
    throw new Error(
      "Choose an existing eBay return policy that accepts returns. Reload policies and select it again.",
    );
  const condition = listing.ebay_condition || "";
  if (![...accepted].some((id) => CONDITION_ID_ENUM[id] === condition))
    throw new Error("Select a condition supported by this category.");
  const aspects = Object.fromEntries(
    Object.entries(listing.item_specifics ?? {})
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, v.split(" | ").map((x) => x.trim())]),
  );
  // Drafts prepared before eBay locked size specifics to standard values may
  // still carry a custom one ("UK 7"); snap it, or drop it if optional.
  for (const name of snapStandardSizes(aspects, meta))
    console.warn(
      `[ebay/publish] sku=${sku} dropped optional "${name}" — not one of eBay's standard values`,
    );
  const issues = validateAspects(aspects, meta);
  if (issues.length) throw new Error(issues.join("; "));
  const existing = await findPublishedOffer(accessToken, sku);
  if (existing)
    return {
      success: false,
      sku,
      alreadyListed: true,
      ...existing,
      error:
        "This SKU is already live. Open the existing listing to confirm the previous attempt before posting again.",
    };
  const identifiers = extractProductIdentifiers(listing),
    brand = realBrand(listing);
  const inventoryItem = {
    product: {
      title: listing.title,
      description: listing.description,
      aspects,
      imageUrls: photoUrls,
      ...(identifiers.upc ? { upc: [identifiers.upc] } : {}),
      ...(identifiers.ean ? { ean: [identifiers.ean] } : {}),
      ...(identifiers.isbn ? { isbn: [identifiers.isbn] } : {}),
      ...(identifiers.mpn && brand ? { brand, mpn: identifiers.mpn } : {}),
    },
    condition,
    conditionDescription: listing.condition_notes || "",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    ...(shipping.weightOz !== undefined || shipping.lengthIn !== undefined
      ? {
          packageWeightAndSize: {
            ...(shipping.weightOz !== undefined
              ? { weight: { value: shipping.weightOz, unit: "OUNCE" } }
              : {}),
            ...(shipping.lengthIn !== undefined
              ? {
                  dimensions: {
                    length: shipping.lengthIn,
                    width: shipping.widthIn,
                    height: shipping.heightIn,
                    unit: "INCH",
                  },
                }
              : {}),
            packageType: SAFE_PACKAGE_TYPE,
          },
        }
      : {}),
  };
  const offerBody = {
    sku,
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    listingDescription: listing.description,
    pricingSummary: {
      price: { value: price.toFixed(2), currency: EBAY_CURRENCY },
    },
    quantityLimitPerBuyer: 1,
    categoryId: catId,
    merchantLocationKey: shipping.locationKey,
    listingPolicies: {
      fulfillmentPolicyId: shipping.fulfillmentPolicyId,
      paymentPolicyId: shipping.paymentPolicyId,
      returnPolicyId: shipping.returnPolicyId,
    },
    includeCatalogProductDetails: false,
  };
  const prior = await ebayRequest(
    accessToken,
    "GET",
    EBAY_INV_BASE + "/inventory_item/" + encodeURIComponent(sku),
  );
  if (!prior.ok && prior.status !== 404 && !errorIds(prior).includes(25713))
    throw new Error("Could not verify the inventory SKU before writing.");
  if (prior.ok) {
    const p = prior.json;
    // A retry may reuse exactly this item; a conflicting SKU must never be overwritten.
    if (
      p?.product?.title !== inventoryItem.product.title ||
      p?.product?.description !== inventoryItem.product.description ||
      JSON.stringify(p?.product?.imageUrls) !== JSON.stringify(photoUrls)
    )
      throw new Error(
        "This SKU already contains a different draft. Choose a unique SKU before posting this item.",
      );
  }
  const r = await withTransientRetry(
    () =>
      ebayRequest(
        accessToken,
        "PUT",
        EBAY_INV_BASE + "/inventory_item/" + encodeURIComponent(sku),
        { body: inventoryItem, extraHeaders: CL },
      ),
    "inventory item",
    sku,
  );
  if (!r.ok)
    return {
      success: false,
      sku,
      error: publishErrorMessage(
        "Inventory item rejected; review the draft",
        r,
      ),
    };
  // Reconcile existing unpublished offers before creating. Do not blindly retry POST.
  const offers = await ebayRequest(
    accessToken,
    "GET",
    EBAY_INV_BASE +
      "/offer?sku=" +
      encodeURIComponent(sku) +
      "&marketplace_id=" +
      EBAY_MARKETPLACE_ID,
  );
  if (!offers.ok && offers.status !== 404 && !errorIds(offers).includes(25713))
    throw new Error(
      "Could not confirm the existing offer state. Retry to reconcile before creating an offer.",
    );
  const previous = (offers.json?.offers ?? []).find(
    (o: any) => o.status !== "PUBLISHED" && o.format === "FIXED_PRICE",
  );
  let offerId = previous?.offerId;
  const offerResp = offerId
    ? await ebayRequest(
        accessToken,
        "PUT",
        EBAY_INV_BASE + "/offer/" + offerId,
        { body: updateOfferBody(offerBody), extraHeaders: CL },
      )
    : await ebayRequest(accessToken, "POST", EBAY_INV_BASE + "/offer", {
        body: offerBody,
        extraHeaders: CL,
      });
  if (!offerResp.ok)
    return {
      success: false,
      sku,
      error: publishErrorMessage("Offer rejected; review the draft", offerResp),
    };
  offerId = offerId || offerResp.json?.offerId;
  if (!offerId)
    throw new Error(
      "eBay did not return an offer ID. Retry to reconcile the saved draft.",
    );
  let published: EbayResp;
  try {
    published = await ebayRequest(
      accessToken,
      "POST",
      EBAY_INV_BASE + "/offer/" + offerId + "/publish",
      { extraHeaders: CL },
    );
  } catch (error) {
    const live = await findPublishedOffer(accessToken, sku);
    if (live) return { success: true, sku, ...live };
    throw error;
  }
  if (published.ok && published.json?.listingId)
    return {
      success: true,
      sku,
      offerId,
      listingId: String(published.json.listingId),
    };
  const live = await findPublishedOffer(accessToken, sku);
  if (live) return { success: true, sku, ...live };
  return {
    success: false,
    sku,
    offerId,
    error: publishErrorMessage(
      "Publication rejected; the reviewed facts were preserved",
      published,
    ),
  };
}
