alter table public.drive_folders add column if not exists structure jsonb not null default '{}'::jsonb, add column if not exists structure_version integer not null default 0, add column if not exists structure_completed_at timestamptz;
create table public.drive_folder_leases (scope text primary key, token uuid not null, expires_at timestamptz not null);
alter table public.drive_folder_leases enable row level security;
revoke all on public.drive_folder_leases from public, anon, authenticated;
grant all on public.drive_folder_leases to service_role;
create or replace function public.acquire_drive_folder_lease(scope_key text, lease_token uuid) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if length(scope_key) > 400 or scope_key !~ '^(parcel:|village:)' then raise exception 'Invalid folder scope'; end if;
  insert into public.drive_folder_leases(scope,token,expires_at) values (scope_key,lease_token,now()+interval '5 minutes') on conflict(scope) do update set token=excluded.token,expires_at=excluded.expires_at where public.drive_folder_leases.expires_at < now();
  return found;
end; $$;
create or replace function public.release_drive_folder_lease(scope_key text, lease_token uuid) returns void language sql security invoker set search_path = '' as $$ delete from public.drive_folder_leases where scope=scope_key and token=lease_token; $$;
revoke all on function public.acquire_drive_folder_lease(text,uuid), public.release_drive_folder_lease(text,uuid) from public, anon, authenticated;
grant execute on function public.acquire_drive_folder_lease(text,uuid), public.release_drive_folder_lease(text,uuid) to service_role;
insert into public.document_types(code,label,is_required_by_default,is_sensitive,sort_order) values ('lease_deed','Lease Deed',false,true,0),('other','Other',false,true,10) on conflict(code) do nothing;
