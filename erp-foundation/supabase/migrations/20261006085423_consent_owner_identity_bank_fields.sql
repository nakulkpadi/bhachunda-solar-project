alter table public.owner_private_details
  add column if not exists pan_owner_name text,
  add column if not exists aadhaar_owner_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_account_type text;
alter table public.owner_private_details
  add constraint owner_bank_account_type_allowed check (bank_account_type is null or bank_account_type in ('SB','CA','OD','CC'));
-- Identity and bank rows retain the existing admin-only RLS policies.
-- Reject document links to an owner from a different survey, including direct API writes.
create or replace function private.check_document_owner_survey()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.parcel_owners o where o.id = new.owner_id and o.parcel_id = new.parcel_id
  ) then
    raise exception 'Document owner must belong to the selected survey' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_document_owner_survey before insert or update of owner_id, parcel_id on public.parcel_documents
for each row execute function private.check_document_owner_survey();
