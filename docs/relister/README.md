# Re-Lister

Separate feature branch `codex/re-lister`, Draft PR #46. Base is current production's `93dc20e` / PR #45, not outdated main. Existing Snaplist listing/measurement work remains separate. No production deployment, production database migration, eBay end/add/price change, credential rotation, new OAuth scope, paid service or PR merge performed.

## Implemented application

- Second navigation tab **Re-Lister**, seller inventory overview with checkbox/image/title/SKU/current start date/price/status/item link. Date sorting oldest first; search and first 1/5/20/25/50/100/200 selection over the entire cached result set. Missing views are unavailable, not zero; view sorts are disabled until real data exists.
- Restartable background sync: paginated GetMyeBaySelling, then GetItem details in bounded chunks; the previous complete catalog remains visible until the new one completes. Real marketplace is Item.Site=Germany, not EUR/language/location. Seller is checked against GetUser and again on every GetItem.
- Risk checks use full GetItem, the documented GetBestOffers arrays and explicit empty-result evidence, and Inventory API ownership checks. Missing permissions/data stay unknown/ineligible. Active discounts/strike prices are excluded; no marketing/analytics scope is silently added.
- Cent-exact whole-selection percentage presets and custom decimal comma values below 100%; immutable original price/percentage/target. Target compatibility with Best Offer thresholds is checked and visible. 49.99 EUR minus 6% is 46.99 EUR, not a second compounded discount on retry.
- Protected actual byte backups, snapshot JSON, readback checksums and ordered restore. Existing media uploader restores saved bytes to new eBay picture URLs before nonpublishing verification. Snapshot JSON/byte hashes are validated before reuse; original URL lists alone are not backups.
- Explicit publication DTO preserving supported title/description, SKU, specifics, identifiers, category, condition, seller policy IDs, dispatch time, VAT, payment flag, store categories, Best Offer thresholds and photo order. Catalog auto-fill/stock-photo substitution is disabled so the saved content is authoritative. Foreign response-only fields/old item IDs/sales counts are not passed to Add.
- Real Trading adapter implements VerifyAddFixedPriceItem, EndFixedPriceItem, AddFixedPriceItem and GetItem postcheck. Fresh original owner/site/price/quantity/sales/risk checks run before ending; current publication/shipping/return settings must match the saved snapshot. End is confirmed and the old item is rechecked for a sale before creation. Stale verification is refreshed; nonzero fees block for separate review.
- Durable state transition before each side effect, per-seller/item locks, expiring/fenced worker leases, bounded retries, pause/resume, authentication pause and manual-review states. Already-ended rows remain resumable while paused. A new preview can replace a pre-end failed job; locks after a requested end are retained. Stable 32-hex UUID plus ApplicationData identifies a creation. Ambiguous create responses scan the entire authenticated seller's active inventory for that marker; absence is unknown, never permission to create blindly.
- Live mode requires BOTH RELISTER_LIVE_ENABLED=true and an unexpired service-only approval matching job/account/seller/item/final backup+outgoing-payload digest/target. The browser cannot write approvals or activate a mismatched job. No such real grant has been created.
- Postcheck compares active German ownership, price/currency/stock, explicit content/condition/specifics, ordered pictures and expanded shipping/return settings. Persistent old→new lineage keeps first capture, latest renewal and predecessors separate from the current eBay start date.

## Operating modes

**Simulation:** synthetic listings, real protected fixture backups, simulated eBay operations. Explicit simulation confirmation starts the worker.

**Dry-run:** real read/snapshot/image restoration/nonpublishing verification; stops at ready. It never ends or creates an offer or changes an existing price. Images may be uploaded for verification. Final snapshot/fee details are visible in row history. Confirmation cannot activate live mode without the separate server grant.

**Live:** implemented, but disabled for this task. A separately approved one-item pilot is the next account-affecting gate. Production migration and deployment also need explicit approval under the user's request.

## Supported first-version subset and exclusions

Only active German fixed-price GTC listings, one available piece, zero sold, no variants, positively supported Trading management and clear offer/price checks. Seller shipping/return/payment profiles are required. Auctions, quantities/variants, Inventory-managed records, unknown management, uncertain offers/promotions and missing required fields/images are excluded.

Regulatory/GPSR structures, custom compliance policies, category-specific condition descriptors, compatibility lists, charitable contributions, video/pickup programs, additional listing categories, paid subtitle/enhancement options and shipping-cost overrides are not silently dropped: such listings are blocked pending dedicated support. Fees above zero are shown and blocked rather than approved automatically. This conservative subset can mean no eligible item in a particular seller's stock; the UI must show why.

