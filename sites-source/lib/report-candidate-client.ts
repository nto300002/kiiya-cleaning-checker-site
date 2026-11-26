type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type CandidateResponse={epoch:number;candidate:{id:string}|null};
type Input={workId:string;actorId:string;revision:number;body:string;api:(path:string,body?:unknown)=>Promise<any>;storage?:StorageLike;id:()=>string};

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
 const result=await input.api(path,{requestId,revision:input.revision,epoch:fenced.epoch,body:input.body}) as {candidateId:string};
 return result.candidateId;
}
