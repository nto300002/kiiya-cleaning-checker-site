type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type CandidateResponse={epoch:number;candidate:{id:string}|null};
type Input={workId:string;actorId:string;revision:number;body:string;format?:'markdown'|'pdf';api:(path:string,body?:unknown)=>Promise<any>;storage?:StorageLike;id:()=>string};

// Only non-secret request metadata may be kept on the shared device. An epoch
// fence serializes recovery even if the previous request ID was lost entirely.
export async function startCandidate(input:Input):Promise<string>{
 const path=`works/${encodeURIComponent(input.workId)}/report-candidate`;
 const key=`kiiya-report-request-${input.workId}`;
 const current=await input.api(path) as CandidateResponse;
 if(current.candidate)return current.candidate.id;
 const fenced=await input.api(`${path}/fence-scope`,{revision:input.revision,expectedEpoch:current.epoch}) as {epoch:number};
 const requestId=input.id();
 try{input.storage?.setItem(key,JSON.stringify({requestId,workId:input.workId,actorId:input.actorId,revision:input.revision,createdAt:Date.now()}))}catch{}
 const result=await input.api(path,{requestId,revision:input.revision,epoch:fenced.epoch,body:input.body,format:input.format??'markdown'}) as {candidateId:string};
 return result.candidateId;
}

type ExistingCandidate={id:string;body:string;format:string;stale:boolean;confirmed:boolean;trial?:{permitStatus:string}};
/** Replace a safely unposted candidate only when the intended report changed. */
export async function ensureCandidateForReport(input:Input):Promise<string>{
 const path=`works/${encodeURIComponent(input.workId)}/report-candidate`;
 const matching=(candidate:ExistingCandidate)=>candidate.body===input.body&&candidate.format===(input.format??'markdown')&&!candidate.stale;
 const read=async()=>(await input.api(path) as {candidate:ExistingCandidate|null}).candidate;
 let candidate=await read();
 if(candidate&&!matching(candidate)){
  if(!candidate.confirmed&&candidate.trial?.permitStatus==='Active')await input.api('chatwork/production/trial/self-cancel',{candidateId:candidate.id});
  await input.api(`${path}/close`,{revision:input.revision,candidateId:candidate.id});
  try{input.storage?.removeItem(`kiiya-report-request-${input.workId}`)}catch{}
  candidate=null;
 }
 if(candidate)return candidate.id;
 const id=await startCandidate(input);
 const actual=await read();
 if(!actual||actual.id!==id||!matching(actual))throw new Error('報告の内容が更新されました。もう一度確認してください');
 return id;
}
