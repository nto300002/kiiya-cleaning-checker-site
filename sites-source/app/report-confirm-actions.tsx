"use client";

type Props = {busy:boolean;confirmed:boolean;canSend:boolean;onClose:()=>void;onSend:()=>void;onRefresh:()=>void;onDiscard:()=>void};

export function ReportConfirmActions({busy,confirmed,canSend,onClose,onSend,onRefresh,onDiscard}:Props) {
  return <>
    <div className="modal-actions candidate-actions">
      <button type="button" className="button secondary" onClick={onClose}>閉じる</button>
      <button type="button" className="button primary" onClick={onSend} disabled={busy||!canSend}>確定して送信</button>
    </div>
    <details className="candidate-more">
      <summary>その他<span aria-hidden="true" className="candidate-more-arrow"/></summary>
      <div className="candidate-more-actions">
        <button type="button" className="button outline" onClick={onDiscard} disabled={busy||confirmed}>候補を破棄</button>
        <button type="button" className="button outline" onClick={onRefresh} disabled={busy}>状態を更新</button>
      </div>
    </details>
  </>;
}
