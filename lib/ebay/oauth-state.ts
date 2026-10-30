// Namespaced for the fixed shared callback relay; account binding is verified here.
export function ebayState(accountId?:string):string {
 return (accountId ? `snaplist:${accountId}:` : "")+crypto.randomUUID();
}
export function validEbayState(state:string|null,expected:string|undefined,accountId?:string):boolean {
 if(!state || !expected || state!==expected) return false;
 return !accountId || new RegExp(`^snaplist:${accountId}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).test(state);
}
