#!/usr/bin/env python3
"""Render one safe, idempotent SQL batch from a prepared ERP import payload.

The tool intentionally emits SQL to stdout so a privileged deployment runner
can apply one small section at a time.  It never contacts Supabase and does
not log the source data itself.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SECTIONS = (
    "villages",
    "parcels",
    "owners",
    "consents",
    "ensure_private_owners",
    "private_details",
    "acquisition_cases",
    "legal_reviews",
    "map_features",
    "map_links",
)


def sql_json(rows: list[dict]) -> str:
    # A non-alphanumeric dollar tag avoids needing to quote Gujarati text,
    # apostrophes, or multiline names from the source workbooks.
    return "$erp_import$" + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "$erp_import$"


def values(payload: dict, source: str) -> list[dict]:
    if source == "consents":
        return payload["consent_records"]
    if source == "private_details":
        return payload["owner_private_details"]
    if source == "ensure_private_owners":
        # Fallback ownership must never copy a bank/PAN/Aadhaar name into the
        # general owner directory.  The detailed identity remains exclusively
        # in owner_private_details.
        return [
            {"village_code": row["village_code"], "survey_normalized": row["survey_normalized"]}
            for row in payload["owner_private_details"]
        ]
    if source == "map_links":
        return payload["parcel_map_features"]
    return payload[source]


def render(section: str, rows: list[dict]) -> str:
    source = sql_json(rows)
    if section == "villages":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    code text, name_en text, name_gu text, district text, taluka text,
    drive_root_folder_id text
  )
)
insert into public.villages (code, name_en, name_gu, district, taluka, drive_root_folder_id)
select code, name_en, name_gu, district, taluka, drive_root_folder_id from source
on conflict (code) do update set
  name_en = excluded.name_en,
  name_gu = coalesce(excluded.name_gu, public.villages.name_gu),
  district = coalesce(excluded.district, public.villages.district),
  taluka = coalesce(excluded.taluka, public.villages.taluka),
  drive_root_folder_id = coalesce(excluded.drive_root_folder_id, public.villages.drive_root_folder_id);
"""
    if section == "parcels":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_number text, survey_normalized text,
    old_survey_number text, hectare_are_sqmt text, acreage numeric,
    account_number text, tenure text, land_use text, rights_and_encumbrances text,
    nondh_numbers text, source_workbook text, source_row_number integer,
    latitude numeric, longitude numeric
  )
)
insert into public.parcels (
  village_id, survey_number, old_survey_number, hectare_are_sqmt, acreage,
  account_number, tenure, land_use, rights_and_encumbrances, nondh_numbers,
  source_workbook, source_row_number, latitude, longitude
)
select v.id, s.survey_number, s.old_survey_number, s.hectare_are_sqmt, s.acreage,
  s.account_number, s.tenure, s.land_use, s.rights_and_encumbrances, s.nondh_numbers,
  s.source_workbook, s.source_row_number, s.latitude, s.longitude
from source s join public.villages v on v.code = s.village_code
on conflict (village_id, survey_number_normalized) do update set
  survey_number = excluded.survey_number,
  old_survey_number = excluded.old_survey_number,
  hectare_are_sqmt = excluded.hectare_are_sqmt,
  acreage = excluded.acreage,
  account_number = excluded.account_number,
  tenure = excluded.tenure,
  land_use = excluded.land_use,
  rights_and_encumbrances = excluded.rights_and_encumbrances,
  nondh_numbers = excluded.nondh_numbers,
  source_workbook = excluded.source_workbook,
  source_row_number = excluded.source_row_number,
  latitude = coalesce(excluded.latitude, public.parcels.latitude),
  longitude = coalesce(excluded.longitude, public.parcels.longitude);
"""
    if section == "owners":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text, display_name text,
    source_owner_text text, sequence_no smallint, is_primary boolean
  )
)
insert into public.parcel_owners (parcel_id, display_name, source_owner_text, sequence_no, is_primary)
select p.id, s.display_name, s.source_owner_text, s.sequence_no, s.is_primary
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
on conflict (parcel_id, sequence_no) do update set
  display_name = excluded.display_name,
  source_owner_text = excluded.source_owner_text,
  is_primary = excluded.is_primary;
"""
    if section == "consents":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text, status text, source_value text
  )
)
insert into public.consent_records (parcel_id, status, source_value)
select p.id, s.status::public.consent_status, s.source_value
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
on conflict (parcel_id) do update set
  status = excluded.status,
  source_value = excluded.source_value,
  received_on = case when excluded.status = 'received'::public.consent_status
    then public.consent_records.received_on else null end;
"""
    if section == "ensure_private_owners":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text
  )
)
insert into public.parcel_owners (parcel_id, display_name, sequence_no, is_primary)
select p.id, 'Owner details restricted', 1, true
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
where not exists (
  select 1 from public.parcel_owners o where o.parcel_id = p.id and o.is_primary
)
on conflict (parcel_id, sequence_no) do nothing;
"""
    if section == "private_details":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text, pan_number text, aadhaar_number text,
    bank_account_number text, bank_name text, ifsc_code text, vendor_code text,
    bank_owner_name text
  )
)
insert into public.owner_private_details (
  owner_id, pan_number, aadhaar_number, bank_account_number, bank_name,
  ifsc_code, vendor_code, bank_owner_name
)
select o.id, s.pan_number, s.aadhaar_number, s.bank_account_number, s.bank_name,
  s.ifsc_code, s.vendor_code, s.bank_owner_name
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
join public.parcel_owners o on o.parcel_id = p.id and o.is_primary
on conflict (owner_id) do update set
  pan_number = excluded.pan_number,
  aadhaar_number = excluded.aadhaar_number,
  bank_account_number = excluded.bank_account_number,
  bank_name = excluded.bank_name,
  ifsc_code = excluded.ifsc_code,
  vendor_code = excluded.vendor_code,
  bank_owner_name = excluded.bank_owner_name;
