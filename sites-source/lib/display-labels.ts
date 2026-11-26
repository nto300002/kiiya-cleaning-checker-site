type Connection = {setupReason:string; sourceDisplayName:string|null; roomName:string|null};
export function connectionMessage(value:Connection|null):string {
 if(!value) return 'Chatworkの連携状況を確認できません';
 switch(value.setupReason){
 case 'ReconnectRequired': return 'Chatworkの再接続が必要です';
 case 'PausedByOperator': return 'Chatwork送信を停止中です';
 case 'RoomVerificationRequired': return 'Chatworkの投稿確認待ち';
 case 'AccountNotConnected': return 'Chatworkが未接続です';
 case 'AccountConfirmationRequired': return 'Chatworkの送信元を確認してください';
 case 'RoomNotConfigured': return value.sourceDisplayName ? 'Chatwork連携済み・送信先が未設定' : 'Chatwork送信先を設定してください';
 case 'DeliveryPathUnavailable': return 'Chatwork連携済み・実務送信は準備中';
 default: return 'Chatworkの連携状況を確認してください';
 }
}
export function statusLabel(value:string):string {
 const labels:Record<string,string>={Draft:'下書き',Prepared:'送信準備済み',Completed:'完了'};
 return labels[value] || '状態を確認できません';
}
