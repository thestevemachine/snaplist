# Parallel development / merge notes

Feature base is `codex/main-frame-colors-release` at `93dc20e`, not main (main is behind production). Do not merge unrelated PRs.

Only shared source changes: application layout navigation, Trading read-call union (GetMyeBaySelling/GetBestOffers), and conditional registration of a separate Inngest function. Listing creation, measurement and existing cards are untouched. Concurrent edits to layout or Inngest route need a small manual merge. All business logic/UI/migration/test files use relister namespaces. Feature is disabled without RELISTER_ENABLED and accounts mode; production was not deployed.

Migration functions are service-role-only; source review is not a PostgreSQL integration test. A separate approved test DB is required to validate RLS, leases, command/worker races and Storage before any deployment. The live pipeline is incomplete and must remain blocked. Existing owner credentials are never borrowed for other accounts.
