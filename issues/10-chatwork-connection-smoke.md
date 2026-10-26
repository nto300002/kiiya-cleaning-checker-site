## 目的と判定範囲
案Aの本格的な報告送信に先立ち、指定したChatworkアカウントのOAuth接続、検証用ルームの照合、本文1件のテスト投稿を実証する。これは接続試験であり、Issue #5のPDF・画像送信、結果不明照合、Cloud Run経由の報告送信の完了とは区別する。

紐づけるのは職員一人ひとりのSitesアカウントではなく、アプリの検証用送信設定1件と既存メンバーのChatworkアカウント1件である。現場職員にはChatwork認証を求めず、誰が作業・報告したかはSites側の職員IDで記録する。

## 実施環境（固定）
- 今回だけは既存の公開Site `https://kiiya-cleaning-app.hherocl278.chatgpt.site`（Sites project ID `appgprj_6ad975d1c8988191b700f13697017fbe`）で限定試験を行う。OAuthコールバックURIは`https://kiiya-cleaning-app.hherocl278.chatgpt.site/api/chatwork/oauth/callback`とする。**このAPIを実装・配備し、下記のサーバー側制限を確認するまでOAuthクライアントを作成・認可しない。** 別Siteへ変更する場合はクライアント作成前にこの節、URI、証跡を改訂する。
- D1はこのSiteの`DB`バインディングを用い、接続・投稿試験の行を`chatwork_smoke`名前空間に分離する。本番報告の接続行・報告版・送信状態を更新しない。実行前に`DB`の実リソースID、マイグレーション版、Site配備版を非公開の環境台帳へ記録し、一致を確認する。
- Sitesのホスト済み環境変数に`APP_ENV=production`、`CHATWORK_SMOKE_ENABLED`、`CHATWORK_SMOKE_EXPIRES_AT`、`CHATWORK_SMOKE_CLIENT_ID`、`CHATWORK_SMOKE_CLIENT_SECRET`、`CHATWORK_SMOKE_TOKEN_KEY`、`CHATWORK_SMOKE_ROOM_ID`を設定する。秘密値とルームIDは公開Issue・Gitへ記載しない。初期状態は無効とし、試験終了・期限到来で無効化する。
- 接続開始、宛先確認、試験投稿はサーバーで`APP_ENV=production`、固定Site origin、`CHATWORK_SMOKE_ENABLED=true`、有効期限内、サインイン済みの有効なIT担当者をすべて検査する。条件が欠ければ試験APIを拒否する。ブラウザーの表示や入力値だけで環境を判定しない。

## 実装・検証作業
- `confidential`クライアントを検証用に登録し、上記URIと`users.profile.me:read`、`rooms.info:read`、`rooms.messages:write`を設定する。トークン更新まで試す場合のみ`offline_access`を追加する。組織契約でAPI利用承認が必要なら承認状態を確認する。検証と本番のクライアント、シークレット、接続行、ルームを混用しない。
- OAuthの`state`を開始者のSite IDと短期有効期限に結び、PKCE S256を使う。コールバックで1回だけ消費し、不一致・期限切れ・再利用を拒否する。初回トークンは暗号化してD1へ保存してから接続済みとする。
- `GET /me`の`account_id`と表示名を取得して「確認待ち」に置く。IT担当者が`account_id`を確認・固定するまで投稿不可とし、再接続時にIDが変われば固定を解除して再確認する。登録名だけで本人判定しない。
- 接続設定はIT担当者が操作する1件だけとし、別の職員がアプリへサインインしてもChatwork接続を追加せず、送信元を切り替えない。設定画面には送信元の`account_id`・表示名、送信先のroom ID・ルーム名、接続状態と最終確認時刻を示し、トークンを表示しない。
- `GET /rooms/{room_id}`で参加可能なルーム名を取得する。選択できるのはサーバー側`CHATWORK_SMOKE_ROOM_ID`と一致する検証用ルームだけで、IT担当者が名前を確認した後にD1へ固定する。試験投稿APIはリクエスト本文のroom IDを受け付けず、この固定値以外に送らない。
- `rooms.messages:write`はChatwork側では参加中の複数ルームに作用し、投稿に加えてメッセージ編集・削除にも使える。漏えい時の残余リスクを記録し、アプリ側には選択済みルームへの`POST /messages`だけを実装する。Chatworkへの編集・削除API呼出しと、別ルームへの投稿経路を設けない。
- IT担当者の明示操作で、個人情報を含まない一意の識別子付き本文を1件投稿する。成功応答時は`message_id`と画面上の投稿を照合する。応答喪失時は識別子を使って手動照合し「投稿あり／投稿なし／判定不能」を記録する。判定不能を自動再送しない。
- 401は認証切れ・再接続要否、403はルーム参加・投稿権限不足、429は利用制限と待機情報として別々に記録する。認証・権限エラーや投稿成否が不明な状態を成功にしない。
- 平文トークン、クライアント秘密値、認可コードをブラウザー、公開ソース、通常ログ、職員向け応答に出さない。試験用Site直接投稿の結果をIssue #5のCloud Run投稿経路の合格に流用しない。

