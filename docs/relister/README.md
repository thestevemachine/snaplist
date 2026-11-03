# Re-Lister — implementation and release status

Base: production commit `93dc20e10e7c8ac5074c6bdab1fbd5a973b239bb`, PR #45. Feature branch: `codex/re-lister`. Existing dirty project mirror is untouched. No PR merged, production deployment/migration, eBay mutation, paid service or OAuth scope change performed.

## Implemented

- Separate `/relister` area, second application navigation tab; full-result search/sort/quick-selection of 1–200 items, oldest first; missing views sorted last.
- Presets 0/2/4/6/8/10%, custom decimal comma percentages below 100, integer/BigInt cent rounding, immutable per-job original and target prices; explicit preview and simulation confirmation.
- Authenticated account API using existing account scope, guards and seller token provider; Trading seller enumeration with complete pagination. Marketplace is the actual `Site`, never inferred from language, currency or location. Unknown quantities, sales and offer/promotion/management states are ineligible.
- Durable job documents, service-role-only tables/RLS, per seller/item locks, worker claims, pause/resume, persisted transition-before-side-effect, bounded retries and manual-review states; separate Inngest cron reuses existing client without enabling legacy shared-account jobs.
- Protected bucket migration and fixture image upload/readback. Restricted external-image downloader allows only HTTPS eBay image CDN, no redirects/credentials/queries, bounded streaming and image signature checks.
- Explicit, restricted publication DTO; full GetItem response is never passed to Add. Unsupported regulatory, storefront, additional category or paid-option settings block DTO generation.
- Executable simulated end-to-end rehearsal including lost create response and restart from durable local disk.

## Important limitations — not a finished live relisting implementation

Real seller inventory is read-only. Management, pending offers and promotions are currently `unknown`, and therefore real listings are intentionally excluded from job preparation. The current worker supports simulation only; a SQL constraint and server guard reject live jobs. There is no operational EndFixedPriceItem/AddFixedPriceItem live adapter, real-image publication pipeline, live VerifyAddFixedPriceItem integration, complete settings round-trip comparison, or live-pilot approval mechanism yet. The simulation comparer checks fixture identity/price, not real eBay fields. The current GetMyeBaySelling sync is request-bound, not yet a resumable sync for very large accounts. Background SQL/Storage/Inngest integration has not been run against Supabase; no PostgreSQL sandbox was available in this task. Accounts-mode integration is required; legacy cookie-only mode is rejected.

This branch is a reviewable first implementation with a complete simulated rehearsal, not fulfillment of all live requirements. Do not approve or run a live pilot based on these fixtures.

## Configuration (review, no production application)

1. Review `supabase/migrations/20261103000000_relister.sql`; apply only to an approved isolated test Supabase project.
2. Existing `SUPABASE_EU_URL`, `SUPABASE_EU_SECRET_KEY`, account auth and Inngest configuration are reused. Set `SNAPLIST_ACCOUNTS_ENABLED=true`, `RELISTER_ENABLED=true` in that isolated environment. Do not add OAuth scopes silently.
3. Register existing `/api/inngest` with Inngest. `relister-durable-tick` polls every minute, up to one article per job/invocation. Closing the browser does not own execution.
4. Open Re-Lister, load explicitly labelled test data, filter/sort, select and set discount; prepare preview, then confirm the simulation. Inspect row history and backups. Pause stops new simulated ends; already-ended rows remain resumable.
5. Disabling the feature prevents new API operations. Do not disable a future live worker while ended items need recovery.

No database policy grants a browser access to backup files. No foreign description HTML is rendered in this UI. Credentials are never serialized in jobs or reports.

## History and Webinterpret

Catalog records distinguish listing start time and first Snaplist capture. Job mappings retain old/new IDs; a production history successor update remains to implement. Never infer original inventory age. Watchers and listing history do not transfer automatically. A new item number does not guarantee ranking or a 24-hour boost. Listing fees, quotas, paid enhancements and ads need explicit handling. According to the seller's experience Webinterpret ends foreign counterparts when a German original ends; international recreation and price propagation remain unverified and require a separately approved one-item pilot. No international mutation is implemented.

## Official API evidence checked 2026-11-03

- [GetMyeBaySelling](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetMyeBaySelling.html): authenticated seller inventory, pagination; fixed-price current price is SellingStatus.CurrentPrice.
- [GetItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetItem.html): details and item specifics. InventoryTrackingMethod=SKU is not proof of Inventory API ownership; missing fields do not prove absence of risk.
- [AddFixedPriceItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/AddFixedPriceItem.html): new listing, estimated fees, 32-hex UUID for repeat protection, duplicate UUID error can contain prior item ID.
- [EndFixedPriceItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/EndFixedPriceItem.html) and [GetBestOffers](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetBestOffers.html) reviewed for future live adapter.
- [Analytics overview](https://developer.ebay.com/api-docs/sell/analytics/static/overview.html): Germany supported, traffic metrics include listing page views. Views are distinct from impressions/watchers; Analytics integration and existing-scope verification are not implemented. UI says unavailable, not zero.

## Verification results

- 53 focused tests passed: cents/percent validation, marketplace/ownership safety, incomplete fields, variants/stock/sales/discount/offer exclusions, global quick selection with 205 rows, both views sorts with missing values last, three-page seller pagination, image URL safety, mutation state machine, price races, creation/end timeouts, serialized restart, locks, authorization pause, retry bounds and simulated postcheck.
- Chrome browser test passed: Re-Lister page, 205 rows, select first 200 across pagination, custom `3,5` discount and explicit confirmation preview (API mocked; not Supabase).
- Next production build passed locally. Package ranges were installed via pnpm without changing package.json/package-lock; installed versions may differ from npm lock. Clean lockfile-based CI remains required before release.
- Complete simulated disk-backed rehearsal report: `REHEARSAL.json`. Uses two synthetic items, 49.99 EUR → 46.99 EUR. Real fixture PNG bytes saved to local disk; simulated eBay APIs, simulated fees and postcheck. No Sandbox, live eBay, Webinterpret or production storage behavior was verified.
- Full suite: 659/660 passed. One pre-existing failure in `prepare-sunglasses.test.ts:107` expects glasses rules version 4 while production base has version 5. Reproduced independently from `git archive` of untouched base `93dc20e`; not changed by this feature.
