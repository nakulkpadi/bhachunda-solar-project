import { requireRole } from "../_shared/google-drive-oauth.ts";
import { authFailure, corsHeaders, json } from "../_shared/consent-http.ts";
import { validateDraftFields } from "../_shared/generated-consent.ts";
Deno.serve(async request => {
  const headers=corsHeaders(request,"GET");if(!headers)return json({error:"Origin is not allowed."},403,{});
  if(request.method==="OPTIONS")return new Response("ok",{headers});
  if(request.method!=="GET")return json({error:"Method not allowed."},405,headers);
  try {
    await requireRole(request,["admin","editor"]);
    const response=await fetch("https://bhachunda-solar-default-rtdb.asia-southeast1.firebasedatabase.app/consent-forms.json",{signal:AbortSignal.timeout(15000),headers:{Accept:"application/json"},cache:"no-store"});
    if(!response.ok)return json({error:"Earlier Firebase forms are unavailable. No records were changed. Check the old generator or ask the administrator to export its history."},502,headers);
    if(Number(response.headers.get("content-length"))>8000000)return json({error:"Earlier history is too large to load safely."},502,headers);
    const reader=response.body?.getReader();if(!reader)throw new Error("Empty history response");const chunks:Uint8Array[]=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000000){await reader.cancel();throw new Error("History is too large")};chunks.push(value)}}finally{reader.releaseLock()}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(data===null)return json({records:[]},200,headers);
    if(typeof data!=="object"||Array.isArray(data)||Object.keys(data).length>2000)throw new Error("Invalid history response");
    const text=(v:unknown,max=200)=>typeof v==="string"||typeof v==="number"?String(v).trim().slice(0,max):"";
    const records=Object.entries(data).filter(([,v])=>v&&typeof v==="object"&&!Array.isArray(v)).map(([id,v])=>{
      const old=v as Record<string,unknown>;let fields=null;
      try {fields=validateDraftFields({date:text(old.dateGenerated,10),survey_number:text(old.surveyNo,80),khata:text(old.khataNo,80),has:text(old.has,20),village_en:text(old.villageEn,100),village_gu:text(old.villageGu,100),taluka:text(old.taluka,100),district:text(old.district,100),mobile:text(old.mobile,20),owners:old.owners})}catch{ /* Incomplete old records remain visible; they cannot be silently imported. */ }
      return {id:text(id),survey_number:text(old.surveyNo,80),village_en:text(old.villageEn,100),date:text(old.dateGenerated,20),first_owner:text(old.firstOwner)||text(Array.isArray(old.owners)?old.owners[0]:""),status:old.status==="sent"?"sent":old.status==="received"?"received":"missing",fields};
    });
    return json({records},200,headers);
  }catch(e){const f=authFailure(e);return json({error:f.message},f.status,headers)}
});