"""
    if section == "acquisition_cases":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text, project_name text, spv_name text,
    mw numeric, category text, atl_category text, acquisition_purpose text,
    project_duration_months integer, block_name text, target_date date,
    execution_date date, reason_not_acquired text, total_acres_in_rtc numeric,
    total_acres_to_acquire numeric, total_acres_acquired numeric,
    total_sq_meters_acquired numeric, source_fields jsonb
  )
)
insert into public.acquisition_cases (
  parcel_id, project_name, spv_name, mw, category, atl_category,
  acquisition_purpose, project_duration_months, block_name, target_date,
  execution_date, reason_not_acquired, total_acres_in_rtc, total_acres_to_acquire,
  total_acres_acquired, total_sq_meters_acquired, source_fields
)
select p.id, s.project_name, s.spv_name, s.mw, s.category, s.atl_category,
  s.acquisition_purpose, s.project_duration_months, s.block_name, s.target_date,
  s.execution_date, s.reason_not_acquired, s.total_acres_in_rtc,
  s.total_acres_to_acquire, s.total_acres_acquired, s.total_sq_meters_acquired,
  coalesce(s.source_fields, '{{}}'::jsonb)
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
on conflict (parcel_id) do update set
  project_name = excluded.project_name, spv_name = excluded.spv_name, mw = excluded.mw,
  category = excluded.category, atl_category = excluded.atl_category,
  acquisition_purpose = excluded.acquisition_purpose,
  project_duration_months = excluded.project_duration_months,
  block_name = excluded.block_name, target_date = excluded.target_date,
  execution_date = excluded.execution_date, reason_not_acquired = excluded.reason_not_acquired,
  total_acres_in_rtc = excluded.total_acres_in_rtc,
  total_acres_to_acquire = excluded.total_acres_to_acquire,
  total_acres_acquired = excluded.total_acres_acquired,
  total_sq_meters_acquired = excluded.total_sq_meters_acquired,
  source_fields = excluded.source_fields;
"""
    if section == "legal_reviews":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    village_code text, survey_normalized text, public_notice_status text,
    sro_search_status text, documents_required integer, documents_submitted integer,
    law_firm_verification_status text, pending_documents text,
    preliminary_tsr_status text, conditional_clearance_status text, nfa_number text,
    nfa_submitted_on date, nfa_approved_on date, legal_remarks text
  )
)
insert into public.legal_reviews (
  parcel_id, public_notice_status, sro_search_status, documents_required,
  documents_submitted, law_firm_verification_status, pending_documents,
  preliminary_tsr_status, conditional_clearance_status, nfa_number,
  nfa_submitted_on, nfa_approved_on, legal_remarks
)
select p.id, s.public_notice_status, s.sro_search_status, s.documents_required,
  s.documents_submitted, s.law_firm_verification_status, s.pending_documents,
  s.preliminary_tsr_status, s.conditional_clearance_status, s.nfa_number,
  s.nfa_submitted_on, s.nfa_approved_on, s.legal_remarks
from source s
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
on conflict (parcel_id) do update set
  public_notice_status = excluded.public_notice_status,
  sro_search_status = excluded.sro_search_status,
  documents_required = excluded.documents_required,
  documents_submitted = excluded.documents_submitted,
  law_firm_verification_status = excluded.law_firm_verification_status,
  pending_documents = excluded.pending_documents,
  preliminary_tsr_status = excluded.preliminary_tsr_status,
  conditional_clearance_status = excluded.conditional_clearance_status,
  nfa_number = excluded.nfa_number,
  nfa_submitted_on = excluded.nfa_submitted_on,
  nfa_approved_on = excluded.nfa_approved_on,
  legal_remarks = excluded.legal_remarks;
"""
    if section == "map_features":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    feature_key text, svg_element_id text, source_cad_layer text,
    validation_status text
  )
)
insert into public.map_features (feature_key, svg_element_id, source_cad_layer, validation_status)
select feature_key, svg_element_id, source_cad_layer, validation_status from source
on conflict (feature_key) do update set
  svg_element_id = excluded.svg_element_id,
  source_cad_layer = excluded.source_cad_layer,
  validation_status = excluded.validation_status;
"""
    if section == "map_links":
        return f"""
with source as (
  select * from jsonb_to_recordset({source}::jsonb) as x(
    feature_key text, village_code text, survey_normalized text,
    match_method text, match_confidence text, notes text
  )
)
insert into public.parcel_map_features (
  parcel_id, map_feature_id, match_method, match_confidence, notes
)
select p.id, mf.id, s.match_method, s.match_confidence, s.notes
from source s
join public.map_features mf on mf.feature_key = s.feature_key
join public.villages v on v.code = s.village_code
join public.parcels p on p.village_id = v.id and p.survey_number_normalized = s.survey_normalized
on conflict (parcel_id, map_feature_id) do update set
  match_method = excluded.match_method,
  match_confidence = excluded.match_confidence,
  notes = excluded.notes;
"""
    raise ValueError(f"Unsupported section: {section}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--section", choices=SECTIONS, required=True)
    parser.add_argument("--batch", type=int, default=0, help="Zero-based batch number")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--count", action="store_true", help="Print the number of batches instead of SQL")
    args = parser.parse_args()
    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    rows = values(payload, args.section)
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    if args.count:
        print((len(rows) + args.batch_size - 1) // args.batch_size)
        return 0
    start = args.batch * args.batch_size
    batch = rows[start:start + args.batch_size]
    if not batch:
        parser.error("Requested batch is outside the section range")
    print(render(args.section, batch))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
