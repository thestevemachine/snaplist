# Daily EU database health check

Vercel invokes `/api/cron/database-health` daily at 07:00 UTC (Hobby may run anywhere within that hour). Production only. Requires server-only sensitive `CRON_SECRET` (at least 32 characters) and existing `SUPABASE_EU_URL` / `SUPABASE_EU_SECRET_KEY`.

The authenticated handler performs three uncached GET queries selecting only `id` from EU `ebay_oauth_tokens`, row 1. It never reads/decrypts OAuth token values, calls eBay or AI, changes rows, or touches the unused legacy database. Responses contain only `{ ok: true/false }`; failures return HTTP 503. No secrets or upstream errors are logged.

Check Settings → Cron Jobs in Vercel project `snaplist`, use Run and View Logs. Investigate non-200 responses. This provides regular database activity but is not a guaranteed exemption from Supabase Free pausing and does not automatically restore paused projects. Supabase Pro is the guaranteed inactivity-pause exemption. Backups remain a separate requirement. No paid plan or external monitoring service is enabled.

Disable by removing this cron entry and redeploying, or disable Cron Jobs in Vercel. Do not remove the EU database or its credentials.
