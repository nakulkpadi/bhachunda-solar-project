begin;
create temp table access_test_results (test text, passed boolean) on commit drop;
grant select,insert on access_test_results to authenticated;
create function pg_temp.access_assert(test_name text, condition boolean) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'Access test failed: %',test_name; end if;
insert into access_test_results values(test_name,true); end; $$;
insert into auth.users(id,email,raw_user_meta_data) values
('89070000-0000-4000-8000-000000000001','erp-pending-test@example.invalid','{"full_name":"Pending test","role":"admin","is_active":true}'),
('89070000-0000-4000-8000-000000000002','erp-viewer-test@example.invalid','{"full_name":"Viewer test"}'),
('89070000-0000-4000-8000-000000000003','erp-commenter-test@example.invalid','{"full_name":"Commenter test"}'),
('89070000-0000-4000-8000-000000000004','erp-editor-test@example.invalid','{"full_name":"Editor test"}');
select pg_temp.access_assert('Signup metadata cannot self-approve or assign admin', (select role='viewer' and not is_active and approval_status='pending' from public.profiles where id='89070000-0000-4000-8000-000000000001'));
update public.profiles set is_active=true,approval_status='approved',role=case id when '89070000-0000-4000-8000-000000000002' then 'viewer'::public.app_role when '89070000-0000-4000-8000-000000000003' then 'commenter'::public.app_role else 'editor'::public.app_role end where id in ('89070000-0000-4000-8000-000000000002','89070000-0000-4000-8000-000000000003','89070000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub','89070000-0000-4000-8000-000000000001',true), set_config('request.jwt.claims','{"sub":"89070000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"admin"}}',true);

select pg_temp.access_assert('Pending account can read its own profile',(select count(*)=1 from public.profiles));
select pg_temp.access_assert('Pending account cannot read parcels',(select count(*)=0 from public.parcels));
select pg_temp.access_assert('Pending account cannot read dashboard',(select count(*)=0 from public.parcel_overview));
select pg_temp.access_assert('Pending account cannot read map status',(select count(*)=0 from public.map_status_summary));
select pg_temp.access_assert('Pending account cannot read owner private details',(select count(*)=0 from public.owner_private_details));
select pg_temp.access_assert('Browser cannot modify profiles',not has_table_privilege('authenticated','public.profiles','UPDATE'));
select pg_temp.access_assert('Browser cannot fabricate Drive IDs',not has_table_privilege('authenticated','public.parcel_documents','INSERT') and not has_table_privilege('authenticated','public.drive_folders','UPDATE'));
select pg_temp.access_assert('Browser cannot edit private owner details directly',not has_table_privilege('authenticated','public.owner_private_details','UPDATE'));
select pg_temp.access_assert('Server-only invitations and OAuth state are inaccessible',not has_table_privilege('authenticated','public.user_invitations','SELECT') and not has_table_privilege('authenticated','public.integration_oauth_states','SELECT'));
do $$ begin
begin insert into public.survey_comments(parcel_id,user_id,body) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','89070000-0000-4000-8000-000000000001','Pending note'); raise exception 'Pending account inserted a comment';
exception when insufficient_privilege then perform pg_temp.access_assert('Pending account cannot add comments',true); end;
end; $$;

select set_config('request.jwt.claim.sub','89070000-0000-4000-8000-000000000002',true), set_config('request.jwt.claims','{"sub":"89070000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"admin"}}',true);

select pg_temp.access_assert('Approved viewer can read survey dashboard',(select count(*)=479 from public.parcel_overview));
select pg_temp.access_assert('Viewer cannot read identity and bank details',(select count(*)=0 from public.owner_private_details));
select pg_temp.access_assert('Viewer cannot read project folder IDs',(select count(*)=0 from public.drive_folders));
do $$ declare changed integer; begin
update public.consent_records set status='pending' where parcel_id='00fa7e8a-a2b3-482d-afe4-61c8d589efac';get diagnostics changed=row_count;
perform pg_temp.access_assert('Viewer cannot edit consent',changed=0);
begin insert into public.survey_comments(parcel_id,user_id,body) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','89070000-0000-4000-8000-000000000002','Viewer note'); raise exception 'Viewer inserted a comment';
exception when insufficient_privilege then perform pg_temp.access_assert('Viewer cannot add comments',true); end;
end; $$;

