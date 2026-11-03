import { accountDb, VAULT_BUCKET, isOwner } from "../accounts/server";
import { accountScope, type AccountContext } from "../accounts/context";
import { openConnection, sellerAccessToken } from "../ebay/session";
import {
  TradingAdapter,
  productionTransport,
  productionUpload,
} from "./trading-adapter";
import { riskProbe } from "./risk";
import { bucket } from "./store";
import type { BackupStorage } from "./backup";
export async function backgroundAccount(id: string): Promise<AccountContext> {
  const db = accountDb(),
    u = await db.auth.admin.getUserById(id);
  if (u.error || !u.data.user?.app_metadata?.snaplist?.active)
    throw Error("Aktive Kontoberechtigung fehlt.");
  const user = u.data.user;
  const file = await db.storage
    .from(VAULT_BUCKET)
    .download(`${id}/credentials.json`);
  let secrets: Record<string, string> = {};
  if (file.data) {
    const opened = await openConnection(await file.data.text());
    if (!opened) throw Error("Kontozugang nicht entschlüsselbar.");
    secrets = JSON.parse(opened.refreshToken);
  } else if (
    file.error &&
    !["400", "404"].includes(String((file.error as any).statusCode))
  )
    throw Error("Kontozugang nicht verfügbar.");
  return { id, email: user.email ?? "", owner: isOwner(user), secrets };
}
export function imageStore(account: string): BackupStorage {
  const db = accountDb();
  const check = (path: string) => {
    if (!path.startsWith(`${account}/`) || path.includes(".."))
      throw Error("Kontofremder Sicherungspfad.");
  };
  return {
    async put(path, bytes, mime) {
      check(path);
      const old = await db.storage.from(bucket).download(path);
      if (old.data) {
        if (!Buffer.from(await old.data.arrayBuffer()).equals(bytes))
          throw Error("Unveränderliche Sicherung bereits vorhanden.");
        return;
      }
      const r = await db.storage
        .from(bucket)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (r.error) throw Error("Sicherung nicht gespeichert.");
    },
    async get(path) {
      check(path);
      const r = await db.storage.from(bucket).download(path);
      if (r.error || !r.data) throw Error("Sicherung fehlt.");
      return Buffer.from(await r.data.arrayBuffer());
    },
  };
}
export async function realAdapter(account: AccountContext, seller: string) {
  return accountScope.run(account, async () => {
    const token = await sellerAccessToken(undefined);
    if (!token) throw Error("eBay-Zugang fehlt.");
    const call = productionTransport(token);
    return new TradingAdapter(
      account.id,
      seller,
      call,
      imageStore(account.id),
      riskProbe(token, call),
      productionUpload(token),
    );
  });
}
