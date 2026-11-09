-- REVIEW ONLY. Do not apply to production without separate approval.
create table public.relister_jobs (
 id uuid primary key, account_id uuid not null, seller text not null,
 document jsonb not null, pending boolean not null default false, revision bigint not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint relister_simulation_only check (document->>'mode' = 'simulation')
);
create table public.relister_catalog (
 account_id uuid primary key, seller text not null, listings jsonb not null,
 synced_at timestamptz not null default now()
);
create table public.relister_item_locks (
 seller text not null, item_id text not null, job_id uuid not null references public.relister_jobs(id),
 primary key(seller,item_id)
);
create table public.relister_claims (
 job_id uuid primary key references public.relister_jobs(id), lease_owner uuid, lease_until timestamptz
);
alter table public.relister_jobs enable row level security;
alter table public.relister_catalog enable row level security;
alter table public.relister_item_locks enable row level security;
alter table public.relister_claims enable row level security;
revoke all on public.relister_jobs,public.relister_catalog,public.relister_item_locks,public.relister_claims from anon,authenticated;
grant all on public.relister_jobs,public.relister_catalog,public.relister_item_locks,public.relister_claims to service_role;
create function public.relister_claim(p_job uuid,p_owner uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into relister_claims(job_id,lease_owner,lease_until) values(p_job,p_owner,now()+interval '5 minutes')
 on conflict(job_id) do update set lease_owner=p_owner,lease_until=now()+interval '5 minutes'
 where relister_claims.lease_until<now();
 return found;
end $$;
revoke all on function public.relister_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.relister_claim(uuid,uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('snaplist-relister','snaplist-relister',false,20971520,array['image/jpeg','image/png','image/webp','application/json']) on conflict(id) do nothing;
-- Worker updates cannot undo a concurrently requested pause/confirmation.
create function public.relister_save(p_job uuid,p_account uuid,p_document jsonb) returns void language sql security definer set search_path=public as $$
 update relister_jobs set document=p_document || jsonb_build_object('paused',document->'paused','confirmed',document->'confirmed'),updated_at=now(),pending=exists(select 1 from jsonb_array_elements(p_document->'rows') r where r->>'phase' not in ('completed','review','skipped')),revision=revision+1 where id=p_job and account_id=p_account;
$$;
revoke all on function public.relister_save(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.relister_save(uuid,uuid,jsonb) to service_role;
create function public.relister_command(p_job uuid,p_account uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_action not in ('confirm','pause','resume') then raise exception 'invalid command';end if;
 update relister_jobs set document=jsonb_set(document,case when p_action='confirm' then '{confirmed}'::text[] else '{paused}'::text[] end,to_jsonb(case when p_action='resume' then false else true end)),updated_at=now(),pending=true,revision=revision+1 where id=p_job and account_id=p_account;
end $$;
revoke all on function public.relister_command(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.relister_command(uuid,uuid,text) to service_role;
