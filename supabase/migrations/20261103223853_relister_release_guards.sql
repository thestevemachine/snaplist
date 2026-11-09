-- Separate test/review migration. Applying this never grants permission to end an item.
alter table public.relister_jobs drop constraint relister_simulation_only;
alter table public.relister_jobs add constraint relister_modes check(document->>'mode' in ('simulation','dry-run','live'));
create table public.relister_approvals(
 job_id uuid not null references public.relister_jobs(id),item_id text not null,
 account_id uuid not null,seller text not null,snapshot_digest text not null,
 target_cents bigint not null,expires_at timestamptz not null,
 primary key(job_id,item_id)
);
alter table public.relister_approvals enable row level security;
revoke all on public.relister_approvals from public,anon,authenticated;
grant all on public.relister_approvals to service_role;
create table public.relister_sync(
 account_id uuid primary key,seller text not null,document jsonb not null,
 pending boolean not null default true,updated_at timestamptz not null default now()
);
alter table public.relister_sync enable row level security;
revoke all on public.relister_sync from public,anon,authenticated;
grant all on public.relister_sync to service_role;
create index relister_pending_jobs_idx on public.relister_jobs(updated_at) where pending;
create index relister_account_jobs_idx on public.relister_jobs(account_id,created_at desc);
create index relister_pending_sync_idx on public.relister_sync(updated_at) where pending;
-- Preserve price snapshot, account and identity on every worker write.
create or replace function public.relister_save(p_job uuid,p_account uuid,p_document jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare original jsonb;entry jsonb;previous jsonb;
begin
 select document into original from relister_jobs where id=p_job and account_id=p_account for update;
 if original is null then raise exception 'job unavailable';end if;
 if p_document->>'account' is distinct from original->>'account' or p_document->>'seller' is distinct from original->>'seller' or p_document->>'mode' is distinct from original->>'mode' then raise exception 'immutable job identity';end if;
 for entry in select * from jsonb_array_elements(p_document->'rows') loop
 select r into previous from jsonb_array_elements(original->'rows') r where r->>'id'=entry->>'id';
 if previous is null or entry->>'originalCents' is distinct from previous->>'originalCents' or entry->>'targetCents' is distinct from previous->>'targetCents' or entry->>'percent' is distinct from previous->>'percent' or entry->>'uuid' is distinct from previous->>'uuid' or entry->'listing'->>'id' is distinct from previous->'listing'->>'id' then raise exception 'immutable price snapshot';end if;
 end loop;
 update relister_jobs set document=p_document||jsonb_build_object('paused',document->'paused','confirmed',document->'confirmed'),pending=exists(select 1 from jsonb_array_elements(p_document->'rows') r where r->>'phase' not in ('completed','review','skipped') and not (p_document->>'mode'='dry-run' and r->>'phase'='ready')),updated_at=now(),revision=revision+1 where id=p_job;
end $$;
revoke all on function public.relister_save(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.relister_save(uuid,uuid,jsonb) to service_role;
create function public.relister_activate(p_job uuid,p_account uuid,p_digest text) returns void language plpgsql security invoker set search_path=public as $$
declare d jsonb;r jsonb;
begin
 select document into d from relister_jobs where id=p_job and account_id=p_account for update;
 if d is null or d->>'mode' is distinct from 'dry-run' or d->>'previewDigest' is distinct from p_digest then raise exception 'preview mismatch';end if;
 for r in select * from jsonb_array_elements(d->'rows') loop
 if r->>'phase' is distinct from 'ready' or jsonb_typeof(r->'backup') is distinct from 'object' or jsonb_typeof(r->'outgoing') is distinct from 'object' or (r->>'feeCents')::bigint is distinct from 0 then raise exception 'not ready';end if;
 if not exists(select 1 from relister_approvals a where a.job_id=p_job and a.account_id=p_account and a.item_id=r->'listing'->>'id' and a.seller=d->>'seller' and a.snapshot_digest=p_digest and a.target_cents=(r->>'targetCents')::bigint and a.expires_at>now()) then raise exception 'pilot approval missing';end if;
 end loop;
 update relister_jobs set document=jsonb_set(jsonb_set(d,'{mode}','"live"'),'{confirmed}','true'),pending=true,updated_at=now() where id=p_job;
end $$;
revoke all on function public.relister_activate(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.relister_activate(uuid,uuid,text) to service_role;
create table public.relister_lineage(
 account_id uuid not null,seller text not null,old_id text not null,new_id text not null,
 job_id uuid not null references public.relister_jobs(id),first_seen timestamptz not null,renewed_at timestamptz not null,
 primary key(seller,old_id),unique(seller,new_id)
);
alter table public.relister_lineage enable row level security;
revoke all on public.relister_lineage from public,anon,authenticated;
grant all on public.relister_lineage to service_role;
create index relister_lineage_account_idx on public.relister_lineage(account_id,seller);

notify pgrst, 'reload schema';
