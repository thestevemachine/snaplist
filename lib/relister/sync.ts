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
function selectionWindow(items: Listing[]) {
  return [...items]
    .filter((item) => Number.isFinite(Date.parse(item.started)))
    .sort(
      (a, b) =>
        Date.parse(a.started) - Date.parse(b.started) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 25);
}
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
          `<ActiveList><Include>true</Include><Sort>StartTime</Sort><Pagination><EntriesPerPage>25</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList>`,
        );
        assertTradingSuccess(r);
        const pages = Number(r.ActiveList?.PaginationResult?.TotalNumberOfPages);
        if (!Number.isSafeInteger(pages) || pages < 0)
          throw Error("Pagination fehlt.");
        state.items = selectionWindow(
          list<any>(r.ActiveList?.ItemArray?.Item).map((raw) =>
            normalize(raw, record.seller),
          ),
        );
        state.page = 1;
        state.cursor = 0;
        state.stage = "details";
      } else if (state.stage === "details") {
        // Narrow any older in-progress sync documents before continuing.
        if (state.items.length > 25) {
          const oldest = selectionWindow(state.items);
          const cursor = Math.min(state.cursor, oldest.length);
          state.cursor = oldest.slice(0, cursor).every(
            (item, index) => item.id === state.items[index]?.id,
          ) ? cursor : 0;
          state.items = oldest;
        }
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
          state.items = [];
          state.cursor = 0;
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
          stage: "done",
          page: 0,
          items: [],
          cursor: 0,
          error:
            "Synchronisierung pausiert: eBay-Zugang oder API-Limit prüfen.",
        },
        pending: false,
      })
      .eq("account_id", account);
  }
}
