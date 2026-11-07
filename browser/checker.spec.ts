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

test("standalone URL saves one private model, survives reload and isolates other browsers", async ({
  page,
  browser,
}) => {
  let calls = 0;
  await page.route("**/api/reseller-checker", (route) => {
    calls++;
    expect(route.request().postDataJSON().model).toBeUndefined();
    return route.fulfill({ json: { result, usage: [] } });
  });
  await page.goto("/reseller-checker");
  await expect(
    page.getByRole("navigation", { name: "Anwendungsbereiche" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    }),
  ).toBeDisabled();
  const fakeKey = "daughter-browser-key-123456789";
  await page.getByLabel("API-Schlüssel für").fill(fakeKey);
  await page
    .getByRole("button", { name: "KI-Zugang speichern", exact: true })
    .click();
  await expect(page.getByText("Eingerichtet:")).toBeVisible();
  await expect(page.locator(".reseller-settings details")).not.toHaveAttribute(
    "open",
  );
  await expect(page.getByLabel("API-Schlüssel für")).toHaveValue("");
  const cookies = await page.context().cookies();
  const credential = cookies.find((c) => c.name === "reseller_checker_session");
  expect(credential?.httpOnly).toBe(true);
  expect(credential?.path).toBe("/api/reseller-checker");
  expect(credential?.value).not.toContain(fakeKey);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    fakeKey,
  );
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("http://127.0.0.1:3194/reseller-checker");
  await expect(
    otherPage.getByRole("button", { name: "KI-Zugang speichern", exact: true }),
  ).toBeDisabled();
  await expect(otherPage.getByText("Eingerichtet:")).toHaveCount(0);
  await other.close();
  await page.reload();
  await expect(page.getByText("Eingerichtet:")).toBeVisible();
  await expect(page.locator(".reseller-settings details")).not.toHaveAttribute(
    "open",
  );
  await page.getByLabel("Fotos auswählen").setInputFiles({
    name: "daughter.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("img")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("article").getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/reseller-checker-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Alles leeren", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText("Eingerichtet:")).toBeVisible();
  await page.getByText("KI-Einstellungen ändern", { exact: true }).click();
  await page
    .getByRole("button", { name: "KI-Zugang entfernen", exact: true })
    .click();
  await expect(page.getByText("Eingerichtet:")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await page.context().cookies()).some(
      (c) => c.name === "reseller_checker_session",
    ),
  ).toBe(false);
});

test("download all originals including the current article and clear the workspace", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => false });
  });
  await page.route("**/api/checker", (route) =>
    route.fulfill({ json: { result, usage: [] } }),
  );
  await page.goto("/checker");
  const upload = page.getByLabel("Fotos auswählen");
  await upload.setInputFiles([
    { name: "same.png", mimeType: "image/png", buffer: png },
    { name: "back.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByRole("img")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("article").getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  await upload.setInputFiles({
    name: "same.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("img")).toHaveCount(3);
  const perArticle = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Artikel-Fotos herunterladen", exact: true })
    .click();
  const article = await perArticle;
  expect(article.suggestedFilename()).toBe("reseller-checker-artikel-1.zip");
  await article.saveAs(testInfo.outputPath("article.zip"));
  const allPhotos = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Alle Fotos herunterladen (3)", exact: true })
    .click();
  const all = await allPhotos;
  expect(all.suggestedFilename()).toBe("reseller-checker-alle-fotos.zip");
  await all.saveAs(testInfo.outputPath("all.zip"));
  await page.getByRole("button", { name: "Alles leeren", exact: true }).click();
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByLabel("Angaben zum Artikel")).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Alle Fotos herunterladen (0)",
      exact: true,
    }),
  ).toBeDisabled();
});

test("clearing discards queued articles and ignores a late response", async ({
  page,
}) => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/checker", async (route) => {
    calls++;
    if (calls === 1) await blocked;
    await route.fulfill({ json: { result, usage: [] } });
  });
  await page.goto("/checker");
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Fotos auswählen").setInputFiles({
      name: `photo-${i}.png`,
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      page.getByRole("button", {
        name: "Artikel fertig → Entwurf erstellen",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", {
        name: "Artikel fertig → Entwurf erstellen",
        exact: true,
      })
      .click();
  }
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Alles leeren", exact: true }).click();
  const late = page.waitForResponse("**/api/checker");
  release();
  await late;
  await expect(page.getByRole("article")).toHaveCount(0);
  await page
    .getByLabel("Fotos auswählen")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Artikel fertig → Entwurf erstellen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("article").getByLabel("Titel", { exact: true }),
  ).toHaveValue(result.title);
  expect(calls).toBe(2);
});

test("top media-library button shares original photos from every article together", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        (
          window as unknown as {
            sharedPhotos: { name: string; size: number }[];
          }
        ).sharedPhotos = data.files.map((file) => ({
          name: file.name,
          size: file.size,
        }));
      },
    });
  });
  await page.route("**/api/checker", (route) =>
    route.fulfill({ json: { result, usage: [] } }),
  );
  await page.goto("/checker");
  for (const names of [["front.png", "back.png"], ["next.png"]]) {
    await page
      .getByLabel("Fotos auswählen")
      .setInputFiles(
        names.map((name) => ({ name, mimeType: "image/png", buffer: png })),
      );
    await expect(
      page.getByRole("button", {
        name: "Artikel fertig → Entwurf erstellen",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", {
        name: "Artikel fertig → Entwurf erstellen",
        exact: true,
      })
      .click();
  }
  await expect(page.getByRole("article")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Alle Fotos in Mediathek speichern (3)",
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            sharedPhotos: { name: string; size: number }[];
          }
        ).sharedPhotos,
    ),
  ).toEqual(
    ["front.png", "back.png", "next.png"].map((name) => ({
      name,
      size: png.length,
    })),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Bilder sichern" }),
  ).toBeVisible();
});
