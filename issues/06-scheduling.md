## 目的
案Aで、報告・マスタ通知の5分照合、1分監視、日次期限処理をCloud Run専用ワーカーからSite内部APIへ接続する実行基盤に移す。

## 作業
- `docs/sites-async-review.md`の案Aに従い、Cloud Tasksを個別の投稿・5分後照合、Cloud Schedulerを毎分監視・日次処理に使い、認証付きでCloud Runを起動する。
- Cloud Run専用ワーカーは**保護されたSite APIだけ**を通じてジョブ確保・ファイル取得・結果保存・投稿用アクセストークン取得を行う。ワーカーからSites管理のD1/R2へ直接アクセスしない。Site側だけがChatworkトークンを更新する。
- Cloud Schedulerは毎分、OIDC認証付きで非公開Cloud Runの監視入口を起動する。ワーカーはD1の未投入確認ジョブの再投入、失効リースの`Unknown`確定、保留中の設定変更の進行をSite内部API経由で実行し、全監視が成功した場合だけ`POST /api/internal/delivery/heartbeat`へ`workerRevision`、`siteRevision`、一意の`monitorRunId`、`monitorSucceeded=true`を送る。Siteはサービス認証、承認済み配備版、一意の実行IDを検査し、受信時刻を保存する。監視対象が0件でも毎分実行する。失敗・無認証・版不一致は正常ハートビートとして扱わず、3分超で本番送信登録を止める。
- 確認投稿ジョブとキュー投入意図はD1で原子的に保存する。Cloud Tasks投入失敗時の`DispatchPending`を毎分監視で同一の決定的タスク名を使って再投入する。タスクが既存なら投入済みと照合する。ワーカーが外部POSTを開始した`Posting`または結果不明`Unknown`は再投入・再投稿しない。投稿リースの重複取得をD1の条件付き更新で拒否する。
- 重複実行、停止からの再開、`Unknown`保留、通知回数上限、日次R2走査の時間を検証する。

## 完了条件
- [ ] Cloud TasksからCloud Runへの5分後配送、Cloud SchedulerからCloud Runへの毎分・日次起動を実ログで確認する。
- [ ] 毎分監視の実行ID、Site内部APIの認証主体と配備版、Site受信時刻を照合する。監視失敗・ワーカー停止・古い配備版・無認証時に正常ハートビートが更新されず、3分超で`DeliveryEnabled=false`となる。監視復旧後の再評価も確認する。
- [ ] D1保存成功・キュー投入失敗の検証IDを`DispatchPending`として検出・再投入し、同一`requestId`、タスク名重複、リース失効でも二重投稿しない。外部POST開始後の`Unknown`は自動再送しない。
- [ ] 無認証からの実行を拒否し、外部実行者に一般職員権限を与えない。
- [ ] 重複起動でもChatwork投稿・版確定が重複しない。
- [ ] 停止中に期限を過ぎた処理が復帰後に実行される。
- [ ] Site内部APIとCloud Runの認証方式・資格情報保管・失効方法、ジョブ単位の権限を検証する。
- [ ] Site API経由のD1/R2読み書き、画像/PDF転送、排他と再実行を確認する。案Aが成立しなければ未達と記録して構成判断を再審議する。

関連: 元リポジトリのIssue  `#7`、`#26`、`#27`、`#30`、`#32`、`#57`。設計: `docs/architecture.md`、`docs/decision-log.md`。
