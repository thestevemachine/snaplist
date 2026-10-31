import type { ItemGroup } from "./types";

// The draft ID travels with the draft, not with a device or a bin number.
// Never rotate an identity after a timeout or an edit.
export function withPublicationIdentity(group: ItemGroup): ItemGroup {
  if (group.publicationId || group.postStatus === "posted") return group;
  return {
    ...group,
    publicationId:
      group.publicationAttemptSku ||
      group.postStatus === "posting" ||
      /eBay 488|Antwort.*ausgeblieben/i.test(group.postError || "")
        ? `legacy:${group.publicationAttemptSku || group.sku}`
        : `draft:${group.id}`,
  };
}
export const validPublicationId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(draft:[a-zA-Z0-9_-]{1,128}|legacy:.{1,50})$/.test(value);
