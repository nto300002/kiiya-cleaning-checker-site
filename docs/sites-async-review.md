# Sitesの非同期・定期処理に関する資料調査（2026-10-21）

## 確認できたこと

- [OpenAIのSites説明](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)とSitesスキルの`references/recurring-updates.md`は、公開済みSiteにクラウド定期更新を結び付け、Siteを閉じても更新できることを説明する。一方、業務要件の**毎分監視**や**報告ごとの5分後起動**を保証する間隔・遅延の仕様は確認できない。訪問者がSite内で許可した外部アプリのアクセス権も定期タスクへ自動継承されない。
- [ChatGPTのScheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)には、対象プランの繰り返しタスクは最短1時間という一般的な説明がある。ただしSitesに結び付くスケジュールへ同じ上限が必ず適用されるとは、この資料だけでは断定しない。
- [Cloudflare WorkersのCron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)は基盤側の機能だが、Sitesのホスティング設定で任意のCron Triggerを宣言・運用できるというSites固有の手順は確認できない。基盤に機能があることをSitesで使える証拠にはしない。
- [Cloud Tasks](https://docs.cloud.google.com/tasks/docs/create-tasks)は指定時刻に汎用HTTPSエンドポイントへ個別タスクを送れる。[Cloud Scheduler](https://docs.cloud.google.com/scheduler/docs/configuring/cron-job-schedules)は`* * * * *`の毎分実行と日次実行を設定できる。繰り返し実行にはCloud Schedulerを使い、Cloud Tasksは報告・通知単位の遅延配送を担う。
- [Cloud TasksのHTTPターゲット](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)は認証トークンを付けられる。ただしSitesの非公開入口がGoogleのOIDCトークンをそのまま受け付けるとは確認できない。Sites側のサービスアクセス方式、秘密値の受け渡し、受信側の検証と権限を実証する必要がある。

## Sites版の暫定構成

1. 報告確定またはマスタ通知確定からの配送・5分後照合をCloud Tasksへ登録する。
2. 毎分監視と日次の保存期限処理はCloud Schedulerで起動する。
3. まず検証環境の小さな保護されたSite実行入口へタスクを送る。認証、二重配送、応答喪失、停止からの復帰を確認する。Siteへ安全に接続できなければGCPの専用ワーカーを維持する。
4. 実測した配信遅延と費用を元構成と比較し、採用可否を決める。

これはドキュメント調査に基づく**推奨設計案**であり、SitesとCloud Tasks／Schedulerの実接続試験は未実施。Chatwork投稿の成功、定期処理の成立、期限処理の完了を示す証跡ではない。
