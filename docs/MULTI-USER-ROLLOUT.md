# Invitation-only accounts — staged implementation

Do not enable publicly before the rollout checks below pass. Existing deployment
continues in legacy single-owner mode when SNAPLIST_ACCOUNTS_ENABLED is unset.
No keys/tables belonging to ebay-ki-tools are modified.

## Required configuration (server secrets)
- Apply db/006_snaplist_accounts.sql to the existing EU project. It adds only
  snaplist_accounts, references auth.users, enables RLS and revokes client access.
- Obtain the owner's chosen email; create a Supabase Auth invite for that person,
  insert their exact auth user UUID into snaplist_accounts and set
  SNAPLIST_OWNER_USER_ID to that verified UUID. Never use user-editable metadata.
- Set APP_URL to the actual deployment origin. Configure Supabase Auth redirect
  URLs for that origin. Keep public signup disabled in Supabase; application
  membership is also required even if someone directly signs up through Auth.
- Set SNAPLIST_PRIVACY_CONTACT to operator name, postal address and contact.
- Existing SESSION_SECRET, SUPABASE_EU_URL and SUPABASE_EU_SECRET_KEY are reused.
  Never rotate them or expose them while preparing this migration.
- Invite generation uses admin.generateLink, not email delivery. The owner hands
  the private single-use link to its intended recipient. No emails are sent by
  this implementation. Link token is carried in a fragment and cleared before
  verification so it is not sent as a URL/referrer. Recipient sets a password.
- Members bring their own API keys through Mein Konto. All providers, including
  Claude, use only that member's keys; no environment-key fallback. Keys are
  encrypted with AES-GCM server-side and never returned by the account endpoint.

## Isolation and current limits
- Every interactive API is wrapped in verified Supabase getUser + membership,
  disabled-account and origin checks. Writes additionally bind the page account
  id to the current session, preventing stale-tab writes after account changes.
- Only the configured owner can use the legacy shared eBay database token.
  Members authorize their own eBay seller via OAuth; callback state binds to
  their user id, and refresh tokens are stored under that id. Legacy eBay
  cookies cannot become a member's connection. Manual code-pasting is disabled
  in account mode; it cannot provide the same callback account binding.
- Draft IndexedDB and model/shop preferences are namespaced. Only the owner keeps
  the existing namespace, preserving their old draft. These local browser files
  are not encrypted; separate browser profiles are required on shared machines.
  No cross-device synchronization is claimed.
- Existing cloud jobs use shared identities: disabled in account mode. Drain any
  active jobs before rollout. Do not turn background jobs back on until tenant
  identity and provider credentials are carried and revalidated by the worker.
- Price research is disabled in account mode pending review of current eBay
  API entitlements/terms. eBay API keys stay with the operator and calls share
  application quotas. Each seller consents through eBay, never supplies passwords.
- Technical separation does not establish legal compliance. Before sharing,
  review operator privacy/terms, subprocessors/DPAs, international AI transfers,
  account-deletion notification requirements, retention and eBay application
  requirements. Do not advertise full GDPR/eBay compliance without that review.

## Verification before activation
1. Deploy an isolated preview with its own APP_URL and enable accounts there.
2. Verify owner login, original draft restoration and shared seller access.
3. Invite two test users; test login/password, separate keys, missing-key failure,
   revoked membership, session refresh, eBay callbacks, A/B swapped identifiers,
   wrong origin and stale-tab writes. Test only read/verify actions at eBay.
4. Confirm previous users' local files are not shown in the interface; use
   separate browser profiles where local at-rest confidentiality is required.
5. Complete the legal configuration above and then enable production deliberately.
   Retain a rollback deployment; turning the flag off restores single-owner mode
   and must never be treated as public guest access.

Current implementation is not an activated multi-user service. No migration,
owner creation, external invitations, paid upgrade or production flag change
is performed merely by adding these files.
