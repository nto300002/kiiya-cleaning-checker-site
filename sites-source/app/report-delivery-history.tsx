"use client";
import { useEffect, useState } from "react";
import { reportDeliveryLabel } from "@/lib/report-delivery-label";

type History = { status:string;reason:string|null;artifacts:{id?:string;kind:string;status:string;downloadable?:boolean}[];canReconcile?:boolean;jobId?:string;roomName?:string;trial?:{jobId:string;permitId:string;roomName:string} };
const kinds:Record<string,string> = {body:"本文",markdown:"Markdown",pdf:"PDF",image:"画像"};
export default function ReportDeliveryHistory({workId,reportId}:{workId:string;reportId:string}) {
  const [history,setHistory]=useState<History|null|undefined>(undefined);
  const [error,setError]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let current=true;
    setHistory(undefined);setError(false);
    fetch(`/api/works/${encodeURIComponent(workId)}/reports/${encodeURIComponent(reportId)}/delivery`,{cache:"no-store"})
      .then(async response=>{if(!response.ok)throw new Error("history unavailable");return response.json() as Promise<History|null>})
      .then(value=>{if(current)setHistory(value)}).catch(()=>{if(current)setError(true)});
    return ()=>{current=false};
  },[workId,reportId,refresh]);
  if(error)return <p role="status">送信履歴を確認できません。再読み込みしてください。</p>;
  if(history===undefined)return <p>送信履歴を確認中です。</p>;
  if(history===null)return <p>送信登録はありません。</p>;
  return <div role="status"><p>送信状態：{reportDeliveryLabel(history.status)}</p><button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>送信状態を更新</button>
    {history.trial && <div className="notice mini"><strong>試験送信の許可があります</strong><span>送信先：{history.trial.roomName}。個人情報を含まない試験用の報告だけを送信してください。</span>
      <button type="button" disabled={busy} onClick={async()=>{
        if(!history.trial||!window.confirm(`「${history.trial.roomName}」へ、この報告を試験送信します。よろしいですか？`))return;
        setBusy(true);setMessage("");
        try{
          const body=JSON.stringify({jobId:history.trial.jobId,permitId:history.trial.permitId});
          for(const action of ['register','prepare']){
            const response=await fetch(`/api/chatwork/production/trial/${action}`,{method:'POST',headers:{'content-type':'application/json'},body});
            if(!response.ok){const data=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(data?.error||'試験送信を準備できません');}
          }
          setMessage('試験送信を登録しました。送信状態を確認してください。');setRefresh(value=>value+1);
        }catch(e){setMessage(e instanceof Error?e.message:'試験送信を準備できません');setRefresh(value=>value+1);}finally{setBusy(false)}
      }}>{busy?'試験送信を準備中':'この報告を試験送信'}</button></div>}
    {message&&<p role="status">{message}</p>}
    {(history.reason==="ACTOR_CHANGED" || history.reason==="ACTOR_CHANGED_UNSEALED") && <p>職員の権限または登録情報が変更されたため停止しました。</p>}
    {(history.reason==="SETTINGS_CHANGED" || history.reason==="SETTINGS_CHANGED_UNSEALED") && <p>送信先の設定が変更されたため停止しました。</p>}
    {history.canReconcile && <p>旧ワーカーの隔離が記録されています。「{history.roomName}」の投稿を確認し、各成果物を照合してください。</p>}
    {history.canReconcile && history.artifacts.length>0 && history.artifacts.every(item=>item.status==='Pending') && <button type="button" disabled={busy} onClick={async()=>{
      if(!history.jobId||!window.confirm(`「${history.roomName}」にこの報告が届いていないことを確認しましたか？`))return;
      setBusy(true);setMessage("");try{const response=await fetch('/api/chatwork/production/trial/reconcile-unposted',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:history.jobId})});if(!response.ok)throw new Error('照合を保存できません');setMessage('報告が未送信であることを記録しました。');setRefresh(value=>value+1)}catch(e){setMessage(e instanceof Error?e.message:'照合を保存できません')}finally{setBusy(false)}
    }}>報告全体が未送信と確認</button>}
    {history.artifacts.length>0 && <ul>{history.artifacts.map((item,index)=><li key={index}>{kinds[item.kind] ?? "成果物"}：{reportDeliveryLabel(item.status)}
      {item.downloadable && item.id && <a href={`/api/works/${encodeURIComponent(workId)}/reports/${encodeURIComponent(reportId)}/delivery/file/${encodeURIComponent(item.id)}`}>手動送信用に取得</a>}
      {history.canReconcile && item.id && <span> {item.status!=='Pending' && <button type="button" disabled={busy} onClick={async()=>{
        if(!history.jobId||!item.id||!window.confirm(`「${history.roomName}」にこの成果物が届いていないことを確認しましたか？`))return;
        setBusy(true);setMessage("");try{const response=await fetch('/api/chatwork/production/trial/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:history.jobId,artifactId:item.id,outcome:'NotSent'})});if(!response.ok)throw new Error('照合を保存できません');setMessage('未送信として照合しました。');setRefresh(value=>value+1)}catch(e){setMessage(e instanceof Error?e.message:'照合を保存できません')}finally{setBusy(false)}
      }}>未送信を確認</button>} <button type="button" disabled={busy} onClick={async()=>{
        if(!history.jobId||!item.id)return;const messageId=window.prompt(item.kind==='body'?'確認したメッセージIDを入力してください':'確認したファイルIDを入力してください');if(!messageId?.trim())return;
        setBusy(true);setMessage("");try{const response=await fetch('/api/chatwork/production/trial/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:history.jobId,artifactId:item.id,outcome:'Sent',messageId:messageId.trim()})});if(!response.ok)throw new Error('照合を保存できません');setMessage('送信済みとして照合しました。');setRefresh(value=>value+1)}catch(e){setMessage(e instanceof Error?e.message:'照合を保存できません')}finally{setBusy(false)}
      }}>送信済みを確認</button></span>}</li>)}</ul>}
  </div>;
}
