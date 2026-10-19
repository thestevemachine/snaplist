import { isGlasses } from "@/lib/glasses-rules";
import {
  FIXED_CONDITION_NOTES,
  contentIssues,
} from "@/lib/listing-content-rules";
import { materialTitleIssues } from "../eyewear-inscriptions";
import { categorySpecifics } from "./category-fields";
import { isSunglasses } from "../category-selection";
import { mergeCategoryAspects } from "./secondary-category";
import { createHash } from "node:crypto";
import { parseListing, shippingSchema, skuSchema } from "@/lib/validation";
import { verifyReview } from "@/lib/review";
import { categoryAspects, acceptedConditionIds } from "./taxonomy";
import { validateAspects } from "./draft";
import {
  CONDITION_ID_ENUM,
  sanitizeEbayImageUrls,
  type PublishInput,
  type PublishResult,
} from "./publish";
import { fetchTradingOptions } from "./trading-options";
import {
  assertTradingSuccess,
  list,
  requireGermanMarketplace,
  tradingCall,
  tradingMessages,
  xml,
} from "./trading";

export interface TradingResult extends PublishResult {
  verified?: boolean;
  fees?: { name: string; amount: string; currency: string }[];
}

// Same SKU always gets the same UUID, including after timeouts/reloads/edits.
// eBay rejects a second Add for an already successful UUID. Never auto-revise.
export function listingUuid(sku: string) {
  return createHash("sha256")
    .update(`snaplist:trading:DE:${sku}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

export async function submitTradingListing(
  token: string,
  input: PublishInput,
  mode: "verify" | "publish",
): Promise<TradingResult> {
  requireGermanMarketplace();
  const sku = skuSchema.parse(input.sku);
  const listing = parseListing(input.listing);
  const shipping = shippingSchema.parse(input.shipping);
  const category = listing.category_id || "";
  const secondary = listing.secondary_category_id || "";
  if (isSunglasses(listing) && !secondary)
    throw new Error("Bitte Sonnenbrillen für Herren und Damen vorbereiten.");
  if (secondary && secondary === category)
    throw new Error("Haupt- und Zweitkategorie müssen verschieden sein.");
  if (
    !input.review ||
    input.review.categoryId !== category ||
    (input.review.secondaryCategoryId || "") !== secondary ||
    !verifyReview(
      category,
      input.review.expiresAt,
      input.review.signature,
      secondary,
    )
  )
    throw new Error("Bitte die Kategorie erneut vorbereiten.");
  const price = Number(listing.suggested_price);
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    listing.title.length > 80 ||
    !listing.description.trim()
  )
    throw new Error(
      "Titel, Beschreibung und ein positiver Preis in EUR sind erforderlich.",
    );
  const photos = sanitizeEbayImageUrls(input.imageUrls);
  if (
    !Number.isInteger(input.expectedPhotoCount) ||
    !photos.length ||
    photos.length !== input.expectedPhotoCount
  )
    throw new Error(
      "Alle ausgewählten Fotos müssen zuerst vollständig hochgeladen werden.",
    );
  let [meta, accepted, options] = await Promise.all([
    categoryAspects(category),
    acceptedConditionIds(category, token),
    fetchTradingOptions(token),
  ]);
  if (!meta.length || !accepted.size)
    throw new Error("Die Kategorie-Merkmale konnten nicht geprüft werden.");
  if (secondary) {
    const [secondMeta, secondAccepted] = await Promise.all([
      categoryAspects(secondary),
      acceptedConditionIds(secondary, token),
    ]);
    if (!secondMeta.length || !secondAccepted.size)
      throw new Error("Die zweite Kategorie konnte nicht geprüft werden.");
    meta = mergeCategoryAspects(meta, secondMeta);
    accepted = new Set([...accepted].filter((id) => secondAccepted.has(id)));
  }
  if (isGlasses(listing)) meta = meta.map(m => ({...m, required:m.required || /^Besonderheiten$/i.test(m.name)}));
  for (const [rows, id] of [
    [options.fulfillment, shipping.fulfillmentPolicyId],
    [options.payment, shipping.paymentPolicyId],
    [options.returns, shipping.returnPolicyId],
  ] as const)
    if (!rows.some((r) => r.id === id))
      throw new Error(
        "Bitte die aktuellen eBay.de-Rahmenbedingungen auswählen.",
      );
  const origin = options.locations.find((r) => r.id === shipping.locationKey);
  if (!origin)
    throw new Error("Bitte den tatsächlichen Artikelstandort auswählen.");
  const conditionId = [...accepted].find(
    (id) => CONDITION_ID_ENUM[id] === listing.ebay_condition,
  );
  if (!conditionId)
    throw new Error(
      "Bitte einen für diese Kategorie gültigen Zustand auswählen.",
    );
  const aspects = Object.fromEntries(
    Object.entries(categorySpecifics(listing.item_specifics ?? {}, meta))
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, v.split(" | ").map((s) => s.trim())]),
  );
  // Seller's default for stock without an EAN; preserve an entered identifier.
  const eanKey = Object.keys(aspects).find(
    (key) => key.trim().toUpperCase() === "EAN",
  );
  const ean = eanKey ? aspects[eanKey][0] : "Nicht zutreffend";
  if (meta.some((aspect) => aspect.name === "EAN")) aspects.EAN = [ean];
  const issues = [
    ...validateAspects(aspects, meta),
    ...contentIssues(listing),
    ...materialTitleIssues({
      ...listing,
      item_specifics: Object.fromEntries(
        Object.entries(aspects).map(([k, v]) => [k, v.join(" | ")]),
      ),
    }),
  ];
  if (issues.length) throw new Error(issues.join("; "));
  // Description is editable plain text. Escape HTML first, then XML; preserve lines.
  const conditionNotes = isGlasses(listing)
    ? FIXED_CONDITION_NOTES
    : listing.condition_notes;
  const description = xml(listing.description).replace(/\r?\n/g, "<br>");
  const grams =
    shipping.weightOz === undefined
      ? undefined
      : Math.ceil(shipping.weightOz * 28.349523125);
  const packageXml =
    grams !== undefined || shipping.lengthIn !== undefined
      ? `<ShippingPackageDetails><MeasurementUnit>Metric</MeasurementUnit><ShippingPackage>PackageThickEnvelope</ShippingPackage>${grams !== undefined ? `<WeightMajor>${Math.floor(grams / 1000)}</WeightMajor><WeightMinor>${grams % 1000}</WeightMinor>` : ""}${shipping.lengthIn !== undefined ? `<PackageLength>${Math.ceil(shipping.lengthIn * 2.54)}</PackageLength><PackageWidth>${Math.ceil(shipping.widthIn! * 2.54)}</PackageWidth><PackageDepth>${Math.ceil(shipping.heightIn! * 2.54)}</PackageDepth>` : ""}</ShippingPackageDetails>`
      : "";
  const item = `<Item>
    <Title>${xml(listing.title)}</Title><Description>${xml(description)}</Description>
    <PrimaryCategory><CategoryID>${xml(category)}</CategoryID></PrimaryCategory>
    ${secondary ? `<SecondaryCategory><CategoryID>${xml(secondary)}</CategoryID></SecondaryCategory>` : ""}
    <Site>Germany</Site><Country>${xml(origin.country)}</Country><Currency>EUR</Currency>
    <Location>${xml(origin.city)}</Location><PostalCode>${xml(origin.postalCode)}</PostalCode>
    <ListingType>FixedPriceItem</ListingType><ListingDuration>GTC</ListingDuration>
    <StartPrice currencyID="EUR">${price.toFixed(2)}</StartPrice><Quantity>1</Quantity>
    <SKU>${xml(sku)}</SKU><InventoryTrackingMethod>SKU</InventoryTrackingMethod>
    <UUID>${listingUuid(sku)}</UUID><ConditionID>${conditionId}</ConditionID>
    <ProductListingDetails><EAN>${xml(ean)}</EAN><IncludeeBayProductDetails>false</IncludeeBayProductDetails></ProductListingDetails>
    ${conditionNotes ? `<ConditionDescription>${xml(conditionNotes)}</ConditionDescription>` : ""}
    <PictureDetails>${photos.map((p) => `<PictureURL>${xml(p)}</PictureURL>`).join("")}</PictureDetails>
    <ItemSpecifics>${Object.entries(aspects)
      .map(
        ([name, values]) =>
          `<NameValueList><Name>${xml(name)}</Name>${values.map((v) => `<Value>${xml(v)}</Value>`).join("")}</NameValueList>`,
      )
      .join("")}</ItemSpecifics>
    <SellerProfiles>
      <SellerShippingProfile><ShippingProfileID>${xml(shipping.fulfillmentPolicyId)}</ShippingProfileID></SellerShippingProfile>
      <SellerPaymentProfile><PaymentProfileID>${xml(shipping.paymentPolicyId)}</PaymentProfileID></SellerPaymentProfile>
      <SellerReturnProfile><ReturnProfileID>${xml(shipping.returnPolicyId)}</ReturnProfileID></SellerReturnProfile>
    </SellerProfiles>
    ${packageXml}
    <VATDetails><VATPercent>19</VATPercent></VATDetails>
    <BestOfferDetails><BestOfferEnabled>${listing.best_offer_enabled !== false}</BestOfferEnabled></BestOfferDetails>
  </Item>`;
  // Always verify first. Verification never falls through to Add in verify mode.
  const verification = await tradingCall(
    token,
    "VerifyAddFixedPriceItem",
    item,
  );
  assertTradingSuccess(verification);
  const warnings = tradingMessages(verification, "Warning");
  const fees = list(verification.Fees?.Fee).map((f) => ({
    name: f.Name || "",
    amount: typeof f.Fee === "string" ? f.Fee : f.Fee?.["#text"] || "0",
    currency:
      typeof f.Fee === "object" ? f.Fee["@_currencyID"] || "EUR" : "EUR",
  }));
  if (mode === "verify")
    return { success: true, sku, verified: true, warnings, fees };
  const result = await tradingCall(token, "AddFixedPriceItem", item);
  assertTradingSuccess(result);
  if (!result.ItemID || !/^\d+$/.test(result.ItemID))
    throw new Error(
      "Keine Angebotsnummer erhalten. Vor einem erneuten Versuch im Seller Hub nachsehen; SKU nicht ändern.",
    );
  return {
    success: true,
    sku,
    listingId: result.ItemID,
    warnings: [...warnings, ...tradingMessages(result, "Warning")],
    fees,
  };
}
