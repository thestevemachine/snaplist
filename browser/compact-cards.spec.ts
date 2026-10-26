import { test, expect, type Page } from "@playwright/test";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
async function setup(page: Page, pattern = "") {
  let paid = 0,
    writes = 0;
  await page.route("**/api/**", (r) => {
    if (/analyze|\/ai\//.test(r.request().url())) paid++;
    if (/publish|verify/.test(r.request().url())) writes++;
    if (r.request().url().endsWith("/api/cloud"))
      return r.fulfill({ json: { enabled: false } });
    return r.fulfill({
      json: {
        ok: false,
        connected: false,
        configured: false,
        sortModels: [],
        analysisModels: [],
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "Auf diesem Gerät gespeichert",
  );
  await page.evaluate(
    async ({ image, pattern }) => {
      const photo = {
        id: "p1",
        mediaType: "image/png",
        previewUrl: image,
        data: image.split(",")[1],
      };
      const meta = (name: string, extra = {}) => ({
        name,
        required: false,
        usage: "OPTIONAL",
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        values: [],
        ...extra,
      });
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("listing-writer-drafts");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            {
              version: 1,
              photos: [photo],
              groups: [
                {
                  id: "g1",
                  sku: "",
                  name: "CRH Brille",
                  photoIds: ["p1"],
                  status: "done",
                  evidencePhotoIds: ["p1"],
                  listing: {
                    title: "CRH Brille Rund Panto Schwarz Silber",
                    description: "Manueller Text",
                    eyewear_kind: "optical",
                    category_id: "180957",
                    suggested_price: 69,
                    glasses_rules_version: 4,
                    category_fields_version: 4,
                    item_specifics: {
                      Marke: "CRH",
                      Muster: pattern,
                      Rahmenmaterial: "Metall | Acetat",
                      Produktlinie: "",
                      Rahmenbreite: "",
                      Herstellungsjahr: "",
                    },
                    eyewear: {
                      fields: {
                        material: {
                          value: "Titan",
                          source: "label",
                          quote: "TITANIUM",
                          photos: [1],
                        },
                      },
                      warnings: [],
                    },
                    evidence: { Marke: [1] },
                    estimates: { Marke: 90 },
                    frontMeasurement: {
                      method: "front-photo-ratio-v1",
                      status: "uncertain",
                      photoIndex: 1,
                      lensHeightMm: 40,
                      totalWidthMm: 138,
                      reasons: ["Perspektive unsicher"],
                    },
                  },
                  preparation: {
                    categoryId: "180957",
                    categoryName: "Brillenfassungen",
                    suggestions: [
                      {
                        id: "180957",
                        path: "Beauty & Gesundheit > Augenoptik > Brillenfassungen",
                      },
                    ],
                    signature: "test",
                    expiresAt: Date.now() + 3600000,
                    conditions: [],
                    issues: [],
                    aspects: [
                      meta("Marke"),
                      meta("Thema", {
                        cardinality: "MULTI",
                        values: ["Retro"],
                      }),
                      meta("Charakter", {
                        cardinality: "MULTI",
                        values: ["Klassisch"],
                      }),
                      meta("Muster"),
                      meta("Rahmenmaterial", {
                        cardinality: "MULTI",
                        values: ["Titan", "Acetat", "Metall"],
                      }),
                      meta("Produktlinie"),
                      meta("Anzahl der Einheiten"),
                      meta("Maßeinheit"),
                      meta("Rahmenbreite", { values: ["130 mm", "140 mm"] }),
                      meta("Herstellungsjahr"),
                    ],
                  },
                },
              ],
              orphanIds: [],
              binPrefix: "old-bin-value",
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
    { image, pattern },
  );
  await page.reload();
  await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
  await expect(
    page.locator(".draft-controls").getByLabel("Marke", { exact: true }),
  ).toHaveValue("CRH");
  return () => ({ paid, writes });
}
test("compact cards group values with labels, collapse rare sections, preserve exact SKU and suggestions on reload", async ({
  page,
}) => {
  const counts = await setup(page);
  const card = page.locator(".listing-card");
  await page.getByRole("button",{name:"Stapeltabelle",exact:true}).click();
  await expect(page.getByRole("button",{name:"Detailkarten",exact:true})).toHaveCSS("border-top-color","rgb(29, 78, 216)");
  await expect(page.getByRole("button",{name:"Detailkarten",exact:true})).toHaveCSS("border-top-width","3px");
  await page.getByRole("button",{name:"Detailkarten",exact:true}).click();
  await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
  await expect(
    card.getByLabel("Versandregel", { exact: true }),
  ).not.toBeVisible();
  await expect(card.getByLabel("Produktlinie", { exact: true })).toHaveCount(0);
  await expect(
    card.getByLabel("Anzahl der Einheiten", { exact: true }),
  ).toHaveCount(0);
  await expect(card.getByLabel("Maßeinheit", { exact: true })).toHaveCount(0);
  await expect(card.getByLabel("Rahmenbreite", { exact: true })).toHaveValue(
    "138 mm",
  );
  await expect(card.getByLabel("Muster", { exact: true })).toHaveCount(0);
  const materials = card.getByLabel("Rahmenmaterial: Auswahl bearbeiten");
  await expect(materials).toContainText("Titan");
  await expect(materials).toContainText("Acetat");
  await expect(materials).toContainText("Metall");
  await card.getByText("Versand und Rückgabe", { exact: true }).click();
  await expect(card.getByLabel("Versandregel", { exact: true })).toBeVisible();

  await expect(card.getByLabel("Thema: Auswahl bearbeiten")).toContainText(
    "Panto",
  );
  for (const name of ["Thema", "Charakter"]) {
    await card.getByLabel(`${name}: Auswahl bearbeiten`).click();
    const tags = card.getByLabel(`${name}: eigene Stilbegriffe`);
    expect((await tags.inputValue()).split(" | ")).toHaveLength(5);
    await card.getByLabel(`${name}: Auswahl bearbeiten`).click();
  }
  const positions = await card
    .locator(".specific-edit")
    .first()
    .evaluate((el) => {
      const legend = el
          .querySelector(".specific-name")!
          .getBoundingClientRect(),
        input = el.querySelector("input")!.getBoundingClientRect(),
        hints = el.querySelector(".aspect-evidence")!.getBoundingClientRect();
      return {
        gap: input.top - legend.bottom,
        after: hints.top >= input.bottom,
      };
    });
  expect(positions.gap).toBeLessThanOrEqual(8);
  expect(positions.after).toBe(true);
  const divider = await card
    .locator(".specific-edit")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el),
        hints = getComputedStyle(el.querySelector(".aspect-evidence")!);
      return {
        bottom: style.borderBottomStyle,
        bottomWidth: parseFloat(style.borderBottomWidth),
        hintsTop: parseFloat(hints.borderTopWidth),
      };
    });
  expect(divider.bottom).toBe("solid");
  expect(divider.bottomWidth).toBe(1);
  expect(divider.hintsTop).toBe(0);
  const cat = await card.locator(".category-id-field").evaluate((el) => {
    const a = el.querySelector("span")!.getBoundingClientRect(),
      b = el.querySelector("input")!.getBoundingClientRect();
    return Math.abs(a.top + a.height / 2 - b.top - b.height / 2);
  });
  expect(cat).toBeLessThan(4);
  await card.getByLabel("SKU", { exact: true }).fill("65-23537-A-7cd44bf46731");
  await card
    .getByRole("button", { name: "SKU 65-23537 übernehmen", exact: true })
    .click();
  await expect(card.getByLabel("SKU", { exact: true })).toHaveValue("65-23537");
  await card.getByLabel("Rahmenbreite", { exact: true }).fill("");
  await card.getByLabel("Thema: Auswahl bearbeiten").click();
  await card.getByLabel("Thema: eigene Stilbegriffe").fill("Mein eigener Stil");
  await card.getByLabel("Thema: Auswahl bearbeiten").click();
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
  await expect(
    page.getByLabel("Versandregel", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("65-23537");
  await expect(page.getByLabel("Rahmenbreite", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Thema: Auswahl bearbeiten")).toContainText(
    "Mein eigener Stil",
  );
  await expect(
    page.getByLabel("Herstellungsjahr", { exact: true }),
  ).toHaveValue("");
  expect(counts()).toEqual({ paid: 0, writes: 0 });
  await page.screenshot({
    path: "/tmp/snaplist-compact-card-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Artikelmerkmale", {exact:true})).toBeVisible();
  await expect(page.getByText(/Verwendet die vorhandenen Fotos/)).toHaveCount(0);
  await expect(page.getByText(/Ein Angebot in beiden Kategorien/)).toHaveCount(0);
  const tools = page.locator(".analysis-tools > details");
  const firstTool = await tools.nth(0).boundingBox();
  const secondTool = await tools.nth(1).boundingBox();
  expect(secondTool!.y - (firstTool!.y + firstTool!.height)).toBeLessThan(8);
  await page.locator(".title-input").fill("Lindberg Sonnenbrille Herren Damen Pilot Oval Titan Schwarz Modell 1234 Blau");
  await expect.poll(() => page.locator(".title-input").evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await expect(page.locator(".listing-card-title strong")).toHaveCSS("white-space", "normal");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "/tmp/snaplist-compact-card-phone.png",
    fullPage: true,
  });
});
test("upload and photo sorting do not ask for a SKU", async ({ page }) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json: {
        ok: false,
        connected: false,
        enabled: false,
        sortModels: [],
        analysisModels: [],
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("#bin")).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({
    name: "front.png",
    mimeType: "image/png",
    buffer: Buffer.from(image.split(",")[1], "base64"),
  });
  await page
    .getByRole("button", { name: "Diese Fotos gehören zu einem Artikel" })
    .click();
  await expect(page.getByLabel("Artikel-SKU / Lagerbox")).toHaveCount(0);
});

test("retains an actual recognized pattern but omits empty or plain pattern fields", async ({
  page,
}) => {
  await setup(page, "Gestreift | Geometrisch");
  await expect(page.getByLabel("Muster", { exact: true })).toHaveValue(
    "Gestreift | Geometrisch",
  );
});
test("removes an unproven ic berlin titanium guess from an existing draft without a new paid analysis", async ({page}) => {
  const counts=await setup(page);
  await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
  await page.evaluate(async()=>{
    await new Promise<void>((resolve,reject)=>{
      const r=indexedDB.open("listing-writer-drafts");
      r.onsuccess=()=>{
        const db=r.result,tx=db.transaction("workspace","readwrite"),store=tx.objectStore("workspace"),get=store.get("current");
        get.onsuccess=()=>{
          const data=get.result,l=data.groups[0].listing;
          l.title="ic! berlin Titan Sonnenbrille";
          l.brand="ic! berlin";l.content_rules_version=3;
          l.material="Titan";l.item_specifics.Marke="ic! berlin";
          l.item_specifics.Rahmenmaterial="Titan";
          l.eyewear={fields:{material:{value:"Titan",source:"label",quote:"TITANIUM",photos:[1]}},warnings:[]};
          store.put(data,"current");
        };
        tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator(".title-input")).toHaveValue("ic! berlin Metall Sonnenbrille");
  await expect(page.getByLabel("Rahmenmaterial: Auswahl bearbeiten")).toContainText("Metall");
  await expect(page.getByLabel("Rahmenmaterial: Auswahl bearbeiten")).not.toContainText("Titan");
  await expect(page.getByLabel("Beschreibung",{exact:true})).toHaveValue("Manueller Text");
  await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
  await page.reload();
  await expect(page.locator(".title-input")).toHaveValue("ic! berlin Metall Sonnenbrille");
  expect(counts()).toEqual({paid:0,writes:0});
});
test("recovers Lindberg 46 mm from stored demo-lens text without a paid reanalysis",async ({page})=>{
 const counts=await setup(page);
 await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
 await page.evaluate(async()=>{
  await new Promise<void>((resolve,reject)=>{
   const r=indexedDB.open("listing-writer-drafts");r.onsuccess=()=>{
    const db=r.result,tx=db.transaction("workspace","readwrite"),store=tx.objectStore("workspace"),get=store.get("current");
    get.onsuccess=()=>{const data=get.result,g=data.groups[0],l=g.listing;
     l.brand="Lindberg";l.title="Lindberg Brille";l.item_specifics.Marke="Lindberg";
     l.item_specifics.Scheibenbreite="";
     l.eyewear.fields.modelNumber={value:"1257",source:"label",quote:"LINDBERG 1257 46",photos:[1]};
     delete l.eyewear.fields.lensWidth;
     g.preparation.aspects.push({name:"Scheibenbreite",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false,dataType:"NUMBER"});
     store.put(data,"current");};
    tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
   };
  });
 });
 await page.reload();
 await expect(page.getByLabel("Scheibenbreite",{exact:true})).toHaveValue("46");
 await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
 await page.getByText("Aufdrucke & Maße",{exact:true}).click();
 await expect(page.getByRole("textbox",{name:/^Glasbreite \(mm\)/})).toHaveValue("46");
 await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
 await page.reload();
 await expect(page.getByLabel("Scheibenbreite",{exact:true})).toHaveValue("46");
 expect(counts()).toEqual({paid:0,writes:0});
});
test("missing-field warning jumps into a closed aspect section, and optical lens width stays editable without a taxonomy field",async ({page})=>{
 const counts=await setup(page);
 await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
 await page.evaluate(async()=>{
  await new Promise<void>((resolve,reject)=>{
   const r=indexedDB.open("listing-writer-drafts");r.onsuccess=()=>{
    const db=r.result,tx=db.transaction("workspace","readwrite"),store=tx.objectStore("workspace"),get=store.get("current");
    get.onsuccess=()=>{const d=get.result,g=d.groups[0];g.listing.item_specifics.Rahmenfarbe="";
     delete g.listing.eyewear;
     g.listing.frontMeasurement={method:"front-photo-ratio-v1",status:"unavailable",photoIndex:1,reasons:["Scheibenbreite fehlt"],imageSize:{width:1000,height:500},observation:{photoIndex:1,leftLens:{left:{x:.15,y:.4},right:{x:.4,y:.4},top:{x:.27,y:.2},bottom:{x:.27,y:.6}},rightLens:{left:{x:.6,y:.4},right:{x:.85,y:.4},top:{x:.73,y:.2},bottom:{x:.73,y:.6}},outerLeft:{x:.05,y:.4},outerRight:{x:.95,y:.4},frontal:true,groovesVisible:true,complete:true,samePlane:true,confidence:95,note:""}};
     g.preparation.aspects.push({name:"Glashöhe",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false});
     g.preparation.aspects.push({name:"Rahmenfarbe",mode:"SELECTION_ONLY",cardinality:"SINGLE",values:["Schwarz","Braun"],required:true});store.put(d,"current");};
    tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
   };
  });
 });
 await page.reload();
 await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
 const width=page.getByRole("spinbutton",{name:"Glasbreite manuell (mm)"});
 await expect(width).toBeVisible();
 await width.fill("46");
 await expect(page.getByLabel("Glashöhe",{exact:true})).toHaveValue("37 mm");
 await page.locator(".specifics-details > summary").click();
 await expect(page.getByLabel("Rahmenfarbe",{exact:true})).not.toBeVisible();
 await page.getByRole("button",{name:"Enter Rahmenfarbe",exact:true}).click();
 await expect(page.getByLabel("Rahmenfarbe",{exact:true})).toBeFocused();
 await page.getByLabel("Rahmenfarbe",{exact:true}).selectOption("Schwarz");
 await expect(page.getByRole("button",{name:"Enter Rahmenfarbe",exact:true})).toHaveCount(0);
 await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
 await page.reload();
 await page.getByRole("button",{name:"Angebotsdetails aufklappen"}).click();
 await expect(width).toHaveValue("46");
 await expect(page.getByLabel("Glashöhe",{exact:true})).toHaveValue("37 mm");
 expect(counts()).toEqual({paid:0,writes:0});
});
test("restored published cards stay collapsed while the next draft summary remains visible",async ({page})=>{
 const counts=await setup(page);
 await expect(page.getByRole("status")).toContainText("Auf diesem Gerät gespeichert");
 await page.evaluate(async()=>{
  await new Promise<void>((resolve,reject)=>{
   const r=indexedDB.open("listing-writer-drafts");r.onsuccess=()=>{
    const db=r.result,tx=db.transaction("workspace","readwrite"),store=tx.objectStore("workspace"),get=store.get("current");
    get.onsuccess=()=>{const d=get.result,g=d.groups[0],next=structuredClone(g);next.id="next-card";next.sku="NEXT";next.listing.title="Noch nicht veröffentlicht";
     g.postStatus="posted";g.listingId="123456789012";g.sku="DONE";d.groups.push(next);store.put(d,"current");};
    tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
   };
  });
 });
 await page.reload();
 await page.getByRole("button",{name:"Detailkarten",exact:true}).click();
 const cards=page.locator(".listing-card");
 await expect(cards.nth(0).locator(".listing-card-body")).toHaveCount(0);
 await expect(cards.nth(0).getByRole("link",{name:/Angebot bei eBay öffnen/})).toBeVisible();
 await expect(cards.nth(1).locator(".listing-card-body")).toBeVisible();
 await cards.nth(0).locator(".listing-card-head").click();
 await expect(cards.nth(0).locator(".listing-card-body")).toBeVisible();
 await expect(cards.nth(1).locator(".listing-card-body")).toBeVisible();
 expect(counts()).toEqual({paid:0,writes:0});
});

test("draft defaults to a compact title/SKU/price and a warning expands directly to its field",async({page})=>{
 const counts=await setup(page);
 await page.reload();
 const card=page.locator(".listing-card");
 await expect(card.getByRole("button",{name:"Angebotsdetails aufklappen"})).toHaveAttribute("aria-expanded","false");
 await expect(card.getByRole("button",{name:"Angebotsdetails aufklappen"})).toContainText("Ausklappen");
 await expect(card.locator(".card-toggle-arrow")).toHaveText("↓");
 expect(await card.evaluate(el=>el.parentElement?.previousElementSibling?.classList.contains("sku-sequence"))).toBe(true);
 await expect(card.getByLabel("SKU",{exact:true})).toBeVisible();
 await expect(card.getByLabel("Preis",{exact:true})).toBeVisible();
 await expect(card.getByLabel("Beschreibung",{exact:true})).not.toBeVisible();
 await expect(card.getByRole("button",{name:"Titel kopieren"})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 const actions=card.locator(".title-actions");
 const copyBox=await actions.getByRole("button",{name:"Titel kopieren"}).boundingBox();
 const publishBox=await actions.getByRole("button",{name:"Auf eBay.de veröffentlichen…"}).boundingBox();
 expect(Math.abs(copyBox!.y-publishBox!.y)).toBeLessThan(2);
 await page.screenshot({path:"/tmp/snaplist-quick-card-phone.png",fullPage:true});
 const publish=card.getByRole("button",{name:"Auf eBay.de veröffentlichen…"});
 await expect(publish).toBeVisible();await expect(publish).toBeDisabled();
 await card.getByRole("button",{name:/Rahmenbedingungen und Artikelstandort/}).click();
 await expect(card.getByLabel("Versandregel",{exact:true})).toBeFocused();
 await expect(card.getByLabel("Beschreibung",{exact:true})).toBeVisible();
 expect(counts()).toEqual({paid:0,writes:0});
});
