-- Owner-only preparation rollout: atomically bind one real item per account.
create table public.relister_preparation_bindings (
 account_id uuid primary key, seller text not null, item_id text not null,
 created_at timestamptz not null default now()
);
alter table public.relister_preparation_bindings enable row level security;
revoke all on public.relister_preparation_bindings from public,anon,authenticated;
grant all on public.relister_preparation_bindings to service_role;
create function public.relister_bind_preparation(p_account uuid,p_seller text,p_item text) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from relister_catalog c where c.account_id=p_account and c.seller=p_seller and exists(select 1 from jsonb_array_elements(c.listings) l where l->>'id'=p_item)) then raise exception 'item outside account catalog';end if;
 insert into relister_preparation_bindings(account_id,seller,item_id) values(p_account,p_seller,p_item) on conflict do nothing;
 return exists(select 1 from relister_preparation_bindings where account_id=p_account and seller=p_seller and item_id=p_item);
end $$;
revoke all on function public.relister_bind_preparation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.relister_bind_preparation(uuid,text,text) to service_role;
notify pgrst,'reload schema';
