"use client";
import {useEffect,useRef,useState} from 'react';
const steps=[
 {title:'今日の作業',text:'スタッフの人数と名前を入力し、作業を始めます。担当職員と日付を確認してください。',image:'work-start.jpg'},
 {title:'清掃範囲',text:'今日清掃する客室と人数、清掃種別を選びます。トイレとシャワーの対象数も確認します。',image:'scope.jpg'},
 {title:'全体チェック',text:'客室のチェックと作業ごとの担当・時間を記録します。休憩や気づき、写真もここに入力できます。',image:'checks.jpg'},
 {title:'報告内容',text:'入力した内容を確認し、必要に応じて編集します。報告時は送信先と内容を確認してから確定してください。',image:'report.jpg'},
];
export default function HomeTutorial({onClose}:{onClose:()=>void}){
 const [step,setStep]=useState(0);const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;close.current?.focus();const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return()=>{window.removeEventListener('keydown',onKey);previous?.focus()}},[onClose]);
 const current=steps[step];
 return <div className="modal-backdrop"><section className="modal tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
  <div className="tutorial-heading"><div><p className="overline">HOW TO USE · {step+1} / {steps.length}</p><h2 id="tutorial-title">使い方ガイド</h2></div><button ref={close} className="tutorial-close" type="button" onClick={onClose} aria-label="ガイドを閉じる">×</button></div>
  <h3>{current.title}</h3><p className="tutorial-copy">{current.text}</p>
  <img className="tutorial-image" src={`/assets/tutorial/${current.image}`} alt={`${current.title}の画面例`}/><p className="tutorial-note">画像はデモ画面の例です。実際の画面と一部異なる場合があります。</p>
  <div className="tutorial-progress" aria-label={`${steps.length}手順中${step+1}番目`}>{steps.map((item,i)=><span key={item.title} className={i===step?'active':''}/>)}</div>
  <div className="modal-actions"><button className="button secondary" type="button" onClick={()=>step?setStep(step-1):onClose()}>{step?'戻る':'閉じる'}</button><button className="button primary" type="button" onClick={()=>step===steps.length-1?onClose():setStep(step+1)}>{step===steps.length-1?'閉じる':'次へ'}</button></div>
 </section></div>;
}
