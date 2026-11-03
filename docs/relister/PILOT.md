# Single-item pilot — awaits real account/read-only rollout approval

The implementation and isolated tests are reviewable in PR #46. No real eBay item has yet been backed up or approved through this feature. This is not a request to end an offer.

## Gate 1: read-only rollout / real preparation

The user explicitly prohibited production deployment/migrations. The isolated Supabase test account has no seller grant; existing production eBay/account secrets have not been copied. To obtain a real, owned, current listing and complete snapshot through the established login, approve a strictly read-only deployment/migration stage separately, or configure an approved isolated environment with its own user-completed eBay consent. Do not invent a seller/item or use a public search result as ownership proof. Do not switch RuNames or activate a second keyset as a workaround.

RELISTER_LIVE_ENABLED remains absent; no relister_approvals rows may be created during this stage. Select exactly one eligible German item and run dry-run. Record:
- authenticated account UUID, GetUser seller and original item ID/link/SKU;
- actual current price, percentage and target; zero/nonzero fee estimate, quotas and remaining fees uncertainty;
- full private snapshot and ordered image hashes/readback;
- exact unsupported/risk exclusions, expanded shipping/return settings, outgoing DTO and final previewDigest.

## Gate 2: explicit single-item live approval

Only after the user reviews those concrete values: create one service-only approval bound to the exact job/account/seller/item/digest/target, with short expiry; enable live processing only in the approved environment; have the user explicitly confirm the prepared job. This task has NOT authorized this gate. Never create a blanket approval from a browser checkbox. Nonzero fees remain blocked in the first version.

Before End: re-read current listing/risk/price/stock and saved setting fingerprint. After End: verify ended and no sale; before Add repeat the old-item check. Create once with immutable UUID; timeout means reconcile, and unknown means human review. Original item IDs cannot be restored. Pause starts no new ends; ended rows remain visible and resumable. Expired authorization stops the account's work.

After Add: compare all supported fields, ordered picture URLs and expanded policy settings; store old→new history. Deviations require review and must not trigger another Add.

## Gate 3: user checks Webinterpret

Observe whether old foreign counterparts end, whether the new German ID is taken over, price propagation, timing and duplicates. Snaplist sends no foreign-marketplace mutations. Fixture/Sandbox tests cannot prove this behavior or any ranking effect.
