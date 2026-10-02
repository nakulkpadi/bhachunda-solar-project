-- Keep SECURITY DEFINER helpers off the Data API's exposed public schema.
-- Policies and triggers retain their function OID dependencies after the move.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.current_app_role() set schema private;
alter function public.has_app_role(public.app_role[]) set schema private;
alter function public.handle_new_user() set schema private;

-- SQL-language function bodies are stored as text, so replace the helper body
-- after moving its dependency to the private schema.
create or replace function private.has_app_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.current_app_role() = any(p_roles);
$$;

revoke all on function private.current_app_role() from public, anon;
revoke all on function private.has_app_role(public.app_role[]) from public, anon;
revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.has_app_role(public.app_role[]) to authenticated;

-- This project-level event trigger is invoked by PostgreSQL, not through the
-- REST API. Remove its default direct execution grants from browser roles.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

commit;
