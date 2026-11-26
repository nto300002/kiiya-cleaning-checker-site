import {generateReportPdf} from './report-pdf.ts';
type Image={id:string;fileName:string;mime:string;bytes:Uint8Array};
type Artifact={kind:'body'|'markdown'|'pdf'|'image';sourceId:string|null;fileName:string|null;mime:string;bytes:Uint8Array};
const max=5_000_000;
export async function prepareReportArtifacts(input:{body:string;font:Uint8Array;images:Image[]}):Promise<Artifact[]>{
 if(typeof input.body!=='string'||!input.body.trim()||input.body.length>65535||!Array.isArray(input.images)||input.images.length>20)throw new Error('Invalid report');
 const body=new TextEncoder().encode(input.body);
 if(body.length>max)throw new Error('Report exceeds file limit');
 const seen=new Set<string>();
 for(const image of input.images){
  if(!image.id||seen.has(image.id)||!image.fileName||image.fileName.length>255||/[\\/\x00-\x1f\x7f]/.test(image.fileName)||!['image/png','image/jpeg'].includes(image.mime)||!image.bytes?.length||image.bytes.length>max)throw new Error('Invalid image');
  seen.add(image.id);
 }
 // Decoding every image and generating the final PDF happen before any POST.
 const pdf=await generateReportPdf({body:input.body,font:input.font,images:input.images});
 return [{kind:'body',sourceId:null,fileName:null,mime:'text/plain',bytes:body},
  {kind:'markdown',sourceId:null,fileName:'report.md',mime:'text/markdown',bytes:body},
  {kind:'pdf',sourceId:null,fileName:'report.pdf',mime:'application/pdf',bytes:pdf},
  ...input.images.map(image=>({kind:'image' as const,sourceId:image.id,fileName:image.fileName,mime:image.mime,bytes:new Uint8Array(image.bytes)}))];
}
