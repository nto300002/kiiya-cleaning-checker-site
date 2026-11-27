import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {prepareReportArtifacts} from '../lib/report-preflight.ts';
const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
test('prepares body, markdown, PDF and images from the same immutable snapshot',async()=>{
 const result=await prepareReportArtifacts({body:'清掃報告',font,images:[{id:'one',fileName:'one.png',mime:'image/png',bytes:png}]});
 assert.deepEqual(result.map(x=>x.kind),['body','markdown','pdf','image']);
 assert.equal(new TextDecoder().decode(result[1].bytes),'清掃報告');
 assert.equal(Buffer.from(result[2].bytes.subarray(0,5)).toString(),'%PDF-');
 assert.deepEqual(result[3].bytes,new Uint8Array(png));
});
test('rejects oversized and malformed content before producing any output',async()=>{
 await assert.rejects(prepareReportArtifacts({body:'報告',font,images:[{id:'x',fileName:'x.png',mime:'image/png',bytes:new Uint8Array(5000001)}]}));
 await assert.rejects(prepareReportArtifacts({body:'報告',font,images:[{id:'x',fileName:'x.png',mime:'image/png',bytes:new Uint8Array([1,2,3])}]}));
 await assert.rejects(prepareReportArtifacts({body:'報告',font,images:[{id:'x',fileName:'x.png',mime:'image/png',bytes:png},{id:'x',fileName:'x.png',mime:'image/png',bytes:png}]}));
});
test('選択した形式のみを生成し、画像は保持する',async()=>{
 const images=[{id:'one',fileName:'one.png',mime:'image/png',bytes:png}];
 const markdown=await prepareReportArtifacts({body:'清掃報告',font,images,format:'markdown'});
 assert.deepEqual(markdown.map(x=>x.kind),['body','image']);
 assert.equal(new TextDecoder().decode(markdown[0].bytes),'清掃報告');
 const pdf=await prepareReportArtifacts({body:'清掃報告',font,images,format:'pdf'});
 assert.deepEqual(pdf.map(x=>x.kind),['pdf','image']);
 assert.equal(Buffer.from(pdf[0].bytes.subarray(0,5)).toString(),'%PDF-');
});
