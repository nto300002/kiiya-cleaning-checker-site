import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {withPreparationStage,fetchReportFont,ReportFontError} from '../lib/report-preparation-diagnostics.ts';

test('stage logging records only safe fixed fields and rethrows without leaking exception text',async()=>{
 const events:unknown[][]=[];const log=(...args:unknown[])=>events.push(args);const error=new TypeError('SECRET body cookie url');
 await assert.rejects(withPreparationStage(log,'image_read',async()=>{throw error}),e=>e===error);
 assert.deepEqual(events,[['report_prepare','image_read','start'],['report_prepare','image_read','error','type_error']]);
 assert.doesNotMatch(JSON.stringify(events),/SECRET|cookie|body|url/);
});

test('font response and network failures are distinguished without recording credentials',async()=>{
 const entries:unknown[][]=[];const log=(...x:unknown[])=>entries.push(x);const headers={cookie:'secret-cookie'};
 for(const status of [403,302]){
  await assert.rejects(fetchReportFont(async()=>new Response(null,{status}),headers,log),e=>e instanceof ReportFontError&&e.kind===(status===403?'http_403':'redirect'));
 }
 await assert.rejects(fetchReportFont(async()=>{throw new TypeError('secret-token')},headers,log),e=>e instanceof ReportFontError&&e.kind==='network_error');
 assert.deepEqual(entries.map(x=>x.at(-1)),['http_403','redirect','network_error']);
 assert.doesNotMatch(JSON.stringify(entries),/secret/);
});

test('font fetch success preserves bytes and emits status without exposing headers',async()=>{
 const entries:unknown[][]=[];let sent:HeadersInit|undefined;
 const bytes=await fetchReportFont(async(_url,options)=>{sent=options?.headers;return new Response(new Uint8Array([1,2,3]))},{'OAI-Sites-Authorization':'Bearer secret-site-access'},(...x)=>entries.push(x));
 assert.equal(new Headers(sent).get('OAI-Sites-Authorization'),'Bearer secret-site-access');
 assert.deepEqual([...bytes],[1,2,3]);assert.equal(entries[0].at(-1),'http_2xx');
 assert.doesNotMatch(JSON.stringify(entries),/secret-site-access/);
});
