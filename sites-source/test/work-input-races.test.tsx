import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import CleaningApp from '../app/cleaning-app.tsx';
import {makeWork,todayJst} from '../lib/domain.ts';

async function scenario(run:(ui:{window:Window & typeof globalThis; click:(label:string)=>Promise<void>; tick:()=>Promise<void>; pending:Map<string,()=>void>; work:any; requests:string[]; scrollEvents:{label:string|null;top:number}[]})=>Promise<void>, openChecks=true, useMaximum=false){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),restore=new Map<string,PropertyDescriptor|undefined>();
 const expose=(key:string,value:unknown)=>{restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})};
 for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','MouseEvent','FormData'] as const)expose(key,dom.window[key]);
 expose('IS_REACT_ACT_ENVIRONMENT',true);dom.window.scrollTo=()=>{};const scrollEvents:{label:string|null;top:number}[]=[];dom.window.HTMLElement.prototype.scrollTo=function(options?:ScrollToOptions | number){if(options&&typeof options==='object')scrollEvents.push({label:this.getAttribute('aria-label'),top:options.top||0})};
 const data=makeWork('職員');data.startedAt='2026-11-03T00:00:00Z';data.staffNames=['スタッフ'];data.tasks.corridor.assignees=['スタッフ'];data.toiletTarget=useMaximum?2:0;data.showerTarget=useMaximum?3:0;data.breakAnswer='no';
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
 try{await act(async()=>{root.render(<CleaningApp signOutPath="/signout"/>);await new Promise(r=>setTimeout(r,0))});await click('作業を開始する →');if(openChecks)await click('清掃範囲を決定');await run({window:dom.window as unknown as Window & typeof globalThis,click,tick,pending,work,requests,scrollEvents})}
 finally{await act(async()=>root.unmount());dom.window.close();for(const [key,d] of restore){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key)}}
}

test('scope pickers scroll to the saved selected counts on opening',async()=>scenario(async({scrollEvents})=>{
 assert.ok(scrollEvents.some(e=>e.label?.includes('トイレの清掃箇所数')&&e.top===72));
 assert.ok(scrollEvents.some(e=>e.label?.includes('シャワーの清掃箇所数')&&e.top===108));
},false,true));

test('scope is a separate step before cleaning checks and can be revisited',async()=>scenario(async({window,click})=>{
 assert.match(window.document.querySelector('h1')?.textContent||'',/清掃範囲/);
 assert.match(window.document.querySelector('.workflow-progress-label')?.textContent||'',/2 \/ 4/);
 assert.equal(window.document.querySelector('.task-section'),null);
 await click('清掃範囲を決定');
 assert.match(window.document.querySelector('h1')?.textContent||'',/清掃チェック/);
 assert.match(window.document.querySelector('.workflow-progress-label')?.textContent||'',/3 \/ 4/);
 assert.ok(window.document.querySelector('.task-section'));
 await click('戻る');
 assert.match(window.document.querySelector('h1')?.textContent||'',/清掃範囲/);
},false));

test('checks footer omits the next incomplete shortcut',async()=>scenario(async({window})=>{
 assert.ok(window.document.querySelector('.missing-list'));
 assert.equal([...window.document.querySelectorAll('button')].some(b=>b.textContent?.includes('次の未完了へ')),false);
}));

test('scope changes are saved before entering checks',async()=>scenario(async({window,click,pending})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'確認用スタッフ');input.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await click('清掃範囲を決定');
 assert.ok(pending.has('save'));
 assert.match(window.document.querySelector('h1')?.textContent||'',/清掃範囲/);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
 assert.match(window.document.querySelector('h1')?.textContent||'',/清掃チェック/);
},false));

test('editing a staff name updates the saved task assignee',async()=>scenario(async({window,click,pending})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'変更後');input.dispatchEvent(new window.Event('input',{bubbles:true}));input.blur();await new Promise(r=>setTimeout(r,0))});
 await click('清掃範囲を決定');assert.ok(pending.has('save'));
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);
 assert.deepEqual(saved.data.staffNames,['変更後']);assert.deepEqual(saved.data.tasks.corridor.assignees,['変更後']);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
},false));

test('saving locks fields until the response arrives',async()=>scenario(async({window,click,pending,tick})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'変更前');input.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 const logo=window.document.querySelector<HTMLButtonElement>('button[aria-label="ホームへ戻る"]')!;await act(async()=>{logo.click();await new Promise(r=>setTimeout(r,0))});assert.ok(pending.has('save'));assert.equal(input.disabled,true,'保存中は入力を変更できない');
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});await tick();assert.equal(input.value,'変更前');
},false));

