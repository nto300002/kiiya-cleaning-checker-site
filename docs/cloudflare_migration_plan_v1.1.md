# ChatGPT Sites Cloudflare 移行計画書

> 原資料: cloudflare_migration_plan_v1.1.docx（2026年11月26日、計画段階）。
> これは計画書の内容を記録したもので、実装済み・移行済みを意味しません。

改訂版 v1.1  ｜  2026年11月26日  ｜  計画段階

## 1. 目的と基本方針

2027年2月1日からのSites課金変更を契機に、業務アプリのホスティング・永続データをCloudflareへ移行する。5サイト合計の月額予算は5米ドル以下、目標は0米ドル。Google認証を採用し、既存業務・UI・データの継続性を優先する。移行完了目標は2027年1月24日、最終期限は1月31日とする。課金開始日・適用条件は前回計画とユーザー提示を前提とし、契約上の最新条件は切替前に再確認する。

## 2. 移行対象と優先順位

| 対象 | 優先度 | ソース管理・対応 |
| --- | --- | --- |
| asobe在庫管理 | S | GitHubなし／回収・新規登録 |
| プリントオーダー | S | 既存実装を再利用 |
| プリントマニュアル | S | GitHubなし／写真原本確認 |
| 封入・納品管理 | 要確認 | GitHubなし／利用状況で判断 |
| KIIYA見落としチェッカー | B・独立 | 既存設計リポジトリに実装追加 |

## 3. 分離方針（今回の改訂）

asobeの最大4サイトは共通認証・共通ポータルを持つ。KIIYAは別Worker、別URL、別OAuthクライアント、別DB・R2・セッション、別GitHubリポジトリとする。相互のデータ参照やログイン共有は行わない。同一Cloudflareアカウント内で論理分離する案を基本とし、組織の所有権が異なる場合はアカウント自体も分離する。

現状の本番データ、全機能、画像原本、利用人数は未確認。リポジトリへの書き込みや本番変更は本計画作成時には実施していない。

## 4. 現行サイト・ソース管理台帳

### 在庫管理

https://silk-screen-inventory.hherocl278.chatgpt.site/session?return_to=%2F  
在庫・入出庫履歴等を調査。ソース回収後に新規Privateリポジトリへ。

### プリントオーダー

https://asobe-print-order-20261012.hherocl278.chatgpt.site/  
GitHub: https://github.com/nto300002/asobe-print-order-20261012

### プリントマニュアル

https://asobe-silk-screen-skill-check.hherocl278.chatgpt.site/  
本文・画像・習熟度記録の有無を確認。写真が手元にない場合は優先回収。

### 封入・納品管理

https://funnou-nouhin-kanri.hherocl278.chatgpt.site/  
利用継続の必要性と保存データを確認。不要ならデータ保全のみ。

### KIIYA

https://kiiya-cleaning-checker.hherocl278.chatgpt.site/  
GitHub: https://github.com/nto300002/kiiya-cleaning-checker-site

### GitHub確認結果（2026-11-26）

両リポジトリはPublic、既定ブランチはmain。プリントオーダーにはapp、db、drizzle、scripts、tests等が存在し、package.jsonにはVinext、Next.js、React、Vite、Drizzle、Wranglerが記載されている。KIIYAはREADME、docs、issues等が中心で、READMEはSites版設計資料の保存を目的としている。実行可能な最新Sites実装の存在は確認できていない。

公開範囲の変更は所有者承認後に行う。実データ、写真、秘密鍵、OAuth secret、ChatworkトークンはGit管理しない。過去コミットの秘密情報も検査し、発見時は失効・再発行する。

## 5. 移行先アーキテクチャ

| 項目 | asobe | KIIYA |
| --- | --- | --- |
| ホスティング | asobe-tools Worker（仮） | kiiya Worker（仮） |
| URL | workers.dev／アプリ別パス | 独立workers.dev URL |
| 認証 | Google OIDC 共通認証 | 独立Google OIDC |
| DB | auth + 4業務DB | 専用auth + 業務DB |
| 画像 | asobe専用R2 | KIIYA専用R2（必要時） |
| Git | 既存注文repo＋新規repo等 | 既存kiiya-site repo |
| デプロイ | 独立CI／Wrangler | 独立CI／Wrangler |

D1は合計7 DBを想定（封入を除けば6）。同一アカウントの無料枠10 DBの残りを検証用に使う。asobeのパスは /inventory、/print-order、/manual、/delivery、/admin を暫定案とする。既存アプリの独立デプロイが必要ならasobe内でWorkerを分け、共通認証の安全な連携を別途設計する。

