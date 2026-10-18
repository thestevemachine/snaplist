import { boundedFetch } from "@/lib/network";
import type { AccountOptions } from "./publish";
import { EBAY_ACC_BASE } from "./config";
import {
  assertTradingSuccess,
  requireGermanMarketplace,
  tradingCall,
} from "./trading";

export interface TradingOptions extends AccountOptions {
  locations: {
    id: string;
    name: string;
    country: string;
    postalCode: string;
    city: string;
  }[];
}

// Read only: no Inventory API locations are created or required.
export async function fetchTradingOptions(
  token: string,
): Promise<TradingOptions> {
  requireGermanMarketplace();
  const policy = async (kind: string, key: string, id: string) => {
    const r = await boundedFetch(
      `${EBAY_ACC_BASE}/${kind}_policy?marketplace_id=EBAY_DE`,
      {
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!r.ok)
      throw new Error(
        "Die eBay.de-Rahmenbedingungen konnten nicht geladen werden.",
      );
    const data = await r.json();
    if (!Array.isArray(data[key]))
      throw new Error("Ungültige eBay-Rahmenbedingungen.");
    return data[key].map((p: Record<string, unknown>) => {
      if (!/^\d+$/.test(String(p[id] || "")))
        throw new Error("Ungültige eBay-Vorlagen-ID.");
      return { id: String(p[id]), name: String(p.name || p[id]) };
    });
  };
  const [fulfillment, payment, returns, user] = await Promise.all([
    policy("fulfillment", "fulfillmentPolicies", "fulfillmentPolicyId"),
    policy("payment", "paymentPolicies", "paymentPolicyId"),
    policy("return", "returnPolicies", "returnPolicyId"),
    tradingCall(token, "GetUser", "<DetailLevel>ReturnAll</DetailLevel>"),
  ]);
  assertTradingSuccess(user);
  const address = user.User?.RegistrationAddress;
  const country = address?.Country || "",
    postalCode = address?.PostalCode || "",
    city = address?.CityName || "";
  return {
    fulfillment,
    payment,
    returns,
    locations:
      /^[A-Z]{2}$/.test(country) && postalCode && city
        ? [
            {
              id: "ebay-registration-address",
              country,
              postalCode,
              city,
              name: `eBay-Kontoadresse: ${postalCode} ${city}, ${country} (als Artikelstandort bestätigen)`,
            },
          ]
        : [],
  };
}
