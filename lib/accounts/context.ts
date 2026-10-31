import { AsyncLocalStorage } from "node:async_hooks";
export type AccountContext = { id: string; email: string; owner: boolean; secrets: Record<string,string> };
export const accountScope = new AsyncLocalStorage<AccountContext>();
export const accountsEnabled = () => process.env.SNAPLIST_ACCOUNTS_ENABLED === "true";
export function currentAccount() {
 const value=accountScope.getStore();
 if(accountsEnabled() && !value) throw new Error("Authenticated account context required.");
 return value;
}
function legacyProviderKey(provider:string) {
 return (provider==="google" ? process.env.GEMINI_API_KEY : provider==="openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) ?? "";
}
export function providerKey(provider:string) {
 if(accountsEnabled()) {
  const account=currentAccount()!;
  // Preserve the existing owner's keys without copying or exposing them.
  // An explicit empty override disables a provider, even for the owner.
  if(Object.hasOwn(account.secrets,provider)) return account.secrets[provider];
  return account.owner ? legacyProviderKey(provider) : "";
 }
 return legacyProviderKey(provider);
}
