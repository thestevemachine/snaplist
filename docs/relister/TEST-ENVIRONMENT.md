# Isolated Supabase verification — 2026-11-03

Project: `snaplist-relister-test`, ref `xfprtvwsjlvwcaywgwyw`, Frankfurt (`eu-central-1`). Organization explicitly selected by user: `thestevemachine`. Supabase quoted new-project cost: USD 0/month; organization reports Free plan. No paid option enabled.

Production project `ebay-ki-tools-eu` was not modified. New project was empty before applying the Re-Lister migration.

## Verified on real hosted PostgreSQL

Applied `relister_test_foundation` successfully. Executed transactional assertions (rolled back fixture rows):
- Initial job lease succeeds; second concurrent owner is rejected.
- A pause survives a worker save containing an older paused=false document.
- A command using another account UUID cannot resume the job.
- Database CHECK rejects mode=live.
- anon/authenticated cannot SELECT job documents or call control RPCs.
- Authorized resume succeeds.
- Storage bucket `snaplist-relister` is private.

Supabase security advisors returned only INFO `rls_enabled_no_policy` for the four server-only tables. This is intentional: table grants are revoked from anon/authenticated; service_role owns the access path. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.

## Not yet verified

Real object upload/readback, application account login on this project, Inngest cron execution and application-to-database integration still need server runtime configuration. No service-role secret has been retrieved or printed. The MCP connection can administer SQL but does not itself configure the Next.js server's SUPABASE_EU_SECRET_KEY or Inngest credentials.

The dedicated test project is created and its SQL foundation verified; this is not a claim of a completed live Re-Lister or a Webinterpret pilot.
