// Only the authenticated server page chooses the active browser workspace.
export function workspaceStorageKey(legacy:string) {
 if(typeof document==="undefined") return legacy;
 const user=document.body.dataset.account;
 if(!user || document.body.dataset.accountOwner==="true") return legacy;
 return `${legacy}:${user}`;
}
