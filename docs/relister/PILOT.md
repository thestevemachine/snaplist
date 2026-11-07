# Re-Lister operating notes

The Re-Lister works only on the authenticated owner account and German original fixed-price listings. It reads the complete active inventory, sorts by actual start date and supports exact selection of up to 200 eligible items.

## Per-job flow

1. Synchronize the eBay inventory and select the items and target discount.
2. Start preparation. The background worker saves the listing data and ordered image bytes, then rechecks ownership, marketplace, status, price, stock, supported settings and the listing fee.
3. Once every selected row is ready and the eBay listing fee is zero, review the exact job and explicitly confirm it in the UI. This grants only the listed source items, seller, saved snapshot and target prices for that job. There is no blanket approval for future jobs.
4. The worker ends each source item and creates a genuinely new fixed-price offer through `AddFixedPriceItem`. It reconciles ambiguous replies, compares supported fields and saves lineage. Pause/resume and durable retries continue the same confirmed job.

Do not bypass the exact confirmation or mark a job complete by hand. A changed source price, stock, seller, marketplace or settings snapshot must stop before End. Unknown publication outcomes require reconciliation or review before another create attempt.

## Preserved settings and limits

New listings reuse the original shipping, return and payment business-policy IDs, store category and ordered image files. Snaplist does not create or edit coupons or advertising. It does not inspect, end or recreate foreign Webinterpret listings. Ranking changes are not guaranteed. Watchers and the old offer history do not transfer automatically. The current workflow requires an eBay preflight listing fee of zero; sale fees and account quota can still apply.

Keep operational account, item and rollout records outside repository documentation. Never copy seller credentials into test environments or expose service keys.
