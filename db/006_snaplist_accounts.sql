-- Additive migration. Does not alter ebay_oauth_tokens or ebay-ki-tools.
create table if not exists public.snaplist_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 disabled boolean not null default false,
 sealed_credentials text,
 created_at timestamptz not null default now()
);
alter table public.snaplist_accounts enable row level security;
revoke all on public.snaplist_accounts from anon, authenticated;
-- Intentionally no browser policies. All access is server-side, filtered by
-- verified auth.users.id. Roles and credentials cannot be set by user metadata.
