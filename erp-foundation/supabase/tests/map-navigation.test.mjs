import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {stripTypeScriptTypes} from "node:module";
const source=new URL("../../apps/web/src/map-interactions.ts",import.meta.url);
const code=stripTypeScriptTypes(await readFile(source,"utf8"));
const {zoomBox,clampMapBox,attachMapNavigation}=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
test("scroll zoom keeps the point under the cursor stationary",()=>{
  const initial=[0,0,1000,800];assert.deepEqual(zoomBox(initial,initial,.5,{x:250,y:200}),[125,100,500,400]);
});
test("zoom limits and panning never crop a fitted complete map",()=>{
  const boundary=[50,70,1000,800];assert.deepEqual(zoomBox([100,100,300,240],boundary,10),boundary);
  assert.deepEqual(clampMapBox([-1000,1000,100,80],boundary),[50,790,100,80]);
  const close=zoomBox(boundary,boundary,.0001);assert.equal(close[2],100);const closer=zoomBox(close,boundary,.1);assert.equal(closer[2],25);
});
test("map installs non-passive wheel controls once and preserves ordinary parcel clicks",()=>{
  const events=new Map(),capture=[];let box="0 0 1000 800";
  const root={dataset:{},style:{},setAttribute(k,v){if(k==="viewBox")box=v;},getAttribute(){return box;},addEventListener(k,fn,opt){events.set(k,{fn,opt});},getScreenCTM(){return{inverse:()=>({})};},setPointerCapture(id){capture.push(id);},hasPointerCapture(){return false;}};
  attachMapNavigation(root);assert.deepEqual(events.get("wheel").opt,{passive:false});const before=events.size;attachMapNavigation(root);assert.equal(events.size,before);
  events.get("pointerdown").fn({button:0,pointerId:1,clientX:20,clientY:30});assert.equal(capture.length,0);
});
test("clean CAD asset retains every registered clickable boundary and no external/active content",async()=>{
  const svg=await readFile(new URL("../../apps/web/public/maps/combined-villages-full.svg",import.meta.url),"utf8");
  const ids=JSON.parse(await readFile(new URL("../../scripts/cad-map/registered-map-elements.json",import.meta.url),"utf8"));
  assert.equal(ids.length,990);for(const id of ids)assert.ok(svg.includes(`id="${id}"`));assert.equal((svg.match(/data-survey-boundary="true"/g)||[]).length,990);
  assert.ok(!/<script|<foreignObject|(?:href|onload|onclick)=/i.test(svg));
});