test('typing alone does not save; a unit task update saves the current draft',async()=>scenario(async({window,click,pending,requests})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'入力中');input.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,650))});
 assert.equal(requests.filter(x=>x==='PUT /api/works/work').length,0,'文字入力だけでは自動保存しない');
 assert.equal(window.localStorage.getItem('kiiya-draft-work'),null,'文字入力だけでは端末にも書き込まない');
 const logo=window.document.querySelector<HTMLButtonElement>('button[aria-label="ホームへ戻る"]')!;
 await act(async()=>{logo.click();await new Promise(r=>setTimeout(r,0))});
 assert.ok(pending.has('save'),'画面遷移では保存する');
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
},false));

test('changing a unit task saves the current work',async()=>scenario(async({window,pending,requests})=>{
 const assignment=window.document.querySelector<HTMLInputElement>('.task-section input[type="checkbox"]');
 assert.ok(assignment,'作業の担当者を選べる');
 await act(async()=>{assignment.click();await new Promise(r=>setTimeout(r,20))});
 assert.equal(requests.filter(x=>x==='PUT /api/works/work').length,1);
 assert.ok(pending.has('save'));
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
}));

test('batch editing groups work by unit',async()=>scenario(async({window,click})=>{
 await click('まとめて内容修正');
 const first=window.document.querySelector<HTMLElement>('[data-unit="1"]');const second=window.document.querySelector<HTMLElement>('[data-unit="2"]');
 assert.ok(first);assert.ok(second);assert.match(first.textContent||'',/ユニット1/);assert.match(second.textContent||'',/ユニット2/);
 assert.ok(first.querySelector('input[aria-label="廊下の開始時刻"]'));assert.ok(second.querySelector('input[aria-label="ラウンジの開始時刻"]'));
 assert.equal(first.querySelector('input[aria-label="ラウンジの開始時刻"]'),null);
}));

test('batch editing saves shower count with completion',async()=>scenario(async({window,click,pending})=>{
 await click('まとめて内容修正');
 const count=window.document.querySelector('select[aria-label="シャワールームの清掃済み数"]') as unknown as HTMLSelectElement;assert.ok(count);
 const assignee=window.document.querySelector<HTMLInputElement>('input[aria-label="シャワールームの担当者: スタッフ"]')!;
 const start=window.document.querySelector<HTMLInputElement>('input[aria-label="シャワールームの開始時刻"]')!;
 const end=window.document.querySelector<HTMLInputElement>('input[aria-label="シャワールームの終了時刻"]')!;
 const complete=window.document.querySelector<HTMLInputElement>('input[aria-label="シャワールームを完了"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{assignee.click();count.value='2';count.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(start,'09:10');start.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(end,'09:30');end.dispatchEvent(new window.Event('input',{bubbles:true}));complete.click();await new Promise(r=>setTimeout(r,0))});
 await click('この内容で確定');assert.ok(pending.has('save'));
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.equal(saved.data.tasks.showers.completedCount,2);assert.equal(saved.data.tasks.showers.completed,true);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
},true,true));

test('batch time opens directly for editing and saves times',async()=>scenario(async({window,click,pending})=>{
 await click('まとめて内容修正');assert.match(window.document.querySelector('h1')?.textContent||'',/作業時間をまとめて確認/);
 assert.doesNotMatch(window.document.body.textContent||'',/時間を入力・変更|時刻は未記録/);
 const start=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の開始時刻"]')!;
 const end=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の終了時刻"]')!;assert.ok(start);assert.ok(end);
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(start,'09:15');start.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(end,'09:45');end.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await click('この内容で確定');assert.ok(pending.has('save'));
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.equal(saved.data.tasks.corridor.startedAt,'09:15');assert.equal(saved.data.tasks.corridor.finishedAt,'09:45');assert.equal(saved.data.tasks.corridor.completed,false);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});assert.match(window.document.querySelector('h1')?.textContent||'',/清掃チェック/);
}));

test('batch completion is saved and elapsed time updates from input',async()=>scenario(async({window,click,pending})=>{
 await click('まとめて内容修正');
 const start=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の開始時刻"]')!;
 const end=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の終了時刻"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(start,'09:15');start.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(end,'10:30');end.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 const check=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下を完了"]');assert.ok(check);
 await act(async()=>{check.click();await new Promise(r=>setTimeout(r,0))});
 assert.match(window.document.querySelector('.batch-elapsed')?.textContent||'',/1時間15分/);
 await click('この内容で確定');assert.ok(pending.has('save'));
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.equal(saved.data.tasks.corridor.completed,true);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
}));