### 技術選定

プリントオーダーは既存Vinext構成を優先。Sites専用の認証ヘッダー、.openai/hosting.json、ビルド・環境変数依存を調査し、Cloudflare本番用設定とD1/R2 bindingを整備する。pnpm lockfileを尊重し、Node.js 22.13以上でビルド検証する。その他は回収コードに合わせ、必要な場合のみReact/TypeScript/Vite/Hono/Drizzleを採用する。全面書き換えやモノレポ統合は必須にしない。

### Google認証・権限

Authorization Code Flow + PKCE、state、nonce、署名・iss・aud・exp検証を行う。Google subを永続識別子とし、既存SitesユーザーIDとは管理者承認の対応表で紐付ける。許可済みユーザーのみアクセス可能とし、管理者・職員・作業担当者の権限はAPI側で検査する。CookieはSecure/HttpOnly/SameSite、CSRF対策、退職時のセッション失効を実装。R2は非公開とし認証済みAPIで配信する。

### KIIYA固有の検証

既存設計にChatwork連携、毎分監視・遅延照合・日次処理の候補がある。現行サイトの実装有無を確認し、必要ならWorkers Cron等で再現性・重複送信防止・実行時間・費用を検証する。外部Cloud Tasks等は費用未確定のため採用保留。

## 6. 費用計画・上限制御

Workers Freeを基本とし、有料化は承認制とする。以下は前回計画で参照した公式仕様に基づく設計値で、契約時点に再確認する。同一アカウント内の全アプリで枠を共有する。

| 項目 | 無料枠（設計値） | 警戒ライン |
| --- | --- | --- |
| Workers | 10万動的要求/日、CPU 10ms/要求 | 7万要求/日 |
| 静的配信 | 無料・無制限（該当配信） | 動的処理と区別 |
| D1読込 | 500万行/日 | 350万行/日 |
| D1書込 | 10万行/日 | 7万行/日 |
| D1容量 | 合計5GB、個別500MB、10 DB | 個別350MB |
| R2 Standard | 10GB-month、Class A 100万/月、B 1000万/月 | 7GB、操作枠70% |

試算：15人×50操作/日×3 API = 2,250要求/日、各API100行読込なら225,000行/日、操作あたり2行書込なら1,500行/日。画像2GBと仮定すれば上記主要枠内。ただし認証・定期処理・バックアップ・CPUは別途実測する。

R2は無料枠超過で従量課金される。保存量・アップロードサイズ・操作回数をアプリ側で制御し、上限接近時は管理者通知と不要な書込み停止を行う。予算通知は強制課金停止を保証しない。Workers Paidは基本5ドル/月に超過料金・税が加わる可能性があるため、総額5ドルの厳守には不向き。独自ドメインは購入しない前提。

### 運用と所有権

本番アカウントは事業所の管理権限を確保する。GitHubとCloudflareの最小権限を設定し、KIIYAのデプロイトークンはasobeの資源を変更できないようにする。組織が別でアカウントも分離する場合、費用は両アカウントの合計で管理する。

## 7. データ・ソースコード回収

優先順：①現行ソースとエクスポートの取得、②管理者限定のエクスポート機能追加、③取得不可の場合は画面・仕様から再実装。現行本番への変更はバックアップと承認の後に限る。

| 回収対象 | 確認・保全内容 |
| --- | --- |
| コード | フロント、API、依存・lockfile、設定、テスト、スキーマ |
| DB | 全レコード、ID、日時、外部キー、件数、容量、削除状態 |
| ファイル | 写真原本、MIME、サイズ、SHA-256、参照先 |
| 認証 | 既存ID、権限、所有者対応表（秘密値除外） |
| 仕様 | 全画面、操作、エラー、外部連携、スクリーンショット |

### プリントオーダー

既存repoをcloneし、現在のSitesデプロイと差分を確認。移行用ブランチを作り、既存コード・履歴を維持する。DBスキーマと本番データは別物として回収する。

### KIIYA：既存リモートへのソース追記

既存README/docs/issuesを保全した状態でSitesから最新実装を回収し、移行用ブランチへ追加する。既存設計資料との相違を記録し、秘密・業務データを除外、ローカルビルドとテスト後にPRで統合する。別の旧リポジトリのコードは参考資料として扱い、最新Sitesコードと混同しない。

### GitHub未登録の3サイト

