import { boundedFetch } from "../network";
import { list, xml, assertTradingSuccess } from "../ebay/trading";
import type { RiskEvidence, RawItem, TradingCall } from "./trading-adapter";
// Never request new scopes or treat an authorization/error response as absence.
export function riskProbe(token: string, call: TradingCall) {
  return async (id: string, raw: RawItem): Promise<RiskEvidence> => {
    let management: RiskEvidence["management"] = "unknown",
      offers: RiskEvidence["offers"] = "unknown";
    if (typeof raw.SKU === "string" && raw.SKU) {
      const r = await boundedFetch(
        `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(raw.SKU)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          cache: "no-store",
        },
      );
      const b = await r.json().catch(() => null);
      if (r.ok) management = "inventory";
      else if (
        r.status === 404 &&
        Array.isArray(b?.errors) &&
        b.errors.length &&
        b.errors.every((e: any) => Number(e.errorId) === 25710)
      )
        management = "trading";
      if (management === "unknown")
        console.warn("relister-management-check", {
          httpStatus: r.status,
          errorCodes: Array.isArray(b?.errors)
            ? b.errors
                .map((e: any) => String(e.errorId))
                .filter((id: string) => /^\d{1,12}$/.test(id))
            : [],
        });
    }
    const best = await call(
      "GetBestOffers",
      `<ItemID>${xml(id)}</ItemID><BestOfferStatus>Active</BestOfferStatus>`,
    );
    const entries = [
      ...list<any>(best.BestOfferArray?.BestOffer),
      ...list<any>(best.ItemBestOffers?.BestOfferArray?.BestOffer),
      ...list<any>(best.ItemBestOffersArray?.ItemBestOffers).flatMap((x) =>
        list<any>(x.BestOfferArray?.BestOffer),
      ),
    ];
    // eBay documents 20140 as no offers matching the exact ItemID/Active query.
    // Accept it only for the freshly verified active German source, with no
    // conflicting errors or returned offers. Missing data is still unknown.
    // https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/Errors/ErrorMessages.htm
    const errors = list<any>(best.Errors);
    const documentedEmpty =
      String(raw.ItemID ?? "") === id &&
      raw.Site === "Germany" &&
      Boolean(raw.Seller?.UserID) &&
      raw.SellingStatus?.ListingStatus === "Active" &&
      errors.length > 0 &&
      errors.every(
        (e) => String(e.ErrorCode) === "20140" && e.SeverityCode === "Error",
      ) &&
      entries.length === 0;
    if (!documentedEmpty) assertTradingSuccess(best);
    const containers = list<any>(best.ItemBestOffersArray?.ItemBestOffers);
    const boundEmpty =
      (Object.hasOwn(best, "BestOfferArray") &&
        String(best.Item?.ItemID ?? "") === id) ||
      (containers.length > 0 &&
        containers.every(
          (x) =>
            String(x.Item?.ItemID ?? "") === id &&
            Object.hasOwn(x, "BestOfferArray"),
        ));
    const explicitZero =
      String(best.PaginationResult?.TotalNumberOfEntries ?? "") === "0";
    offers = entries.length
      ? "pending"
      : (documentedEmpty || boundEmpty || explicitZero) &&
          Number(best.PaginationResult?.TotalNumberOfPages ?? 1) <= 1
        ? "clear"
        : "unknown";
    // Conditional GetItem fields represent active promotional price displays or
    // strike-through treatments. The full ReturnAll response must be supplied.
    const promotion =
      raw.DiscountPriceInfo || raw.SellingStatus?.PromotionalSaleDetails
        ? "active"
        : "clear";
    return { management, offers, promotion };
  };
}