## 受け入れ条件
- [ ] 固定したSite ID・origin・コールバックURI、`DB`実リソースID、環境変数の**キー名**、配備版、試験期限を照合した記録がある。秘密値は証跡に残さない。
- [ ] 試験フラグ無効・期限超過・origin不一致・匿名・無効職員・一般職員ではOAuth開始、接続状態閲覧、宛先確定、試験投稿が拒否される。終了後も拒否される。
- [ ] `state`・PKCE異常、認可拒否、初回D1保存失敗では接続済みにならず、平文の認証情報がブラウザー・公開Git・D1・通常ログに残らない。
- [ ] APIで得た`account_id`をIT担当者が確認して固定する前は投稿できない。固定済みIDと異なる再接続でも投稿できず、再確認が必要になる。
- [ ] 職員2名以上が別々のSites IDで作成した記録からも、Chatwork接続は同じ1設定・同じ`account_id`を使用し、職員ごとのOAuth認可を求めない。報告本文と作業履歴には各作成者のSites IDが残る。
- [ ] ルーム名・参加権限をAPIで確認し、サーバー側に固定した検証用ルーム以外への投稿を拒否する。別ルームIDをリクエストしても投稿不可で、Chatwork編集・削除API呼出しがないことを確認する。Chatwork側の広いスコープによる残余リスクを記録する。
- [ ] 成功時はテスト識別子、APIの`message_id`、画面上の投稿が一致し、重複がない。応答喪失時は`message_id`が得られない前提で「投稿あり／投稿なし／判定不能」と照合根拠を記録し、判定不能を自動再送しない。
- [ ] 401・403・429の原因と最終状態を別々に記録し、接続解除・認可失効後は投稿できない。更新を試す場合は更新失敗と再接続も検証する。
- [ ] 実行日、実行者、Git SHA、Site配備版、接続アカウントID（非公開証跡）、ルーム名、テスト識別子、取得できた投稿ID、結果を記録する。未実施を成功扱いしない。

## 関連
Issue #5（報告成果物とCloud Run投稿）、Issue #9（統合受け入れ）。設計: `docs/architecture.md`、`docs/chatwork-token-storage.md`。

受け入れケースの共有版: [コミット`3e61fdf`](https://github.com/nto300002/kiiya-cleaning-checker-site/commit/3e61fdfa3f5f83a42b57dd7812a7a737882d0c6f)の[`SITE-CHATWORK-01`〜`05`](https://github.com/nto300002/kiiya-cleaning-checker-site/blob/3e61fdfa3f5f83a42b57dd7812a7a737882d0c6f/docs/sites-test-cases.md)。判定時には実装・配備に使ったSHAと差分も記録する。
