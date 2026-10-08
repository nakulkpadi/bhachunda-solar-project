-- Unsigned generated forms are independent of consent_records and map status.
create table public.consent_form_drafts (
  id uuid primary key,
  parcel_id uuid not null references public.parcels(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft','archived')),
  revision integer not null default 1 check (revision > 0),
  template_version text not null default 'bnpl-consent-v1' check (template_version = 'bnpl-consent-v1'),
  fields jsonb not null check (jsonb_typeof(fields)='object' and octet_length(fields::text)<=24000
    and fields ?& array['date','survey_number','khata','has','village_en','village_gu','taluka','district','mobile','owners']
    and not fields ?| array['status','consent_status','received_on']
    and jsonb_typeof(fields->'owners')='array' and jsonb_array_length(fields->'owners') between 1 and 50),
  document_id uuid references public.parcel_documents(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consent_form_drafts_parcel_updated_idx on public.consent_form_drafts(parcel_id,updated_at desc);
create index consent_form_drafts_updated_idx on public.consent_form_drafts(updated_at desc,id);
alter table public.consent_form_drafts enable row level security;
revoke all on public.consent_form_drafts from public,anon,authenticated;
grant select on public.consent_form_drafts to authenticated;
grant all on public.consent_form_drafts to service_role;
create policy approved_draft_readers on public.consent_form_drafts for select to authenticated
 using ((select private.current_app_role()) in ('admin','editor'));
comment on table public.consent_form_drafts is 'Unsigned generated forms. Generating, saving, printing or attaching a PDF never indicates owner consent or changes map colours.';
insert into public.document_types(code,label,is_required_by_default,is_sensitive,sort_order)
 values ('consent_form_draft','Generated consent form (unsigned draft)',false,true,95)
 on conflict(code) do nothing;
create or replace function private.check_generated_form_document()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.document_id is not null and not exists (
  select 1 from public.parcel_documents d where d.id=new.document_id
   and d.parcel_id=new.parcel_id and d.document_type_code='consent_form_draft' and d.status in ('uploaded','verified')
 ) then raise exception 'Generated forms must link to an unsigned draft document belonging to the same survey'; end if;
 return new;
end;
$$;
revoke all on function private.check_generated_form_document() from public,anon,authenticated;
create trigger check_generated_form_document before insert or update of document_id,parcel_id
 on public.consent_form_drafts for each row execute function private.check_generated_form_document();

