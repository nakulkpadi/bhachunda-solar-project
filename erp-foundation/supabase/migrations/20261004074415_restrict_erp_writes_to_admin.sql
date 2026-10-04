-- The operating model for this project is intentionally simple:
-- Nakul is the only administrator who can create or edit records; every
-- other signed-in role is read-only.  Sensitive owner identity and bank data
-- remains server-only and is never available through the browser Data API.

begin;

-- Replace the earlier operational-role write policies with administrator-only
-- policies.  These policy names are from the initial migration; `if exists`
-- keeps the migration safe for a clean deployment and for the current project.
drop policy if exists parcels_operational_manage on public.parcels;
drop policy if exists owners_operational_read on public.parcel_owners;
drop policy if exists owners_data_entry_manage on public.parcel_owners;
drop policy if exists owner_private_operational_read on public.owner_private_details;
drop policy if exists owner_private_data_entry_manage on public.owner_private_details;
drop policy if exists acquisition_cases_operational_read on public.acquisition_cases;
drop policy if exists acquisition_cases_data_entry_manage on public.acquisition_cases;
drop policy if exists consent_data_entry_manage on public.consent_records;
drop policy if exists drive_folders_operational_read on public.drive_folders;
drop policy if exists drive_folders_data_entry_manage on public.drive_folders;
drop policy if exists parcel_documents_operational_read on public.parcel_documents;
drop policy if exists parcel_documents_data_entry_manage on public.parcel_documents;
drop policy if exists legal_reviews_legal_read on public.legal_reviews;
drop policy if exists legal_reviews_legal_manage on public.legal_reviews;
drop policy if exists payments_finance_read on public.payments;
drop policy if exists payments_finance_manage on public.payments;
drop policy if exists activity_log_operational_insert on public.activity_log;

create policy parcels_admin_manage on public.parcels
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy owners_admin_read on public.parcel_owners
  for select to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]));
create policy owners_admin_manage on public.parcel_owners
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy owner_private_admin_read on public.owner_private_details
  for select to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]));
create policy owner_private_admin_manage on public.owner_private_details
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

-- These two tables retain narrowly-scoped read access because the dashboard
-- views calculate a public workflow stage and document count from them.  The
-- browser receives only the explicitly granted columns below.
create policy acquisition_cases_active_safe_read on public.acquisition_cases
  for select to authenticated using (private.current_app_role() is not null);
create policy acquisition_cases_admin_manage on public.acquisition_cases
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy parcel_documents_active_safe_read on public.parcel_documents
  for select to authenticated using (private.current_app_role() is not null);
create policy parcel_documents_admin_manage on public.parcel_documents
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy consent_admin_manage on public.consent_records
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy drive_folders_admin_read on public.drive_folders
  for select to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]));
create policy drive_folders_admin_manage on public.drive_folders
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy legal_reviews_admin_read on public.legal_reviews
  for select to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]));
create policy legal_reviews_admin_manage on public.legal_reviews
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

create policy payments_admin_read on public.payments
  for select to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]));
create policy payments_admin_manage on public.payments
  for all to authenticated
  using (private.has_app_role(array['admin']::public.app_role[]))
  with check (private.has_app_role(array['admin']::public.app_role[]));

-- Do not allow a browser client to add audit-log rows directly.  Edge
-- Functions use the service role after authorising the user server-side.

-- Rebuild Data API privileges as a column-minimised, read-only surface for
-- ordinary signed-in users.  RLS above is still the row-level boundary.
revoke all on public.villages, public.parcels, public.parcel_owners,
  public.owner_private_details, public.acquisition_cases, public.consent_records,
  public.document_types, public.drive_folders, public.parcel_documents,
  public.legal_reviews, public.payments, public.map_features,
  public.parcel_map_features, public.import_runs, public.activity_log
  from authenticated;

grant select (id, code, name_en, name_gu, district, taluka, map_source_status,
  created_at, updated_at) on public.villages to authenticated;
grant select on public.profiles to authenticated;
grant select on public.parcels, public.document_types, public.map_features,
  public.parcel_map_features to authenticated;
grant select (parcel_id, status, received_on) on public.consent_records to authenticated;
grant select (parcel_id, acquisition_stage) on public.acquisition_cases to authenticated;
grant select (parcel_id, status) on public.parcel_documents to authenticated;

-- Admin clients may use the existing data-entry screens.  The policies above
-- deny the same mutations to every other signed-in role.
grant insert, update, delete on public.villages, public.parcels,
  public.parcel_owners, public.owner_private_details, public.acquisition_cases,
  public.consent_records, public.document_types, public.drive_folders,
  public.parcel_documents, public.legal_reviews, public.payments,
  public.map_features, public.parcel_map_features, public.import_runs,
  public.activity_log to authenticated;
grant select on public.parcel_owners, public.owner_private_details,
  public.legal_reviews, public.payments, public.drive_folders,
  public.import_runs, public.activity_log to authenticated;

-- Browser-safe mapping used by the interactive SVG.  It contains no owner,
-- bank, Drive file, or other private fields.
create or replace view public.map_feature_parcel_links
with (security_invoker = true)
as
select
  mf.feature_key,
  mf.svg_element_id,
  pmf.parcel_id,
  p.survey_number,
  v.code as village_code,
  v.name_en as village_name,
  pmf.match_method,
  pmf.match_confidence
from public.map_features mf
join public.parcel_map_features pmf on pmf.map_feature_id = mf.id
join public.parcels p on p.id = pmf.parcel_id
join public.villages v on v.id = p.village_id;

grant select on public.map_feature_parcel_links to authenticated;

commit;
