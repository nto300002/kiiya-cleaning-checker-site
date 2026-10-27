# 本番Chatwork送信設定API契約（案A）

2026-10-27決定。対象は現行のKIIYA Siteで使う本番送信設定1件と、最初の画面の設定案内である。Issue #10の期限付き`chatwork_smoke` API・固定検証ルームとはURL、D1行、実行フラグを分離する。本書は本番用設定APIの実装契約とし、報告版・ワーカー内部APIを含む全体のOpenAPIはIssue #3で統合する。

## 権限とデータ

- 有効なSites職員だけが設定状態を読める。OAuth接続、送信元確認、room ID入力・確定、試験投稿、送信停止・再開は専用の`manage_chatwork`権限を持つ設定担当職員だけに許す。現行の`it`ロールは職員管理APIも操作できるため、`it`だけを理由に本番Chatwork設定権限を与えない。職員管理者が`manage_chatwork`を個別に付与・剥奪し、操作者・対象者・時刻を監査記録に残す。`manage_chatwork`だけの職員は職員管理APIを操作できない。事務担当者が画面で設定でき、環境変数やコードの編集は不要とする。
- 本番設定はD1に`production`キーの1行として保持する。`account_id`、表示名、確認状態、room ID、ルーム名、設定版、確認者のSite IDと時刻、送信状態を持つ。OAuthトークンは暗号化して別の列または表に保存し、鍵とOAuthクライアント秘密値だけをホスト済みシークレットに置く。トークン更新番号は設定版とは別にする。
- 有効職員向け応答はroom ID、`account_id`、トークン、検証用設定を返さない。`manage_chatwork`保有者向け詳細応答だけにroom IDと`account_id`を含める。通常ログ、公開Issue、ソースへ本番room IDを出さない。全応答は`Cache-Control: no-store`。
- 変更操作にはSitesサインイン、D1の有効職員・`manage_chatwork`権限、同一origin、CSRF対策を要求する。`GET /api/me`は本人の`manageChatwork`可否を返し、画面の導線を切り替える。権限は各APIで再検査する。初回設定と送信先変更には設定版の条件付き更新を使い、履歴に変更者・旧／新宛先・日時を残す。
- D1移行時に本番設定1行を`version="0"`・`controlRevision="0"`・`Unconfigured`で作る。未設定時の`GET /api/chatwork/production/settings`も両方`"0"`を返し、最初の`expectedVersion`には`"0"`を指定する。移行不足で行がない場合は空設定を装わず503にする。一般職員向け`configurationVersion`は送信先確認前には`null`とする。`version`は送信元・宛先の変更、`controlRevision`は手動停止・再開の競合を管理する。
- `manage_chatwork`はアプリの操作権限を分けるもので、Sites本番の配備・DB管理者からroom IDを技術的に隠す仕組みではない。本番の配備・DB管理権限を誰に与えるかは別途管理する。

## 職員向け読み取り

`GET /api/report-delivery-settings` — 有効職員。最初の画面と報告確認画面が毎回サーバーから取得する。

```json
{
  "setupRequired": true,
  "setupReason": "RoomNotConfigured",
  "sourceDisplayName": null,
  "roomName": null,
  "destinationStatus": "Unconfigured",
  "deliveryEnabled": false,
  "configurationVersion": null
}
```

`setupReason`は`RoomNotConfigured`、`AccountNotConnected`、`AccountConfirmationRequired`、`RoomVerificationRequired`、`ReconnectRequired`、`PausedByOperator`、`DeliveryPathUnavailable`、`None`のいずれか。room IDが空なら他の準備不足より`RoomNotConfigured`を優先し、最初の画面で案内する。画面は`manage_chatwork`保有者に設定画面への導線を、その他の職員に設定担当職員への連絡案内を表示する。通信エラーは「設定状態を確認できません」とし、未設定・送信可能を推定しない。清掃記録とプレビューは続行可能、本番送信登録は`deliveryEnabled=false`ならサーバーでも拒否する。

