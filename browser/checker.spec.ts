import { test, expect } from "@playwright/test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
const result = {
  title: "Blaues Hemd",
  description: "Blaues Hemd. Größe bitte prüfen.",
  price: 15,
  priceReason: "Privater Wiederverkauf geschätzt.",
  uncertainties: ["Größe prüfen"],
};
test("upload, article grouping, independent copy fields and original photo download", async ({
  page,
}) => {
  let calls = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    });
    Object.defineProperty(navigator, "canShare", { value: () => false });
  });
  await page.route("**/api/checker", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.images).toHaveLength(calls === 1 ? 2 : 1);
    expect(body.images[0].mediaType).toBe("image/jpeg");
    await route.fulfill({ json: { result, usage: [] } });
  });
  await page.clock.install();
  await page.goto("/checker");
  await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(3);
  const upload = page.getByLabel("Fotos auswählen");
  await upload.setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: png },
    { name: "back.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByRole("img")).toHaveCount(2);
  await page.getByLabel("Angaben zum Artikel").fill("Größe M");
  await page
    .getByRole("button", { name: "Artikel fertig → Entwurf erstellen" })
    .click();
  const first = page.getByRole("article").first();
  await expect(first.getByLabel("Titel", { exact: true })).toHaveValue(
    result.title,
  );
  await expect(first.getByRole("img")).toHaveCount(2);
  await first.getByLabel("Titel", { exact: true }).fill("Mein Hemd");
  await first
    .getByRole("button", { name: "Titel kopieren", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe("Mein Hemd");
  await first.getByRole("button", { name: "Beschreibung kopieren" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(result.description);
  await first.getByRole("button", { name: "Preis kopieren" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe("15");
  const download = page.waitForEvent("download");
  await first
    .getByRole("button", { name: "Foto 1 speichern", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("front.png");
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(first.getByRole("img")).toHaveCount(0);
  await expect(first.getByLabel("Titel", { exact: true })).toHaveValue("Mein Hemd");
  await upload.setInputFiles({
    name: "next.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("button", { name: "Artikel fertig → Entwurf erstellen" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByRole("article").last().getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  expect(calls).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Checker", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/checker-mobile.png",
    fullPage: true,
  });
});
test("failed generation preserves photos and retries only on a deliberate click", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/checker", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 502, json: { error: "Testfehler" } })
      : route.fulfill({
          json: { result: { ...result, price: null }, usage: [] },
        });
  });
  await page.goto("/checker");
  await page
    .getByLabel("Fotos auswählen")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Artikel fertig → Entwurf erstellen" })
    .click();
  await expect(page.getByRole("article").getByRole("alert")).toHaveText(
    "Testfehler",
  );
  expect(calls).toBe(1);
  await expect(page.getByRole("article").getByRole("img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Erneut versuchen (KI-Kosten)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preis kopieren" }),
  ).toBeDisabled();
  expect(calls).toBe(2);
});

test("live camera groups successive articles while generation runs", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/checker", async (route) => {
    calls++;
    expect(route.request().postDataJSON().images).toHaveLength(1);
    await route.fulfill({ json: { result, usage: [] } });
  });
  await page.goto("/checker");
  await page
    .getByRole("button", {
      name: "Kamera öffnen · mehrere Fotos aufnehmen",
      exact: true,
    })
    .click();
  const shutter = page.getByRole("button", {
    name: "Foto aufnehmen",
    exact: true,
  });
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(page.getByRole("img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Artikel fertig → nächste", exact: true })
    .click();
  await expect(
    page.getByRole("article").first().getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  await shutter.click();
  await expect(page.getByRole("img")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Artikel fertig → nächste", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByRole("article").last().getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  expect(calls).toBe(2);
  await page
    .getByRole("button", { name: "Fertig · Kamera schließen", exact: true })
    .click();
  await expect(page.getByLabel("Live-Kamerabild")).toHaveCount(0);
});
