begin;

alter table public.profiles add column email text;
alter table public.profiles add column approval_status text not null default 'pending';
alter table public.profiles add column approved_by uuid references auth.users(id) on delete set null;
alter table public.profiles add column approved_at timestamptz;
alter table public.profiles add column invited_by uuid references auth.users(id) on delete set null;
update public.profiles p set email = lower(u.email), approval_status = case when p.is_active then 'approved' else 'suspended' end,
  approved_at = case when p.is_active then now() else null end from auth.users u where u.id=p.id;
alter table public.profiles alter column is_active set default false;
alter table public.profiles add constraint profile_approval_status check (approval_status in ('pending','approved','rejected','suspended'));
alter table public.profiles add constraint profile_active_approval check (is_active = (approval_status = 'approved'));
create unique index profiles_email_unique on public.profiles(email) where email is not null;
create index profiles_approval_created_idx on public.profiles(approval_status,created_at desc);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- User-editable metadata never decides access, approval or the role.
  insert into public.profiles(id,email,full_name,role,is_active,approval_status)
  values(new.id,lower(new.email),left(coalesce(new.raw_user_meta_data->>'full_name',''),100),'viewer',false,'pending')
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;

create or replace function private.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active and approval_status='approved';
$$;
revoke all on function private.current_app_role() from public,anon;
grant execute on function private.current_app_role() to authenticated;

create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.profiles set email=lower(new.email) where id=new.id; return new; end;
$$;
revoke all on function private.sync_profile_email() from public,anon,authenticated;
create trigger sync_project_email after update of email on auth.users for each row execute function private.sync_profile_email();

create or replace function private.protect_project_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.role='admin' then
    if tg_op='DELETE' then raise exception 'Administrator account is protected' using errcode='23514'; end if;
    if new.role<>'admin' or new.approval_status<>'approved' or not new.is_active then
      raise exception 'Administrator account is protected' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.protect_project_admin() from public,anon,authenticated;
create trigger protect_project_admin before update or delete on public.profiles for each row execute function private.protect_project_admin();

-- Profile approval and privileged metadata are changed only by protected
-- Edge Functions. Even approved Editors cannot fabricate Drive file IDs.
revoke insert,update,delete on public.profiles,public.parcel_documents,
  public.drive_folders,public.owner_private_details from authenticated;

create policy parcels_editor_manage on public.parcels for all to authenticated
  using(private.has_app_role(array['editor']::public.app_role[])) with check(private.has_app_role(array['editor']::public.app_role[]));
create policy acquisition_editor_manage on public.acquisition_cases for all to authenticated
  using(private.has_app_role(array['editor']::public.app_role[])) with check(private.has_app_role(array['editor']::public.app_role[]));
create policy consent_editor_manage on public.consent_records for all to authenticated
  using(private.has_app_role(array['editor']::public.app_role[])) with check(private.has_app_role(array['editor']::public.app_role[]));
create policy legal_editor_manage on public.legal_reviews for all to authenticated
  using(private.has_app_role(array['editor']::public.app_role[])) with check(private.has_app_role(array['editor']::public.app_role[]));
create policy owner_private_editor_read on public.owner_private_details for select to authenticated
  using(private.has_app_role(array['editor']::public.app_role[]));
grant select(parcel_id,status,received_on,remarks,updated_by) on public.consent_records to authenticated;
grant select(parcel_id,category,target_date,acquisition_stage) on public.acquisition_cases to authenticated;
grant select on public.legal_reviews to authenticated;

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),email text not null,role public.app_role not null,
  user_id uuid references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null check(status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  constraint invitation_assignable_role check(role in ('editor','viewer','commenter'))
);
create index invitation_actor_created_idx on public.user_invitations(invited_by,created_at desc);
create index invitation_user_idx on public.user_invitations(user_id);
alter table public.user_invitations enable row level security;
revoke all on public.user_invitations from public,anon,authenticated;
grant all on public.user_invitations to service_role;

create table public.survey_comments (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(char_length(trim(body)) between 1 and 2000),
  author_name text not null default '',created_at timestamptz not null default now()
);
create index survey_comments_parcel_created_idx on public.survey_comments(parcel_id,created_at desc);
create index survey_comments_user_idx on public.survey_comments(user_id);
alter table public.survey_comments enable row level security;
create policy comments_approved_read on public.survey_comments for select to authenticated
  using(private.current_app_role() is not null);
create policy comments_author_insert on public.survey_comments for insert to authenticated
  with check(user_id=auth.uid() and private.has_app_role(array['admin','editor','commenter']::public.app_role[]));
create policy comments_author_delete on public.survey_comments for delete to authenticated
  using(private.has_app_role(array['admin']::public.app_role[]) or (user_id=auth.uid() and private.has_app_role(array['editor','commenter']::public.app_role[])));
revoke all on public.survey_comments from public,anon,authenticated;
grant select,delete on public.survey_comments to authenticated;
grant insert(parcel_id,user_id,body) on public.survey_comments to authenticated;
grant all on public.survey_comments to service_role;
create or replace function private.prepare_survey_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Comment author is invalid'; end if;
  select coalesce(nullif(trim(full_name),''),'Project member') into new.author_name from public.profiles where id=auth.uid();
  new.created_at=now();new.body=trim(new.body);return new;
end;
$$;
revoke all on function private.prepare_survey_comment() from public,anon,authenticated;
create trigger prepare_survey_comment before insert on public.survey_comments for each row execute function private.prepare_survey_comment();

create table public.drive_existing_folder_templates (
  google_folder_id text primary key,parent_folder_id text not null,village_name text not null,
  survey_name text not null,parcel_id uuid references public.parcels(id) on delete set null,
  structure jsonb not null,checked_at timestamptz not null default now()
);
create index existing_folder_parcel_idx on public.drive_existing_folder_templates(parcel_id);
alter table public.drive_existing_folder_templates enable row level security;
revoke all on public.drive_existing_folder_templates from public,anon,authenticated;
grant all on public.drive_existing_folder_templates to service_role;

commit;
