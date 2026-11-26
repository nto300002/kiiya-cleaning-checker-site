export function reportDeliveryLabel(status:string):string {
  const labels:Record<string,string> = {
    TestAwaitingRegistration:"試験送信の登録待ち", DispatchPending:"送信待ち", Dispatched:"送信待ち", Pending:"送信待ち", Posting:"送信中",
    Sent:"送信済み", Failed:"送信できませんでした", Unknown:"結果不明：再送せず担当者に確認",
    ConfigurationChangedHold:"送信先の変更により保留中",
  };
  return labels[status] ?? "状態を確認できません";
}
