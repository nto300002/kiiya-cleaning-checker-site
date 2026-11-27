import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

type Image = {bytes:Uint8Array;mime:string};
const MAX_BYTES=5_000_000;
export async function generateReportPdf(input:{body:string;font:Uint8Array;images:Image[]}):Promise<Uint8Array>{
 if(typeof input.body!=='string'||!input.body.trim()||input.body.length>100_000||!input.font?.length||!Array.isArray(input.images)||input.images.length>20)throw new Error('Invalid report content');
 if(input.images.some(image=>!['image/jpeg','image/png'].includes(image.mime)||!image.bytes?.length||image.bytes.length>MAX_BYTES))throw new Error('Invalid report image');
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(input.font,{subset:false});
 const supported=new Set(font.getCharacterSet());
 for(const char of input.body){const code=char.codePointAt(0)!;if(char!=='\n'&&char!=='\r'&&!supported.has(code))throw new Error('Unsupported report character');}
 const width=595.28,height=841.89,margin=42,fontSize=11,lineHeight=18,maxWidth=width-margin*2;
 const newPage=()=>{const result=doc.addPage([width,height]);result.drawRectangle({x:0,y:0,width,height,color:rgb(1,1,1)});return result};
 let page=newPage(), y=height-margin;
 const newline=()=>{y-=lineHeight;if(y<margin){page=newPage();y=height-margin}};
 for(const paragraph of input.body.replaceAll('\r\n','\n').split('\n')){
   let line='';
   for(const char of paragraph){
     const next=line+char;
     if(font.widthOfTextAtSize(next,fontSize)>maxWidth&&line){page.drawText(line,{x:margin,y,size:fontSize,font,color:rgb(0,0,0)});newline();line=char;}else line=next;
   }
   if(line)page.drawText(line,{x:margin,y,size:fontSize,font,color:rgb(0,0,0)});
   newline();
 }
 for(const image of input.images){
   const embedded=image.mime==='image/png'?await doc.embedPng(image.bytes):await doc.embedJpg(image.bytes);
   page=newPage();const scale=Math.min((width-2*margin)/embedded.width,(height-2*margin)/embedded.height,1);
   const iw=embedded.width*scale,ih=embedded.height*scale;
   page.drawImage(embedded,{x:(width-iw)/2,y:height-margin-ih,width:iw,height:ih});
 }
 const bytes=await doc.save();if(bytes.length>MAX_BYTES)throw new Error('Report PDF exceeds file limit');return bytes;
}
