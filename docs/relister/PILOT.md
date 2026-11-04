# Single-item pilot

A preview does not authorize real eBay changes. Keep operational account, item and rollout records outside repository documentation.

## Read-only preparation

Production migrations and deployments need explicit permission. With RELISTER_PREPARATION_ONLY=true, the API restricts preparation to the owner and atomically binds one source item per account. Keep RELISTER_LIVE_ENABLED=false until the separate live permission is received. Inngest processes saved work when configured; browser polling is only a fallback without its credentials.

Prepare exactly one owned, active German original from the oldest-first inventory. Record privately: seller, item/link/SKU, current price, discount, fixed target, fee estimate and remaining uncertainty. Verify the complete snapshot, ordered image files and hashes, outgoing payload, shop categories, shipping/return settings and final preview digest. Do not copy seller credentials into test environments or change keysets or consent destinations.

## Separate live approval

Present those concrete values and the consequences before requesting approval. Existing shop coupons and advertising are managed by eBay and can apply again through the preserved shop category. Explain the existing advertising charges. Webinterpret may end associated foreign offers; takeover of the new German ID and its price remains to be checked. Watchers and previous offer history do not transfer automatically. A ranking benefit is not established.

After explicit approval, create one service-only grant bound to the exact job/account/seller/item/digest/target with a short expiry, enable the live gate in the approved environment, and explicitly activate that job. The owner-only preparation restriction can remain enabled for this single-item pilot. No blanket approvals; nonzero estimated listing fees remain blocked.

Before End, re-read ownership, marketplace, price, stock and the saved settings fingerprint. After End, verify that the source ended without a sale. Check it again before Add. Use the stable request UUID; after an ambiguous response reconcile before retrying. Unknown results require review. An original item ID cannot be restored. Pause starts no additional ends; already ended rows remain visible for recovery.

After Add, compare supported fields, ordered pictures, price and expanded policies, and persist old-to-new lineage. Deviations require review and must not trigger another Add.

## Webinterpret observation

Check whether old foreign counterparts end, whether the new German ID is taken over, and whether prices, timing and duplicate prevention behave as expected. Snaplist never sends foreign-marketplace mutations. Simulated tests do not establish Webinterpret behavior or any ranking effect.
