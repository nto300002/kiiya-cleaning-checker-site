import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import CleaningApp from '../app/cleaning-app.tsx';
import {makeWork,todayJst} from '../lib/domain.ts';

test('closing the confirmation during a delayed refresh keeps it closed when the response arrives', async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
 const restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(key:string,value:unknown)=>{restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})};
 for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent'] as const)expose(key,dom.window[key]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);
 dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
 const data=makeWork('職員');data.startedAt='2026-11-03T00:00:00Z';data.staffNames=['テスト'];data.breakAnswer='no';data.toiletTarget=0;data.showerTarget=0;
 for(const task of Object.values(data.tasks)){task.completed=true;task.assignees=['テスト'];task.startedAt='09:00';task.finishedAt='09:01'}
 const work={id:'work',day:todayJst(),ownerId:'staff',revision:1,status:'Started',data,images:[],reports:[]};
 const candidate={id:'candidate',body:'試験報告',format:'markdown',imageIds:[],workRevision:1,stale:false,confirmed:false};
 let calls=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});const requests:string[]=[];
 expose('fetch',async(url:string,init?:RequestInit)=>{
  const path=String(url);requests.push(`${init?.method||'GET'} ${path}`);
  let value:unknown;
  if(path==='/api/me')value={id:'staff',name:'職員',active:true,role:'field'};
  else if(path==='/api/works'&&init?.method==='POST')value=work;
  else if(path==='/api/works')value=[];
  else if(path==='/api/report-delivery-settings')value={setupRequired:false,deliveryEnabled:false};
  else if(path==='/api/works/work')value=work;
  else if(path==='/api/works/work/preview')value={ready:true,missing:[],body:'試験報告'};
  else if(path==='/api/works/work/report-candidate') {calls++;if(calls===3)await pending;value={candidate,epoch:0};}
  else throw new Error(`unexpected request ${path}`);
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 });
 const root=createRoot(dom.window.document.getElementById('root')!);
 const click=async(label:string)=>{const node=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);assert.ok(node,`button ${label} exists`);assert.equal(node.disabled,false,`${label} is enabled`);await act(async()=>{node.click();await new Promise(r=>setTimeout(r,0))})};
 try{
  await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});
  await click('本日の作業を作成');await click('報告内容へ →');await click('報告');
  assert.equal(calls,3);assert.ok(dom.window.document.querySelector('[role="dialog"]'));
  await click('閉じる');assert.equal(Boolean(dom.window.document.querySelector('[role="dialog"]')),false);
  await act(async()=>{release();await new Promise(r=>setTimeout(r,0))});
  assert.equal(Boolean(dom.window.document.querySelector('[role="dialog"]')),false);
  assert.equal(requests.some(path=>path.includes('/trial/register')),false,'closing does not start delivery');
  await click('報告');assert.ok(dom.window.document.querySelector('[role="dialog"]'),'the user can open confirmation again');
 } finally {await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of restore){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}}
});
