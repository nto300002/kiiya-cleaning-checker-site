import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import CleaningApp from '../app/cleaning-app.tsx';
import {makeWork,todayJst} from '../lib/domain.ts';

test('a staff member can confirm and send without waiting for an operator', async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
 const restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(key:string,value:unknown)=>{restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})};
 for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent'] as const)expose(key,dom.window[key]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);
 dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
 const data=makeWork('職員');data.startedAt='2026-11-03T00:00:00Z';data.staffNames=['テスト'];data.breakAnswer='no';data.toiletTarget=0;data.showerTarget=0;
 for(const task of Object.values(data.tasks)){task.completed=true;task.assignees=['テスト'];task.startedAt='09:00';task.finishedAt='09:01'}
 const work={id:'work',day:todayJst(),ownerId:'staff',revision:1,status:'Started',data,images:[],reports:[]};
 const candidate={id:'candidate',body:'試験報告',imageIds:[],workRevision:1,stale:false,confirmed:false};
 let reserved=false,prepared=false;const requests:string[]=[];
 expose('fetch',async(url:string,init?:RequestInit)=>{
  const path=String(url);requests.push(`${init?.method||'GET'} ${path}`);
  let value:unknown;
  if(path==='/api/me')value={id:'staff',name:'職員',active:true,role:'field'};
  else if(path==='/api/works'&&init?.method==='POST')value=work;
  else if(path==='/api/works')value=[];
  else if(path==='/api/report-delivery-settings')value={setupRequired:false,deliveryEnabled:false};
  else if(path==='/api/works/work')value=work;
  else if(path==='/api/works/work/preview')value={ready:true,missing:[],body:'試験報告'};
  else if(path==='/api/works/work/report-candidate') value={candidate:{...candidate,...(reserved?{trial:{jobId:'job',permitId:'permit',roomName:'試験室',permitValid:true,prepared}}:{})},epoch:0};
  else if(path==='/api/chatwork/production/trial/self-reserve'){reserved=true;value={jobId:'job',permitId:'permit'}}
  else if(path==='/api/chatwork/production/trial/prepare'){prepared=true;value={prepared:true}}
  else if(path==='/api/chatwork/production/trial/register') value={registered:true};
  else throw new Error(`unexpected request ${path}`);
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 });
 const root=createRoot(dom.window.document.getElementById('root')!);
 const click=async(label:string)=>{const node=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);assert.ok(node,`button ${label} exists`);assert.equal(node.disabled,false,`${label} is enabled`);await act(async()=>{node.click();await new Promise(r=>setTimeout(r,0))})};
 try{
  await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});
  await click('今日の作業を開く →');await click('本日の作業を作成');await click('清掃範囲へ進む →');await click('チェックを始める →');await click('報告内容へ →');await click('報告');
  assert.ok(dom.window.document.querySelector('[role="dialog"]'));
  assert.ok(dom.window.document.body.textContent?.includes('試験室'));
  assert.equal(dom.window.document.body.textContent?.includes('試験許可を待っています'),false);
  assert.equal(requests.filter(path=>path.includes('/trial/register')).length,0);
  await click('確定して送信');
  assert.equal(requests.filter(path=>path.includes('/trial/register')).length,1);
  assert.ok(dom.window.document.body.textContent?.includes('報告を受け付けました'));

 } finally {await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of restore){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}}
});
