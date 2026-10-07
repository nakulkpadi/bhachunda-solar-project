create or replace function public.acquire_drive_folder_lease(scope_key text, lease_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if length(scope_key) > 400 or scope_key !~ '^(parcel:|village:|existing:)' then
    raise exception 'Invalid folder scope';
  end if;
  insert into public.drive_folder_leases(scope,token,expires_at)
    values (scope_key,lease_token,now()+interval '5 minutes')
    on conflict(scope) do update set token=excluded.token,expires_at=excluded.expires_at
    where public.drive_folder_leases.expires_at < now();
  return found;
end;
$$;
revoke all on function public.acquire_drive_folder_lease(text,uuid) from public,anon,authenticated;
grant execute on function public.acquire_drive_folder_lease(text,uuid) to service_role;

-- The browser consent form omits the import-only source_value column.
-- Preserve its existing permissions and historical source values.
