import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import CleaningApp from '../app/cleaning-app.tsx';
import {makeWork,todayJst} from '../lib/domain.ts';

async function scenario(run:(ui:{window:Window & typeof globalThis; click:(label:string)=>Promise<void>; tick:()=>Promise<void>; pending:Map<string,()=>void>; work:any; requests:string[]})=>Promise<void>){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(key:string,value:unknown)=>{restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})};
 for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent','FormData'] as const)expose(key,dom.window[key]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=()=>{};
 const data=makeWork('職員');data.startedAt='2026-11-03T00:00:00Z';data.staffNames=['スタッフ'];data.toiletTarget=0;data.showerTarget=0;data.breakAnswer='no';
 const work={id:'work',day:todayJst(),ownerId:'staff',revision:1,status:'Started',data,images:[],reports:[]};
 const pending=new Map<string,()=>void>(),requests:string[]=[];let upload=0;
 const delay=(key:string)=>new Promise<void>(resolve=>pending.set(key,resolve));
 expose('fetch',async(url:string,init?:RequestInit)=>{
  const path=String(url),method=init?.method||'GET';requests.push(`${method} ${path}`);let value:any;
  if(path==='/api/me')value={id:'staff',name:'職員',active:true,role:'field'};
  else if(path==='/api/works'&&method==='POST')value=work;
  else if(path==='/api/works')value=[];
  else if(path==='/api/report-delivery-settings')value={setupRequired:false,deliveryEnabled:false};
  else if(path==='/api/works/work'&&method==='PUT'){await delay('save');const sent=JSON.parse(String(init?.body));value={...work,revision:2,data:sent.data};}
  else if(path==='/api/works/work')value=work;
  else if(path==='/api/works/work/images'&&method==='POST'){const id=`image${++upload}`;await delay(id);work.images.push({id,file_name:id+'.png'} as never);value={id,fileName:id+'.png'};}
  else throw Error(`unexpected ${method} ${path}`);
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 });
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);const tick=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0))})};
 const click=async(label:string)=>{const b=[...dom.window.document.querySelectorAll('button')].find(x=>x.textContent?.trim()===label);assert.ok(b,`button ${label}`);assert.equal(b.disabled,false);await act(async()=>{b.click();await new Promise(r=>setTimeout(r,0))})};
 try{await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});await click('今日の作業を開く →');await click('本日の作業を作成');await run({window:dom.window as unknown as Window & typeof globalThis,click,tick,pending,work,requests})}
 finally{await act(async()=>root.unmount());dom.window.close();for(const [key,d] of restore){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key)}}
}

test('saving locks fields until the response arrives',async()=>scenario(async({window,click,pending,tick})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'変更前');input.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await click('入力内容を保存');assert.ok(pending.has('save'));assert.equal(input.disabled,true,'保存中は入力を変更できない');
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});await tick();assert.equal(input.disabled,false);assert.equal(input.value,'変更前');
}));

test('edits and two image uploads survive out-of-order responses',async()=>scenario(async({window,click,pending,tick})=>{
 await click('清掃範囲へ進む →');await click('チェックを始める →');
 const uploads=window.document.querySelectorAll<HTMLInputElement>('input[type=file]');
 for(const [index,input] of [...uploads].entries()){Object.defineProperty(input,'files',{value:[new window.File(['png'],`${index}.png`,{type:'image/png'})],configurable:true});await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0))})}
 const notes=[...window.document.querySelectorAll('textarea')].find(e=>e.closest('label')?.textContent?.includes('所感・課題'))!;
 assert.ok(notes);const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')!.set!;
 await act(async()=>{set.call(notes,'画像待ちの間のメモ');notes.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 const save=[...window.document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='保存する');assert.ok(save);assert.equal(save.disabled,true,'画像の受け付け中は保存できない');
 await act(async()=>{pending.get('image2')!();await new Promise(r=>setTimeout(r,0))});await act(async()=>{pending.get('image1')!();await new Promise(r=>setTimeout(r,0))});await tick();
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.equal(saved.data.notes,'画像待ちの間のメモ');assert.deepEqual([...saved.data.imageIds].sort(),['image1','image2']);
}));
