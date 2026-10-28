# [Sites] 本番Chatworkのコンフィデンシャルクライアントと送信先登録を完了する

## 目的

現行方式で、設定担当職員が本番用ChatworkアカウントをOAuth接続し、業務報告ルームのIDを画面に入力する。アプリがChatwork APIから取得したルーム名を表示し、職員が確認して本番設定へ保存する。**ルーム名を手入力しない。** このIssueの完了状態は「送信元・送信先の登録済み／投稿未確認」であり、業務ルームへの実投稿や業務報告の送信可能判定は[Issue #5](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/5)・[Issue #9](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/9)で別に受け入れる。

基準: KIIYA Site第22版。2026-10-28確認時、本番D1の設定行は`Unconfigured`（版0）、本番用OAuth環境変数3件は未登録。`CHATWORK_SMOKE_*`は期限付き接続試験用であり本番設定へ流用しない。

## 1. ローカルで実装・検証できる作業

この節はChatworkへのログイン、本番秘密値、実room IDを使わずに進める。モック・ローカルDBでのテストとコード変更が対象であり、実接続の合格にはしない。

- 既存の`GET /api/chatwork/production/settings`、`POST /oauth/start`、`GET /oauth/callback`、`POST /account/confirm`、`POST /room/preview`、`POST /room/confirm`、`GET /api/report-delivery-settings`を基準にする。`GET /me`の`account_id`と表示名を確認させ、room IDからChatworkの`GET /rooms/{room_id}`で取得したroom名を入力IDと一緒に表示する。room名は手入力させない。
- OAuth接続・送信元確認・ルーム確定における設定更新と監査記録を、競合条件付きの一括更新にする。現在は監査記録が別処理なので、失敗時に設定だけが変わる状態を解消する。
- ルーム保存後の画面を「送信元・送信先を登録済み／投稿確認待ち」とする。`DestinationVerificationRequired`と`deliveryEnabled=false`を維持し、初回画面の未設定案内を投稿確認待ちの案内に切り替える。room名の取得・保存だけで`DestinationVerified`や`DeliveryEnabled`に進めない。
- サーバー側で`manage_chatwork`を検査する。一般職員向け応答にはroom ID、`account_id`、トークンを含めない。本番room IDをソース、環境変数、通常ログ、公開Issueに残さない。
- `rooms.messages:write`は投稿のほか既存メッセージの編集・削除にも使え、スコープは1ルームに限定されない。アプリ側に任意ルームへの投稿、既存メッセージの編集・削除APIを設けない。Issue #5で確認投稿を実装するときも保存済みroom IDだけを使う。
- リダイレクトURIとSiteの公開URLを揃える。ドメイン変更時にはコード側のorigin・callbackとChatworkクライアント登録を同時に見直す。

### ローカル側の受け入れ条件

- [ ] モックの`GET /me`で送信元ID・表示名、`GET /rooms/{room_id}`で入力ID・取得名の表示を検証する。異なる送信元IDでの再接続は再確認待ちとなる。
- [ ] 10分期限、同一操作者・送信元・設定版への候補束縛、競合・期限切れ・他人の候補の拒否をテストする。
- [ ] 監査書き込み失敗や設定版競合を注入しても、設定変更・候補消費・監査が部分成功せず、再操作時に二重確定しない。D1本番設定行が欠落した場合は503を返す。
- [ ] 保存後は`DestinationVerificationRequired`かつ`deliveryEnabled=false`。画面に送信元・room名・「投稿確認待ち」が表示され、ルーム情報取得だけで送信可能にならない。
- [ ] 権限のない職員の詳細・変更APIは403。一般職員向け応答にはroom ID、`account_id`、トークンがなく、任意ルーム投稿やメッセージ編集・削除APIがない。

## 2. ブラウザ操作が必要な登録・実接続

この節はChatwork、Sitesの環境変数設定画面、公開したアプリで実施する。クライアント管理者と投稿元アカウントの担当者は別々に決める。同一人物・同一アカウントでもよいが必須条件にはしない。業務ルームの受領担当者も事前に確認する。

1. **Chatworkクライアント管理者:** [OAuthクライアント作成画面](https://www.chatwork.com/service/packages/chatwork/subpackages/oauth/client_create.php)で、タイプを**コンフィデンシャルクライアント**、名前を「KIIYA清掃報告（本番）」など検証用と区別できるものにする。リダイレクト先URIは`https://kiiya-cleaning-app.hherocl278.chatgpt.site/api/chatwork/production/oauth/callback`を完全一致で登録する。
2. **Chatworkクライアント管理者:** 現行コードが要求する`offline_access`、`users.profile.me:read`、`rooms.info:read`、`rooms.messages:write`の4スコープを登録し、上位の`rooms.all:read_write`は選ばない。`offline_access`は無人更新用。将来のPDF・画像ファイル送信では別途`rooms.files:write`をクライアント登録・認可要求コードに加えて再同意を得る。現行4スコープの成功をファイル送信可能と判定しない。[Chatwork OAuth仕様・スコープ一覧](https://developer.chatwork.com/docs/oauth)を参照する。
3. **Sitesの設定担当者:** 発行されたClient IDとClient Secret、ランダム32バイトのBase64URL形式のトークン鍵を、本番環境変数`CHATWORK_PRODUCTION_CLIENT_ID`、`CHATWORK_PRODUCTION_CLIENT_SECRET`、`CHATWORK_PRODUCTION_TOKEN_KEY`へ登録する。後二者はシークレットにする。秘密値を公開Issue・ソース・チャットに書かない。環境設定変更後は保存済みSite版を再配備する。既存の`CHATWORK_SMOKE_*`、`APP_ENV`、D1結合`DB`は改変しない。room ID・ルーム名は環境変数に入れない。
4. **職員管理者:** 公開アプリで設定担当職員へ`manage_chatwork`を付与する。一般職員と`it`のみの職員には本番Chatwork設定を変更させない。
5. **投稿元アカウントの担当者と設定担当職員:** 公開アプリの「Chatworkを接続」から予定した投稿元アカウントで認可し、取得した`account_id`と表示名を照合して送信元を確定する。
6. **設定担当職員:** 業務報告ルームのroom IDをアプリ画面へ入力し、Chatworkから表示されたroom名と入力IDを一緒に確認する。一致する候補だけ10分以内に確定する。保存後も「投稿確認待ち」であり、実投稿の確認はIssue #5・#9で行う。

### ブラウザ側の受け入れ条件

- [ ] 本番用3環境変数を登録して再配備後、設定画面のOAuth接続が開始できる。本番D1の設定行は1件で、秘密値は画面応答や通常ログに出ない。
- [ ] 実際の投稿元`account_id`と表示名を照合して確定できる。異なるIDや権限のない職員の操作は拒否される。
- [ ] 実room IDに対して取得したroom名が正しく表示され、誤った名前なら保存しない。保存後の設定版はD1と設定APIで照合し、画面では送信元・room名・「投稿確認待ち」を照合する。本番room IDを公開Issueに記載しない。
- [ ] `rooms.messages:write`の権限が1ルーム限定ではなく編集・削除も含むことを受け入れ記録に残す。アプリから任意ルーム投稿や編集・削除ができないことを確認する。

## このIssueの終了と次のIssueへの引継ぎ

ローカル側・ブラウザ側の両方が合格して初めて「送信元・送信先の登録済み／投稿未確認」とする。本番ルームへの確認投稿と人による照合、ワーカー経由の報告送信、ファイル送信スコープ`rooms.files:write`の追加・再認可はIssue #5・#9に残す。「登録済み」を`DestinationVerified`や`DeliveryEnabled`と同一視しない。

設計: [本番設定API契約](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-production-settings-api.md)、[画面・配信契約](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-screen-and-delivery.md)、[実務利用テスト手順](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-practical-test-runbook.md)。
