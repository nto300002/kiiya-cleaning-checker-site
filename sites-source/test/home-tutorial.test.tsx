import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import HomeTutorial from '../app/home-tutorial.tsx';
test('tutorial opens on first step, advances with screenshots and closes',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),old=new Map<string,PropertyDescriptor|undefined>();
 for(const k of ['window','document','navigator','HTMLElement','MouseEvent']){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:(dom.window as any)[k],configurable:true,writable:true})}
 old.set('IS_REACT_ACT_ENVIRONMENT',Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT'));Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);let closed=false;
 try{await act(async()=>{root.render(<HomeTutorial onClose={()=>{closed=true}}/>)});
  assert.ok(dom.window.document.querySelector('[role=dialog]'));assert.match(dom.window.document.body.textContent!,/今日の作業/);
  const click=async(label:string)=>{const b=[...dom.window.document.querySelectorAll('button')].find(x=>x.textContent?.trim()===label);assert.ok(b,label);await act(async()=>b.click())};
  for(const title of ['清掃範囲','全体チェック','報告内容']){await click('次へ');assert.match(dom.window.document.body.textContent!,new RegExp(title));assert.ok(dom.window.document.querySelector('img'))}
  await click('閉じる');assert.equal(closed,true);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [k,v] of old){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k)}}
});
