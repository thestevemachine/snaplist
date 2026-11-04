import { tradingCall, assertTradingSuccess, list, xml } from "../ebay/trading";
import { sellerAccessToken } from "../ebay/session";
import { type Listing, type Payload } from "./domain";
type Data = Record<string, any>;
const money = (x: any) => {
  const s = String(x?.["#text"] ?? x ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [a, b = ""] = s.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
};
export async function reader() {
  const token = await sellerAccessToken(undefined);
  if (!token) throw Error("eBay-Anmeldung erforderlich.");
  const call = async (
    name: "GetItem" | "GetUser" | "GetMyeBaySelling" | "GetBestOffers",
    body: string,
  ) => {
    const r = await tradingCall(token, name, body);
    assertTradingSuccess(r);
    return r as unknown as Data;
  };
  const user = await call("GetUser", "");
  const seller = String(user.User?.UserID ?? "");
  if (!seller) throw Error("Verkäuferkonto nicht bestätigt.");
  return {
    seller,
    async item(id: string) {
      if (!/^\d{6,20}$/.test(id)) throw Error("Ungültige Artikelnummer.");
      return (
        await call(
          "GetItem",
          `<ItemID>${xml(id)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`,
        )
      ).Item as Data;
    },
    async oldest(): Promise<string> {
      let page = 1,
        pages = 1;
      do {
        const r = await call(
          "GetMyeBaySelling",
          `<ActiveList><Include>true</Include><Sort>StartTime</Sort><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`,
        );
        pages = Number(r.ActiveList?.PaginationResult?.TotalNumberOfPages);
        if (!Number.isSafeInteger(pages) || pages < 0 || pages > 1000)
          throw Error("Unvollständige Pagination.");
        for (const summary of list<Data>(r.ActiveList?.ItemArray?.Item)) {
          const raw = await this.item(String(summary.ItemID));
          if (String(raw.Seller?.UserID ?? "") !== seller)
            throw Error("Verkäufer stimmt nicht überein.");
          if (
            raw.Site === "Germany" &&
            raw.SellingStatus?.ListingStatus === "Active"
          )
            return String(raw.ItemID);
        }
        page++;
      } while (page <= pages);
      throw Error("Kein aktives deutsches Angebot gefunden.");
    },
    async all() {
      const found = new Map<string, Listing>();
      let page = 1,
        pages = 1;
      do {
        const r = await call(
          "GetMyeBaySelling",
          `<ActiveList><Include>true</Include><Sort>StartTime</Sort><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`,
        );
        if (!r.ActiveList?.PaginationResult)
          throw Error(
            "Unvollständige Pagination; bisheriger Bestand bleibt erhalten.",
          );
        pages = Number(r.ActiveList.PaginationResult.TotalNumberOfPages);
        if (!Number.isSafeInteger(pages) || pages < 0 || pages > 1000)
          throw Error("Ungültige Pagination.");
        for (const i of list<Data>(r.ActiveList.ItemArray?.Item)) {
          const l = normalize(i, seller);
          found.set(l.id, l);
        }
        page++;
      } while (page <= pages);
      return [...found.values()];
    },
  };
}
export function normalize(i: Data, seller: string): Listing {
  const price = money(i.SellingStatus?.CurrentPrice ?? i.StartPrice);
  return {
    id: String(i.ItemID ?? ""),
    seller: String(i.Seller?.UserID ?? seller),
    site: String(i.Site ?? "unknown"),
    title: String(i.Title ?? ""),
    sku: String(i.SKU ?? ""),
    started: String(i.ListingDetails?.StartTime ?? ""),
    priceCents: Number.isSafeInteger(price) ? price : 0,
    currency: String(
      i.SellingStatus?.CurrentPrice?.["@_currencyID"] ?? i.Currency ?? "",
    ),
    quantity:
      i.QuantityAvailable === undefined ? null : Number(i.QuantityAvailable),
    sold:
      i.SellingStatus?.QuantitySold === undefined
        ? null
        : Number(i.SellingStatus.QuantitySold),
    type: String(i.ListingType ?? ""),
    active: i.SellingStatus?.ListingStatus === "Active",
    variations: Boolean(i.Variations),
    management: "unknown",
    offers: "unknown",
    promotion: "unknown",
    views: null,
    ...(Number.isFinite(money(i.ListingDetails?.MinimumBestOfferPrice))
      ? { minOfferCents: money(i.ListingDetails.MinimumBestOfferPrice) }
      : {}),
    ...(Number.isFinite(money(i.ListingDetails?.BestOfferAutoAcceptPrice))
      ? { autoAcceptCents: money(i.ListingDetails.BestOfferAutoAcceptPrice) }
      : {}),
    thumbnail: list<string>(i.PictureDetails?.PictureURL)[0],
    firstSeen: new Date().toISOString(),
    predecessors: [],
  };
}
export function publicationPayload(i: Data): Payload {
  // First supported contract: single-item GTC listings using seller policies.
  const required = [
    "Title",
    "Description",
    "SKU",
    "ConditionID",
    "Country",
    "Location",
    "PostalCode",
    "DispatchTimeMax",
  ];
  if (
    required.some((k) => !String(i[k] ?? "").trim()) ||
    !i.PrimaryCategory?.CategoryID ||
    !i.ItemSpecifics?.NameValueList ||
    !i.SellerProfiles?.SellerShippingProfile?.ShippingProfileID ||
    !i.SellerProfiles?.SellerReturnProfile?.ReturnProfileID ||
    !i.SellerProfiles?.SellerPaymentProfile?.PaymentProfileID
  )
    throw Error("Pflichtdaten/Verkaufsrichtlinien fehlen.");
  const unsupported = [
    ...(i.ListingDuration !== "GTC" ? ["ListingDuration"] : []),
    ...[
      "Regulatory",
      "ProductSafety",
      "Variations",
      "DiscountPriceInfo",
      "ListingEnhancement",
      "SubTitle",
      "SecondaryCategory",
    ].filter((k) => Boolean(i[k])),
    ...(i.ShippingDetails?.ShippingDiscountProfileID
      ? ["ShippingDiscountProfileID"]
      : []),
  ];
  if (unsupported.length)
    throw Error(`Nicht unterstützte Einstellungen: ${unsupported.join(", ")}.`);

  if (
    [
      "ItemCompatibilityList",
      "Charity",
      "PickupInStoreDetails",
      "ShippingServiceCostOverrideList",
      "CustomPolicies",
      "ExtendedProducerResponsibility",
      "ConditionDescriptors",
      "VideoDetails",
    ].some((k) => i[k]) ||
    i.PrivateListing === "true"
  )
    throw Error("Wesentliche Sondereinstellung noch nicht unterstützt.");
  const minimum = money(i.ListingDetails?.MinimumBestOfferPrice),
    accept = money(i.ListingDetails?.BestOfferAutoAcceptPrice);
  const offer = i.BestOfferDetails?.BestOfferEnabled;
  if (offer !== undefined && !["true", "false", true, false].includes(offer))
    throw Error("Preisvorschlagseinstellungen unklar.");
  const optional: Partial<Payload> = {};
  if (i.InventoryTrackingMethod !== undefined) {
    if (!["SKU", "ItemID"].includes(i.InventoryTrackingMethod))
      throw Error("Bestandsverfolgung unklar.");
    optional.InventoryTrackingMethod = i.InventoryTrackingMethod;
  }
  if (i.TaxCategory) optional.TaxCategory = String(i.TaxCategory);
  if (i.ShipToLocations)
    optional.ShipToLocations = list<string>(i.ShipToLocations).map(String);
  if (i.VATDetails) {
    optional.VATDetails = {};
    for (const k of ["BusinessSeller", "RestrictedToBusiness"] as const)
      if (i.VATDetails[k] !== undefined) {
        if (!["true", "false", true, false].includes(i.VATDetails[k]))
          throw Error("Steuereinstellung unklar.");
        optional.VATDetails[k] = String(i.VATDetails[k]);
      }
    if (i.VATDetails.VATPercent !== undefined) {
      const v = String(i.VATDetails.VATPercent);
      if (!/^\d{1,2}(?:\.\d)?$/.test(v) || Number(v) > 27)
        throw Error("Mehrwertsteuersatz nicht unterstützt.");
      optional.VATDetails.VATPercent = v;
    }
  }
  if (i.AutoPay !== undefined) {
    if (!["true", "false", true, false].includes(i.AutoPay))
      throw Error("Zahlungseinstellung unklar.");
    optional.AutoPay = String(i.AutoPay);
  }
  if (i.Storefront) {
    optional.Storefront = {};
    for (const k of ["StoreCategoryID", "StoreCategory2ID"] as const)
      if (i.Storefront[k] !== undefined) {
        if (!/^\d+$/.test(String(i.Storefront[k])))
          throw Error("Shop-Kategorie ungültig.");
        optional.Storefront[k] = String(i.Storefront[k]);
      }
  }
  if (i.ProductListingDetails) {
    optional.ProductListingDetails = {
      IncludeeBayProductDetails: "false",
      IncludeStockPhotoURL: "false",
    };
    for (const k of ["EAN", "ISBN", "UPC", "ProductReferenceID"] as const)
      if (i.ProductListingDetails[k] !== undefined)
        optional.ProductListingDetails[k] = String(i.ProductListingDetails[k]);
    if (i.ProductListingDetails.BrandMPN) {
      const b = i.ProductListingDetails.BrandMPN;
      if (!b.Brand || !b.MPN) throw Error("Produktkennung unvollständig.");
      optional.ProductListingDetails.BrandMPN = {
        Brand: String(b.Brand),
        MPN: String(b.MPN),
      };
    }
  }
  const offerSettings =
    offer !== undefined
      ? {
          BestOfferDetails: { BestOfferEnabled: String(offer) },
          ListingDetails: {
            ...(Number.isFinite(minimum)
              ? { MinimumBestOfferPrice: (minimum / 100).toFixed(2) }
              : {}),
            ...(Number.isFinite(accept)
              ? { BestOfferAutoAcceptPrice: (accept / 100).toFixed(2) }
              : {}),
          },
        }
      : {};
  return {
    ...optional,
    ...offerSettings,
    Title: i.Title,
    Description: i.Description,
    SKU: i.SKU,
    Site: "Germany",
    Currency: "EUR",
    ListingType: "FixedPriceItem",
    ListingDuration: "GTC",
    Quantity: 1,
    StartPrice: String(i.StartPrice?.["#text"] ?? i.StartPrice),
    PrimaryCategory: { CategoryID: String(i.PrimaryCategory.CategoryID) },
    ConditionID: String(i.ConditionID),
    ...(i.ConditionDescription
      ? { ConditionDescription: String(i.ConditionDescription) }
      : {}),
    ItemSpecifics: {
      NameValueList: list<Data>(i.ItemSpecifics.NameValueList).map((v) => ({
        Name: String(v.Name),
        Value: list<string>(v.Value).map(String),
      })),
    },
    PictureDetails: { PictureURL: list<string>(i.PictureDetails?.PictureURL) },
    Country: String(i.Country),
    Location: String(i.Location),
    PostalCode: String(i.PostalCode),
    DispatchTimeMax: String(i.DispatchTimeMax),
    SellerProfiles: {
      SellerShippingProfile: {
        ShippingProfileID: String(
          i.SellerProfiles.SellerShippingProfile.ShippingProfileID,
        ),
      },
      SellerReturnProfile: {
        ReturnProfileID: String(
          i.SellerProfiles.SellerReturnProfile.ReturnProfileID,
        ),
      },
      SellerPaymentProfile: {
        PaymentProfileID: String(
          i.SellerProfiles.SellerPaymentProfile.PaymentProfileID,
        ),
      },
    },
  };
}
