"use client";
import { useEffect, useRef, useState } from "react";
import { verificationRequestId } from "@/lib/verification-request-id";

type Settings = { version: string; status: string; accountId: string | null; displayName: string | null; accountConfirmed: boolean; roomId: string | null; roomName: string | null; destinationVerified: boolean; paused: boolean; deliveryEnabled: boolean; oauthConfigured: boolean; verificationReady: boolean };
type DeliveryStatus = { setupRequired: boolean; setupReason: string; sourceDisplayName: string | null; roomName: string | null; deliveryEnabled: boolean };
type Candidate = { candidateId: string; roomId: string; roomName: string; expiresAt: string };
type Verification = { verificationId: string; requestId: string | null; marker: string; status: string; messageId: string | null; errorCode: string | null; roomName: string; roomId: string; accountId: string; canConfirm: boolean; createdAt: string };
const steps = [
  { target: "connect", title: "送信元を接続", description: "業務報告を投稿するChatworkアカウントで接続します。職員ごとの接続は不要です。" },
  { target: "account", title: "送信元を確認", description: "Chatworkから戻ったら表示名を確認し、予定したアカウントなら確定します。識別番号は詳細で照合できます。" },
  { target: "room", title: "ルームIDを入力", description: "Chatworkの業務報告ルームを開き、URLの「rid」に続く数字を入力します。数字だけで決めず、次にルーム名も確認します。" },
  { target: "preview", title: "ルーム名を取得", description: "入力したIDのルーム名をChatworkから取得します。この時点では送信先は変更されません。" },
  { target: "confirm", title: "送信先を確定", description: "表示されたルーム名が業務報告用のルームと一致することを確認して確定します。ここではまだ投稿しません。" },
  { target: "verify", title: "届いた内容を確認", description: "確認文を送ったら、Chatworkを開いて投稿者・ルーム名・識別番号を照合します。届いたことを確認してから確定します。" },
] as const;
type StepKey = typeof steps[number]["target"];
async function call<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/chatwork/production/${path}`, { method: data === undefined ? "GET" : "POST", headers: data === undefined ? undefined : { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store" });
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || "設定を確認できません");
  return result;
}
export default function ChatworkProductionSettings({ canManage, deliveryStatus, onUpdated }: { canManage: boolean; deliveryStatus: DeliveryStatus | null; onUpdated?: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null), [roomId, setRoomId] = useState(""), [candidate, setCandidate] = useState<Candidate | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null), [arrivalChecked, setArrivalChecked] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [verificationLoaded, setVerificationLoaded] = useState(false);
  const [reconcileChecked, setReconcileChecked] = useState(false), [reconcileOutcome, setReconcileOutcome] = useState<"" | "Sent" | "NotSent">(""), [reconcileMessageId, setReconcileMessageId] = useState("");
  const refreshSequence = useRef(0);
  const [tourStage, setTourStage] = useState<"closed" | "intro" | "steps">("closed"), [tourStep, setTourStep] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  async function refresh() {
    if (!canManage) return;
    const sequence = ++refreshSequence.current;
    setVerificationLoaded(false);
    const current = await call<Settings>("settings");
    const latest = await call<Verification | null>("verifications/latest");
    if (sequence !== refreshSequence.current) return;
    setSettings(current);
    setVerification(latest);
    setVerificationLoaded(true);
    if (!candidate) setRoomId(current.roomId || "");
    onUpdated?.();
  }
  useEffect(() => {
    if (!verification || !["DispatchPending", "Dispatched", "Posting"].includes(verification.status)) return;
    const timer = window.setInterval(() => {
      call<Verification>(`verifications/${verification.verificationId}`).then(setVerification).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [verification?.verificationId, verification?.status]);
  useEffect(() => { refresh().catch(error => setMessage(error.message)); }, [canManage]);
  useEffect(() => {
    if (tourStage !== "steps") return;
    const frame = window.requestAnimationFrame(() => sectionRef.current?.querySelector(`[data-cw-tour="${steps[tourStep].target}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [tourStage, tourStep]);
  useEffect(() => {
    if (tourStage === "closed") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setTourStage("closed"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourStage]);
  async function run(action: () => Promise<void>, refreshAfter = true) {
    setBusy(true); setMessage("");
    try { await action(); if (refreshAfter) await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "処理に失敗しました"); }
    finally { setBusy(false); }
  }
  const view: Settings = settings ?? { version: "0", status: deliveryStatus?.setupReason || "Unconfigured", accountId: null, displayName: deliveryStatus?.sourceDisplayName || null, accountConfirmed: false, roomId: null, roomName: deliveryStatus?.roomName || null, destinationVerified: false, paused: false, deliveryEnabled: false, oauthConfigured: false, verificationReady: false };
  const enabled = canManage && !!settings && !busy;
  const spotlight = (target: StepKey, content: React.ReactNode) => <div className={`cw-tour-target ${tourStage === "steps" && steps[tourStep].target === target ? "active" : ""}`} data-cw-tour={target}>
    {content}
    {tourStage === "steps" && steps[tourStep].target === target && <div className="cw-tour-bubble" role="dialog" aria-label="Chatwork設定の操作説明">
      <small>{tourStep + 1} / {steps.length}</small><strong>{steps[tourStep].title}</strong><p>{steps[tourStep].description}</p>
      <div className="cw-tour-actions"><button type="button" onClick={() => setTourStage("closed")}>終了</button>{tourStep > 0 && <button type="button" onClick={() => setTourStep(tourStep - 1)}>戻る</button>}<button type="button" className="next" onClick={() => tourStep + 1 < steps.length ? setTourStep(tourStep + 1) : setTourStage("closed")}>{tourStep + 1 < steps.length ? "次へ" : "完了"}</button></div>
    </div>}
  </div>;
  return <section ref={sectionRef} className="section chatwork-settings" aria-label="Chatwork送信設定">
    <div className="section-title"><h2>Chatwork連携</h2><button type="button" className="cw-tour-launch" onClick={() => { setTourStep(0); setTourStage("intro"); }}>チュートリアル</button></div>
    <p className="section-copy">報告に使う送信元とルームを順番に設定します。清掃記録は連携前でも利用できます。</p>
    {!canManage && <div className="notice mini"><strong>設定担当職員が操作します</strong><span>下の入力欄で手順を確認できます。接続や送信先の変更は、設定担当職員に依頼してください。</span></div>}
    {message && <div className="warning" role="status">{message}</div>}
    <div className="notice mini"><strong>送信の状態</strong><span>{deliveryStatus?.deliveryEnabled ? "業務報告を送信できます" : view.status === "ReconnectRequired" ? "Chatworkの再接続が必要です" : view.paused ? "送信を停止中です" : view.destinationVerified ? "送信先を確認済み。業務報告の送信経路は確認中です" : view.status === "DestinationVerificationRequired" ? "送信元・送信先を登録済み／投稿確認待ち。業務報告はまだ送信できません" : "Chatworkへの実務報告はまだ送信できません"}</span></div>
    <div className="chatwork-step"><h3>1. 送信元を接続</h3>
      {spotlight("connect", <><p>報告の投稿に使うChatworkアカウントで接続してください。接続時には、参加しているルームへのファイルアップロード権限も求められます。</p>
        <button type="button" className="button outline" disabled={!enabled || !view.oauthConfigured} onClick={() => run(async () => {
          const result = await call<{ authorizeUrl: string }>("oauth/start", {});
          if (!result.authorizeUrl.startsWith("https://www.chatwork.com/")) throw new Error("接続先が正しくありません");
          window.location.assign(result.authorizeUrl);
        })}>{view.accountId ? "Chatworkを再接続" : "Chatworkを接続"}</button>
        {canManage && !view.oauthConfigured && <p className="tiny">接続準備中です。アプリ管理者による接続設定が必要です。</p>}</>)}
      {spotlight("account", <><div className="detail-list"><div><span>投稿者の表示名</span><strong>{view.displayName || "未接続"}</strong></div></div>
        {canManage && view.accountId && <details className="cw-account-detail"><summary>アカウントの識別番号を確認</summary><code>{view.accountId}</code></details>}
        <button type="button" className="button secondary" disabled={!enabled || !view.accountId || view.accountConfirmed} onClick={() => run(async () => {
          await call("account/confirm", { accountId: view.accountId, expectedVersion: view.version }); setMessage("送信元を確認しました");
        })}>{view.accountConfirmed ? "送信元を確認済み" : "このアカウントを送信元にする"}</button></>)}
    </div>
    <div className="chatwork-step"><h3>2. 送信先のルームを指定</h3>
      {spotlight("room", <><p>Chatworkで業務報告ルームを開き、URLの「rid」の後にある数字を入力します。</p>
        <label htmlFor="production-room-id" className="micro-label">ルームID</label><input id="production-room-id" inputMode="numeric" pattern="[0-9]*" value={roomId} onChange={event => { setRoomId(event.target.value.trim()); setCandidate(null); }} placeholder="例：123456789" disabled={!enabled || !view.accountConfirmed}/></>)}
      {spotlight("preview", <button type="button" className="button outline compact" disabled={!enabled || !view.accountConfirmed || !/^\d{1,20}$/.test(roomId)} onClick={() => run(async () => {
        const result = await call<Candidate>("room/preview", { roomId, expectedVersion: view.version });
        setCandidate(result); setMessage("ルーム名を取得しました。下の名前を確認してください");
      }, false)}>ルーム名を確認する</button>)}
      {spotlight("confirm", <div className="chatwork-room-candidate"><span>確認したルーム</span><strong>{candidate?.roomName || "ルーム名の確認後に表示されます"}</strong>{candidate && <small>入力したルームID：{candidate.roomId}</small>}<small>名前が業務報告ルームと一致するか確認してください。10分以内に確定できます。</small>
        <button type="button" className="button secondary" disabled={!enabled || !candidate} onClick={() => run(async () => {
          await call("room/confirm", { candidateId: candidate!.candidateId, expectedVersion: view.version });
          setCandidate(null); setMessage("送信先を保存しました。実際の投稿確認はまだ完了していません");
        })}>このルームを送信先にする</button></div>)}
      {view.roomName && <div className="detail-list"><div><span>保存済みの送信先</span><strong>{view.roomName}</strong></div></div>}
    </div>
    <div className="chatwork-step"><h3>3. 投稿を確認</h3>
      {spotlight("verify", <><p>送信先を確定した後、個人情報を含まない確認文を送り、Chatwork画面で投稿者・ルーム名・識別番号を照合します。</p>
        <button type="button" className="button outline" disabled={!enabled || !verificationLoaded || !view.verificationReady || !view.roomId || !!view.paused || !!verification && (["DispatchPending", "Dispatched", "Posting", "Unknown"].includes(verification.status) || verification.status === "Sent" && verification.canConfirm && !view.destinationVerified)} onClick={() => run(async () => {
          const key = `kiiya-verification-request-${view.version}`;
          const requestId = verificationRequestId(window.localStorage.getItem(key), verification, () => crypto.randomUUID());
          window.localStorage.setItem(key, requestId);
          try {
            const result = await call<Verification>("verify-posting", { expectedVersion: view.version, requestId });
            setVerification(result); setArrivalChecked(false);
          } catch (error) {
            setVerificationLoaded(false);
            throw error;
          }
        }, false)}>確認文を送る</button>
        {!verificationLoaded && <p className="tiny">確認投稿の最新状態を取得してください。 <button type="button" disabled={busy} onClick={() => run(async () => {}, true)}>最新状態を取得</button></p>}
        {!view.verificationReady && <p className="tiny">投稿経路を準備中です。ワーカーの確認後にこのボタンが使えるようになります。</p>}
        {verification && <div className="chatwork-room-candidate" role="status"><span>確認投稿の状態：{verification.status}</span><strong>{verification.roomName}</strong><small>照合する識別番号：{verification.marker}</small>
          {verification.messageId && <small>Chatwork投稿ID：{verification.messageId}</small>}
          {verification.status === "Sent" && verification.canConfirm && !view.destinationVerified && <><label className="task-row"><input type="checkbox" checked={arrivalChecked} onChange={event => setArrivalChecked(event.target.checked)}/><span>Chatworkで投稿者・ルーム名・識別番号を照合しました</span></label>
            <button type="button" className="button secondary" disabled={!enabled || !arrivalChecked} onClick={() => run(async () => {
              await call(`verifications/${verification.verificationId}/confirm`, { expectedVersion: view.version });
              setMessage("送信先の投稿を確認しました。業務報告の送信可否は別に確認します。");
            })}>届いたことを確定する</button></>}
          {verification.status === "Sent" && !verification.canConfirm && <p className="tiny">投稿済みの記録は残りました。設定が変更されたか、元の担当者と異なるため、この投稿では送信先を確定できません。現在の送信先を改めて確認してください。</p>}
          {verification.status === "Unknown" && <div>
            <p className="tiny">再送する前に、下記の送信元と元のルームで、上の識別番号を含む投稿をChatworkで照合してください。投稿の有無を確実に判断できない場合は、結果不明のままにしてください。</p>
            <p className="tiny">未送信を確定する前に、運用担当者が旧ワーカーの停止とChatworkトークンの無効化を確認・記録する必要があります。確認できない場合は結果不明のままにしてください。</p>
            <small>送信元アカウントID：{verification.accountId}／元のルームID：{verification.roomId}／要求日時：{verification.createdAt}</small>
            <fieldset><legend>照合結果</legend>
              <label><input type="radio" name="verification-outcome" checked={reconcileOutcome === "NotSent"} onChange={() => { setReconcileOutcome("NotSent"); setReconcileChecked(false); }}/> 投稿されていないと確認した</label>
              <label><input type="radio" name="verification-outcome" checked={reconcileOutcome === "Sent"} onChange={() => { setReconcileOutcome("Sent"); setReconcileChecked(false); }}/> 投稿されていると確認した</label>
            </fieldset>
            {reconcileOutcome === "Sent" && <label>Chatwork投稿ID（数字）<input inputMode="numeric" value={reconcileMessageId} onChange={event => setReconcileMessageId(event.target.value.trim())}/></label>}
            {reconcileOutcome && <label className="task-row"><input type="checkbox" checked={reconcileChecked} onChange={event => setReconcileChecked(event.target.checked)}/><span>元の送信元・ルーム・識別番号と投稿の有無を照合し、この結果を記録します</span></label>}
            <button type="button" className="button secondary" disabled={!enabled || !verificationLoaded || !reconcileChecked || !reconcileOutcome || reconcileOutcome === "Sent" && !/^[0-9]{1,100}$/.test(reconcileMessageId)} onClick={() => run(async () => {
              await call(`verifications/${verification.verificationId}/resolve`, { checked: true, marker: verification.marker, outcome: reconcileOutcome, ...(reconcileOutcome === "Sent" ? { messageId: reconcileMessageId } : {}) });
              setReconcileChecked(false); setReconcileOutcome(""); setReconcileMessageId("");
              setMessage("照合結果を記録しました。送信先の確定は別途行ってください。");
            })}>照合結果を記録する</button>
          </div>}
          {verification.status === "Failed" && <p className="tiny">投稿に失敗しました。接続と権限を確認してください。{verification.errorCode || ""}</p>}
        </div>}</>)}
    </div>
    <div className="notice mini"><strong>実務報告の送信確認</strong><span>確認文が届いた後、専用の検証作業から報告を1件送り、本文・添付・アプリの状態を照合します。結果が不明な場合は再送せず、Chatworkを確認して設定担当者へ連絡してください。</span></div>
    {tourStage === "steps" && <div className="cw-tour-scrim" aria-hidden="true"/>}
    {tourStage === "intro" && <div className="cw-tour-intro-backdrop"><div className="cw-tour-intro" role="dialog" aria-modal="true" aria-labelledby="cw-tour-title">
      <p className="overline">HOW TO USE</p><h2 id="cw-tour-title">Chatwork連携の流れ</h2>
      <ul><li>現場職員が投稿に使うアカウントを接続し、表示名を確認します。</li><li>業務報告ルームのIDを入力し、取得したルーム名を確認して保存します。</li><li>確認文を送り、Chatwork上の投稿者・ルーム名・識別番号を照合して確定します。</li><li>確認文の到着と、業務報告を送信できることは別々に確認します。</li></ul>
      <div className="cw-tour-actions"><button type="button" onClick={() => setTourStage("closed")}>閉じる</button><button type="button" className="next" onClick={() => { setTourStep(0); setTourStage("steps"); }}>入力場所を見る</button></div>
    </div></div>}
  </section>;
}
