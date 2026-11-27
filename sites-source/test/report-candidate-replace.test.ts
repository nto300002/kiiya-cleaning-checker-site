import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {ensureCandidateForReport} from '../lib/report-candidate-client.ts';

test('edited report cancels unposted permit, closes old candidate, then creates new content',async()=>{
 const calls:string[]=[],stored=new Map<string,string>();let old:any={id:'old',body:'before',format:'markdown',stale:false,confirmed:false,trial:{permitStatus:'Active'}};let epoch=1;
 const api=async(path:string,body?:any)=>{calls.push(path);if(path.endsWith('self-cancel')){assert.equal(body.candidateId,'old');old.trial.permitStatus='Revoked';return {cancelled:true}}if(path.endsWith('/close')){assert.equal(body.candidateId,'old');old=null;epoch++;return {closed:true}}if(path.endsWith('fence-scope')){epoch++;return {epoch}}if(path.endsWith('report-candidate')&&!body)return {epoch,candidate:old};if(path.endsWith('report-candidate')){assert.equal(body.body,'after');old={id:'new',body:body.body,format:body.format,stale:false,confirmed:false};return {candidateId:'new'}}throw Error(path)};
 const storage={getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>{stored.set(k,v)},removeItem:(k:string)=>{stored.delete(k)}};
 const id=await ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'after',format:'markdown',api,storage,id:()=> 'request'});
 assert.equal(id,'new');assert.ok(calls.indexOf('chatwork/production/trial/self-cancel')<calls.indexOf('works/w/report-candidate/close'));assert.equal(old.body,'after');
});
test('unchanged candidate is reused and no cancellation or replacement occurs',async()=>{
 let calls=0;const api=async()=>{calls++;return {epoch:1,candidate:{id:'old',body:'same',format:'markdown',stale:false,confirmed:false}}};
 assert.equal(await ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'same',format:'markdown',api,id:()=> 'request'}),'old');assert.equal(calls,1);
});
test('if cancellation or closure cannot prove safety, no new candidate is created',async()=>{
 for(const fail of ['cancel','close']){const calls:string[]=[];const api=async(path:string,body?:any)=>{calls.push(path);if(path.endsWith('self-cancel')){if(fail==='cancel')throw Error('unknown');return {cancelled:true}}if(path.endsWith('/close'))throw Error('blocked');if(!body)return {epoch:0,candidate:{id:'old',body:'old',format:'markdown',stale:false,confirmed:false,trial:{permitStatus:'Active'}}};throw Error('must not create')};
 await assert.rejects(ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'new',format:'markdown',api,id:()=> 'request'}));assert.ok(!calls.some(x=>x.endsWith('fence-scope')));
 }
});
test('a concurrent different candidate is never presented as the edited report',async()=>{
 let reads=0;const api=async(path:string,body?:any)=>{if(!body){reads++;return {epoch:1,candidate:reads===1?null:{id:'other',body:'different',format:'markdown',stale:false,confirmed:false}}}throw Error('must not create')};
 await assert.rejects(ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'new',format:'markdown',api,id:()=> 'request'}));
});
test('changing report format also replaces the old unsent candidate',async()=>{
 let current:any={id:'old',body:'same',format:'markdown',stale:false,confirmed:false};let epoch=0;const api=async(path:string,body?:any)=>{if(path.endsWith('/close')){current=null;epoch++;return {closed:true}}if(path.endsWith('fence-scope'))return {epoch:++epoch};if(!body)return {epoch,candidate:current};current={id:'pdf',body:body.body,format:body.format,stale:false,confirmed:false};return {candidateId:'pdf'}};
 assert.equal(await ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'same',format:'pdf',api,id:()=> 'request'}),'pdf');assert.equal(current.format,'pdf');
});
test('matching confirmed candidate is reused, avoiding duplicate report creation',async()=>{
 let calls=0;const api=async()=>{calls++;return {candidate:{id:'old',body:'same',format:'markdown',stale:false,confirmed:true}}};assert.equal(await ensureCandidateForReport({workId:'w',actorId:'a',revision:1,body:'same',format:'markdown',api,id:()=> 'request'}),'old');assert.equal(calls,1);
});
