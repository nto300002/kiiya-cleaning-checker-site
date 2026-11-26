"use client";
import { useEffect, useState } from "react";

type Connection = { enabled: boolean; configured: boolean; status: string; accountId: string | null; displayName: string | null; accountConfirmed: boolean; roomId: string | null; roomName: string | null; roomConfirmed: boolean; lastVerifiedAt: string | null; expiresAt: string | null };
type TestPost = { request_id: string; marker: string; status: string; message_id: string | null; error_code: string | null };
async function api<T>(path: string, method = "GET", value?: unknown): Promise<T> {
  const response = await fetch(`/api/chatwork/${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined, cache: "no-store" });
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || "処理に失敗しました");
  return result as T;
}
export default function ChatworkSettings() {
  const [connection, setConnection] = useState<Connection | null>(null), [posts, setPosts] = useState<TestPost[]>([]);
  const [roomId, setRoomId] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  async function refresh() {
    const [current, history] = await Promise.all([api<Connection>("connection"), api<TestPost[]>("posts")]);
    setConnection(current); setRoomId(current.roomId || ""); setPosts(history);
  }
  useEffect(() => { refresh().catch(error => setMessage(error.message)); }, []);
  async function run(fn: () => Promise<void>) {
    setPending(true); setMessage("");
    try { await fn(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "処理に失敗しました"); }
    finally { setPending(false); }
  }
  return <section className="section chatwork-settings" aria-label="Chatwork接続試験">
    <div className="section-title"><h2>Chatwork接続試験</h2><span className="tiny">職員用</span></div>
    <p className="section-copy">既存の本番Site内で行う期限付き試験です。固定した検証用ルームにだけテスト文を送ります。業務報告の自動送信は別途確認します。</p>
    <p className="tiny">Chatworkの投稿権限はOAuth上で特定のルームだけに限定されません。アプリ側で検証用ルームIDを固定し、この画面のAPIにはメッセージの編集・削除操作を設けていません。</p>
    {message && <div className="warning" role="status">{message}</div>}
    {!connection ? <p className="tiny">{message ? "OAuthクライアントと試験期限の設定後に接続状態を確認できます。" : "接続状態を読み込み中です…"}</p> : <>
      <div className="detail-list"><div><span>試験状態</span><strong>{connection.enabled && connection.configured ? connection.status : "無効・未設定"}</strong></div>
        <div><span>送信元</span><strong>{connection.displayName || "未接続"}</strong></div>
        <div><span>account_id</span><strong>{connection.accountId || "未取得"}</strong></div>
        <div><span>検証用ルーム</span><strong>{connection.roomName || "未確認"}</strong></div>
        <div><span>最終テスト</span><strong>{connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString("ja-JP") : "未実施"}</strong></div>
      </div>
      {!connection.enabled || !connection.configured ? <div className="notice mini"><strong>設定待ち</strong><span>OAuthクライアント登録後、開発者がSitesのシークレットと試験期限を設定すると接続できます。</span></div> : <div className="stack chatwork-actions">
        <button type="button" className="button outline" disabled={pending} onClick={() => run(async () => {
          const result = await api<{ authorizeUrl: string }>("oauth/start", "POST");
          if (!result.authorizeUrl.startsWith("https://www.chatwork.com/")) throw new Error("認可URLが不正です");
          window.location.assign(result.authorizeUrl);
        })}>{connection.accountId ? "Chatworkを再接続" : "Chatworkを接続"}</button>
        {connection.accountId && !connection.accountConfirmed && <button type="button" className="button outline" disabled={pending} onClick={() => run(async () => { await api("account/confirm", "POST", { accountId: connection.accountId }); setMessage("送信元アカウントを確認しました"); })}>上記のaccount_idを送信元として確認</button>}
        {connection.accountConfirmed && <div className="chatwork-room-entry"><label htmlFor="chatwork-room-id">検証用ルームID</label><input id="chatwork-room-id" inputMode="numeric" value={roomId} onChange={event => setRoomId(event.target.value.trim())} placeholder="ルームID" disabled={pending}/><button type="button" className="button outline compact" disabled={pending || !/^\d+$/.test(roomId)} onClick={() => run(async () => { await api("room/verify", "POST", { roomId }); setMessage("ルーム名を取得しました。投稿権限はテスト投稿で確認します"); })}>ルーム名を確認</button></div>}
        {connection.roomConfirmed && <button type="button" className="button secondary" disabled={pending} onClick={() => run(async () => {
          const result = await api<{ marker: string; messageId?: string; status: string }>("smoke/test-message", "POST", { requestId: crypto.randomUUID() });
          setMessage(result.status === "Sent" ? `テスト投稿が完了しました。投稿ID: ${result.messageId} / ${result.marker}` : `結果を確認してください: ${result.marker}`);
        })}>固定した検証用ルームへテスト投稿</button>}
        {connection.accountId && <button type="button" className="button outline" disabled={pending} onClick={() => run(async () => { await api("disconnect", "POST"); setMessage("接続情報をアプリから削除しました。Chatwork側の認可解除はChatworkで行ってください"); })}>接続を解除</button>}
      </div>}
      {posts.length > 0 && <div className="chatwork-posts"><h3>最近の試験記録</h3>{posts.map(post => <div className="version-row" key={post.request_id}><span>{post.marker}</span><strong>{post.status}{post.message_id ? ` · ${post.message_id}` : ""}</strong></div>)}</div>}
    </>}
  </section>;
}
