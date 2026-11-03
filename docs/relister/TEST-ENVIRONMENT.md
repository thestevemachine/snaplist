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

## Hosted application integration test (subsequent run)

Server credentials were entered by the user into the ignored local `.env.local`; the key was neither printed nor committed. The guarded hosted Vitest test passed against this exact test-project URL. It:
- Uploaded an actual PNG into the private Storage bucket and read back matching SHA256 bytes.
- Persisted and read back the full snapshot JSON, then restored the ordered image bytes.
- Persisted two confirmed simulation rows in PostgreSQL.
- Simulated a lost response after creation, persisted `create_requested` with the known new ID, discarded adapter state, and resumed using processJob reconstructed from PostgreSQL.
- Completed both rows at immutable 46.99 EUR target from 49.99 EUR minus 6%, with no second reduction.
- Removed only this run's UUID-namespaced fixture objects/rows afterward.

eBay calls remained simulated. The worker function ran directly from the test process; remote Inngest scheduling, real eBay mutations and Webinterpret behavior are NOT verified by this test.

## Final recovery checks

All three migrations are installed only on the isolated test project. Transactional assertions passed for pre-end lock recovery, retaining locks after an end request, and rejecting saves by expired workers. Test rows were rolled back. The latest focused run passes 67 tests (hosted opt-in skipped); the production build passes. Hosted Storage/database and Chrome completion were separately exercised with synthetic data. No real seller account or eBay mutation was tested.
