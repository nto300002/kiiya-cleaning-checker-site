"use client";
import { useEffect, useState } from "react";

type Staff = { id?: string; displayName: string; staffRevision?: string; authorized?: boolean; appAdmin?: boolean; role: "normal" | "field" };
type Candidate = { id: string; displayName: string; email: string; seenAt: string };

function StaffCard({ staff, canEditName, canChangeRole, onSaved }: { staff: Staff; canEditName: boolean; canChangeRole: boolean; onSaved: (staff: Staff) => void }) {
  const [name, setName] = useState(staff.displayName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmRole, setConfirmRole] = useState<"normal" | "field" | null>(null);
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(staff.id!)}/display-name`, {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ name: name.trim(), expectedStaffRevision: staff.staffRevision }),
      });
      const result = await response.json() as Staff & { error?: string };
      if (!response.ok) throw new Error(result.error || "保存できませんでした");
      onSaved({ ...staff, displayName: result.displayName, staffRevision: result.staffRevision });
      setMessage("表示名を保存しました");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存できませんでした"); }
    finally { setBusy(false); }
  }
  async function changeRole() {
    if (!confirmRole || !staff.id) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(staff.id)}/role`, {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ role: confirmRole, expectedStaffRevision: staff.staffRevision }),
      });
      const result = await response.json() as Staff & { error?: string };
      if (!response.ok) throw new Error(result.error || "権限を変更できませんでした");
      onSaved({ ...staff, role: result.role, staffRevision: result.staffRevision });
      setConfirmRole(null); setMessage("権限を変更しました。対象者に画面更新を依頼してください");
    } catch (error) { setMessage(error instanceof Error ? error.message : "権限を変更できませんでした"); }
    finally { setBusy(false); }
  }
  return <article className="staff-card">
    <div className="staff-card-head"><strong>{staff.displayName}</strong><span className={`badge ${staff.role === "field" ? "good" : ""}`}>{staff.appAdmin ? "アプリ管理者" : staff.role === "field" ? "現場職員" : "通常職員"}</span></div>
    {canEditName && <><label className="field"><span className="field-label">氏名（表示名）</span><input value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-label={`${staff.displayName}の氏名（表示名）`}/></label>
    <button type="button" className="button outline compact" disabled={busy || !name.trim() || name.trim() === staff.displayName} onClick={save}>表示名を保存</button>
    {canChangeRole && !staff.appAdmin && <button type="button" className="button outline compact" disabled={busy} onClick={() => setConfirmRole(staff.role === "field" ? "normal" : "field")}>{staff.role === "field" ? "通常職員に変更" : "現場職員に変更"}</button>}
    {confirmRole && <div className="notice mini" role="group" aria-label="権限変更の確認"><strong>{staff.displayName}を{confirmRole === "field" ? "現場職員" : "通常職員"}に変更しますか？</strong><span>{confirmRole === "field" ? "清掃作業、Chatwork設定、マニュアル変更、職員の氏名と権限の変更ができるようになります。" : "清掃記録・報告書・写真の閲覧のみになります。"}</span><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setConfirmRole(null)}>キャンセル</button><button type="button" className="button primary" disabled={busy} onClick={changeRole}>変更を確定</button></div></div>}</>}
    {message && <p className="staff-message" role="status">{message}</p>}
    {canEditName && <details className="staff-id"><summary>登録用IDを表示</summary><code>{staff.id}</code></details>}
  </article>;
}

