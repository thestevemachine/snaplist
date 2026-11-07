# Parallel development / merge notes

Feature base is `codex/main-frame-colors-release` at `93dc20e`, not main (main is behind production). Do not merge unrelated PRs.

Only shared source changes: application layout navigation, Trading read-call union (GetMyeBaySelling/GetBestOffers), and conditional registration of a separate Inngest function. Listing creation, measurement and existing cards are untouched. Concurrent edits to layout or Inngest route need a small manual merge. All business logic/UI/migration/test files use relister namespaces. Feature is disabled without RELISTER_ENABLED and accounts mode; production was not deployed.

Migration functions are service-role-only. The three migrations were applied only to the separately authorized free test project snaplist-relister-test. Hosted database, private Storage, browser flow, approval gating and lease behavior have been exercised there. The guarded live adapter exists; real seller preparation, actual eBay mutations, remote scheduler operation and Webinterpret behavior remain unverified. Production deployment/migrations and a concrete single-item pilot need separate approval (see PILOT.md). Existing owner credentials are never borrowed for other accounts.
