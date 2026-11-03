// No tokens, credentials or arbitrary response objects are part of this model.
export type Listing = {
  id: string;
  seller: string;
  site: string;
  title: string;
  sku: string;
  started: string;
  priceCents: number;
  currency: string;
  quantity: number | null;
  sold: number | null;
  type: string;
  active: boolean;
  variations: boolean;
  management: "trading" | "inventory" | "unknown";
  offers: "clear" | "pending" | "unknown";
  promotion: "clear" | "active" | "unknown";
  minOfferCents?: number;
  autoAcceptCents?: number;
  views: number | null;
  blockingReason?: string;
  thumbnail?: string;
  firstSeen: string;
  lastRenewed?: string;
  predecessors: string[];
};
export type Payload = {
  Title: string;
  Description: string;
  SKU: string;
  Site: "Germany";
  Currency: "EUR";
  ListingType: "FixedPriceItem";
  ListingDuration: "GTC";
  Quantity: 1;
  StartPrice: string;
  PrimaryCategory: { CategoryID: string };
  ConditionID: string;
  ConditionDescription?: string;
  ItemSpecifics: { NameValueList: { Name: string; Value: string[] }[] };
  PictureDetails: { PictureURL: string[] };
  Country: string;
  Location: string;
  PostalCode: string;
  SellerProfiles: {
    SellerShippingProfile: { ShippingProfileID: string };
    SellerReturnProfile: { ReturnProfileID: string };
    SellerPaymentProfile: { PaymentProfileID: string };
  };
  VATDetails?: {
    BusinessSeller?: string;
    RestrictedToBusiness?: string;
    VATPercent?: string;
  };
  InventoryTrackingMethod?: "SKU" | "ItemID";
  TaxCategory?: string;
  ShipToLocations?: string[];
  AutoPay?: string;
  Storefront?: { StoreCategoryID?: string; StoreCategory2ID?: string };
  ProductListingDetails?: {
    IncludeeBayProductDetails?: string;
    IncludeStockPhotoURL?: string;
    EAN?: string;
    ISBN?: string;
    UPC?: string;
    ProductReferenceID?: string;
    BrandMPN?: { Brand: string; MPN: string };
  };
  DispatchTimeMax: string;
  BestOfferDetails?: { BestOfferEnabled: string };
  ListingDetails?: {
    MinimumBestOfferPrice?: string;
    BestOfferAutoAcceptPrice?: string;
  };
};
export type Backup = {
  version: 1;
  listing: Listing;
  payload: Payload;
  images: { path: string; sha256: string; bytes: number; mime: string }[];
  createdAt: string;
  digest: string;
  settingsSnapshot?: Record<string, unknown>;
};
export type Phase =
  | "selected"
  | "backed_up"
  | "verified"
  | "ready"
  | "end_requested"
  | "ended"
  | "create_requested"
  | "created"
  | "completed"
  | "review"
  | "skipped";
export type Row = {
  id: string;
  listing: Listing;
  originalCents: number;
  percent: string;
  targetCents: number;
  phase: Phase;
  uuid: string;
  backup?: Backup;
  outgoing?: Payload;
  feeCents?: number;
  verifiedAt?: number;
  createAttempted?: boolean;
  newId?: string;
  error?: string;
  attempts: number;
  nextAttemptAt?: number;
  history: { at: string; phase: Phase; note: string }[];
};
export type Job = {
  id: string;
  account: string;
  seller: string;
  mode: "simulation" | "dry-run" | "live";
  confirmed: boolean;
  paused: boolean;
  rows: Row[];
  createdAt: string;
  previewDigest: string;
};
export function percentUnits(input: unknown): number {
  if (typeof input !== "string" && typeof input !== "number")
    throw Error("Ungültiger Prozentwert.");
  const s = String(input).trim().replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,4})?$/.test(s))
    throw Error(
      "Prozentwert muss zwischen 0 und unter 100 liegen (maximal vier Nachkommastellen).",
    );
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 10000 + Number(fraction.padEnd(4, "0"));
}
export function reducedPrice(cents: number, input: unknown): number {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000)
    throw Error("Ungültiger Ausgangspreis.");
  const units = percentUnits(input);
  return Number(
    (BigInt(cents) * BigInt(1_000_000 - units) + 500_000n) / 1_000_000n,
  );
}
export function exclusions(
  l: Listing,
  seller: string,
  target = l.priceCents,
): string[] {
  const reasons: string[] = [];
  if (l.blockingReason) reasons.push(l.blockingReason);
  if (l.seller !== seller) reasons.push("Anderes Verkäuferkonto");
  if (l.site !== "Germany") reasons.push("Kein deutsches Originalangebot");
  if (!l.active) reasons.push("Nicht aktiv");
  if (l.type !== "FixedPriceItem") reasons.push("Kein Festpreisangebot");
  if (l.quantity !== 1 || l.sold !== 0)
    reasons.push("Bestand/Verkäufe nicht sicher für Einzelstück geeignet");
  if (l.variations) reasons.push("Varianten werden nicht unterstützt");
  if (l.management !== "trading")
    reasons.push("Verwaltungsweg nicht als Trading bestätigt");
  if (l.offers !== "clear")
    reasons.push("Laufender oder ungeklärter Preisvorschlag/Verkaufsvorgang");
  if (l.promotion !== "clear")
    reasons.push("Rabattaktion oder Preisbezug ungeklärt");
  if (l.currency !== "EUR" || target < 1)
    reasons.push("Ungültiger EUR-Zielpreis");
  if ((l.minOfferCents ?? 0) > target || (l.autoAcceptCents ?? 0) > target)
    reasons.push("Preisvorschlagsgrenze über Zielpreis");
  if (!l.started || !Number.isFinite(Date.parse(l.started)))
    reasons.push("Einstelldatum fehlt");
  return reasons;
}
export type Sort = "oldest" | "newest" | "viewsAsc" | "viewsDesc";
export function filtered(items: Listing[], query: string, sort: Sort) {
  const q = query.toLocaleLowerCase("de");
  return items
    .filter((l) => `${l.title} ${l.sku}`.toLocaleLowerCase("de").includes(q))
    .sort((a, b) => {
      let n = 0;
      if (sort.startsWith("views")) {
        if (a.views === null && b.views !== null) return 1;
        if (b.views === null && a.views !== null) return -1;
        n = ((a.views ?? 0) - (b.views ?? 0)) * (sort === "viewsDesc" ? -1 : 1);
      } else
        n =
          (Date.parse(a.started) - Date.parse(b.started)) *
          (sort === "newest" ? -1 : 1);
      return n || a.id.localeCompare(b.id);
    });
}
export function quickSelect(items: Listing[], seller: string, n: number) {
  return items
    .filter((l) => !exclusions(l, seller).length)
    .slice(0, n)
    .map((l) => l.id);
}
