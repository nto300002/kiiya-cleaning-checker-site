## 目的
SitesのWorkerとホスト済みシークレットでChatwork OAuth、投稿、結果照合が成立するか検証・実装する。

## 作業
- OAuth state/PKCE、コールバック、トークン更新、ルーム名確認、1ルーム設定を実証する。
- PDF・Markdown本文／添付・画像ファイルの生成と送信を、Workerの実行時間・メモリ・サイズ上限で検証する。
- 成果物別投稿ID、`Sent`／`Failed`／`Unknown`、手動確定、重複回避を実装する。

## 完了条件
- [ ] トークンはブラウザーや公開ソースに出ず、接続・解除・更新が動く。
- [ ] PDFへの画像埋込とChatworkへの画像添付を実ルームで確認する。
- [ ] 全必須成果物確認後だけ`Sent`。部分成功や応答喪失を自動再送しない。
- [ ] 報告IDとChatwork投稿ID／ファイルIDを照合した証跡がある。

関連: 元リポジトリのIssue  `#22`〜`#28`、`#32`、`#34`。設計: `docs/architecture.md`、`docs/requirements.md`。
