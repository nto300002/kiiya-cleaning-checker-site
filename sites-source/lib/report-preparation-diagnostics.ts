type Stage='token'|'manifest'|'report_read'|'prepared_read'|'image_metadata'|'image_read'|'font_fetch'|'pdf_generate'|'prepared_r2'|'prepared_d1'|'prepare';
type Log=(...args:string[])=>void;
export async function withPreparationStage<T>(log:Log,stage:Stage,operation:()=>Promise<T>):Promise<T>{
 log('report_prepare',stage,'start');
 try{const result=await operation();log('report_prepare',stage,'success');return result}
 catch(error){log('report_prepare',stage,'error',error instanceof TypeError?'type_error':error instanceof Error&&error.name==='AbortError'?'timeout':'other');throw error}
}
export class ReportFontError extends Error{constructor(public readonly kind:'redirect'|'http_403'|'http_4xx'|'http_5xx'|'http_other'|'network_error'){super('Font unavailable')}}
export async function fetchReportFont(fetcher:typeof fetch,headers:HeadersInit,log:Log,origin='https://kiiya-cleaning-checker.hherocl278.chatgpt.site'):Promise<Uint8Array>{
 let response:Response;
 try{response=await fetcher(`${origin.replace(/\/+$/,'')}/assets/fonts/NotoSansJP.ttf`,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)})}
 catch{log('report_prepare','font_http','network_error');throw new ReportFontError('network_error')}
 const kind=response.status>=200&&response.status<300?'http_2xx':response.status>=300&&response.status<400?'redirect':response.status===403?'http_403':response.status>=400&&response.status<500?'http_4xx':response.status>=500&&response.status<600?'http_5xx':'http_other';
 log('report_prepare','font_http',kind);
 if(kind!=='http_2xx')throw new ReportFontError(kind);
 return new Uint8Array(await response.arrayBuffer());
}
