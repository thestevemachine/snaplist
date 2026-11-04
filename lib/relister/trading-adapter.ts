import { XMLBuilder } from "fast-xml-parser";
import { assertTradingSuccess, tradingCall, list, xml } from "../ebay/trading";
import { uploadOnePhoto } from "../ebay/photo-upload";
import { normalize, publicationPayload } from "./ebay";
import { fetchImage } from "./images";
import { secureBackup, restoreImages, type BackupStorage } from "./backup";
import {
  digest,
  TemporaryError,
  AuthorizationError,
  type Adapter,
} from "./engine";
import {
  exclusions,
  type Backup,
  type Listing,
  type Payload,
  type Row,
} from "./domain";
export type RawItem = Record<string, any>;
export type TradingCall = (
  call:
    | "GetItem"
    | "GetUser"
    | "GetMyeBaySelling"
    | "GetBestOffers"
    | "VerifyAddFixedPriceItem"
    | "EndFixedPriceItem"
    | "AddFixedPriceItem",
  body: string,
) => Promise<any>;
export type RiskEvidence = {
  management: Listing["management"];
  offers: Listing["offers"];
  promotion: Listing["promotion"];
};
export function payloadXml(payload: Payload, uuid?: string) {
  return new XMLBuilder({ ignoreAttributes: false }).build({
    Item: {
      ...payload,
      ...(uuid
        ? { UUID: uuid, ApplicationData: `snaplist-relister:${uuid}` }
        : {}),
    },
  });
}
const canonical = (x: any): any =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : String(x ?? "");
// All side effects are injected, tested and guarded by a separate server grant.
// Construction alone never grants permission to end/create.
const settings = (raw: RawItem) =>
  Object.fromEntries(
    [
      "ShippingDetails",
      "ReturnPolicy",
      "SellerProfiles",
      "PaymentMethods",
      "PaymentInstructions",
      "AutoPay",
      "ShipToLocations",
      "VATDetails",
      "Regulatory",
    ]
      .filter((k) => raw[k] !== undefined)
      .map((k) => [k, raw[k]]),
  );
