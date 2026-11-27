"use client";

type Props = {busy:boolean;confirmed:boolean;canSend:boolean;onClose:()=>void;onSend:()=>void;onRefresh:()=>void};

export function ReportConfirmActions({busy,confirmed,canSend,onClose,onSend,onRefresh}:Props) {
  return <>
    <div className="modal-actions candidate-actions">
      <button type="button" className="button secondary" onClick={onClose}>閉じる</button>
      <button type="button" className="button primary" onClick={onSend} disabled={busy||confirmed||!canSend}>確定して送信</button>
    </div>
    {!canSend && <button type="button" className="button outline" onClick={onRefresh} disabled={busy}>状態を更新</button>}
  </>;
}