test('batch completion cannot bypass assignment requirements',async()=>scenario(async({window,click,requests})=>{
 await click('まとめて内容修正');
 const check=window.document.querySelector<HTMLInputElement>('input[aria-label="ラウンジを完了"]')!;
 await act(async()=>{check.click();await new Promise(r=>setTimeout(r,0))});
 await click('この内容で確定');assert.match(window.document.querySelector('[role="alert"]')?.textContent||'',/担当者/);
 assert.equal(requests.some(x=>x==='PUT /api/works/work'),false);
}));

test('batch editing updates assignees and presents completion after end time',async()=>scenario(async({window,click,pending})=>{
 await click('まとめて内容修正');
 const row=[...window.document.querySelectorAll<HTMLElement>('.batch-time-row')].find(x=>x.querySelector('strong')?.textContent==='ラウンジ')!;
 const assign=row.querySelector<HTMLInputElement>('input[aria-label="ラウンジの担当者: スタッフ"]');assert.ok(assign);
 const start=row.querySelector<HTMLInputElement>('input[aria-label="ラウンジの開始時刻"]')!;
 const end=row.querySelector<HTMLInputElement>('input[aria-label="ラウンジの終了時刻"]')!;
 const complete=row.querySelector<HTMLInputElement>('input[aria-label="ラウンジを完了"]')!;
 assert.ok(end.compareDocumentPosition(complete)&window.Node.DOCUMENT_POSITION_FOLLOWING);
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{assign.click();set.call(start,'09:15');start.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(end,'09:45');end.dispatchEvent(new window.Event('input',{bubbles:true}));complete.click();await new Promise(r=>setTimeout(r,0))});
 await click('この内容で確定');assert.ok(pending.has('save'));
 const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.deepEqual(saved.data.tasks.lounge.assignees,['スタッフ']);assert.equal(saved.data.tasks.lounge.completed,true);assert.equal(saved.data.tasks.lounge.assigneeCustomized,true);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});
}));

test('batch time rejects a finish earlier than start and keeps edits on screen',async()=>scenario(async({window,click,requests})=>{
 await click('まとめて内容修正');
 const start=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の開始時刻"]')!;
 const end=window.document.querySelector<HTMLInputElement>('input[aria-label="廊下の終了時刻"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(start,'10:00');start.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await act(async()=>{set.call(end,'09:00');end.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 await click('この内容で確定');assert.match(window.document.querySelector('[role="alert"]')?.textContent||'',/廊下/);
 assert.equal(requests.some(x=>x==='PUT /api/works/work'),false);
}));

test('edits and two image uploads survive out-of-order responses',async()=>scenario(async({window,click,pending,tick})=>{
 const uploads=window.document.querySelectorAll<HTMLInputElement>('input[type=file]');
 for(const [index,input] of [...uploads].entries()){Object.defineProperty(input,'files',{value:[new window.File(['png'],`${index}.png`,{type:'image/png'})],configurable:true});await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0))})}
 const notes=[...window.document.querySelectorAll('textarea')].find(e=>e.closest('label')?.textContent?.includes('所感・課題'))!;
 assert.ok(notes);const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')!.set!;
 await act(async()=>{set.call(notes,'画像待ちの間のメモ');notes.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 const logo=window.document.querySelector<HTMLButtonElement>('button[aria-label="ホームへ戻る"]')!;await act(async()=>{logo.click();await new Promise(r=>setTimeout(r,0))});assert.equal(pending.has('save'),false,'画像の受け付け中は保存できない');
 await act(async()=>{pending.get('image2')!();await new Promise(r=>setTimeout(r,0))});await act(async()=>{pending.get('image1')!();await new Promise(r=>setTimeout(r,0))});await tick();
 await act(async()=>{logo.click();await new Promise(r=>setTimeout(r,0))});const saved=JSON.parse(window.localStorage.getItem('kiiya-draft-work')!);assert.equal(saved.data.notes,'画像待ちの間のメモ');assert.deepEqual([...saved.data.imageIds].sort(),['image1','image2']);
}));

test('logo returns home only after an unsaved work entry is saved',async()=>scenario(async({window,pending,tick})=>{
 const input=window.document.querySelector<HTMLInputElement>('input[placeholder="氏名を入力"]')!;
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'保存する名前');input.dispatchEvent(new window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});
 const logo=window.document.querySelector<HTMLButtonElement>('button[aria-label="ホームへ戻る"]')!;assert.ok(logo);
 await act(async()=>{logo.click();await new Promise(r=>setTimeout(r,0))});assert.ok(pending.has('save'));assert.match(window.document.body.textContent!,/清掃範囲/);
 await act(async()=>{pending.get('save')!();await new Promise(r=>setTimeout(r,0))});await tick();assert.match(window.document.body.textContent!,/アプリの使い方/);
},false));
