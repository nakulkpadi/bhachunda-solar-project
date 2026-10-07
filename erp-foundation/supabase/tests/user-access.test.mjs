import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../functions");
const origin="https://nakulkpadi.github.io";
const actor="40000000-0000-4000-8000-000000000001",target="40000000-0000-4000-8000-000000000002",invited="40000000-0000-4000-8000-000000000003";
async function fixture(overrides={}) {
  const state={role:"admin",active:true,approval:"approved",writes:[],emails:[],attempts:0,...overrides};
  const users=[{id:actor,email:"admin@example.invalid",role:state.role,is_active:state.active,approval_status:state.approval},{id:target,email:"member@example.invalid",role:"viewer",is_active:false,approval_status:"pending"}];
  const admin={auth:{getUser:async token=>({data:{user:token==="valid-token"?{id:actor}:null},error:null}),admin:{inviteUserByEmail:async(email,options)=>{state.emails.push({email,options});if(state.emailFailure)return{data:{user:null},error:{code:"email_send_failed"}};users.push({id:invited,email,role:"viewer",is_active:false,approval_status:"pending"});return{data:{user:{id:invited}},error:null};}}},from(table){let operation="select",values,filters={},head=false;const run=single=>{
    if(operation!=="select")state.writes.push({table,operation,values,filters:{...filters}});
    if(table==="profiles") { if(operation==="update"){Object.assign(users.find(u=>u.id===filters.id)||{},values);return{data:null,error:null};}const rows=users.filter(u=>Object.entries(filters).every(([k,v])=>u[k]===v));return{data:single?rows[0]||null:rows,error:null}; }
    if(table==="user_invitations")return{data:operation==="insert"?{id:"attempt-id"}:null,error:null,count:head?state.attempts:undefined};
    return{data:null,error:null};
  };const query={select(_cols,options){head=Boolean(options?.head);return query;},eq(k,v){filters[k]=v;return query;},gte(){return query;},order(){return query;},limit(){return query;},insert(v){operation="insert";values=v;return query;},update(v){operation="update";values=v;return query;},maybeSingle:async()=>run(true),single:async()=>run(true),then(a,b){return Promise.resolve(run(false)).then(a,b);}};return query;}};
  let handler;const context=vm.createContext({Error,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,crypto,btoa,atob,Date,Set,
    Deno:{env:{get:key=>({ALLOWED_ORIGIN:origin,SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"server-only-test-key"})[key]},serve:fn=>{handler=fn;}}});
  const sdk=new vm.SyntheticModule(["createClient"],function(){this.setExport("createClient",()=>admin);},{context});
  const modules=new Map();async function load(path){if(modules.has(path))return modules.get(path);const module=new vm.SourceTextModule(stripTypeScriptTypes(await readFile(path,"utf8")),{context,identifier:path});modules.set(path,module);await module.link(async(spec,ref)=>spec.startsWith("npm:")?sdk:load(resolve(dirname(ref.identifier),spec)));return module;}
  const entry=await load(resolve(root,"manage-users/index.ts"));await entry.evaluate();
  return{state,users,handler,requireRole:modules.get(resolve(root,"_shared/google-drive-oauth.ts")).namespace.requireRole};
}
const request=(body,extra={})=>new Request("https://example.supabase.co/functions/v1/manage-users",{method:"POST",headers:{Origin:origin,Authorization:"Bearer valid-token","Content-Type":"application/json",...extra},body:JSON.stringify(body)});

test("real role helper rejects pending, rejected and suspended accounts even with active=true",async()=>{
  for(const approval of ["pending","rejected","suspended",undefined]){const f=await fixture({role:"viewer",active:true,approval});await assert.rejects(f.requireRole(request({}),["viewer"]),/Your role/);}
});
test("real role helper rejects forged/expired sessions and verifies current database approval",async()=>{
  const f=await fixture();await assert.rejects(f.requireRole(request({}, {Authorization:"Bearer forged-token"}),["admin"]),/Authentication/);
  f.users[0].approval_status="suspended";await assert.rejects(f.requireRole(request({}),["admin"]),/Your role/);
});
test("editor, commenter, viewer and inactive admin cannot enumerate or approve accounts",async()=>{
  for(const role of ["editor","commenter","viewer"]){const f=await fixture({role});assert.equal((await f.handler(request({action:"approve",user_id:target,role:"editor"}))).status,403);assert.equal(f.state.writes.length,0);}
  const f=await fixture({active:false});assert.equal((await f.handler(request({action:"invite",email:"member@example.invalid",role:"viewer"}))).status,403);
});
test("approved admin can approve with an explicit role; untrusted metadata is ignored",async()=>{
  const f=await fixture();const r=await f.handler(request({action:"approve",user_id:target,role:"editor",is_active:false,approval_status:"rejected",approved_by:target}));assert.equal(r.status,200);
  const user=f.users.find(u=>u.id===target);assert.equal(user.role,"editor");assert.equal(user.is_active,true);assert.equal(user.approval_status,"approved");assert.equal(user.approved_by,actor);
});
test("admin role and primary administrator cannot be assigned, disabled or demoted",async()=>{
  const f=await fixture();assert.equal((await f.handler(request({action:"approve",user_id:target,role:"admin"}))).status,400);assert.equal((await f.handler(request({action:"suspend",user_id:actor,role:"viewer"}))).status,403);assert.equal(f.state.writes.length,0);
});
test("invitations dispatch to the fixed ERP URL and remain pending until approved",async()=>{
  const f=await fixture();const r=await f.handler(request({action:"invite",email:" New@Example.Invalid ",role:"commenter",full_name:"New member",redirectTo:"https://untrusted.example",approval_status:"approved"}));assert.equal(r.status,201);
  assert.equal(f.state.emails[0].email,"new@example.invalid");assert.equal(f.state.emails[0].options.redirectTo,"https://nakulkpadi.github.io/bhachunda-solar-project/index.html");assert.equal(f.users.find(u=>u.id===invited).approval_status,"pending");assert.equal(f.users.find(u=>u.id===invited).is_active,false);
});
test("failed emails and invitation limits never activate a user",async()=>{
  const f=await fixture({emailFailure:true});assert.equal((await f.handler(request({action:"invite",email:"new@example.invalid",role:"viewer"}))).status,502);assert.ok(f.state.writes.some(w=>w.table==="user_invitations"&&w.values.status==="failed"));
  const limited=await fixture({attempts:20});assert.equal((await limited.handler(request({action:"invite",email:"new@example.invalid",role:"viewer"}))).status,429);assert.equal(limited.state.emails.length,0);
});
test("account API rejects foreign origins, malformed payloads and duplicate accounts",async()=>{
  const f=await fixture();assert.equal((await f.handler(request({}, {Origin:"https://untrusted.example"}))).status,403);assert.equal((await f.handler(request({action:"invite",email:"member@example.invalid",role:"viewer"}))).status,409);assert.equal((await f.handler(request({action:"invite",email:"bad",role:"viewer"}))).status,400);assert.equal(f.state.emails.length,0);
});
