import {generateReportPdf} from './report-pdf.ts';
import {PDFDocument} from 'pdf-lib';
type Image={id:string;fileName:string;mime:string;bytes:Uint8Array};
type Artifact={kind:'body'|'markdown'|'pdf'|'image';sourceId:string|null;fileName:string|null;mime:string;bytes:Uint8Array};
const max=5_000_000;
export async function prepareReportArtifacts(input:{body:string;font?:Uint8Array;images:Image[];format?:'markdown'|'pdf'}):Promise<Artifact[]>{
 if(typeof input.body!=='string'||!input.body.trim()||input.body.length>65535||!Array.isArray(input.images)||input.images.length>20)throw new Error('Invalid report');
 const body=new TextEncoder().encode(input.body);
 if(body.length>max)throw new Error('Report exceeds file limit');
 const seen=new Set<string>();
 for(const image of input.images){
  if(!image.id||seen.has(image.id)||!image.fileName||image.fileName.length>255||/[\\/\x00-\x1f\x7f]/.test(image.fileName)||!['image/png','image/jpeg'].includes(image.mime)||!image.bytes?.length||image.bytes.length>max)throw new Error('Invalid image');
  seen.add(image.id);
 }
 // Validate image data before any POST, even when no PDF is generated.
 if(input.format==='markdown'){
  const check=await PDFDocument.create();for(const image of input.images){if(image.mime==='image/png')await check.embedPng(image.bytes);else await check.embedJpg(image.bytes)}
  return [{kind:'body',sourceId:null,fileName:null,mime:'text/plain',bytes:body},...input.images.map(image=>({kind:'image' as const,sourceId:image.id,fileName:image.fileName,mime:image.mime,bytes:new Uint8Array(image.bytes)}))];
 }
 if(!input.font)throw new Error('PDF font unavailable');
 const pdf=await generateReportPdf({body:input.body,font:input.font,images:input.images});
 if(input.format==='pdf')return [{kind:'pdf',sourceId:null,fileName:'report.pdf',mime:'application/pdf',bytes:pdf},...input.images.map(image=>({kind:'image' as const,sourceId:image.id,fileName:image.fileName,mime:image.mime,bytes:new Uint8Array(image.bytes)}))];
 return [{kind:'body',sourceId:null,fileName:null,mime:'text/plain',bytes:body},
  {kind:'markdown',sourceId:null,fileName:'report.md',mime:'text/markdown',bytes:body},
  {kind:'pdf',sourceId:null,fileName:'report.pdf',mime:'application/pdf',bytes:pdf},
  ...input.images.map(image=>({kind:'image' as const,sourceId:image.id,fileName:image.fileName,mime:image.mime,bytes:new Uint8Array(image.bytes)}))];
}
