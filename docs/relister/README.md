# Re-Lister

Re-Lister prepares replacement listings from owned German fixed-price offers. Price calculations use integer cents. Original prices, discounts, target prices and request identities stay fixed across retries.

The pipeline checks ownership and supported settings, backs up image bytes, verifies publication data and compares the resulting listing. Ambiguous creation responses require reconciliation. Unknown offer or inventory-management states block processing. Shop coupons and advertising do not block eligibility. Existing shop categories are preserved; eBay manages campaign participation. No advertising campaign is created by Re-Lister. Unsupported promotional price data still requires review rather than guessing a reference price.

When Inngest event and signing keys are configured, durable work events start processing and paced steps drain the database queue. A 15-minute recovery cron catches missed notifications. The browser is not needed for background processing. Without background credentials, owner-only preparation has an automatic browser fallback. Keep the Inngest integration restricted to the intended Vercel project; configure its Custom Production Domain to an already public production alias if generated deployment URLs are protected. Signed callbacks remain required.

Live changes require a separate exact-item approval. A preview alone never authorizes ending or publishing an offer.

GetBestOffers code 20140 is documented as no offers matching the query. It is accepted only for the exact verified active source, with no contradictory errors or returned offers. Other errors remain blocked.

Validation commands:

```sh
npm ci
npm test -- tests/relister
npm run build
```

See the source and tests for the supported payload contract and retry behavior. Operational account and rollout records are intentionally excluded from this document.
