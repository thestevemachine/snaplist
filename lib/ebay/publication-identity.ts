import { createHash } from "node:crypto";
import { validPublicationId } from "../publication-identity";
import { assertTradingSuccess, list, tradingCall, xml } from "./trading";
import { skuSchema } from "../validation";

export function listingUuid(publicationId: string) {
  if (!validPublicationId(publicationId))
    throw new Error(
      "Veröffentlichungskennung fehlt. SNAPLIST bitte neu laden; der Entwurf bleibt gespeichert.",
    );
  const source = publicationId.startsWith("legacy:")
    ? `snaplist:trading:DE:${publicationId.slice(7)}`
    : `snaplist:publication:v2:${publicationId}`;
  return createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}
export const applicationData = (id: string) => `snaplist:v2:${listingUuid(id)}`;

export async function findPublishedSku(
  token: string,
  sku: string,
  itemId?: string,
) {
  const response = await tradingCall(
    token,
    "GetItem",
    `<SKU>${xml(skuSchema.parse(sku))}</SKU>${itemId ? `<ItemID>${xml(itemId)}</ItemID>` : ""}<DetailLevel>ReturnAll</DetailLevel>`,
  );
  const errors = list(response.Errors).filter(
    (e) => e.SeverityCode === "Error",
  );
  if (errors.length && errors.every((e) => String(e.ErrorCode) === "21916270"))
    return null;
  assertTradingSuccess(response);
  const item = response.Item;
  if (!item?.ItemID || !/^\d+$/.test(String(item.ItemID)) || item.SKU !== sku)
    throw new Error(
      "eBay-Angebot konnte nicht eindeutig mit der SKU abgeglichen werden. Es wird nichts veröffentlicht.",
    );
  return {
    listingId: String(item.ItemID),
    sku: item.SKU,
    title: item.Title || "",
    applicationData: item.ApplicationData || "",
  };
}
export const belongsToPublication = (
  item: NonNullable<Awaited<ReturnType<typeof findPublishedSku>>>,
  id: string,
) => !id.startsWith("legacy:") && item.applicationData === applicationData(id);

export async function inspectPublication(
  token: string,
  sku: string,
  publicationId: string,
) {
  listingUuid(publicationId); // validate before any request
  const existing = await findPublishedSku(token, sku);
  if (existing)
    return {
      status: belongsToPublication(existing, publicationId)
        ? ("published" as const)
        : ("conflict" as const),
      ...existing,
    };
  return {
    status: publicationId.startsWith("legacy:")
      ? ("uncertain" as const)
      : ("available" as const),
  };
}

// Read-only eBay calls. Caller explicitly confirms these are DIFFERENT objects.
export async function repairPublication(
  token: string,
  input: {
    sku: string;
    publicationId: string;
    draftId: string;
    conflictItemId: string;
    differentItem: boolean;
  },
) {
  if (!input.differentItem || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.draftId))
    throw new Error(
      "Bitte zuerst bestätigen, dass es zwei verschiedene Brillen sind.",
    );
  const check = await inspectPublication(token, input.sku, input.publicationId);
  if (check.status !== "conflict" || check.listingId !== input.conflictItemId)
    throw new Error(
      "Der Konflikt hat sich geändert. Bitte erneut abgleichen; nichts wurde geändert.",
    );
  const publicationId = input.publicationId.startsWith("legacy:")
    ? `draft:${input.draftId}`
    : input.publicationId;
  // Deterministic suffix: a repeated repair produces the SAME identity and SKU.
  const sku = `${input.sku.slice(0, 37)}-${listingUuid(publicationId).slice(0, 12)}`;
  const candidate = await inspectPublication(token, sku, publicationId);
  if (candidate.status !== "available" && candidate.status !== "published")
    throw new Error(
      "Auch die vorgeschlagene SKU ist belegt. Bitte manuell prüfen.",
    );
  return {
    publicationId,
    sku,
    listingId:
      candidate.status === "published" ? candidate.listingId : undefined,
  };
}