在庫・マニュアル・封入のコードを回収し、移行対象に限りPrivateリポジトリへ登録する。新規repoかasobeモノレポかは回収後の技術構成で確定する。マニュアル画像は最優先で原本確認とエクスポートを行う。

### Sites作成元チャットへの調査指示

現行アプリを変更せず、ソースコードの取得方法、DBの種類・スキーマ・件数・容量、全データのエクスポート可否、画像一覧・原本取得方法、認証方式、全画面・API、Sites依存箇所を調査する。取得できない情報は推測せず理由を記載する。削除・再デプロイは禁止。

## 8. スケジュールと完了判定

| 期間 | 作業 | 完了条件 |
| --- | --- | --- |
| 11/26–12/2 | 現行調査・対象確定 | ソース・データ所在を特定 |
| 11/29–12/13 | 全サイトデータ回収 | 復元可能な退避データ |
| 12/1–12/15 | asobe・KIIYA基盤 | 各Google認証・DBが動作 |
| 12/11–12/20 | KIIYA先行検証 | 独立環境で動作・連携確認 |
| 12/18–12/31 | 在庫管理 | 在庫整合性確認 |
| 12/24–1/7 | プリントオーダー | 既存機能と受注記録一致 |
| 12/29–1/10 | マニュアル | 本文・画像照合 |
| 1/6–1/13 | 封入・納品 | 必要時のみ移行 |
| 1/10–1/20 | 統合・受入テスト | 必須Gate合格 |
| 1/20–1/24 | 本番切替 | 利用開始・旧更新停止 |
| 1/24–1/31 | 予備期間 | 不具合対応・旧課金確認 |

工数は前回の43–70時間（コード再利用）、70–120時間（再実装）を暫定参考値とする。KIIYAの独立認証・定期処理等の追加工数は未算定。回収後に再見積もりし、期限に間に合わない場合は優先度Sの3サイトを保護する。

### 必須受入Gate

移行前後の件数と項目値・ID・日時・参照関係を照合。画像SHA-256と全表示を確認。ログイン、未許可ユーザー拒否、CRUD、再読込、別端末、同時更新、権限、asobe/KIIYA間のアクセス拒否を実機検証する。Playwrightのスクリーンショット、HTTP応答、DB比較JSON、テストログを保存。KIIYAの外部連携があれば重複・失敗復旧も検証する。AIの完了報告だけでは合格にしない。

## 9. 切替・復旧・未決事項

### 本番切替

初回移行 → 試験運用 → 旧サイト更新停止 → 最終差分取得・取込 → 件数・内容・画像照合 → 新URL周知 → 新環境での業務開始 → 旧Sites停止・課金状態確認。切替失敗時は新環境の更新分を退避・照合して旧環境へ復帰する。旧環境のデータ削除は復元可能性と管理者承認を確認した後に限る。

### バックアップ

D1は毎日SQLエクスポート、R2は毎週・変更時に原本バックアップ、コード・スキーマは変更ごとにGit管理。暗号化した外部ストレージに週次保管し、月1回空の検証DBへ復元する。D1 Time Travel（無料7日、有料30日）は補助として利用する。

例：npx wrangler d1 export inventory-db --remote --output=./backups/inventory.sql

例：npx wrangler d1 execute inventory-restore-test --remote --file=./backups/inventory.sql

未決事項・確認責任

| 事項 | 確定条件 |
| --- | --- |
| コード完全性 | 現行配備とGitの差分照合 |
| 写真原本 | 手元／Sites／その他の所在確認 |
| 封入管理 | 利用者への確認で継続判断 |
| 本番データ・権限 | 事業所承認、容量・ユーザー・権限実測 |
| KIIYA分離範囲 | Cloudflareアカウント自体の分離要否 |
| 予算 | 税・外部API・バックアップ費用の扱い |
| 課金条件 | OpenAI最新の契約・停止条件確認 |

## 10. 参考資料

https://github.com/nto300002/asobe-print-order-20261012  
https://github.com/nto300002/kiiya-cleaning-checker-site  
https://developers.cloudflare.com/workers/platform/pricing/  
https://developers.cloudflare.com/d1/platform/limits/  
https://developers.cloudflare.com/d1/platform/pricing/  
https://developers.cloudflare.com/r2/pricing/  
https://developers.cloudflare.com/d1/reference/time-travel/  
https://developers.google.com/identity/openid-connect/openid-connect  
https://learn.chatgpt.com/docs/sites/usage-and-cost
