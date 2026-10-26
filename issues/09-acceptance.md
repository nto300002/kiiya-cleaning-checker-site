## 目的
採用方針の案Aについて、Sites版の業務機能とCloud Run専用ワーカーを同じコミット・配備版で受け入れ判定する。

## 作業
- Issue #10の接続試験を先に判定し、その後にIssue #5の報告成果物・Cloud Run経由投稿を別に判定する。
- `docs/operations-and-acceptance.md`に従い、認証、D1競合、R2期限、Site側トークン更新、Cloud Runからの実投稿・Site内部API接続、非同期起動、実機UI、移行・復元を検証する。
- `docs/sites-test-cases.md`のAPIケースをSites版OpenAPIの`operationId`へ、画面ケースを画面ID、移行・復元を手順ID、外部配送を構成ID・実行ログへ対応付け、共有SHAと配備版を固定してから判定する。
- 投稿済みの可能性がある結果不明では手動照合し、重複投稿の有無を確認する。

## 完了条件
- [ ] OAuth接続アカウントID・検証用ルーム名・テスト投稿IDの照合と、Cloud Run経由の報告版ID・成果物投稿IDの照合を別々に記録する。
- [ ] 各ケースに合格／不合格／未実施、担当者、実行日、環境、SHA、Site・Cloud Runの配備版、証跡を記録する。
- [ ] `SITE-AUTH`・`SITE-TOKEN`・`SITE-CHATWORK`・`SITE-D1`・`SITE-R2`・`SITE-JOB`のAPI操作とOpenAPIの対応表、`SITE-UI`のデモ参照版と画面IDの対応表、旧所有者移行・D1復元の手順と証跡、外部配送の構成と実行ログが確定している。
- [ ] 旧版報告と新版10作業、客室ゼロ件、全室アメニティのみ、未解消不備を確認する。
- [ ] 実Chatwork・R2・D1・Cloud RunからSiteへの認証付き接続・定期実行を未実施のまま合格扱いしない。
- [ ] 案Aの各ケースを実測する。案BのGCP正本ケースを案Aの合格として流用しない。案Aが不成立なら未達を記録して採用判断を再審議する。
- [ ] Issue #1の実装継続判断と区別し、本番採用の最終判断と元構成との運用・費用差を記録する。

関連: 元リポジトリのIssue  `#2`、`#34`、`#57`〜`#59`。設計: `docs/operations-and-acceptance.md`。