`configurationVersion`は確認済み設定の不透明な版。値は報告確認時に表示した宛先と送信登録時の宛先を照合するためだけに用いる。`roomName`と`sourceDisplayName`は確認済みの値だけ返す。

## 設定担当職員向け操作

| 操作 | 要求・成功応答 | 状態・制約 |
| --- | --- | --- |
| `GET /api/chatwork/production/settings` | 設定版、制御版、停止状態、送信経路の最終正常時刻、`account_id`・表示名、room ID・ルーム名、確認者・時刻、保留中の変更を返す。トークンは返さない | `manage_chatwork`のみ。初期行は両版`"0"`で`200`、行欠落は503 |
| `POST /api/chatwork/production/oauth/start`、`GET /api/chatwork/production/oauth/callback` | 開始URL／認可後の画面へのリダイレクト | 本番用OAuth state・PKCE・コールバック・D1接続行を`chatwork_smoke`から分離。初回暗号化保存の成功後に接続済みとする |
| `POST /api/chatwork/production/account/confirm` | `{ "accountId": "...", "expectedVersion": "..." }`。更新後の設定詳細を返す | `GET /me`で取得したIDと一致する場合だけ確定。ID変更時は再確認まで投稿不可 |
| `POST /api/chatwork/production/room/preview` | `{ "roomId": "...", "expectedVersion": "..." }` → `{ "candidateId": "...", "roomName": "...", "expiresAt": "..." }` | 入力は数字のroom IDのみ。確認済み送信元トークンでChatworkのルーム情報を取得し、候補を操作者Site ID・送信元ID・設定版・10分期限に結び付ける。ここでは本番宛先を変更しない |
| `POST /api/chatwork/production/room/confirm` | `{ "candidateId": "...", "expectedVersion": "..." }` → 更新後の設定詳細、または`202`と`changeId` | 同じ操作者が候補の10分期限内に1回だけ確定要求を受け付ける。送信元ID・設定版を再検査し、投稿リースがなければD1へ即時反映。リース中なら候補を消費して変更要求にroom ID・送信元・版を写し、`ChangePending`へ進める。受付後は候補期限に左右されない |
| `GET /api/chatwork/production/changes/{changeId}` | `Pending`／`Applied`／`Failed`、受付・完了時刻、失敗理由、反映後の設定版を返す | `manage_chatwork`のみ。`202`の受付を変更完了と表示しない。監視でリースの結果／`Unknown`を確定してから反映し、設定版が競合したら`Failed`として再入力を案内する |
| `POST /api/chatwork/production/verify-posting` | `{ "expectedVersion": "...", "requestId": "UUID" }` → `202`と検証ID・一意識別子・配送状態 | 保存済みの本番room IDにのみ、個人情報を含まないテスト文を1件投稿する`DestinationVerification`ジョブを作る。ジョブへ起動者Site ID・権限版・設定版・送信元`account_id`・room IDを固定し、リクエストに宛先IDを受け付けない。同じ`requestId`は同じ検証を返す。送信先未確認でも下記の専用条件で受け付ける |
| `GET /api/chatwork/production/verifications/{id}` | `DispatchPending`／`Dispatched`／`Posting`／`Sent`／`Failed`／`Cancelled`／`Unknown`、取得できた投稿ID、最終投入試行時刻・失敗分類を返す | `Unknown`を自動再送しない。権限剥奪で未投稿のジョブは理由付き`Cancelled`。外部APIの401／403／429とキュー投入失敗を区別する |
| `POST /api/chatwork/production/verifications/{id}/confirm` | `{ "expectedVersion": "..." }` → 更新後の設定詳細 | Chatwork上の識別子と投稿ID・ルーム名を人が照合した`Sent`だけを対象に、ジョブの設定版・送信元・room IDと現行設定を再照合する。起動者の権限が剥奪されていれば旧`Sent`も確認確定に使えず、新しい権限保有者が新規確認投稿を行う。一致時だけ`DestinationVerified`。旧宛先の投稿記録は残すが、新設定の確認へ流用しない |
| `PUT /api/staff/{siteUserId}/permissions/manage-chatwork` | `{ "enabled": true, "expectedStaffRevision": "...", "reason": "..." }` → `200`と対象者・権限・更新後の職員版 | 有効な職員管理者`it`のみ。対象は有効職員。付与・剥奪を条件付き更新し、操作者・対象者・理由・時刻を監査。`manage_chatwork`だけでは呼べない。剥奪後は対象者の未確定候補・未完了OAuth操作を無効化し、受付済み未適用の`ChangePending`を理由`PermissionRevoked`の`Failed`、外部POST未開始の確認ジョブを同理由の`Cancelled`にする。各設定APIは即時403 |
| `POST /api/chatwork/production/pause` | `{ "expectedControlRevision": "...", "reason": "..." }` → `200`と更新後の制御版・停止状態 | `manage_chatwork`のみ。通常報告と確認専用投稿の新しいリース・外部POST、報告送信登録・確認ジョブ登録を止める。未投稿の確認ジョブは理由付き`Cancelled`、報告の未投稿分は保留。進行中の外部POSTは結果保存または`Unknown`まで待つ。送信元・宛先の設定版は変えない |
| `POST /api/chatwork/production/resume` | `{ "expectedControlRevision": "...", "reason": "..." }` → `200`と更新後の制御版・状態 | `manage_chatwork`のみ。承認済み配備版、キュー／内部API、直近3分の認証済み正常ハートビートを再確認できれば、送信先未確認でも手動停止を解除できる。`DestinationVerified`は再開の前提にしない。未確認なら確認投稿だけ、確認済みなら他の`DeliveryEnabled`条件を再評価する。未充足なら409。保留ジョブの宛先照合と再開判断は別操作 |
| `POST /api/chatwork/production/disconnect` | `{ "expectedVersion": "...", "reason": "..." }` → `200`と更新後の設定詳細、投稿リース中なら`202`と`changeId` | `manage_chatwork`のみ。進行中の外部POSTの結果を確定後にトークンを削除し、接続・送信元・送信先の確認を失効させて`Disconnected`、設定版を進める。過去の報告・投稿ID・変更監査は保持。新規投稿は禁止 |

