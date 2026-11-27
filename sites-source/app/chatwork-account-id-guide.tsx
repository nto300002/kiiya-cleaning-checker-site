import React from 'react';
export default function AccountIdGuide({accountId}:{accountId:string}){
 return <div className="cw-account-id"><span className="cw-account-id-label">接続中のアカウントID</span><code>{accountId}</code><details className="cw-account-guide"><summary>アカウントIDの確認方法</summary><p>Chatworkの画面右上にあるユーザー名をクリックし、「環境設定」→「Chatworkについて」の順に開いてください。表示されるアカウントIDを上のIDと照合し、一致することを確認してください。</p></details></div>;
}
