import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const id='10000000-0000-4000-8000-000000000001';
const parcel='20000000-0000-4000-8000-000000000001';
const fields={date:'2026-10-08',survey_number:'12/1',khata:'0009',has:'1.60.57',village_en:'Bitta',village_gu:'બીટા',taluka:'Abdasa',district:'Kutch',mobile:'',owners:['નમૂના માલિક']};
const initial={id,parcel_id:parcel,state:'draft',revision:1,template_version:'bnpl-consent-v1',fields,document_id:null};
async function harness(config={}) {
  const state={role:'admin',active:true,approval:'approved',row:null,writes:[],...config};let handler;
  const admin={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'actor'}:null},error:null})},from(table){
    let op='select',values,filters={};const q={select(){return q},order(){return q},range(){return q},eq(k,v){filters[k]=v;return q},insert(v){op='insert';values=v;return q},update(v){op='update';values=v;return q},maybeSingle:async()=>run(true),single:async()=>run(true),then(a,b){return Promise.resolve(run(false)).then(a,b)}};
    function run(single){
      if(table==='profiles')return{data:{role:state.role,is_active:state.active,approval_status:state.approval},error:null};
      if(table==='parcels')return{data:{survey_number:'12/1',villages:{name_en:'Bitta',name_gu:'બીટા'}},error:null};
      if(op!=='select')state.writes.push({table,op,values});
      if(table!=='consent_form_drafts')throw Error('Unexpected table: '+table);
      if(op==='insert'){if(state.duplicate)return{data:null,error:{code:'23505'}};state.row={...initial,...values};return{data:state.row,error:null}}
      if(op==='update'){if(state.saveConflict)return{data:null,error:null};state.row={...state.row,...values};return{data:state.row,error:null}}
      return{data:single?state.row:state.row?[state.row]:[],error:null};
    }return q;
  }};
  const context=vm.createContext({Error,Request,Response,URL,TextEncoder,Uint8Array,crypto,Date,JSON,Deno:{env:{get:k=>({ALLOWED_ORIGIN:'https://nakulkpadi.github.io',SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'})[k]},serve:fn=>{handler=fn}}});
  const sdk=new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',()=>admin)},{context});
  const cache=new Map();
  async function load(path){
    if(!path.endsWith('.ts')&&!path.endsWith('.json'))path+='.ts';
    if(cache.has(path))return cache.get(path);
    if(path.endsWith('.json')){const data=JSON.parse(await readFile(path,'utf8'));const m=new vm.SyntheticModule(['default'],function(){this.setExport('default',data)},{context});cache.set(path,m);return m}
    const m=new vm.SourceTextModule(stripTypeScriptTypes(await readFile(path,'utf8'),{mode:'strip'}),{context,identifier:path});cache.set(path,m);await m.link((s,p)=>s.startsWith('npm:')?sdk:load(resolve(dirname(p.identifier),s)));return m;
  }
  const module=await load(resolve(root,'supabase/functions/consent-drafts/index.ts'));await module.evaluate();
  const print=await load(resolve(root,'apps/web/src/consent-print.ts'));await print.evaluate();
  const schema=cache.get(resolve(root,'shared/consent-draft.ts'));
  return {state,handler,print:print.namespace.consentPrintHtml,area:schema.namespace.areaFromHas,validate:schema.namespace.validateDraftFields};
}
const request=(body={id,parcel_id:parcel,fields},method='POST',token='valid',origin='https://nakulkpadi.github.io')=>new Request('https://project.invalid/functions/v1/consent-drafts',{method,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
test('create and edit generated forms only write drafts; printing is read-only',async()=>{
  const h=await harness();assert.equal((await h.handler(request())).status,201);assert.equal(h.state.row.state,'draft');
  assert.equal((await h.handler(request({id,revision:1,fields:{...fields,khata:'0010'}},'PATCH'))).status,200);assert.equal(h.state.row.revision,2);
  const before=h.state.writes.length;const html=h.print(h.state.row);assert.doesNotMatch(html,/Unsigned generated form|Owner signature and verification pending|<footer/);assert.match(html,/0010/);assert.equal(h.state.writes.length,before);
  assert.ok(h.state.writes.every(w=>w.table==='consent_form_drafts'));assert.equal(Object.hasOwn(h.state.row,'received_on'),false);
});
test('generated requests reject received status, receipt dates and changing survey identity',async()=>{
  for(const body of [{id,parcel_id:parcel,fields,status:'received'},{id,parcel_id:parcel,fields,received_on:'2026-10-08'},{id,parcel_id:parcel,fields:{...fields,consent_status:'received'}},{id,parcel_id:parcel,fields:{...fields,village_en:'Bhavanipar'}}]){const h=await harness();assert.equal((await h.handler(request(body))).status,400);assert.equal(h.state.writes.length,0)}
  const h=await harness({row:initial});assert.equal((await h.handler(request({id,revision:1,state:'received'},'PATCH'))).status,400);assert.equal((await h.handler(request({id,revision:1,fields:{...fields,survey_number:'99'}},'PATCH'))).status,400);
});
test('approved editor can generate; viewers, commenters and all unapproved accounts cannot read or write private forms',async()=>{
  assert.equal((await (await harness({role:'editor'})).handler(request())).status,201);
  for(const config of [{role:'viewer'},{role:'commenter'},{role:'editor',approval:'pending'},{approval:'suspended'},{active:false}]){const h=await harness(config);for(const method of ['GET','POST','PATCH'])assert.equal((await h.handler(request(undefined,method))).status,403);assert.equal(h.state.writes.length,0)}
  const h=await harness();assert.equal((await h.handler(request(undefined,'GET','forged'))).status,401);assert.equal((await h.handler(request(undefined,'POST','valid','https://evil.invalid'))).status,403);
});
test('stale revisions and duplicate retry IDs fail without overwrite; archive never receives consent',async()=>{
  const h=await harness({row:initial});assert.equal((await h.handler(request({id,revision:9,fields},'PATCH'))).status,409);assert.equal(h.state.writes.length,0);
  const conflict=await harness({row:initial,saveConflict:true});assert.equal((await conflict.handler(request({id,revision:1,fields},'PATCH'))).status,409);
  const retry=await harness({duplicate:true});assert.equal((await retry.handler(request())).status,409);
  assert.equal((await h.handler(request({id,revision:1,state:'archived'},'PATCH'))).status,200);assert.equal(h.state.row.state,'archived');assert.ok(h.state.writes.every(w=>w.table==='consent_form_drafts'));
});
test('area validation carries rounded 40 guntha into next acre and rejects malformed input',async()=>{
  const h=await harness();const a=h.area('0.40.46');assert.equal(a.acres,1);assert.equal(a.guntha,0);assert.equal(h.area('1.60.57').guntha,39);
  assert.equal(h.area('૧-પ૬-૮૭').sqm,15687);assert.equal(h.validate({...fields,has:'૨-૮૪-૦પ'}).has,'2-84-05');
  for(const s of ['0.00.00','1.100.00','1.2','-1.00.00','1e3.10.01'])assert.throws(()=>h.area(s));
  assert.throws(()=>h.validate({...fields,date:'2026-02-30'}));assert.throws(()=>h.validate({...fields,owners:['']}));
});
test('print output escapes owner values, retains Gujarati, and paginates long owners without hidden overflow',async()=>{
  const h=await harness();const attack='<img src=x onerror=alert(1)> {{survey_number}}';const html=h.print({...initial,fields:{...fields,owners:[attack,...Array(49).fill('પરીક્ષણ માલિક')]}});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('{{survey_number}}'));assert.ok(html.includes('પરીક્ષણ માલિક'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('firebase'));assert.ok(!html.includes('height:297mm'));assert.ok(!html.includes('overflow:hidden'));assert.equal((html.match(/પરીક્ષણ માલિક/g)||[]).length,98);
});