各変更APIはサーバーで権限・版・CSRFを検査する。停止・再開は`controlRevision`だけを進め、送信元・宛先の設定版と既存の投稿確認を変えない。接続解除は設定版を進め、再接続・送信元確認・新しい本番確認投稿が必要となる。権限付与画面は職員管理者が職員一覧から操作し、設定担当職員は通常の設定画面だけを使う。

## 状態、競合、エラー

- room ID未設定は`Unconfigured`、送信元未確認は`AccountConfirmationRequired`、room ID確定後は`DestinationVerificationRequired`、本番ルームへの実投稿を照合後は`DestinationVerified`とする。OAuth失効は`ReconnectRequired`。`DeliveryEnabled`は`DestinationVerified`と、承認済みのSite／ワーカー配備版・キュー／内部API経路・運用者の有効化記録・認証済みワーカーの直近3分以内の正常ハートビートがそろい、手動停止中でない場合だけ真になる。3分超の停止・手動停止・送信経路障害では報告送信登録を拒否する。受け入れ結果だけを永続的な送信許可として扱わない。
- `DestinationVerification`は`ReportDelivery`と別のジョブ種別・API権限で扱う。`DestinationVerificationRequired`でも、確認済み送信元と確定済みroom ID、未処理の設定変更なし、承認済みワーカー配備版、認証済みのキュー／内部API経路、直近3分の正常ハートビートがあれば`manage_chatwork`保有者の確認投稿だけを許す。`DestinationVerified`と`DeliveryEnabled`はこの入口条件に含めない。通常報告の送信登録・ジョブ確保は`DeliveryEnabled=false`の間は拒否し、確認投稿APIに報告IDや任意本文・宛先を渡せない。確認投稿が`Sent`になり人の照合を経て初めて`DestinationVerified`へ進む。
- 確認投稿の登録・ワーカーによる`Posting`への遷移は、手動停止中なら拒否する。停止時に`DispatchPending`／`Dispatched`の確認ジョブを`Cancelled(Paused)`にし、キューの再投入・ジョブ確保・外部POSTを行わない。停止解除しても取消済みジョブは復活せず、設定担当職員が設定版・送信元・room IDを再確認し、新しい`requestId`で確認投稿を起動する。送信先未確認のまま停止した場合も、正常なワーカー経路と`manage_chatwork`権限で停止解除できる。通常報告は人による`DestinationVerified`まで引き続き拒否する。
- 権限剥奪は職員の権限版、候補／OAuth状態、受付済み未適用の変更、未投稿確認ジョブをD1の条件付き更新で連動させ、変更を`Failed(PermissionRevoked)`、確認ジョブを`Cancelled(PermissionRevoked)`に確定する。`ChangePending`は受付者Site ID、確認ジョブは起動者Site IDと権限版を保持する。キュー内に残ったタスクもワーカーのジョブ確保・`Posting`への条件付き遷移時の権限／状態照合で拒否し、設定変更の監視は失敗済み変更を適用しない。すでに`Posting`になった1件は結果または`Unknown`を記録し、続く投稿は開始しない。剥奪前に投稿済み、または剥奪後に結果が`Sent`となった確認ジョブも`confirmationBlockedReason=PermissionRevoked`として`DestinationVerified`に使わない。受付・取消・投稿結果、操作者・時刻・理由を監査に残す。剥奪された本人は詳細APIを使えず、新しい権限保有者が履歴を確認して新規確認投稿を行う。
- 確認ジョブとキュー投入意図を同じD1トランザクションで保存して`DispatchPending`とする。キューのタスク名は検証IDから決定し、投入成功または既存タスク検出後に`Dispatched`とタスク名を記録する。投入失敗時も`202`で同じ検証IDと`DispatchPending`を返し、送信成功とは表示しない。同じ`requestId`の再操作はこの状態を返す。毎分監視が未投入意図を検出して同じタスク名で再投入し、5分超の滞留は設定担当者へ要対応として表示する。`Dispatched`以降はワーカーがD1で一度だけジョブを確保し、外部POST開始時に`Posting`を保存する。配送重複・期限切れリースでも二度目のPOSTを行わず、POST開始後の応答喪失・リース失効は`Unknown`として手動照合する。未投入の再投入と結果不明の再送を混同しない。
- `POST /api/internal/delivery/heartbeat`は認証済みCloud Runワーカー専用。要求は`{ "workerRevision": "...", "siteRevision": "...", "monitorRunId": "...", "monitorSucceeded": true }`で、Siteは認証主体・承認済みの両配備版・監視実行IDの一意性を検査し、受信側時刻を`lastHealthyHeartbeatAt`に保存して`200`と記録時刻を返す。呼出し元の時刻は信用しない。監視失敗または版不一致なら正常時刻を更新せず、`409`または`503`を返す。Cloud Schedulerが毎分OIDC付きで非公開Cloud Run監視入口を起動し、ワーカーは未投入意図の再投入、期限切れリース判定などの監視に成功した後だけこのSite APIを呼ぶ。ジョブが0件でも監視とハートビートを実行する。認証と配備版を満たさない偽のハートビートでは送信を有効化できない。詳細はIssue #6に従う。
- 検証用の投稿ジョブも登録時の設定版・送信元・room IDに固定する。ワーカーは投稿直前に現行設定と照合し、変更済みなら旧ジョブを`ConfigurationChangedHold`として投稿しない。外部POST中に変更が要求されたときは、その1件を`Sent`または`Unknown`へ記録するまで変更を保留し、次の投稿を開始しない。投稿後に変更された場合、旧ルームの投稿IDは監査用に保持し、現行設定の確認には使わず新しいテスト投稿を要求する。
- room IDや送信元の変更要求時に成果物の投稿リースがあれば、要求を`ChangePending`として`202`と変更IDを返す。毎分の監視が5分のリース期限切れを`Unknown`へ確定した後でも変更を進められるが、旧ジョブの自動再送はしない。保留中は次の成果物を開始しない。変更後の未投稿成果物を新ルームへ振り替えず、既投稿IDを保持する。詳細は[画面・配信契約](chatwork-screen-and-delivery.md)に従う。
- `401`は未サインイン、`403`は無効職員・権限不足・origin/CSRF不一致、`400`は形式不正、`404`は存在しない候補・検証、`409`は設定版不一致・候補期限切れ・送信元変更・手動停止中の投稿要求・判定不能、`429`は操作の頻度制限、`503`はChatworkまたは送信経路が利用不可。外部APIの401／403／429はその意味を内部状態にも記録し、トークンやroom IDをエラー本文へ含めない。版不一致時は最新状態の再取得を促す。
- `expectedVersion`の欠落は`428`。設定版を進めるDB更新、変更履歴、候補の消費は原子的に行う。同じ`requestId`の再操作は二重投稿を作らない。外部投稿とDB保存が分断された場合は`Unknown`として人が照合する。

