import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {generateReportPdf} from '../lib/report-pdf.ts';
const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
test('generates a Japanese report PDF with text and image pages',async()=>{
 const pdf=await generateReportPdf({body:'清掃報告\n作業が完了しました。',font,images:[{bytes:png,mime:'image/png'}]});
 assert.equal(Buffer.from(pdf.subarray(0,5)).toString(),'%PDF-');
 const document=await PDFDocument.load(pdf);
 assert.ok(document.getPageCount()>=2);
 assert.ok(pdf.length<=5000000);
});
test('rejects missing text, unsupported images and oversized source',async()=>{
 await assert.rejects(generateReportPdf({body:'',font,images:[]}));
 await assert.rejects(generateReportPdf({body:'test',font,images:[{bytes:png,mime:'image/gif'}]}));
 await assert.rejects(generateReportPdf({body:'test',font,images:[{bytes:new Uint8Array(5000001),mime:'image/png'}]}));
});

test('rejects text containing characters absent from the embedded font',async()=>{
 await assert.rejects(generateReportPdf({body:'完了 🧹',font,images:[]}));
});
