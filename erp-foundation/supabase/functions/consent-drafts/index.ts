import { requireRole } from "../_shared/google-drive-oauth.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { assertDraftRequest, DRAFT_TEMPLATE_VERSION, UUID, validateDraftFields } from "../_shared/generated-consent.ts";

const columns = "id,parcel_id,state,revision,template_version,fields,document_id,created_at,updated_at";
Deno.serve(async request => {
  const headers=corsHeaders(request,"GET, POST, PATCH");
  if (!headers) return json({error:"Origin is not allowed."},403,{});
  if (request.method==="OPTIONS") return new Response("ok",{headers});
  if (!["GET","POST","PATCH"].includes(request.method)) return json({error:"Method not allowed."},405,headers);
  try {
    const {admin,userId}=await requireRole(request,["admin","editor"]);
    if (request.method==="GET") {
      const url=new URL(request.url); const parcel=url.searchParams.get("parcel_id");
      const id=url.searchParams.get("id");
      if ((parcel&&!UUID.test(parcel))||(id&&!UUID.test(id))) return json({error:"Invalid form or survey ID."},400,headers);
      const offset=Number(url.searchParams.get("offset") || 0);
      if (!Number.isInteger(offset)||offset<0||offset>100000) return json({error:"Invalid page."},400,headers);
      let query=admin.from("consent_form_drafts").select(columns).order("updated_at",{ascending:false}).order("id").range(offset,offset+99);
      if (parcel) query=query.eq("parcel_id",parcel);
      if (id) query=query.eq("id",id);
      const {data,error}=await query;
      if (error) throw error;
      return json({drafts:data || [],next_offset:data?.length===100 ? offset+100 : null},200,headers);
    }
    const raw=await request.text();
    if (raw.length>24000) return json({error:"Form is too large."},413,headers);
    let input; let fields;
    try { input=assertDraftRequest(JSON.parse(raw),request.method==="PATCH"); fields=input.fields===undefined ? undefined : validateDraftFields(input.fields); }
    catch(e) { return json({error:e instanceof Error ? e.message : "Invalid form."},400,headers); }
    if (request.method==="POST") {
      const {data:parcel,error}=await admin.from("parcels").select("survey_number,villages!inner(name_en,name_gu)").eq("id",input.parcel_id).maybeSingle();
      if (error) throw error;
      if (!parcel) return json({error:"Survey was not found."},404,headers);
      const village=Array.isArray(parcel.villages)?parcel.villages[0]:parcel.villages;
      if (!fields || fields.survey_number!==parcel.survey_number || fields.village_en!==village.name_en) return json({error:"The form does not match the selected village and survey."},400,headers);
      const row={id:input.id,parcel_id:input.parcel_id,fields,template_version:DRAFT_TEMPLATE_VERSION,created_by:userId,updated_by:userId};
      const {data:created,error:saveError}=await admin.from("consent_form_drafts").insert(row).select(columns).single();
      if (saveError?.code==="23505") return json({error:"This form was already saved. Refresh the draft list before saving again."},409,headers);
      if (saveError) throw saveError;
      return json({draft:created},201,headers);
    }
    const {data:current,error:readError}=await admin.from("consent_form_drafts").select("id,fields,revision,state").eq("id",input.id).maybeSingle();
    if (readError) throw readError;
    if (!current) return json({error:"Draft was not found."},404,headers);
    if (current.revision!==input.revision) return json({error:"Someone changed this draft. Reload it before saving."},409,headers);
    if (fields && (fields.survey_number!==current.fields.survey_number || fields.village_en!==current.fields.village_en)) return json({error:"The village and survey cannot be changed on a saved form."},400,headers);
    const patch={...(fields?{fields,document_id:null}:{}),state:input.state || current.state,revision:current.revision+1,updated_by:userId,updated_at:new Date().toISOString()};
    const {data:updated,error:saveError}=await admin.from("consent_form_drafts").update(patch).eq("id",input.id).eq("revision",input.revision).select(columns).maybeSingle();
    if (saveError) throw saveError;
    if (!updated) return json({error:"Someone changed this draft. Reload it before saving."},409,headers);
    return json({draft:updated},200,headers);
  } catch(e) { const failure=authFailure(e); return json({error:failure.message},failure.status,headers); }
});