## 受け入れケース

1. room IDが未設定のとき、最初の画面は役割別案内を表示し、清掃記録はできるが本番送信登録はできない。状態APIの通信失敗は送信可能に変わらない。
2. `manage_chatwork`だけを持つ設定担当職員がroom IDを入力するとルーム名が表示され、確認前はDBの本番宛先が変わらない。確定後も実投稿照合前は送信不可。この職員の職員管理API操作と、権限のない職員のChatwork詳細取得・変更は403。
3. 別room、期限切れ候補、他人の候補、設定版競合、送信元ID変更を拒否する。環境変数・ソースに本番room IDを持たない。
4. 検証用ルームの成功を本番ルームの確認に流用しない。本番テスト投稿の識別子・投稿ID・画面を照合し、送信先確認済みと実務報告送信可能を別々に判定する。
5. 設定変更と送信中ジョブが競合しても、旧成果物の投稿IDと宛先が残り、新旧ルームへ同一報告版の成果物が分かれない。検証用テスト投稿も登録・投稿直前・確認確定で固定設定を照合する。
6. 初期版`"0"`からの設定、候補期限内に受け付けた`ChangePending`の完了照会、候補期限後の保留完了、設定版競合を確認する。ワーカー停止から3分超で`deliveryEnabled=false`となり、再開は認証済みハートビートと運用状態の再確認を要する。
7. `DestinationVerificationRequired`では設定担当職員の確認投稿だけが動き、通常報告の送信登録は拒否される。未投入ジョブは毎分監視で一度だけ配送され、外部POST開始後の結果不明は再送されない。同じ`requestId`とキュー重複で投稿が増えない。
8. 毎分の監視失敗、未承認配備版、無認証のハートビートは正常時刻を更新しない。職員管理者による権限付与・剥奪、設定担当者による停止・再開・解除をAPIから実行し、版競合・監査履歴・送信拒否を確認する。
9. 送信先未確認で停止した場合、確認投稿も止まり未投稿確認ジョブは`Cancelled(Paused)`になる。正常経路の下で停止解除した後は新しい確認専用投稿だけ起動でき、通常報告は`DestinationVerified`まで拒否される。取消済みジョブは復活しない。
10. 権限剥奪で当該職員の未適用`ChangePending`と未投稿確認ジョブが理由付きで終了し、キュー重複や監視によって復活しない。外部POST開始済みの1件だけは結果または`Unknown`を残し、次の投稿を開始しない。
