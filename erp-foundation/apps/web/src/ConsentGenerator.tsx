import { useEffect, useMemo, useRef, useState } from "react";
import { loadConsentFormDrafts, loadParcelDetail, saveConsentFormDraft, uploadConsentFormDraftPdf } from "./api";
import { areaFromHas, normalizeHas, validateDraftFields, type ConsentFormDraft, type ConsentFormFields } from "../../../shared/consent-draft";
import type { ParcelDetail, ParcelSummary } from "./types";
import { SurveyPicker } from "./ui";
import { csvValue } from "./csv-export";
import { consentPrintHtml } from "./consent-print";

const localDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const villageGujarati:Record<string,string>={bhavanipar:"ભવાનીપર",bitta:"બીટા","vandh-timbo":"વાંઢ ટીંબો"};
function prefill(p:ParcelDetail):ConsentFormFields {
  if(!p.village)throw new Error("This survey has no linked village. Ask the administrator to check the master record.");
  return { date:localDate(),survey_number:p.survey_number,khata:p.account_number || "",has:normalizeHas(p.hectare_are_sqmt || ""),village_en:p.village.name_en,village_gu:p.village.name_gu || villageGujarati[p.village.code] || "",taluka:p.village.taluka || "Abdasa",district:p.village.district || "Kutch",mobile:"",owners:p.owners.length ? p.owners.map(o=>o.display_name) : [""] };
}
export function ConsentGenerator({rows,canEdit}:{rows:ParcelSummary[];canEdit:boolean}) {
  const [selectedId,setSelectedId]=useState(rows[0]?.id || "");
  const [fields,setFields]=useState<ConsentFormFields|null>(null);
  const [baseline,setBaseline]=useState<ConsentFormFields|null>(null);
  const [saved,setSaved]=useState<ConsentFormDraft|null>(null);
  const [formId,setFormId]=useState<string>(()=>crypto.randomUUID());
  const [list,setList]=useState<ConsentFormDraft[]>([]);
  const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");const [error,setError]=useState("");
  const [search,setSearch]=useState("");const [preview,setPreview]=useState<ConsentFormDraft|null>(null);
  const frame=useRef<HTMLIFrameElement>(null);const upload=useRef<HTMLInputElement>(null);
  const generation=useRef(0);const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[]);
  const selected=rows.find(p=>p.id===selectedId) || rows[0];
  const dirty=!!fields && JSON.stringify(saved?.fields || baseline)!==JSON.stringify(fields);
  const filtered=list.filter(d=>`${d.fields.village_en} ${d.fields.survey_number} ${d.fields.owners.join(' ')} ${d.fields.mobile}`.toLowerCase().includes(search.toLowerCase()));
  const area=useMemo(()=>{try{return fields ? areaFromHas(fields.has) : null}catch{return null}},[fields?.has]);
  const refresh=async()=>{const drafts=await loadConsentFormDrafts();if(alive.current)setList(drafts)};
  useEffect(()=>{if(!canEdit)return;let cancelled=false;loadConsentFormDrafts().then(d=>{if(!cancelled)setList(d)}).catch(e=>{if(!cancelled)setError(e.message)});const timer=setInterval(()=>{loadConsentFormDrafts().then(d=>{if(!cancelled)setList(d)}).catch(()=>{})},15000);return()=>{cancelled=true;clearInterval(timer)}},[canEdit]);
  const choose=async(id:string)=>{
    const request=++generation.current;setSelectedId(id);setSaved(null);setFields(null);setBaseline(null);setFormId(crypto.randomUUID());setPreview(null);setLoading(true);setError("");setMessage("");
    try{const p=await loadParcelDetail(id);if(alive.current&&request===generation.current){const f=prefill(p);setFields(f);setBaseline(f)}}catch(e){if(alive.current&&request===generation.current)setError(e instanceof Error?e.message:"Could not prefill the form.")}finally{if(alive.current&&request===generation.current)setLoading(false)}
  };
  useEffect(()=>{if(canEdit&&selectedId)void choose(selectedId)},[canEdit]);
  const patch=(key:keyof ConsentFormFields,value:string|string[])=>setFields(f=>f?{...f,[key]:value}:f);
  const selectSurvey=(id:string)=>{if(!dirty||window.confirm("Discard the unsaved form changes and select another survey?"))void choose(id)};
  const run=async(task:()=>Promise<void>)=>{setBusy(true);setError("");setMessage("");try{await task()}catch(e){if(alive.current)setError(e instanceof Error?e.message:"The action failed.")}finally{if(alive.current)setBusy(false)}};
  const save=()=>run(async()=>{
    const clean=validateDraftFields(fields);if(!selected)throw new Error("Choose a survey.");
    const draft=await saveConsentFormDraft(saved?{id:saved.id,revision:saved.revision,fields:clean}:{id:formId,parcel_id:selected.id,fields:clean});
    if(!alive.current)return;setFields(draft.fields);setSaved(draft);setMessage("Draft saved. Owner consent has not been recorded.");await refresh();
  });
  const edit=(draft:ConsentFormDraft)=>{if(dirty&&!window.confirm("Discard the unsaved changes and open this saved form?"))return;generation.current++;setSelectedId(draft.parcel_id);setSaved(draft);setFields(draft.fields);setFormId(draft.id);setPreview(null);setLoading(false);setError("");setMessage("")};
  const archive=(draft:ConsentFormDraft)=>run(async()=>{const updated=await saveConsentFormDraft({id:draft.id,revision:draft.revision,state:draft.state==="draft"?"archived":"draft"});if(saved?.id===draft.id)setSaved(updated);await refresh();setMessage("Draft list updated. Received consent is unchanged.")});
  const exportList=()=>{
    const csv="\uFEFF"+[["Draft ID","Village","Survey","Form date","Owner","Mobile","Form state","Revision"],...filtered.map(d=>[d.id,d.fields.village_en,d.fields.survey_number,d.fields.date,d.fields.owners.join('; '),d.fields.mobile,d.state,d.revision])].map(row=>row.map(csvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement('a');a.href=url;a.download="Generated-consent-forms.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  if(!canEdit)return <section className="panel"><h2>Consent generator</h2><p>An approved Administrator or Editor account and a live connection are required to access generated forms.</p></section>;
  return <div className="generator-workspace">
    <div className="draft-explainer"><span className="draft-label">Unsigned forms</span><p>Prepare forms for the owner to sign. Saving, printing or uploading a generated form does not record consent received.</p></div>
    {error&&<p role="alert" className="generator-error">{error}</p>}{message&&<p role="status" className="generator-message">{message}</p>}
    <section className="panel generator-form"><div className="section-heading"><div><h2>{saved?"Edit generated form":"Generate a consent form"}</h2><p>{saved?`Saved ${saved.state} · revision ${saved.revision}`:"Choose a survey to prefill the land and owner details."}</p></div>{saved&&<button className="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm("Discard unsaved edits and create another form?"))void choose(selectedId)}}>New form</button>}</div>
      {selected&&<SurveyPicker rows={rows} selectedParcel={selected} onSelect={selectSurvey} disabled={busy||loading||!!saved}/>}
      {loading&&<p role="status">Loading survey details…</p>}
      {fields&&<form onSubmit={e=>{e.preventDefault();void save()}}><div className="generator-grid">
        <label>Form date<input type="date" required value={fields.date} disabled={busy} onChange={e=>patch('date',e.target.value)}/></label>
        <label>Khata number<input value={fields.khata} maxLength={80} disabled={busy} onChange={e=>patch('khata',e.target.value)}/></label>
        <label>H.Are.Sq.Mt.<input required value={fields.has} placeholder="1.60.57" maxLength={20} disabled={busy} onChange={e=>patch('has',e.target.value)}/></label>
        <label>Acres / Guntha<input readOnly value={area?`${area.acres} acres · ${area.guntha} guntha`:"Enter a valid H.Are.Sq.Mt. area"}/></label>
        <label>Village — Gujarati<input required value={fields.village_gu} maxLength={100} disabled={busy} onChange={e=>patch('village_gu',e.target.value)}/></label>
        <label>Taluka<input required value={fields.taluka} maxLength={100} disabled={busy} onChange={e=>patch('taluka',e.target.value)}/></label>
        <label>District<input required value={fields.district} maxLength={100} disabled={busy} onChange={e=>patch('district',e.target.value)}/></label>
        <label>Contact mobile<input type="tel" value={fields.mobile} maxLength={20} disabled={busy} onChange={e=>patch('mobile',e.target.value)} autoComplete="off"/></label>
      </div><fieldset className="generator-owners"><legend>7/12 owner names / જમીન માલિકો</legend>{fields.owners.map((name,i)=><div className="generator-owner" key={i}><label><span>Owner {i+1}</span><input required value={name} maxLength={200} disabled={busy} onChange={e=>patch('owners',fields.owners.map((n,j)=>j===i?e.target.value:n))}/></label><button type="button" className="button" disabled={busy||fields.owners.length===1} onClick={()=>patch('owners',fields.owners.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" className="button" disabled={busy||fields.owners.length>=50} onClick={()=>patch('owners',[...fields.owners,""])}>Add owner</button></fieldset>
        <div className="generator-actions"><button className="button button-primary" disabled={busy||!area||saved?.state==="archived"}>{busy?"Saving…":"Save draft"}</button><button type="button" className="button" disabled={!saved||dirty||busy} onClick={()=>setPreview(saved)}>Preview & print</button><button type="button" className="button" disabled={!saved||dirty||busy||saved.state!=="draft"} onClick={()=>upload.current?.click()}>Upload draft PDF to Drive</button></div>
        <p className="field-hint">Save the form before printing. In the print dialog, choose “Save as PDF”. Upload that unsigned PDF here if you want a Drive copy.</p>
        {saved?.document_id&&<p className="field-hint">A draft PDF is linked in Documents as “Generated consent form (unsigned draft)”.</p>}
      </form>}
      <input ref={upload} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f&&saved)void run(async()=>{await uploadConsentFormDraftPdf(saved,f);await refresh();setMessage("Unsigned draft PDF saved to Drive. Consent status is unchanged.")})}}/>
    </section>
    <section className="panel"><div className="section-heading"><div><h2>Generated forms</h2><p>{list.length} saved forms · separate from received consent</p></div><div className="generator-actions"><button className="button" disabled={busy} onClick={()=>void run(refresh)}>Refresh</button><button className="button" disabled={!filtered.length} onClick={exportList}>Export list</button></div></div><label>Search village, survey or owner<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search generated forms"/></label>
      <div className="table-wrap"><table><thead><tr><th>Village / survey</th><th>Form date</th><th>First owner</th><th>Form state</th><th>Actions</th></tr></thead><tbody>{filtered.map(d=><tr key={d.id}><td>{d.fields.village_en}<br/><strong>{d.fields.survey_number}</strong></td><td>{d.fields.date}</td><td>{d.fields.owners[0]}</td><td><span className="draft-label">{d.state==="draft"?"Unsigned draft":"Archived"}</span></td><td><div className="generator-actions"><button className="button" disabled={busy} onClick={()=>edit(d)}>Open</button><button className="button" disabled={busy} onClick={()=>setPreview(d)}>Print</button><button className="button" disabled={busy} onClick={()=>void archive(d)}>{d.state==="draft"?"Archive":"Restore"}</button></div></td></tr>)}</tbody></table>{!filtered.length&&<p className="empty-state">No generated forms match this search.</p>}</div>
    </section>
    {preview&&<div className="generator-modal" role="dialog" aria-modal="true" aria-label="Unsigned form preview"><div className="generator-preview"><div className="generator-preview-bar"><div><strong>Unsigned generated form</strong><p>Owner signature and verification pending</p></div><button className="button button-primary" onClick={()=>frame.current?.contentWindow?.print()}>Print / save PDF</button><button className="button" onClick={()=>setPreview(null)}>Close</button></div><iframe ref={frame} title="English and Gujarati generated consent form" sandbox="allow-same-origin allow-modals" srcDoc={consentPrintHtml(preview)}/></div></div>}
  </div>;
}
