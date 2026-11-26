import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {startCandidate} from '../lib/report-candidate-client.ts';

test('candidate recovery fences unknown older work before creating a new request without storing report text',async()=>{
 const calls:string[]=[];const saved=new Map<string,string>();
 const storage={getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v)},removeItem:(k:string)=>{saved.delete(k)}};
 const api=async(path:string,body?:unknown)=>{calls.push(path);if(path.endsWith('report-candidate')&&!body)return {epoch:0,candidate:null};if(path.endsWith('fence-scope'))return {epoch:1};if(path.endsWith('report-candidate')){assert.equal((body as {epoch:number}).epoch,1);assert.ok(![...saved.values()].some(v=>v.includes('秘密の本文')));return {candidateId:'candidate'}}throw Error('unexpected')};
 const candidate=await startCandidate({workId:'work',actorId:'actor',revision:2,body:'秘密の本文',api,storage,id:()=> 'new-id'});
 assert.equal(candidate,'candidate');assert.deepEqual(calls,['works/work/report-candidate','works/work/report-candidate/fence-scope','works/work/report-candidate']);
 assert.equal(saved.size,1);assert.ok(![...saved.values()].some(v=>v.includes('秘密の本文')));
});

test('candidate recovery reuses the existing server candidate and never creates a second one',async()=>{
 const calls:string[]=[];const api=async(path:string)=>{calls.push(path);return {epoch:3,candidate:{id:'existing',body:'fixed'}}};
 assert.equal(await startCandidate({workId:'work',actorId:'actor',revision:1,body:'other',api,id:()=> 'new'}),'existing');
 assert.equal(calls.length,1);
});

test('lost creation response is recovered without a second creation',async()=>{
 let candidate:string|null=null;let creates=0;let epoch=0;
 const api=async(path:string,body?:unknown)=>{
  if(path.endsWith('fence-scope'))return {epoch:++epoch};
  if(!body)return {epoch,candidate:candidate?{id:candidate}:null};
  creates++;candidate='saved';throw new Error('response lost');
 };
 const input={workId:'work',actorId:'actor',revision:1,body:'report',api,id:()=> 'request'};
 await assert.rejects(startCandidate(input));
 assert.equal(await startCandidate(input),'saved');assert.equal(creates,1);
});

test('storage failure does not bypass server fencing',async()=>{
 const calls:string[]=[];const storage={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}};
 const api=async(path:string,body?:unknown)=>{calls.push(path);if(path.endsWith('fence-scope'))return {epoch:4};if(!body)return {epoch:3,candidate:null};return {candidateId:'c'}};
 assert.equal(await startCandidate({workId:'work',actorId:'actor',revision:1,body:'report',api,storage,id:()=> 'id'}),'c');
 assert.equal(calls.filter(x=>x.endsWith('fence-scope')).length,1);
});

test('an absent request is never treated as permission to create if the scope fence fails',async()=>{
 const calls:string[]=[];
 const api=async(path:string,body?:unknown)=>{
  calls.push(path);
  if(path.endsWith('fence-scope'))throw new Error('fence unavailable');
  if(!body)return {epoch:0,candidate:null};
  throw new Error('unsafe create');
 };
 await assert.rejects(startCandidate({workId:'work',actorId:'actor',revision:1,body:'report',api,id:()=> 'id'}),/fence unavailable/);
 assert.deepEqual(calls,['works/work/report-candidate','works/work/report-candidate/fence-scope']);
});