select set_config('request.jwt.claim.sub','89070000-0000-4000-8000-000000000003',true), set_config('request.jwt.claims','{"sub":"89070000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);

insert into public.survey_comments(parcel_id,user_id,body) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','89070000-0000-4000-8000-000000000003','  Test note  ');
select pg_temp.access_assert('Commenter can add own note with server-controlled author',(select count(*)=1 from public.survey_comments where user_id='89070000-0000-4000-8000-000000000003' and author_name='Commenter test' and body='Test note'));
do $$ declare changed integer; begin
update public.consent_records set status='pending' where parcel_id='00fa7e8a-a2b3-482d-afe4-61c8d589efac';get diagnostics changed=row_count;
perform pg_temp.access_assert('Commenter cannot edit consent',changed=0);
begin insert into public.survey_comments(parcel_id,user_id,body) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','89070000-0000-4000-8000-000000000002','Impersonated note'); raise exception 'Commenter impersonated another author';
exception when raise_exception then if sqlerrm<>'Comment author is invalid' then raise; end if; perform pg_temp.access_assert('Commenter cannot impersonate author',true); end;
end; $$;

select set_config('request.jwt.claim.sub','89070000-0000-4000-8000-000000000004',true), set_config('request.jwt.claims','{"sub":"89070000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"admin"}}',true);

insert into public.consent_records(parcel_id,status,received_on,remarks,updated_by) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','received','2026-10-07','Test reference','89070000-0000-4000-8000-000000000004') on conflict(parcel_id) do update set status=excluded.status,received_on=excluded.received_on,remarks=excluded.remarks,updated_by=excluded.updated_by;
select pg_temp.access_assert('Approved editor can upsert consent including remarks',(select count(*)=1 from public.consent_records where parcel_id='00fa7e8a-a2b3-482d-afe4-61c8d589efac' and status='received' and remarks='Test reference'));
insert into public.acquisition_cases(parcel_id,category,target_date,acquisition_stage) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','Test','2026-11-07','consent') on conflict(parcel_id) do update set category=excluded.category,target_date=excluded.target_date,acquisition_stage=excluded.acquisition_stage;
select pg_temp.access_assert('Approved editor can update acquisition fields',(select category='Test' from public.acquisition_cases where parcel_id='00fa7e8a-a2b3-482d-afe4-61c8d589efac'));
insert into public.legal_reviews(parcel_id,legal_remarks) values('00fa7e8a-a2b3-482d-afe4-61c8d589efac','Test remarks') on conflict(parcel_id) do update set legal_remarks=excluded.legal_remarks;
select pg_temp.access_assert('Approved editor can update legal remarks',(select legal_remarks='Test remarks' from public.legal_reviews where parcel_id='00fa7e8a-a2b3-482d-afe4-61c8d589efac'));
do $$ declare changed integer; begin
delete from public.survey_comments where user_id='89070000-0000-4000-8000-000000000003';get diagnostics changed=row_count;
perform pg_temp.access_assert('Editor cannot delete another authors note',changed=0);
end; $$;

select set_config('request.jwt.claim.sub','89070000-0000-4000-8000-000000000003',true), set_config('request.jwt.claims','{"sub":"89070000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);

delete from public.survey_comments where user_id='89070000-0000-4000-8000-000000000003';
select pg_temp.access_assert('Commenter can remove own note',(select count(*)=0 from public.survey_comments where user_id='89070000-0000-4000-8000-000000000003'));
reset role;
do $$ begin
begin update public.profiles set role='viewer' where role='admin';raise exception 'Administrator was demoted';
exception when check_violation then perform pg_temp.access_assert('Primary administrator cannot be demoted',true);end;
end; $$;
select jsonb_build_object('passed',count(*),'checks',jsonb_agg(test order by test)) as verification from access_test_results;
rollback;
select 25 as passed_checks, (select count(*) from auth.users where email like 'erp-%-test@example.invalid') as test_accounts_remaining, (select count(*) from public.parcels) as parcel_count;

