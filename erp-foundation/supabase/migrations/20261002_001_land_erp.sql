-- Bhachunda Solar ERP - initial data model and access controls.
-- Run this migration in a staging Supabase project before production.

begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'data_entry', 'legal', 'finance', 'viewer');
create type public.consent_status as enum ('not_ready', 'pending', 'received', 'blocked', 'rejected');
create type public.document_status as enum ('missing', 'uploaded', 'verified', 'rejected', 'not_required');
create type public.acquisition_stage as enum ('identified', 'consent', 'legal', 'nfa', 'payment', 'executed', 'closed', 'blocked');
create type public.payment_kind as enum ('token', 'lease', 'other');

create or replace function public.normalise_survey_number(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    translate(lower(trim(coalesce(p_value, ''))), '૦૧૨૩૪૫૬૭૮૯', '0123456789'),
    '[[:space:]]+',
    '',
    'g'
  );
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.villages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_gu text,
  district text,
  taluka text,
  drive_root_folder_id text,
  map_source_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.parcels (
  id uuid primary key default gen_random_uuid(),
  village_id uuid not null references public.villages(id) on delete restrict,
  survey_number text not null,
  survey_number_normalized text generated always as (public.normalise_survey_number(survey_number)) stored,
  old_survey_number text,
  hectare_are_sqmt text,
  acreage numeric(14,4),
  account_number text,
  tenure text,
  land_use text,
  rights_and_encumbrances text,
  nondh_numbers text,
  bunch_number text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  source_workbook text,
  source_row_number integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parcels_acreage_nonnegative check (acreage is null or acreage >= 0),
  constraint parcels_unique_survey_per_village unique (village_id, survey_number_normalized)
);

create table public.parcel_owners (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  display_name text not null,
  source_owner_text text,
  sequence_no smallint,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parcel_owners_unique_sequence unique (parcel_id, sequence_no)
);

