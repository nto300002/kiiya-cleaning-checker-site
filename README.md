# KIIYA見落としチェッカー — Sites構成案

このリポジトリは、[既存のKIIYA見落としチェッカー](https://github.com/nto300002/kiiya-cleaning-checker)のSites版の設計・作業Issueと、現行Siteのソースを保存する公開リポジトリです。設計資料には2026-10-21時点の案も含まれます。現行の実装状態は`sites-source/`を参照してください。

公開設定は**GitHubリポジトリ**の設定です。職員の作業・画像・報告を扱うSite自体を一般公開する決定ではありません。業務データや資格情報をこのリポジトリへ置きません。

## 現行Siteと全件ダウンロード

- Site: [KIIYA 見落としチェッカー](https://kiiya-cleaning-checker.hherocl278.chatgpt.site/)
- ソース: [`sites-source/`](sites-source/)
- 対応するSiteソースのコミット: `83a1ffdb013403b5b04fc93ba3a99d0b9156aa23`（Site公開版47）

アプリ管理者は「メニュー → 職員台帳 → 全レコードとテーブル構造をダウンロード」から、業務データ、全テーブルの構造と件数、R2の画像・報告ファイルをZIPで取得できます。認証・Chatwork連携トークンなどの値は出力せず、テーブル名と構造・件数だけを収録します。未分類のテーブル、列、R2キーを検出すると処理を止めます。ZIP内のR2ファイルには生成名を使い、元のキーを`manifest.json`に記録します。

2026-11-27に管理者アカウントで公開Siteの操作を確認し、画面でダウンロード完了を確認しました。これは初期実装です。厳密な無停止スナップショット、書き込み停止の復旧、復元試験など、[移行計画の確定仕様](https://github.com/nto300002/asobe-cloudflare-migration-plan#全件ダウンロード機能の確定仕様)を満たすかは別途検証が必要です。業務データ本体はGitHubへ登録していません。

## 読む順序

1. [Sites版の業務要件](docs/requirements.md)
2. [UIのデモ参照方針](docs/ui-reference.md)と[構成と移行境界](docs/architecture.md)
3. [データ・API移行設計](docs/data-and-api.md)
4. [運用・受け入れ](docs/operations-and-acceptance.md)
5. [未決定事項](docs/decision-log.md)
6. [Sitesの非同期・定期処理の資料調査](docs/sites-async-review.md)
7. [Chatworkトークン保存案](docs/chatwork-token-storage.md)、[旧所有者の対応手順](docs/owner-mapping.md)、[Sites版受け入れケース](docs/sites-test-cases.md)

`docs/baseline/`は既存リポジトリのローカル作業ツリーから2026-10-21に複写した**参照資料**です。元の基準コミットは`b41cde9a74cc8f1591f1567874a3bba62fe0a05c`ですが、複写元には未コミットの改訂が含まれます。参照資料に残るCloud Run・Cloud SQL・Googleログインなどの記述はSites版の実装指示ではありません。設計の優先順位は、このリポジトリの`docs/`直下、次に参照資料です。

## 方針

画面とサーバー処理はSitesのWorker構成を候補とし、永続データをD1、非公開画像・報告生成物をR2で扱う。職員が各自のChatGPTアカウントを使い共通利用を避けることは、当面は人の運用で管理する。Sitesの定期更新で毎分監視・5分後照合の保証は確認できず、個別遅延にはCloud Tasks、毎分・日次にはCloud Schedulerを代替候補とする。外部実行からSiteへの認証済み接続を含め、**実機検証を通るまで採用確定しない**。既存APIのNode.js/PostgreSQLコードをそのまま配置できる前提は置かない。

関連作業はこのリポジトリのGitHub Issuesで管理します。元リポジトリのIssueや実装状態は変更しません。

## Sites版のIssue

| Issue | 内容 |
| --- | --- |
| [#1](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/1) | 構成の成立条件と採用可否 |
| [#2](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/2) | 職員の本人確認とアクセス規則 |
| [#3](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/3) | D1スキーマとAPI契約 |
| [#4](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/4) | R2の画像・報告ファイル・保存期限 |
| [#5](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/5) | WorkerとChatwork連携 |
| [#6](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/6) | 監視・遅延照合・日次処理 |
| [#7](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/7) | 現場向けPWA |
| [#8](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/8) | 既存データ移行 |
| [#9](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/9) | 統合受け入れと採用判断 |