export default function StaffDirectory({ onOwnNameChanged, ownId, canManage, canRegister }: { onOwnNameChanged: () => void; ownId: string; canManage: boolean; canRegister: boolean }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportChecksum, setExportChecksum] = useState<{ filename: string; text: string } | null>(null);
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function exportAll() {
    setExportMessage(""); setExportChecksum(null); setExporting(true);
    try {
      const response = await fetch("/api/admin/export", { cache: "no-store" });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || `全件データを取得できませんでした（${response.status}）`);
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "kiiya-cleaning.zip";
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      download(new Blob([bytes], { type: "application/zip" }), filename);
      setExportChecksum({ filename: filename.replace(/\.zip$/, ".sha256"), text: `${hash}  ${filename}\n` });
      setExportMessage("業務レコード、テーブル構造、画像をダウンロードしました。照合用ファイルも保存してください。");
    } catch (cause) { setExportMessage(cause instanceof Error ? cause.message : "出力できませんでした"); }
    finally { setExporting(false); }
  }
  const [error, setError] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState("");
  async function lookupCandidate() {
    setRegisterBusy(true); setCandidate(null); setConfirmed(false); setRegistrationMessage("");
    try {
      const response = await fetch(`/api/users/registration-candidate/${encodeURIComponent(registrationId.trim())}`, { cache: "no-store" });
      const result = await response.json() as Candidate & { error?: string };
      if (!response.ok) throw new Error(result.error || "登録用IDを確認できませんでした");
      setCandidate(result);
      setCandidateName(result.displayName);
    } catch (reason) { setRegistrationMessage(reason instanceof Error ? reason.message : "登録用IDを確認できませんでした"); }
    finally { setRegisterBusy(false); }
  }
  async function renameCandidate() {
    if (!candidate) return;
    setRegisterBusy(true); setRegistrationMessage("");
    try {
      const response = await fetch(`/api/users/registration-candidate/${encodeURIComponent(candidate.id)}/display-name`, {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ name: candidateName.trim(), expectedSeenAt: candidate.seenAt }),
      });
      const result = await response.json() as Candidate & { error?: string };
      if (!response.ok) throw new Error(result.error || "表示名を変更できませんでした");
      setCandidate({ ...candidate, displayName: result.displayName, seenAt: result.seenAt });
      setConfirmed(false);
      setRegistrationMessage("登録待ちの表示名を保存しました。利用登録はまだ行われていません");
    } catch (reason) { setRegistrationMessage(reason instanceof Error ? reason.message : "表示名を変更できませんでした"); }
    finally { setRegisterBusy(false); }
  }
  async function registerCandidate() {
    if (!candidate || !confirmed) return;
    setRegisterBusy(true); setRegistrationMessage("");
    try {
      const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ registrationId: candidate.id, expectedSeenAt: candidate.seenAt }) });
      const result = await response.json() as Staff & { error?: string };
      if (!response.ok) throw new Error(result.error || "登録できませんでした");
      setStaff(current => [...current, { id: result.id, displayName: result.displayName, role: "normal", staffRevision: "1", appAdmin: false, authorized: true }]);
      setCandidate(null); setConfirmed(false); setRegistrationId("");
      setRegistrationMessage("通常職員として登録しました。本人に画面更新を依頼してください");
    } catch (reason) { setRegistrationMessage(reason instanceof Error ? reason.message : "登録できませんでした"); }
    finally { setRegisterBusy(false); }
  }
  useEffect(() => {
    fetch("/api/users", { cache: "no-store" }).then(async response => {
      const result = await response.json() as unknown;
      if (!response.ok) throw new Error((result as { error?: string }).error || "職員台帳を読み込めません");
      if (!Array.isArray(result)) throw new Error("職員台帳を読み込めません");
      setStaff(result as Staff[]);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "職員台帳を読み込めません"));
  }, []);
  return <section className="section">
    {canRegister && <section className="section" aria-labelledby="export-heading"><h2 id="export-heading">全件データのダウンロード</h2><p>清掃作業・報告・画像・マスタ履歴などの業務レコード、全テーブルの構造と件数、R2 の画像本体を ZIP に保存します。認証・連携トークンの値は含みません。</p><button className="button primary" type="button" disabled={exporting} onClick={() => void exportAll()}>{exporting ? "作成中…" : "全レコードとテーブル構造をダウンロード"}</button>{exportChecksum && <button className="button secondary" type="button" onClick={() => download(new Blob([exportChecksum.text], { type: "text/plain" }), exportChecksum.filename)}>照合用 SHA-256 を保存</button>}{exportMessage && <p role="status">{exportMessage}</p>}</section>}
    <p className="section-copy">自分の表示名を変更できます。他職員の表示名は現場職員、権限と利用登録はアプリ管理者が変更できます。</p>
    {canRegister && <div className="select-card"><h2>新しい職員を登録</h2><p className="section-copy">本人が自分のアカウントでアプリを開き、表示された登録用IDを受け取ってください。氏名だけで登録せず、本人とIDを照合します。</p>
      <label className="field"><span className="field-label">登録用ID</span><input value={registrationId} maxLength={512} autoComplete="off" placeholder="本人から受け取った登録用ID" onChange={event => { setRegistrationId(event.target.value); setCandidate(null); setConfirmed(false); setRegistrationMessage(""); }}/></label>
      <button type="button" className="button outline compact" disabled={!registrationId.trim() || registerBusy} onClick={lookupCandidate}>IDを照合</button>
      {candidate && <div className="notice mini" role="group" aria-label="登録する職員の確認"><strong>この人を通常職員として登録しますか？</strong><label className="field"><span className="field-label">登録待ちの氏名（表示名）</span><input value={candidateName} maxLength={80} onChange={event => setCandidateName(event.target.value)}/></label><button type="button" className="button outline compact" disabled={registerBusy || !candidateName.trim() || candidateName.trim() === candidate.displayName} onClick={renameCandidate}>表示名を保存（未承認のまま）</button><span>メール：{candidate.email}</span><span>登録用ID：{candidate.id}</span><label className="check-pill"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>本人と登録用IDを確認しました</span></label><button type="button" className="button primary compact" disabled={!confirmed || registerBusy || candidateName.trim() !== candidate.displayName} onClick={registerCandidate}>通常職員として登録</button></div>}
      {registrationMessage && <p className="staff-message" role="status">{registrationMessage}</p>}</div>}
    {error && <div className="warning" role="alert">{error}</div>}
    <div className="stack">{staff.map(person => <StaffCard key={person.id || person.displayName} staff={person} canEditName={canManage || person.id === ownId} canChangeRole={canRegister} onSaved={updated => {
      setStaff(current => current.map(item => item.id === updated.id ? updated : item));
      if (updated.id === ownId) onOwnNameChanged();
    }}/>)}</div>
  </section>;
}
