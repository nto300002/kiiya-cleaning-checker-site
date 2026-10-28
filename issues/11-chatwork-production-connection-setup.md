# [Sites] 本番Chatworkのコンフィデンシャルクライアントと送信先登録を完了する

## 目的

現行方式で、設定担当職員が本番用ChatworkアカウントをOAuth接続し、業務報告ルームのIDを画面に入力する。アプリがChatwork APIから取得したルーム名を表示し、職員が確認して本番設定へ保存する。**ルーム名を手入力しない。** このIssueの完了状態は「送信元・送信先の登録済み／投稿未確認」であり、業務ルームへの実投稿や業務報告の送信可能判定は[Issue #5](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/5)・[Issue #9](https://github.com/nto300002/kiiya-cleaning-checker-site/issues/9)で別に受け入れる。

基準: KIIYA Site第22版。2026-10-28確認時、本番D1の設定行は`Unconfigured`（版0）、本番用OAuth環境変数3件は未登録。`CHATWORK_SMOKE_*`は期限付き接続試験用であり本番設定へ流用しない。

## Chatwork側の登録手順

1. OAuthクライアントの管理者を決め、その管理者が[OAuthクライアント作成画面](https://www.chatwork.com/service/packages/chatwork/subpackages/oauth/client_create.php)で登録する。クライアント管理者と、後でアプリから認可して投稿元になるChatworkアカウントの担当者は別々に決める。同一人物・同一アカウントでもよいが必須条件にはしない。業務ルームの受領担当者も事前に確認する。
2. クライアントタイプは**コンフィデンシャルクライアント**、クライアント名は識別しやすい「KIIYA清掃報告（本番）」などとする。既存の検証用クライアントとは分ける。
3. リダイレクト先URIに次を**完全一致**で登録する: `https://kiiya-cleaning-app.hherocl278.chatgpt.site/api/chatwork/production/oauth/callback`。
4. 現行コードがOAuth認可時に要求する4スコープを登録する: `offline_access`、`users.profile.me:read`、`rooms.info:read`、`rooms.messages:write`。上位の`rooms.all:read_write`などは選ばない。`offline_access`は無人での更新に必要。将来のPDF・画像ファイル送信には`rooms.files:write`が別途必要なので、Issue #5の実装前にクライアント登録・認可要求コード・再同意を揃える。現行4スコープの成功をファイル送信可能と判定しない。
5. 発行されたClient IDとClient Secretは公開Issue・ソース・チャットへ記載せず、Sitesの本番環境変数へ登録する。その後、予定した投稿元アカウントの担当者がアプリの「Chatworkを接続」からOAuth認可する。

Chatworkの[OAuth仕様・スコープ一覧](https://developer.chatwork.com/docs/oauth)を登録時の基準とする。

## Sites側の設定と実装

- Sites本番環境変数に`CHATWORK_PRODUCTION_CLIENT_ID`、`CHATWORK_PRODUCTION_CLIENT_SECRET`、`CHATWORK_PRODUCTION_TOKEN_KEY`を登録する。後二者はシークレット扱いとし、トークン鍵はランダム32バイトのBase64URL値とする。Siteの環境設定変更後に保存済み版を再配備し、設定画面のOAuth接続ボタンが利用可能になることを確認する。既存の`CHATWORK_SMOKE_*`、`APP_ENV`、D1結合`DB`は改変しない。本番room ID・ルーム名は環境変数へ入れない。
- 職員管理者が設定担当職員へ`manage_chatwork`を付与し、一般職員と`it`のみの職員には本番設定の変更を許さない。
- 既存の`GET /api/chatwork/production/settings`、`POST /oauth/start`、`GET /oauth/callback`、`POST /account/confirm`、`POST /room/preview`、`POST /room/confirm`、`GET /api/report-delivery-settings`を使う。`GET /me`の`account_id`を設定担当職員が表示名とともに照合する。room IDの入力後はChatworkの`GET /rooms/{room_id}`からルーム名を取得し、IDと名前を一緒に確認させる。
- OAuth接続・送信元確認・ルーム確定における設定更新と監査記録を、競合条件付きの一括更新にする。現在は監査記録が別処理なので、失敗時に設定だけが変わる状態を解消する。
- ルーム保存後の表示は「送信元・送信先を登録済み／投稿確認待ち」とする。`DestinationVerificationRequired`と`deliveryEnabled=false`を維持し、初回画面の未設定案内を投稿確認待ちの案内に切り替える。room名の取得・保存だけで`DestinationVerified`や`DeliveryEnabled`に進めない。
- リダイレクトURIとSiteの公開URLを揃える。将来ドメインを変更するときは、コード側のorigin・callbackとChatworkクライアント登録を同時に更新する。
- `rooms.messages:write`は投稿だけでなく既存メッセージの編集・削除にも使え、OAuthスコープ自体は1ルームに限定されない。アプリ側の本番設定・投稿APIでは保存済みroom ID以外を宛先に指定できないようにし、任意ルームへの投稿やメッセージ編集・削除APIを提供しない。確認投稿の実装時にIssue #5で再確認する。

## 受け入れ条件

- [ ] 本番用3環境変数が秘密値を漏らさず設定され、再配備後に接続開始ができる。D1の本番設定行が1件存在し、行欠落時は503を返す。
- [ ] `manage_chatwork`保有者が本番OAuth接続でき、`GET /me`の`account_id`と表示名を確認・確定できる。異なるIDでの再接続は再確認待ちとなる。一般職員の詳細・変更APIは403。
- [ ] room IDを画面で入力すると、Chatworkから取得したroom名と入力IDが同時に表示される。名称が違えば保存しない。同一操作者・送信元・設定版に結びついた10分以内の候補だけを1回確定でき、競合・期限切れ・他人の候補は拒否する。
- [ ] 保存後の設定版はD1と設定APIで照合する。画面では送信元・room名・「投稿確認待ち」の状態を照合する。一般職員向け応答にroom ID、`account_id`、トークンを含めない。本番room IDを環境変数・通常ログ・公開Issueへ記載しない。
- [ ] 監査書き込み失敗や設定版競合を注入しても、設定変更・候補消費・監査が部分成功せず、再操作時に二重確定しない。
- [ ] 保存直後は`DestinationVerificationRequired`かつ`deliveryEnabled=false`で、画面に「投稿確認待ち」を示す。ルーム情報取得だけで投稿可能と表示しない。
- [ ] 本番設定APIと画面に任意room IDへの投稿、既存メッセージの編集・削除操作がない。`rooms.messages:write`の広い権限を受け入れ記録に残し、Issue #5で確認投稿を実装する際も保存済みルームだけを宛先にできることを検証する。
- [ ] Issue #5への引継ぎとして、本番ルームへの確認投稿と人による照合、ワーカー経由の報告送信、ファイル送信スコープ`rooms.files:write`の追加・再認可を未完了として明記する。

設計: [本番設定API契約](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-production-settings-api.md)、[画面・配信契約](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-screen-and-delivery.md)、[実務利用テスト手順](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/main/docs/chatwork-practical-test-runbook.md)。
