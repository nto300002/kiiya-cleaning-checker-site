# KIIYA見落としチェッカー — Sites構成案

このリポジトリは、[既存のKIIYA見落としチェッカー](https://github.com/nto300002/kiiya-cleaning-checker)を**Sitesで実装する場合**の設計と作業Issueを保存する公開リポジトリです。2026-10-21時点では設計案であり、Sitesへの登録、配備、実データの移行、Chatwork実送信は行っていません。

公開設定は**GitHubリポジトリ**の設定です。職員の作業・画像・報告を扱うSite自体を一般公開する決定ではありません。業務データや資格情報をこのリポジトリへ置きません。

## 読む順序

1. [Sites版の業務要件](docs/requirements.md)
2. [構成と移行境界](docs/architecture.md)
3. [データ・API移行設計](docs/data-and-api.md)
4. [運用・受け入れ](docs/operations-and-acceptance.md)
5. [未決定事項](docs/decision-log.md)

`docs/baseline/`は既存リポジトリのローカル作業ツリーから2026-10-21に複写した**参照資料**です。元の基準コミットは`b41cde9a74cc8f1591f1567874a3bba62fe0a05c`ですが、複写元には未コミットの改訂が含まれます。参照資料に残るCloud Run・Cloud SQL・Googleログインなどの記述はSites版の実装指示ではありません。設計の優先順位は、このリポジトリの`docs/`直下、次に参照資料です。

## 方針

画面とサーバー処理はSitesのWorker構成を候補とし、永続データをD1、非公開画像・報告生成物をR2で扱う。本人確認、職員限定の閲覧、1分監視・5分照合・日次期限処理、Chatwork OAuthと投稿は**実機検証を通るまで採用確定しない**。既存APIのNode.js/PostgreSQLコードをそのまま配置できる前提は置かない。

関連作業はこのリポジトリのGitHub Issuesで管理します。元リポジトリのIssueや実装状態は変更しません。