Views/Analytics are intentionally unavailable until existing permissions and a common reporting period can be verified; no substitute impressions/watchers are presented as page views. Webinterpret restart/price propagation, listing ranking and real eBay mutations have not been production-verified. A new item ID does not prove a boost.

## Configuration and migrations

Isolated free Supabase project: `snaplist-relister-test` / `xfprtvwsjlvwcaywgwyw`, Frankfurt. Only this test database received the three reviewable Re-Lister migrations. Private bucket and service-only tables/RPCs verified. No production migration applied. The ignored `.env.local` contains the user-entered test secret; no key is in this repository.

Use existing account auth/vault and Inngest integration. Set RELISTER_ENABLED=true only in the approved environment; leave RELISTER_LIVE_ENABLED unset until a separately reviewed pilot. The worker revalidates account membership and obtains only that account's credentials; owner fallback is restricted to the actual configured owner. Never copy owner credentials to a member.

The existing `/api/inngest` conditionally registers `relister-durable-tick`. The minute cron drives pending syncs and jobs; browser lifetime does not own the work. Remote Inngest registration requires its existing event/signing configuration. Local/hosted tests invoke the same worker directly; remote cron delivery has not yet been observed.

See TEST-ENVIRONMENT.md, REHEARSAL.json, PILOT.md and CONFLICTS.md.

## Evidence

- 67 focused unit/fixture tests pass (plus one explicit-opt-in hosted test skipped by default).
- Hosted Supabase test passes: actual private Storage upload/readback/restore; two durable PostgreSQL rows; lost simulated create response; fresh-worker reconstruction/reconciliation; immutable 46.99 EUR target; fixture-only cleanup.
- Chrome test with a real temporary Supabase user passes: real application login → 205-item catalog → selection → discount preview → confirmation → worker → persisted completion/history. Traces/screenshots/video disabled; test account removed afterward.
- Real Trading adapter code is exercised with fixture transports through backup/restore/verify/end/create/postcheck; no real eBay request is made by that rehearsal. Dedicated tests check image order, wrong seller, missing release and ambiguous creation.
- PostgreSQL assertions pass for lease exclusion, pause preservation, tenant separation, service-only RPCs, exact approval matching and immutable target prices. No actual live approval remains (tests rolled back).
- Supabase security advisor reports only INFO rls_enabled_no_policy on intentionally server-only tables with browser grants revoked: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
- Full baseline suite has a pre-existing failure at prepare-sunglasses.test.ts:107 (expects rules version 4; base has 5), reproduced from untouched base. See the latest test report for counts. Application production build passes; repository-wide tsc also includes pre-existing fixture type errors.

## Official sources checked

[GetMyeBaySelling](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetMyeBaySelling.html), [GetItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetItem.html), [GetBestOffers](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetBestOffers.html), [AddFixedPriceItem including UUID/fees/VAT/catalog behavior](https://developer.ebay.com/devzone/xml/docs/reference/ebay/AddFixedPriceItem.html), [EndFixedPriceItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/EndFixedPriceItem.html), [Inventory record error 25710](https://developer.ebay.com/support/knowledge-base/5210), [Analytics overview](https://developer.ebay.com/api-docs/sell/analytics/static/overview.html).

## Production preparation rollout (2026-11-04)

The user separately approved production database setup and deployment for exactly one real item, with End/Add still locked. Four migrations are now applied to production (the fourth atomically binds the account to one source item). RELISTER_ENABLED=true, RELISTER_PREPARATION_ONLY=true and RELISTER_LIVE_ENABLED=false. The preparation API is owner-only. The browser advances saved work automatically while Re-Lister stays open; production has no configured Inngest credentials, so closed-browser unattended execution is not claimed.

A clean npm ci from the committed package-lock.json succeeded in a temporary directory. With those exact dependencies, 67 focused tests and the production build pass. The isolated hosted Chrome test also passes with the preparation mode and automatic processing; no direct worker invocation or extra processing click is needed. SQL assertions validate single-item binding, same-item retries, second-item and foreign-account denial, and browser RPC denial. No real eBay mutation or live approval was created.

The real account ayeayeberlin was recognized through the existing Safari login and the initial inventory scan read more than 3,800 records without changing listings. For the approved single-item gate, an owner-only item-ID lookup now checks ownership/Germany through the same real adapter, saves the source to the account catalog and pauses the bulk scan. It does not create or bind a job until the normal checked preview is requested. Four API regression tests cover non-owner rejection, malformed IDs, adapter ownership rejection and source loading without job execution (71 focused tests total).