-- Kept separate so read-only map and reporting users never receive government IDs or bank details.
create table public.owner_private_details (
  owner_id uuid primary key references public.parcel_owners(id) on delete cascade,
  pan_number text,
  aadhaar_number text,
  bank_account_number text,
  bank_name text,
  ifsc_code text,
  vendor_code text,
  bank_owner_name text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.acquisition_cases (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null unique references public.parcels(id) on delete cascade,
  project_name text,
  spv_name text,
  mw numeric(10,2),
  category text,
  atl_category text,
  acquisition_purpose text,
  project_duration_months integer,
  block_name text,
  target_date date,
  execution_date date,
  acquisition_stage public.acquisition_stage not null default 'identified',
  reason_not_acquired text,
  total_acres_in_rtc numeric(14,4),
  total_acres_to_acquire numeric(14,4),
  total_acres_acquired numeric(14,4),
  total_sq_meters_acquired numeric(16,2),
  source_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null unique references public.parcels(id) on delete cascade,
  status public.consent_status not null default 'not_ready',
  received_on date,
  generated_letter_document_id uuid,
  source_value text,
  remarks text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Historic workbook rows mark consent as received but do not contain a
  -- reliable receipt date. A source value is accepted as evidence for that
  -- initial import; subsequent app entries record the actual date.
  constraint consent_received_evidence check (
    status <> 'received'
    or received_on is not null
    or nullif(trim(coalesce(source_value, '')), '') is not null
  )
);

create table public.document_types (
  code text primary key,
  label text not null,
  is_required_by_default boolean not null default false,
  is_sensitive boolean not null default false,
  sort_order smallint not null default 0
);

create table public.drive_folders (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null unique references public.parcels(id) on delete cascade,
  google_folder_id text not null unique,
  folder_name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.parcel_documents (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  owner_id uuid references public.parcel_owners(id) on delete set null,
  document_type_code text not null references public.document_types(code),
  status public.document_status not null default 'missing',
  google_file_id text unique,
  original_filename text,
  mime_type text,
  byte_size bigint,
  checksum_sha256 text,
  uploaded_by uuid references auth.users(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parcel_documents_size_nonnegative check (byte_size is null or byte_size >= 0),
  constraint parcel_documents_uploaded_has_file check (status not in ('uploaded', 'verified') or google_file_id is not null)
);

alter table public.consent_records
  add constraint consent_generated_letter_document_fk
  foreign key (generated_letter_document_id) references public.parcel_documents(id) on delete set null;

create table public.legal_reviews (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null unique references public.parcels(id) on delete cascade,
  public_notice_status text,
  sro_search_status text,
  documents_required integer,
  documents_submitted integer,
  law_firm_verification_status text,
  pending_documents text,
  preliminary_tsr_status text,
  conditional_clearance_status text,
  nfa_number text,
  nfa_submitted_on date,
  nfa_approved_on date,
  legal_remarks text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_documents_counts_nonnegative check (
    coalesce(documents_required, 0) >= 0 and coalesce(documents_submitted, 0) >= 0
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  payment_kind public.payment_kind not null,
  amount_inr numeric(16,2) not null check (amount_inr >= 0),
  paid_on date,
  utr_reference text,
  remarks text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.map_features (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null unique,
  svg_element_id text unique,
  geometry_geojson jsonb,
  source_cad_layer text,
  validation_status text not null default 'unmatched',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A CAD shape can represent more than one workbook record (for example, a
-- divided survey number such as 143/1, 143/2 and 143/3). Keep that mapping
-- explicit instead of forcing an incorrect one-shape-to-one-parcel link.
create table public.parcel_map_features (
  parcel_id uuid not null references public.parcels(id) on delete cascade,
  map_feature_id uuid not null references public.map_features(id) on delete cascade,
  match_method text not null,
  match_confidence text not null default 'needs_review',
  is_primary boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (parcel_id, map_feature_id)
);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_checksum text,
  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  notes text
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid references public.parcels(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  created_at timestamptz not null default now()
);

-- OAuth state and encrypted refresh-token storage are intentionally not
-- exposed to the browser. Only server-side Edge Functions using the service
-- role can read these records.
create table public.integration_oauth_states (
  state_hash text primary key,
  provider text not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.integration_secrets (
  key text primary key,
  ciphertext text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index parcels_village_idx on public.parcels(village_id);
create index parcels_survey_search_idx on public.parcels(survey_number_normalized);
create index parcel_documents_parcel_idx on public.parcel_documents(parcel_id, document_type_code);
create index payments_parcel_idx on public.payments(parcel_id, paid_on desc);
create index parcel_map_features_feature_idx on public.parcel_map_features(map_feature_id);
create index activity_log_parcel_idx on public.activity_log(parcel_id, created_at desc);
create index integration_oauth_states_expiry_idx on public.integration_oauth_states(expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger villages_set_updated_at before update on public.villages for each row execute function public.set_updated_at();
create trigger parcels_set_updated_at before update on public.parcels for each row execute function public.set_updated_at();
create trigger parcel_owners_set_updated_at before update on public.parcel_owners for each row execute function public.set_updated_at();
create trigger acquisition_cases_set_updated_at before update on public.acquisition_cases for each row execute function public.set_updated_at();
create trigger consent_records_set_updated_at before update on public.consent_records for each row execute function public.set_updated_at();
create trigger parcel_documents_set_updated_at before update on public.parcel_documents for each row execute function public.set_updated_at();
create trigger legal_reviews_set_updated_at before update on public.legal_reviews for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger map_features_set_updated_at before update on public.map_features for each row execute function public.set_updated_at();
create trigger parcel_map_features_set_updated_at before update on public.parcel_map_features for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active = true;
$$;

create or replace function public.has_app_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = any(p_roles);
$$;

-- These functions execute under their owner so RLS can safely read the role
-- table. They are not public API endpoints: only signed-in users may invoke
-- them and both functions return information about the current user only.
revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.current_app_role() from public;
revoke all on function public.has_app_role(public.app_role[]) from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_app_role(public.app_role[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.villages enable row level security;
alter table public.parcels enable row level security;
alter table public.parcel_owners enable row level security;
alter table public.owner_private_details enable row level security;
alter table public.acquisition_cases enable row level security;
alter table public.consent_records enable row level security;
alter table public.document_types enable row level security;
alter table public.drive_folders enable row level security;
alter table public.parcel_documents enable row level security;
alter table public.legal_reviews enable row level security;
alter table public.payments enable row level security;
alter table public.map_features enable row level security;
alter table public.parcel_map_features enable row level security;
alter table public.import_runs enable row level security;
alter table public.activity_log enable row level security;
alter table public.integration_oauth_states enable row level security;
alter table public.integration_secrets enable row level security;

create policy profiles_read_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_app_role(array['admin']::public.app_role[]));
create policy profiles_admin_manage on public.profiles
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy villages_read_active_users on public.villages
  for select to authenticated using (public.current_app_role() is not null);
create policy villages_admin_manage on public.villages
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy parcels_read_active_users on public.parcels
  for select to authenticated using (public.current_app_role() is not null);
create policy parcels_operational_manage on public.parcels
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy owners_operational_read on public.parcel_owners
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));
create policy owners_data_entry_manage on public.parcel_owners
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy owner_private_operational_read on public.owner_private_details
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));
create policy owner_private_data_entry_manage on public.owner_private_details
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy acquisition_cases_operational_read on public.acquisition_cases
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));
create policy acquisition_cases_data_entry_manage on public.acquisition_cases
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy consent_read_active_users on public.consent_records
  for select to authenticated using (public.current_app_role() is not null);
create policy consent_data_entry_manage on public.consent_records
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy document_types_read_active_users on public.document_types
  for select to authenticated using (public.current_app_role() is not null);
create policy document_types_admin_manage on public.document_types
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy drive_folders_operational_read on public.drive_folders
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));
create policy drive_folders_data_entry_manage on public.drive_folders
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry']::public.app_role[]));

create policy parcel_documents_operational_read on public.parcel_documents
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));
create policy parcel_documents_data_entry_manage on public.parcel_documents
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry', 'legal']::public.app_role[]));

