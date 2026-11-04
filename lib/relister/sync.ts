import { accountDb } from "../accounts/server";
import { accountScope } from "../accounts/context";
import { sellerAccessToken } from "../ebay/session";
import { assertTradingSuccess, list } from "../ebay/trading";
import { productionTransport } from "./trading-adapter";
import { backgroundAccount, realAdapter } from "./runtime";
import { normalize } from "./ebay";
import { saveCatalog } from "./store";
import type { Listing } from "./domain";
export type SyncState = {
  stage: "pages" | "details" | "done";
  page: number;
  items: Listing[];
  cursor: number;
  error?: string;
};
export async function syncStep(account: string) {
  const db = accountDb(),
    current = await db
      .from("relister_sync")
      .select("*")
      .eq("account_id", account)
      .eq("pending", true)
      .maybeSingle();
  if (current.error) throw Error("Sync-Auftrag fehlt.");
  if (!current.data) return;
  const record = current.data,
    state = record.document as SyncState;
  const ctx = await backgroundAccount(account);
  try {
    await accountScope.run(ctx, async () => {
      const token = await sellerAccessToken(undefined);
      if (!token) throw Error("eBay-Zugang fehlt.");
      const call = productionTransport(token);
      const user = await call("GetUser", "");
      assertTradingSuccess(user);
      if (user.User?.UserID !== record.seller)
        throw Error("Verkäuferkonto geändert.");
      if (state.stage === "pages") {
        const r = await call(
          "GetMyeBaySelling",
          `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${state.page}</PageNumber></Pagination></ActiveList>`,
        );
        assertTradingSuccess(r);
        const pages = Number(
          r.ActiveList?.PaginationResult?.TotalNumberOfPages,
        );
        if (!Number.isSafeInteger(pages) || pages < 0)
          throw Error("Pagination fehlt.");
        const unique = new Map(state.items.map((i) => [i.id, i]));
        for (const raw of list<any>(r.ActiveList?.ItemArray?.Item)) {
          const l = normalize(raw, record.seller);
          unique.set(l.id, l);
        }
        state.items = [...unique.values()];
        state.page++;
        if (state.page > pages) state.stage = "details";
      } else if (state.stage === "details") {
        const adapter = await realAdapter(ctx, record.seller);
        const end = Math.min(state.cursor + 10, state.items.length);
        while (state.cursor < end) {
          const index = state.cursor;
          try {
            state.items[index] = await adapter.read(state.items[index].id);
          } catch {
            state.items[index] = {
              ...state.items[index],
              blockingReason:
                "Vollständige Angebots-/Risikoprüfung nicht verfügbar.",
            };
          }
          state.cursor++;
        }
        if (state.cursor >= state.items.length) {
          await saveCatalog(account, record.seller, state.items);
          state.stage = "done";
        }
      }
    });
    const saved = await db
      .from("relister_sync")
      .update({
        document: state,
        pending: state.stage !== "done",
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", account)
      .eq("pending", true);
    if (saved.error) throw Error("Sync-Fortschritt nicht gespeichert.");
  } catch {
    await db
      .from("relister_sync")
      .update({
        document: {
          ...state,
          error:
            "Synchronisierung pausiert: eBay-Zugang oder API-Limit prüfen.",
        },
        pending: false,
      })
      .eq("account_id", account);
  }
}
