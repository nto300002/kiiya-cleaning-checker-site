import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import CleaningApp from '../app/cleaning-app.tsx';
import {makeWork,todayJst} from '../lib/domain.ts';

test('a new day starts with empty staff fields and preserves entered names on start',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(k:string,v:unknown)=>{restore.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true})};
 for(const k of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent'] as const)expose(k,dom.window[k]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
 let work:any={id:'today',day:todayJst(),ownerId:'staff',revision:1,status:'Draft',data:makeWork('職員'),images:[],reports:[]};const calls:string[]=[];
 expose('fetch',async(url:string,init?:RequestInit)=>{const path=String(url),method=init?.method||'GET';calls.push(method+' '+path);let value:any;
  if(path==='/api/me')value={id:'staff',name:'職員',active:true,role:'field'};
  else if(path==='/api/works'&&method==='GET')value=[];
  else if(path==='/api/works'&&method==='POST')value=work;
  else if(path==='/api/works/today'&&method==='PUT'){work={...work,revision:2,data:JSON.parse(String(init?.body)).data};value=work;}
  else if(path==='/api/works/today/start'){work={...work,revision:3,data:{...work.data,startedAt:new Date().toISOString()}};value=work;}
  else if(path==='/api/works/today')value=work;
  else if(path==='/api/report-delivery-settings')value={setupRequired:false,deliveryEnabled:false};
  else throw Error(path);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 });
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);
 try{await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});
  const input=dom.window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]');assert.ok(input);assert.equal(input.value,'');
  assert.equal(calls.some(x=>x.startsWith('POST /api/works')),false);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,'新しい職員');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
  const start=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.includes('作業を開始する'));assert.ok(start);
  await act(async()=>{start.click();await new Promise(r=>setTimeout(r,10))});
  assert.deepEqual(work.data.staffNames,['新しい職員']);assert.ok(work.data.startedAt);
  assert.match(dom.window.document.querySelector('h1')?.textContent||'',/清掃範囲/);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [k,v] of restore){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k)}}
});

test('a saved previous day remains in history when midnight opens a fresh start screen',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(k:string,v:unknown)=>{restore.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true})};
 for(const k of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent'] as const)expose(k,dom.window[k]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
 const NativeDate=Date;let clock=NativeDate.parse('2026-11-24T14:59:00Z');
 class FakeDate extends NativeDate { constructor(value?:string|number){super(value===undefined?clock:value)} static now(){return clock} }
 expose('Date',FakeDate);let timer:()=>void=()=>{};
 dom.window.setInterval=((fn:TimerHandler)=>{if(typeof fn==='function')timer=fn as ()=>void;return 1}) as typeof dom.window.setInterval;
 dom.window.clearInterval=()=>{};
 const data=makeWork('職員');data.startedAt='2026-11-24T00:00:00Z';data.staffNames=['前日のスタッフ'];
 const work={id:'old',day:'2026-11-24',ownerId:'staff',revision:1,status:'Started',data,images:[],reports:[]};const calls:string[]=[];
 expose('fetch',async(url:string,init?:RequestInit)=>{const path=String(url),method=init?.method||'GET';calls.push(method+' '+path);let value:any;
  if(path==='/api/me')value={id:'staff',name:'職員',active:true,role:'field'};
  else if(path==='/api/works')value=[{id:'old',day:'2026-11-24',owner_id:'staff',status:'Started'}];
  else if(path==='/api/works/old')value=work;
  else if(path==='/api/report-delivery-settings')value={setupRequired:false,deliveryEnabled:false};
  else throw Error(path);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 });
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);
 try{await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});
  assert.match(dom.window.document.querySelector('h1')?.textContent||'',/清掃チェック/);
  clock=NativeDate.parse('2026-11-24T15:00:01Z');await act(async()=>{timer();await new Promise(r=>setTimeout(r,0))});
  assert.match(dom.window.document.body.textContent||'',/2026-11-25/);
  const input=dom.window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]');assert.ok(input);assert.equal(input.value,'');
  assert.equal(calls.some(x=>x.startsWith('PUT ')||x.startsWith('DELETE ')),false);
  const menu=dom.window.document.querySelector<HTMLDetailsElement>('.header-menu')!;menu.open=true;
  const history=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.includes('履歴'))!;
  await act(async()=>{history.click();await new Promise(r=>setTimeout(r,0))});
  assert.match(dom.window.document.body.textContent||'',/2026-11-24/);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [k,v] of restore){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k)}}
});