export class TradingAdapter implements Adapter {
  constructor(
    private account: string,
    private seller: string,
    private call: TradingCall,
    private storage: BackupStorage,
    private evidence: (id: string, raw: RawItem) => Promise<RiskEvidence>,
    private upload: (
      image: { mediaType: string; data: string },
      name: string,
    ) => Promise<string>,
    private download: typeof fetchImage = fetchImage,
  ) {}
  private async raw(id: string) {
    if (!/^\d{6,20}$/.test(id)) throw Error("Ungültige Artikelnummer.");
    const r = await this.call(
      "GetItem",
      `<ItemID>${xml(id)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`,
    );
    assertTradingSuccess(r);
    if (!r.Item) throw Error("Angebot fehlt.");
    if (
      String(r.Item.Seller?.UserID ?? "") !== this.seller ||
      r.Item.Site !== "Germany"
    )
      throw Error("Verkäufer/Marktplatz stimmt nicht überein.");
    return r.Item as RawItem;
  }
  async read(id: string) {
    const raw = await this.raw(id),
      l = normalize(raw, "");
    l.quantity =
      raw.Quantity !== undefined &&
      raw.SellingStatus?.QuantitySold !== undefined
        ? Number(raw.Quantity) - Number(raw.SellingStatus.QuantitySold)
        : null;
    let blockingReason: string | undefined;
    try {
      publicationPayload(raw);
    } catch (e) {
      blockingReason =
        e instanceof Error ? e.message : "Nicht unterstützte Einstellungen.";
    }
    return {
      ...l,
      // After End, GetItem is the authoritative stock/sale/status check.
      // Active-offer probes can reject ended items with 20140; they cannot
      // establish eligibility and are not needed for the recovery checks.
      ...(l.active
        ? await this.evidence(id, raw)
        : {
            management: "unknown" as const,
            offers: "unknown" as const,
            promotion: "unknown" as const,
          }),
      ...(blockingReason ? { blockingReason } : {}),
    };
  }
  async backup(row: Row, account: string) {
    if (account !== this.account) throw Error("Kontokonflikt.");
    const raw = await this.raw(row.listing.id),
      current = await this.read(row.listing.id),
      listing = {
        ...current,
        firstSeen: row.listing.firstSeen,
        predecessors: row.listing.predecessors,
        lastRenewed: row.listing.lastRenewed,
      };
    if (listing.priceCents !== row.originalCents)
      throw Error("Preis seit Vorschau geändert.");
    return secureBackup(
      {
        account,
        rowId: row.id,
        seller: this.seller,
        listing,
        payload: publicationPayload(raw),
        targetCents: row.targetCents,
        settingsSnapshot: settings(raw),
      },
      this.storage,
      this.download,
    );
  }
  async assertSnapshot(backup: Backup) {
    await restoreImages(backup, this.storage);
    const raw = await this.raw(backup.listing.id);
    if (
      digest(canonical(publicationPayload(raw))) !==
        digest(canonical(backup.payload)) ||
      digest(canonical(settings(raw))) !==
        digest(canonical(backup.settingsSnapshot ?? {}))
    )
      throw Error(
        "Angebots-/Versand-/Rückgabeeinstellungen seit Sicherung geändert.",
      );
  }
  async prepare(backup: Backup, target: number): Promise<Payload> {
    const images = await restoreImages(backup, this.storage),
      urls: string[] = [];
    for (let i = 0; i < images.length; i++)
      urls.push(
        await this.upload(images[i], `relister-${backup.digest}-${i}.jpg`),
      );
    return {
      ...backup.payload,
      StartPrice: (target / 100).toFixed(2),
      PictureDetails: { PictureURL: urls },
    };
  }
  async verify(backup: Backup, target: number, payload?: Payload) {
    if (!payload) throw Error("Wiederhergestellter Bildpayload fehlt.");
    const r = await this.call("VerifyAddFixedPriceItem", payloadXml(payload));
    assertTradingSuccess(r);
    const fees = list<any>(r.Fees?.Fee);
    if (!fees.length) throw Error("Gebührenangabe fehlt.");
    let feeCents = 0;
    for (const fee of fees) {
      const amount = String(fee.Fee?.["#text"] ?? fee.Fee ?? "");
      if (
        !/^\d+(?:\.\d{1,2})?$/.test(amount) ||
        (fee.Fee?.["@_currencyID"] && fee.Fee["@_currencyID"] !== "EUR")
      )
        throw Error("Gebühren nicht eindeutig in EUR.");
      const [a, b = ""] = amount.split(".");
      feeCents += Number(a) * 100 + Number(b.padEnd(2, "0"));
    }
    return { feeCents };
  }
  async end(id: string) {
    const raw = await this.raw(id);
    if (raw.SellingStatus?.ListingStatus !== "Active")
      throw Error("Angebot ist nicht aktiv.");
    const r = await this.call(
      "EndFixedPriceItem",
      `<ItemID>${xml(id)}</ItemID><EndingReason>NotAvailable</EndingReason>`,
    );
    assertTradingSuccess(r);
  }
  async ended(id: string) {
    const raw = await this.raw(id);
    return (
      ["Ended", "Completed"].includes(raw.SellingStatus?.ListingStatus) &&
      Number(raw.SellingStatus?.QuantitySold) === 0
    );
  }
  async reconcile(uuid: string): Promise<string | null | "unknown"> {
    // A successful complete scan can identify an existing listing. Absence after
    // a lost response is not proof of failure; engine never retries blindly.
    try {
      let page = 1,
        pages = 1;
      const matches: string[] = [];
      do {
        const r = await this.call(
          "GetMyeBaySelling",
          `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`,
        );
        assertTradingSuccess(r);
        pages = Number(r.ActiveList?.PaginationResult?.TotalNumberOfPages);
        if (!Number.isSafeInteger(pages) || pages < 0 || pages > 1000)
          return "unknown";
        for (const item of list<any>(r.ActiveList.ItemArray?.Item)) {
          const raw = await this.raw(String(item.ItemID));
          if (raw.ApplicationData === `snaplist-relister:${uuid}`)
            matches.push(String(raw.ItemID));
        }
        page++;
      } while (page <= pages);
      return matches.length === 1 ? matches[0] : "unknown";
    } catch {
      return "unknown";
    }
  }
  async create(payload: Payload, uuid: string) {
    if (
      payload.Site !== "Germany" ||
      payload.Currency !== "EUR" ||
      payload.Quantity !== 1 ||
      payload.ListingType !== "FixedPriceItem"
    )
      throw Error(
        "Veröffentlichungspayload nicht für deutschen Einzelartikel geeignet.",
      );
    if (!/^[A-F0-9]{32}$/.test(uuid))
      throw Error("Wiederholungskennung ungültig.");
    const r = await this.call("AddFixedPriceItem", payloadXml(payload, uuid));
    assertTradingSuccess(r);
    if (!/^\d{6,20}$/.test(String(r.ItemID ?? "")))
      throw new TemporaryError(
        "Erstellungsantwort enthält keine eindeutige Artikelnummer.",
      );
    return String(r.ItemID);
  }
  async compare(id: string, backup: Backup, target: number, payload?: Payload) {
    const actual = await this.read(id);
    if (
      actual.seller !== this.seller ||
      actual.site !== "Germany" ||
      !actual.active ||
      actual.priceCents !== target ||
      actual.quantity !== 1 ||
      actual.currency !== "EUR"
    )
      return false;
    const fields = publicationPayload(await this.raw(id));
    const expected = payload ?? {
      ...backup.payload,
      StartPrice: (target / 100).toFixed(2),
    };
    return (
      digest(canonical(fields)) === digest(canonical(expected)) &&
      (!backup.settingsSnapshot ||
        digest(canonical(settings(await this.raw(id)))) ===
          digest(canonical(backup.settingsSnapshot)))
    );
  }
}
export function productionTransport(token: string): TradingCall {
  return async (call, body) => {
    let result;
    try {
      result = await tradingCall(token, call, body);
    } catch (error) {
      if ([401, 403].includes(Number((error as any)?.httpStatus)))
        throw new AuthorizationError("eBay-Autorisierung abgelaufen.");
      throw new TemporaryError(
        "eBay-Antwort ausgeblieben; Abgleich erforderlich.",
      );
    }
    const codes = list(result.Errors).map((e) => String(e.ErrorCode));
    if (codes.some((c) => ["931", "932"].includes(c)))
      throw new AuthorizationError("eBay-Autorisierung abgelaufen.");
    if (codes.includes("21919144"))
      throw new TemporaryError("eBay-Aufruflimit erreicht.");
    return result;
  };
}
export function productionUpload(token: string) {
  return async (image: { mediaType: string; data: string }, name: string) => {
    const r = await uploadOnePhoto(token, image, name);
    if (!r.url) {
      const message =
        r.error ?? "Bild-Wiederherstellung bei eBay fehlgeschlagen.";
      if (/HTTP (401|403)\b/.test(message))
        throw new AuthorizationError(message);
      if (r.retryable) throw new TemporaryError(message);
      throw Error(message);
    }
    return r.url;
  };
}
