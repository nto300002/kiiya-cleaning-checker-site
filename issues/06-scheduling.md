## 目的
案Aで、報告・マスタ通知の5分照合、1分監視、日次期限処理をCloud Run専用ワーカーからSite内部APIへ接続する実行基盤に移す。

## 作業
- `docs/sites-async-review.md`の案Aに従い、Cloud Tasksを個別の投稿・5分後照合、Cloud Schedulerを毎分監視・日次処理に使い、認証付きでCloud Runを起動する。
- Cloud Run専用ワーカーは**保護されたSite APIだけ**を通じてジョブ確保・ファイル取得・結果保存・投稿用アクセストークン取得を行う。ワーカーからSites管理のD1/R2へ直接アクセスしない。Site側だけがChatworkトークンを更新する。
- 重複実行、停止からの再開、`Unknown`保留、通知回数上限、日次R2走査の時間を検証する。

## 完了条件
- [ ] Cloud TasksからCloud Runへの5分後配送、Cloud SchedulerからCloud Runへの毎分・日次起動を実ログで確認する。
- [ ] 無認証からの実行を拒否し、外部実行者に一般職員権限を与えない。
- [ ] 重複起動でもChatwork投稿・版確定が重複しない。
- [ ] 停止中に期限を過ぎた処理が復帰後に実行される。
- [ ] Site内部APIとCloud Runの認証方式・資格情報保管・失効方法、ジョブ単位の権限を検証する。
- [ ] Site API経由のD1/R2読み書き、画像/PDF転送、排他と再実行を確認する。案Aが成立しなければ未達と記録して構成判断を再審議する。

関連: 元リポジトリのIssue  `#7`、`#26`、`#27`、`#30`、`#32`、`#57`。設計: `docs/architecture.md`、`docs/decision-log.md`。
