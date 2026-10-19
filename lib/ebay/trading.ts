import { XMLParser, XMLValidator } from "fast-xml-parser";
import { boundedFetch } from "@/lib/network";
import { EBAY_TRADING } from "./config";

export function requireGermanMarketplace() {
  if (
    process.env.EBAY_MARKETPLACE_ID !== "EBAY_DE" ||
    process.env.EBAY_CURRENCY !== "EUR" ||
    process.env.EBAY_CATEGORY_TREE_ID !== "77"
  )
    throw new Error(
      "Für diesen Test müssen eBay.de, EUR und Kategoriebaum 77 eingestellt sein.",
    );
}

export function xml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}

export function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export interface TradingResponse {
  Ack: string;
  ItemID?: string;
  Errors?: {
    ErrorCode?: string;
    LongMessage?: string;
    ShortMessage?: string;
    SeverityCode?: string;
  }[];
  User?: {
    UserID?: string;
    RegistrationAddress?: {
      Country?: string;
      PostalCode?: string;
      CityName?: string;
    };
  };
  Fees?: {
    Fee?: {
      Name?: string;
      Fee?: string | { "#text"?: string; "@_currencyID"?: string };
    }[];
  };
}

export async function tradingCall(
  token: string,
  call: "GetUser" | "VerifyAddFixedPriceItem" | "AddFixedPriceItem",
  content: string,
): Promise<TradingResponse> {
  requireGermanMarketplace();
  let response: Response;
  try {
    response = await boundedFetch(EBAY_TRADING, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-EBAY-API-SITEID": "77",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1477",
        "X-EBAY-API-CALL-NAME": call,
        "X-EBAY-API-IAF-TOKEN": token,
      },
      body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>de_DE</ErrorLanguage>${content}</${call}Request>`,
    });
  } catch {
    throw new Error(
      call === "AddFixedPriceItem"
        ? "Antwort von eBay ausgeblieben. Vor einem erneuten Versuch den Seller Hub prüfen und dieselbe SKU beibehalten."
        : "eBay ist momentan nicht erreichbar. Bitte erneut prüfen.",
    );
  }
  const text = await response.text();
  // No DTD/custom entities, raw response bodies or auth headers in errors/logs.
  if (
    !response.ok ||
    text.length > 2_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(text) ||
    XMLValidator.validate(text) !== true
  )
    throw new Error(
      "eBay hat keine gültige Trading-Antwort geliefert. Bei einer Übertragung zuerst im Seller Hub nachsehen.",
    );
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    removeNSPrefix: true,
    isArray: (name, path) =>
      name === "Errors" ||
      (typeof path === "string" && path.endsWith(".Fees.Fee")),
  }).parse(text);
  const result = parsed[`${call}Response`] as TradingResponse | undefined;
  if (
    !result ||
    !["Success", "Warning", "Failure", "PartialFailure"].includes(result.Ack)
  )
    throw new Error("Die eBay-Antwort enthält kein gültiges Ergebnis.");
  return result;
}

export function tradingMessages(
  response: TradingResponse,
  severity: "Error" | "Warning",
): string[] {
  return list(response.Errors)
    .filter((e) => e.SeverityCode === severity)
    .map((e) =>
      `eBay ${e.ErrorCode || ""}: ${e.LongMessage || e.ShortMessage || "Angebot bitte prüfen."}`.slice(
        0,
        1500,
      ),
    );
}

export function assertTradingSuccess(response: TradingResponse) {
  if (
    !["Success", "Warning"].includes(response.Ack) ||
    tradingMessages(response, "Error").length
  )
    throw new Error(
      tradingMessages(response, "Error").join("; ") ||
        "eBay hat die Anfrage abgelehnt.",
    );
}