create policy legal_reviews_legal_read on public.legal_reviews
  for select to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal']::public.app_role[]));
create policy legal_reviews_legal_manage on public.legal_reviews
  for all to authenticated
  using (public.has_app_role(array['admin', 'data_entry', 'legal']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'data_entry', 'legal']::public.app_role[]));

create policy payments_finance_read on public.payments
  for select to authenticated
  using (public.has_app_role(array['admin', 'finance']::public.app_role[]));
create policy payments_finance_manage on public.payments
  for all to authenticated
  using (public.has_app_role(array['admin', 'finance']::public.app_role[]))
  with check (public.has_app_role(array['admin', 'finance']::public.app_role[]));

create policy map_features_read_active_users on public.map_features
  for select to authenticated using (public.current_app_role() is not null);
create policy map_features_admin_manage on public.map_features
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy parcel_map_features_read_active_users on public.parcel_map_features
  for select to authenticated using (public.current_app_role() is not null);
create policy parcel_map_features_admin_manage on public.parcel_map_features
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy import_runs_admin_read on public.import_runs
  for select to authenticated using (public.has_app_role(array['admin']::public.app_role[]));
create policy import_runs_admin_manage on public.import_runs
  for all to authenticated
  using (public.has_app_role(array['admin']::public.app_role[]))
  with check (public.has_app_role(array['admin']::public.app_role[]));

create policy activity_log_admin_read on public.activity_log
  for select to authenticated using (public.has_app_role(array['admin']::public.app_role[]));
create policy activity_log_operational_insert on public.activity_log
  for insert to authenticated
  with check (public.has_app_role(array['admin', 'data_entry', 'legal', 'finance']::public.app_role[]));

