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

test('uses a static Japanese font and embeds it without the broken dynamic subset',async()=>{
 const fontkit=(await import('@pdf-lib/fontkit')).default;
 const parsed=fontkit.create(font);
 assert.equal(Object.keys((parsed as unknown as {variationAxes?:Record<string,unknown>}).variationAxes || {}).length,0,'PDF font must be static');
 const pdf=await generateReportPdf({body:'KIIYA / CLEANING REPORT\n本日の作業時間のデータとなります。\n● ベッドメイキング 203号室',font,images:[]});
 assert.ok(pdf.length>500000,'embed the full static font rather than the broken runtime subset');
});

// macOS's Quartz renderer detects missing glyph outlines that text extraction cannot.
test('renders every representative Japanese and Latin glyph', {skip:process.platform!=='darwin'}, async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process'); const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url); const sharp=require('sharp') as typeof import('sharp').default;
 const dir=mkdtempSync(join(tmpdir(),'kiiya-pdf-render-'));
 try{
  const chars=Array.from('KIIYA清掃報告本日作業時間2026年●');
  const pdf=await generateReportPdf({body:chars.join('\n'),font,images:[]});
  const pdfPath=join(dir,'report.pdf'),pngPath=join(dir,'report.png');writeFileSync(pdfPath,pdf);
  execFileSync('/usr/bin/sips',['-s','format','png',pdfPath,'--out',pngPath],{stdio:'ignore'});
  const {data,info}=await sharp(pngPath).removeAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,595);assert.equal(info.height,842);
  for(let i=0;i<chars.length;i++){
   let dark=0;for(let y=27+i*18;y<44+i*18;y++)for(let x=40;x<60;x++){
    const k=(y*info.width+x)*info.channels;if(data[k]<220&&data[k+1]<220&&data[k+2]<220)dark++;
   }
   assert.ok(dark>=2,`missing rendered glyph at line ${i+1}: ${chars[i]}`);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('checks the final 5 MB limit with real JPEG attachments', async()=>{
 const {randomFillSync}=await import('node:crypto');const {createRequire}=await import('node:module');
 const sharp=createRequire(import.meta.url)('sharp') as typeof import('sharp').default;
 const makeJpeg=async(size:number)=>{const raw=randomFillSync(Buffer.alloc(size*size*3));return sharp(raw,{raw:{width:size,height:size,channels:3}}).jpeg({quality:95}).toBuffer()};
 const small=await makeJpeg(400),large=await makeJpeg(1800);
 assert.ok(large.length<5000000,'source image itself must fit the upload limit');
 const pdf=await generateReportPdf({body:'清掃報告 123',font,images:[{bytes:small,mime:'image/jpeg'}]});
 assert.ok(pdf.length<=5000000);
 await assert.rejects(generateReportPdf({body:'清掃報告 123',font,images:[{bytes:large,mime:'image/jpeg'}]}),/Report PDF exceeds file limit/);
});
