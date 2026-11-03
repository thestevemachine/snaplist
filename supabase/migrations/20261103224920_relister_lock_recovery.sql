create function public.relister_lock(p_seller text,p_item text,p_job uuid) returns boolean language plpgsql security invoker set search_path=public as $$
declare previous uuid;old_row jsonb;
begin
 if not exists(select 1 from relister_jobs j where j.id=p_job and j.seller=p_seller and exists(select 1 from jsonb_array_elements(j.document->'rows') r where r->'listing'->>'id'=p_item)) then raise exception 'job/item mismatch';end if;
 insert into relister_item_locks(seller,item_id,job_id) values(p_seller,p_item,p_job) on conflict do nothing;
 select job_id into previous from relister_item_locks where seller=p_seller and item_id=p_item for update;
 if previous=p_job then return true;end if;
 select r into old_row from relister_jobs j,jsonb_array_elements(j.document->'rows') r where j.id=previous and r->'listing'->>'id'=p_item;
 if old_row->>'phase'='review' and not exists(select 1 from jsonb_array_elements(coalesce(old_row->'history','[]')) h where h->>'phase' in ('end_requested','ended','create_requested','created','completed')) then
 update relister_item_locks set job_id=p_job where seller=p_seller and item_id=p_item;return true;
 end if;
 return false;
end $$;
revoke all on function public.relister_lock(text,text,uuid) from public,anon,authenticated;
grant execute on function public.relister_lock(text,text,uuid) to service_role;
create function public.relister_worker_save(p_job uuid,p_account uuid,p_document jsonb,p_owner uuid) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from relister_claims where job_id=p_job and lease_owner=p_owner and lease_until>now() for update;
 if not found then raise exception 'worker lease expired';end if;
 perform relister_save(p_job,p_account,p_document);
 update relister_claims set lease_until=now()+interval '5 minutes' where job_id=p_job and lease_owner=p_owner;
end $$;
revoke all on function public.relister_worker_save(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.relister_worker_save(uuid,uuid,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