-- Supabase projects created with Data API auto-exposure disabled need explicit
-- grants. RLS remains the row-level authorization boundary; these grants only
-- make the required operational objects reachable to authenticated staff.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated, service_role;

grant select on public.villages, public.parcels, public.consent_records,
  public.document_types, public.map_features, public.parcel_map_features
  to authenticated;
grant select, insert, update on public.acquisition_cases, public.legal_reviews,
  public.parcel_documents, public.drive_folders, public.parcel_owners,
  public.owner_private_details
  to authenticated;
grant update (old_survey_number, acreage, bunch_number) on public.parcels to authenticated;
grant insert, update (status, received_on, source_value, remarks, updated_by) on public.consent_records to authenticated;

-- The import program and the Drive Edge Function run only with the service
-- role on the server. No client is given this role or its secret key.
grant all privileges on all tables in schema public to service_role;

create or replace view public.parcel_overview
with (security_invoker = true)
as
select
  p.id,
  p.village_id,
  v.code as village_code,
  v.name_en as village_name,
  p.survey_number,
  p.old_survey_number,
  p.acreage,
  p.account_number,
  p.bunch_number,
  coalesce(c.status, 'not_ready'::public.consent_status) as consent_status,
  coalesce(a.acquisition_stage, 'identified'::public.acquisition_stage) as acquisition_stage,
  coalesce(d.document_count, 0)::integer as document_count,
  coalesce(d.verified_document_count, 0)::integer as verified_document_count
from public.parcels p
join public.villages v on v.id = p.village_id
left join public.consent_records c on c.parcel_id = p.id
left join public.acquisition_cases a on a.parcel_id = p.id
left join lateral (
  select
    count(*) as document_count,
    count(*) filter (where pd.status = 'verified') as verified_document_count
  from public.parcel_documents pd
  where pd.parcel_id = p.id
) d on true;

-- A shape can map to several land records. It turns green only when every
-- linked record has received consent; any blocked or rejected record wins.
create or replace view public.map_status_summary
with (security_invoker = true)
as
select
  mf.feature_key,
  case
    when count(pmf.parcel_id) = 0 then 'not_ready'::public.consent_status
    when bool_or(coalesce(cr.status, 'not_ready'::public.consent_status) = 'rejected') then 'rejected'::public.consent_status
    when bool_or(coalesce(cr.status, 'not_ready'::public.consent_status) = 'blocked') then 'blocked'::public.consent_status
    when bool_and(coalesce(cr.status, 'not_ready'::public.consent_status) = 'received') then 'received'::public.consent_status
    when bool_or(coalesce(cr.status, 'not_ready'::public.consent_status) = 'pending') then 'pending'::public.consent_status
    else 'not_ready'::public.consent_status
  end as status,
  count(distinct pmf.parcel_id)::integer as linked_parcel_count
from public.map_features mf
left join public.parcel_map_features pmf on pmf.map_feature_id = mf.id
left join public.consent_records cr on cr.parcel_id = pmf.parcel_id
group by mf.id, mf.feature_key;

grant select on public.parcel_overview, public.map_status_summary to authenticated;

insert into public.document_types (code, label, is_required_by_default, is_sensitive, sort_order) values
  ('current_712', 'Current 7/12', true, false, 10),
  ('nondh_6', 'Nondh No. 6 / Mutation Entry', true, false, 20),
  ('aadhaar', 'Aadhaar', true, true, 30),
  ('pan', 'PAN', true, true, 40),
  ('bank_details', 'Bank Details', true, true, 50),
  ('consent_letter', 'Consent Letter', true, true, 60),
  ('old_712', 'Old 7/12', false, false, 70),
  ('old_nondh_6', 'Old Nondh No. 6', false, false, 80),
  ('mutation_death_certificate', 'Mutation Entry / Death Certificate', false, true, 90)
on conflict (code) do nothing;

commit;
