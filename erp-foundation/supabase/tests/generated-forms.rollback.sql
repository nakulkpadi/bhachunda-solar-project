begin;
create temp table generator_results(test text,passed boolean) on commit drop;
grant select,insert on generator_results to authenticated;
create function pg_temp.assert_draft(test_name text,condition boolean) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'Generator test failed: %',test_name;end if;
insert into generator_results values(test_name,true);end;$$;
create temp table consent_snapshot as select
 (select md5(string_agg(row_to_json(c)::text,',' order by parcel_id)) from public.consent_records c) as consents,
 (select md5(string_agg(row_to_json(m)::text,',' order by feature_key)) from public.map_status_summary m) as colours;
insert into auth.users(id,email,raw_user_meta_data) values
 ('89180000-0000-4000-8000-000000000001','generated-pending@example.invalid','{"full_name":"Generator pending fixture","role":"admin"}'),
 ('89180000-0000-4000-8000-000000000002','generated-editor@example.invalid','{"full_name":"Generator editor fixture"}'),
 ('89180000-0000-4000-8000-000000000003','generated-viewer@example.invalid','{"full_name":"Generator viewer fixture"}');
update public.profiles set role=case id when '89180000-0000-4000-8000-000000000002' then 'editor'::public.app_role else 'viewer'::public.app_role end,is_active=true,approval_status='approved' where id in ('89180000-0000-4000-8000-000000000002','89180000-0000-4000-8000-000000000003');
insert into public.consent_form_drafts(id,parcel_id,fields,created_by,updated_by)
 select '89180000-0000-4000-8000-000000000004',p.id,jsonb_build_object('date','2026-10-08','survey_number',p.survey_number,'khata',coalesce(p.account_number,''),'has',translate(p.hectare_are_sqmt,'૦૧૨૩૪૫૬૭૮૯પ','01234567895'),'village_en',v.name_en,'village_gu',v.name_gu,'taluka',v.taluka,'district',v.district,'mobile','','owners',jsonb_build_array('Generator fixture owner')),'89180000-0000-4000-8000-000000000002','89180000-0000-4000-8000-000000000002'
 from public.parcels p join public.villages v on v.id=p.village_id order by p.id limit 1;
set local role authenticated;
select set_config('request.jwt.claim.sub','89180000-0000-4000-8000-000000000001',true);
select pg_temp.assert_draft('Pending account cannot read generated forms',(select count(*)=0 from public.consent_form_drafts));
select set_config('request.jwt.claim.sub','89180000-0000-4000-8000-000000000003',true);
select pg_temp.assert_draft('Viewer cannot read contact details in generated forms',(select count(*)=0 from public.consent_form_drafts));
select set_config('request.jwt.claim.sub','89180000-0000-4000-8000-000000000002',true);
select pg_temp.assert_draft('Approved editor can read generated forms',(select count(*)=1 from public.consent_form_drafts where id='89180000-0000-4000-8000-000000000004'));
select pg_temp.assert_draft('Clients cannot insert or update drafts directly',not has_table_privilege('authenticated','public.consent_form_drafts','INSERT') and not has_table_privilege('authenticated','public.consent_form_drafts','UPDATE'));
reset role;
do $$ begin
 begin update public.consent_form_drafts set state='received' where id='89180000-0000-4000-8000-000000000004';raise exception 'Received draft accepted';exception when check_violation then null;end;
 begin update public.consent_form_drafts set fields=fields||'{"received_on":"2026-10-08"}'::jsonb where id='89180000-0000-4000-8000-000000000004';raise exception 'Receipt date accepted';exception when check_violation then null;end;
end;$$;
update public.consent_form_drafts set state='archived',revision=revision+1 where id='89180000-0000-4000-8000-000000000004';
select pg_temp.assert_draft('Saving and archiving drafts leaves received consent and every map colour unchanged',(select consents=(select md5(string_agg(row_to_json(c)::text,',' order by parcel_id)) from public.consent_records c) and colours=(select md5(string_agg(row_to_json(m)::text,',' order by feature_key)) from public.map_status_summary m) from consent_snapshot));
select jsonb_agg(to_jsonb(generator_results)) as results from generator_results;
rollback;
