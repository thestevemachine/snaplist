import { beforeEach, expect, it, vi } from "vitest";
import { StorageApiError } from "@supabase/storage-js";
import { isMissingVaultObject } from "../../lib/accounts/vault-errors";
const m = vi.hoisted(() => ({ download: vi.fn(), user: vi.fn() }));
vi.mock("../../lib/accounts/server", () => ({
 accountDb: () => ({ auth: {admin: {getUserById: m.user}}, storage: {from: () => ({download: m.download})}}),
 VAULT_BUCKET: "snaplist-account-vault", isOwner: () => true,
}));
vi.mock("../../lib/ebay/session", () => ({openConnection: vi.fn(), sellerAccessToken: vi.fn()}));
import { backgroundAccount } from "../../lib/relister/runtime";
beforeEach(() => {vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:"owner",email:"owner@example.test",app_metadata:{snaplist:{active:true}}}}});});
it("recognizes modern missing-object and legacy numeric responses", () => {
 for (const error of [new StorageApiError("Object not found",400,"NoSuchKey","storage","NoSuchKey"), {statusCode:"404"}, {statusCode:"400"}]) expect(isMissingVaultObject(error)).toBe(true);
});
it("loads the owner context without a personal vault for the existing shared seller connection",async () => {
 m.download.mockResolvedValue({data:null,error:new StorageApiError("Object not found",400,"NoSuchKey","storage","NoSuchKey")});
 await expect(backgroundAccount("owner")).resolves.toMatchObject({id:"owner",owner:true,secrets:{}});
});
it.each([new StorageApiError("Forbidden",403,"AccessDenied","storage","AccessDenied"),new StorageApiError("Offline",503,"InternalError","storage","InternalError"),{statusCode:"400",code:"InvalidJWT"},new TypeError("fetch failed")])("does not hide a real credential storage failure %#", async error => {
 expect(isMissingVaultObject(error)).toBe(false);
 m.download.mockResolvedValue({data:null,error});
 await expect(backgroundAccount("owner")).rejects.toThrow("Kontozugang nicht verfügbar");
});
it("still rejects inactive accounts before accessing credentials",async () => {
 m.user.mockResolvedValue({data:{user:{app_metadata:{snaplist:{active:false}}}}});
 await expect(backgroundAccount("owner")).rejects.toThrow("Aktive Kontoberechtigung fehlt");
 expect(m.download).not.toHaveBeenCalled();
});
