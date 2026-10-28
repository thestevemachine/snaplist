import { AsyncLocalStorage } from "node:async_hooks";
export type AccountContext = { id: string; email: string; owner: boolean; secrets: Record<string,string> };
export const accountScope = new AsyncLocalStorage<AccountContext>();
export const accountsEnabled = () => process.env.SNAPLIST_ACCOUNTS_ENABLED === "true";
export function currentAccount() {
 const value=accountScope.getStore();
 if(accountsEnabled() && !value) throw new Error("Authenticated account context required.");
 return value;
}
export function providerKey(provider:string) {
 if(accountsEnabled()) return currentAccount()?.secrets[provider] ?? "";
 return (provider==="google" ? process.env.GEMINI_API_KEY : provider==="openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) ?? "";
}
