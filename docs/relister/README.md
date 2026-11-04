# Re-Lister

Re-Lister prepares replacement listings from owned German fixed-price offers. Price calculations use integer cents. Original prices, discounts, target prices and request identities stay fixed across retries.

The pipeline checks ownership and supported settings, backs up image bytes, verifies publication data and compares the resulting listing. Ambiguous creation responses require reconciliation. Unknown offer, promotion or inventory-management states block processing.

Live changes require a separate exact-item approval. A preview alone never authorizes ending or publishing an offer.

GetBestOffers code 20140 is documented as no offers matching the query. It is accepted only for the exact verified active source, with no contradictory errors or returned offers. Other errors remain blocked.

Validation commands:

```sh
npm ci
npm test -- tests/relister
npm run build
```

See the source and tests for the supported payload contract and retry behavior. Operational account and rollout records are intentionally excluded from this document.
