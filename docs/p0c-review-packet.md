# imsg-web P0c 配備設計レビュー依頼

2026-09-08。改訂v2。配備承認待ち・未実装・未配備。履歴や既存レビュー結論を参照せず、要求と案の反論、失敗条件、棄却理由を検討してください。重大度、条件、受入条件への影響、最小修正を示してください。コード変更・SSH・外部設定変更は禁止。この本文だけで設計レビュー可能です。Claudeへ渡す場合はOpusまたはSonnet、一回限り・非永続・ツールなし、本文だけを標準入力へ渡し、FableとFableを排除できない自動ルーティングは使わないでください。

## タスクに関係するユーザー要求の原文

> imsgというiMessageをcliで送受信できるバイナリがありますが、それをWeb UIでラップして、そのWeb UIからiMessageが利用できるようにしたいと思っています、まずimsgがどのようにどのようなことができるかを確認し、それを元に実際の実装方針をどこまでの機能をつけるかを検討してください

> 実際にimsgが入っているmacは2台あり、両方sshで接続可能です、macというエイリアスで、sip有効状態のm1 airに、imというエイリアスで、sip無効のIntel imacに繋がります、imsgはsip有効状態と無効状態で若干使える機能に違いがありますが、どちらの状態でもWeb UIは機能するようにしてほしいです、sipが有効ならその範囲で可能なものだけ、sipが無効なら全機能解放という感じです

> 1. 利用者は自分ですが、他の人も各々のマシンでホストして利用可能なように、ソースをgithubに公開したいと思っています
> 2. 2台とも同じApple Accountで、両方常時稼働はしているものの、デスクトップで間違いなく家で動き続けている保証がしやすいのはimacの方だと思うので、実運用はそっちでやりたいですが、検証時は違う環境として両方使う意義はあると思うので、両方で検証はしてほしいです
> 3. 全部盛りを最終目標としますが、初版でどこまで行くかなど、実装のフェーズ組みは実際に実装するあなたがやりやすい分け方をしてほしいです。

> tailscale経由でいいです

> 一旦自分宛にしてください

> 要件未達、セキュリティ、データ損失、不可逆な設計について重大な意見の不一致が残る場合は、あなた一人で裁定せず、選択肢と影響を私へ提示してください。

> 各変更に必要十分なテストを行い、各受け入れ条件と、それを確認したテストまたは手動検証の対応を残してください。

> 進めてください

## 目的・範囲・事実

- P0cは既存の認証付き読み取りWeb UIをMac上で運用する準備・限定配備。最終の送受信製品とは区別する。単一所有者、端末別の独立instance、データ統合なし。
- Node24.20.0/TypeScript/Fastify/React。既存ビルドは92 unit/integration + 9 synthetic HTTPS browser tests成功。両Macの一時foreground HTTP閲覧成功。LaunchAgent/Tailscale実ブラウザー/再起動は未検証。
- iMac: macOS15.7.8 Intel、imsg0.14.2、所有者GUIログイン中。SIP custom、bridge使用可能。Tailscale1.102.3 OSS版のsystem daemonが稼働。ユーザー側にも同名Tailscale plistがあるがプロセス稼働なし。どちらも変更しない。
- iMac Serve status JSON={}、text=no config、get-config --all={version:0.0.1}。MagicDNS有効、自己ホスト名がCertDomainsにある。実証明書発行/ACLの到達対象は未確認。候補8787/443/8443はlsofでLISTEN表示なし（Tailscale userspace listenerの証明ではなく設定との併用）。
- iMac sleep=0、autorestart=0、FileVault off。既存AI watcherとMessagesは稼働中。停止/再起動/電源/TCC/SIP変更は本フェーズに含めない。
- M1: macOS27.0 beta、imsg0.15.1、SIP有効、GUIログイン中、Tailscale GUI版。8787空き。OS安定性差は記録し一般的な全macOS保証にしない。
- 実ホスト名・ユーザー名・IP・本文・宛先・キーはこのパケットへ含めない。`<owner>`、`<host-fqdn>`は配備前に実機値へ置換して確認する。

## 構成と主要interface・データ

- Browser → Tailscale Serve HTTPS443のルート `/` → `http://127.0.0.1:8787` → readonly imsg子。Funnel不使用、LAN/全interface bindなし。Host/Originは`https://<host-fqdn>`と厳密一致。Tailscale identity/forwarded headersを認証に使わない。
- Cookie __Host/Secure/HttpOnly/Strict、所有者キーhashのみ保存。POST session login、GET session/capabilities/chats/messages、DELETE session+CSRF。管理はprivate Unix socketのみ、`auth status/revoke-all/rotate`。健康APIはaliveのみでDB readinessではない。
- owner state schema1(hash)、memory session/opaque ID/DB epoch、Messages DB正本。メッセージ永続mirrorなし。送信・既読変更・添付配信なし。
- 配置案: `/Users/<owner>/Library/Application Support/imsg-web/` owner0700。その下`runtime/node-v24.20.0-{arch}/`、`releases/<commit>/`、`state/`、`logs/`。stateはsetup時新規作成0700、hash0600、socket path≤100 bytesを生成時検査。repoとtmpを実運用参照しない。
- immutable releaseの絶対Node/main.jsパスをplistへ書く。current symlinkやglobal Node置換なし。releaseはdist/package/lock＋固定runtime依存。Node公式SHA256とartifact SHA256を照合。設置親のowner/非symlinkを確認し、既存衝突は拒否。
- 所有者LaunchAgent `local.imsg-web.readonly`、`~/Library/LaunchAgents/local.imsg-web.readonly.plist`、gui/<uid>、Aqua。RunAtLoad=true、KeepAlive=false、ExitTimeOut=45、Umask=63（077）、AbandonProcessGroupは既定false。専用cwdと明示env4項目、shell/secretなし。stdout/stderrは専用0600ログ、通常出力は起動停止の固定文のみ。1MiBは強制上限ではなく保守開始基準。所有者が週1回と異常停止時にサイズ・想定外出力を確認し、超過時は入口/Agentを停止して保管・新規化する。異常例外・ライブラリstderrも合成機密scan対象とする。本文/キーを記録しない。
- GUIログイン時に一度起動。通常稼働は常駐するがクラッシュ後の無条件再起動はしない。既存安全契約により異常停止時lockを維持し、旧子/owner write停止を証明するまで再起動禁止。ログイン前/停電後の無人自動復帰は保証しない。
- キーはユーザーの対話terminalでsetup/rotateを実行しpassword managerへ保存。エージェント会話/tool出力/argv/envへキーを載せない。診断・自動試験キーはpipe/memory内だけで生成使用、試験後失効させて本番キーへユーザーがrotateする。

## 実装・配備フェーズと依存

1. この案の独立レビューと採否記録。配備対象・CTホスト名公開・GUIログイン前提・失敗時手動復旧をユーザーへ提示し、実機設定変更の許可を得る。ACLが読み取れない場合、tailnet到達者はログイン画面へ到達し得るがデータはappキー必須という境界を説明し、owner-onlyネットワークとは主張しない。
2. ローカルrepoに配備ドキュメント、検証付きplist生成器（ファイル生成のみ、install/bootstrap/Serve変更なし）、合成検証を追加。leadが停止/復旧・機密境界と受入assertionを担当。root実行を拒否。別Macのarch/imsgパスを設定値とする。
3. 許可後、iMacの新規private配備directoryへrelease/runtimeを設置、collision/permissions/hash確認。独立一時stateで同じ安定パスからLaunchAgent読み取り試験。M1でも別label/別private一時stateで権限・停止を検証し、常用サービスにしない。実本文/識別子をログに出さない。TCC拒否なら止め、必要なGUI許可を説明し本人操作を依頼、DBやTCCへ書き込まない。
4. iMac本番state初期化・Agent起動、loopback認証/閲覧/正常停止再起動確認。Serve直前に全表示を再取得、差異あれば中止。承認した空設定から`tailscale serve --bg --https=443 http://127.0.0.1:8787`のみ追加。権限拒否やHTTPS有効化promptなら停止し、Tailscale全体設定/ACLを自動変更しない。
5. Tailnetの別端末で本物の証明書検証（insecure無効）、ログイン/会話/本文/15秒更新/失効を確認。無認証401、Host/Originの実転送互換、Funnel無し、8787外部非到達。スマホは本人端末で確認。合成スクショだけ保存。
6. 所有者が最終キーを生成・保管、試験session401を確認し引渡し。再起動/ログアウト/停電試験は別承認・現地復旧手段の準備後、未実施なら未証明と記録。

## 停止・更新・復旧

- 通常停止: まず所有するServe routeを現在値と照合してoffにし、app固有gui labelをbootoutする。正常停止の目標は要求発行から30s以内（内部処理はHTTP最大10s＋reader5s＋admin最大5.5s）。30s超・強制終了・lock残存は正常停止不合格。launchdのSIGKILL猶予45sとは別の条件とし、45s経過でも終了を断定せず確認する。app/admin/RPCの終了、loopback閉鎖、正常時lock解除を確認。`killall imsg`やwatcher停止禁止。Serve停止が必要なら自分が追加した443 rootの現在値を照合して同じflag+offのみ。resetや一括設定復元なし。
- 更新: 旧release保管→新release別directory準備→通常停止→plist旧版をprivate backup→新しい絶対pathへ変更→起動/認証/実読取検証。schema1互換のreadonly版間のみrollback。失敗時新プロセス停止確認して旧plistへ戻す。state/hashは巻き戻さず全session再ログイン。将来schema変更は別計画。
- 異常終了: 入口停止→対象label停止→所有していたprocess tree/同process group/実行pathを調査。PID無しだけで停止証明にしない。証明できなければlock保持のままサービス停止しユーザーへ報告。lockを自動削除しない。停止の追跡記録が完全で、正常終了ACKと全所有子終了・書込終了を確認できた場合だけ保管して復旧する。不明なクラッシュの標準手動復旧は、対象Agentをbootoutしplistを元の権限のままprivate退避→本人承認・現地復旧手段の準備後にOS再起動→変更されたkern.bootsessionuuidと自動ロードされていないこと、旧releaseプロセス不在を確認→state全体を0700へ複製保管→lock/socketだけを同じprivate退避先へ移動（削除せず、owner.jsonは移動/巻戻ししない）→owner hash/権限を再確認→Agent起動・認証・キーrotation確認→最後にServe復帰。再起動前のboot UUIDを配備記録へ保存する。このOS再起動復旧は未検証で、承認後のisolated state練習が完了するまで通常運用の復旧合格にはしない。再起動の承認や停止の証拠が得られなければ停止継続する。Messages DBは一切復元しない。
- 本フェーズでは自動stale-lock回収、root daemon、Tailscale入替、auto-login/電源設定、Messages/AI watcher変更、GitHub push/publicationを行わない。

## 受入条件と確認方法（すべてP0c未実施）

| ID | 条件 | 検証 |
|---|---|---|
| C01 | 生成物は絶対path/owner/arch/port/origin/UDS長検証、secret/root/衝突なし | generator負例・正常例、Mac plutil -lint、生成差分 |
| C02 | 両MacのGUI Agentから認証読取可能、SIP別capability、送信/既読0 | 各AgentでAPI順序とstatus/count-only、起動user確認、終了確認 |
| C03 | iMac443はtailnetのみ・正規証明書、8787非公開、auth/CSRF境界維持 | 別tailnet client HTTPS、無認証401/不正Origin拒否、Serve JSON/外部8787接続拒否 |
| C04 | 停止≤45s、正常restartでsession無効、異常時自動再起動/lock削除なし | isolated stateでTERM/強制終了試験、所有子確認、再起動拒否、既存watcher不変 |
| C05 | 旧release戻しが実際に可能、hash巻戻しなし、所有者キー非漏洩 | 実runtime・同じ実artifactを別の2 release directoryへ置く切替練習（初回は異なる旧版へのrollback証明ではない）、実配備hash照合、log/repo scan、キーrotation後旧session401 |
| C06 | 普段の閲覧性能が判定可能 | 両Mac1client、50会話/50本文、実foreground対照とAgentを同条件で測定する。下記測定定義を使用し、p95≤3s/cold≤10s/owned RSS≤512MiBは初期の試験運用可否を相談する目安で、ユーザー確定SLOとしない。30分pollは継続稼働試験。目安超過は配備を停止して証拠と対策または限定試験継続の選択を本人へ提示、測定後に合格へ読み替えない |
| C07 | ユーザーが利用/失効/停止でき制約を把握 | スマホ閲覧確認、対話キー保存、runbook操作。未実施の再起動/停電/ACL管理試験を明記 |

## 代替案・未決事項

- KeepAlive=trueはクラッシュ復帰を試みるがretained lockで起動失敗を繰り返す。今回はfalse案。安全な自動復旧機能は独立設計が必要。
- root LaunchDaemonはログイン前に起動可能でもMessages/TCCのユーザーcontextと一致しない。別Linuxホスト＋SSHは接続管理が増える。foregroundのみは最小だがログイン時起動なし。今回はuser LaunchAgent案。
- reverse proxy追加はHost互換問題時の代替だが、まず実Serve転送で厳密認証が成立するか検証する。認証チェック緩和で解決しない。
- 未決: 配備/CT名公開の承認、tailnet ACLの閲覧可能範囲、GUI login/手動障害復旧の許容、実TCC、Serve Host互換、性能、再起動試験の日時。本番変更前に重大事項は確定する。
- 送信終了不明時の管理者overrideは依然未決。P0cはread-onlyなのでこれを暗黙採用しない。全部盛り製品の機能を縮小確定しない。

## 一次資料

- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve): bg、HTTPS reverse proxy、対象を指定したoff、statusとget-configの差異。
- [HTTPS / CT](https://tailscale.com/docs/how-to/set-up-https-certificates): 証明書のFQDNは公開CTへ記録、サービス内容の公開とは別。
- [Apple LaunchAgent lifecycle](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html): user agentとlogin lifecycle。
- 実iMac `man launchd.plist`: ExitTimeOut、KeepAlive、Umask、AbandonProcessGroupの仕様を読み取り確認。


## 追加の確定契約・検証詳細

### 信頼境界と承認

- localhost TCP転送は停止中に別ローカルプロセスが8787へbindすると正規originの偽画面を返し得る。iMacの一般UID500〜65533は所有者501のみ（確認時点）だが、これだけでローカル全プロセスの信頼は証明しない。限定版はMac全体を信頼境界とし、他UIDを含む悪意のあるローカルコードからの防御は保証しない。この前提とクラッシュ中の残存Serveリスクを承認事項に含める。計画停止は必ずServeを先にoffにする。
- 他の非信頼ローカル利用者への耐性が必要なら本TCP案を採用せず、認証付きbackend TLSまたはprivate socketに適したHost対応を別設計する。承認前にその実装へ分岐しない。
- 承認書にはVault内の実機値で、iMacの正確なHTTPS FQDN、443 root→127.0.0.1:8787、新設directory/plist、M1の一時Agent、CT公開、GUIログイン前提、異常停止時の手動復旧を示す。レビュー配布用の本文では識別情報を置換する。
- tailnet ACL全体は未取得。ネットワークowner-onlyを保証しない。到達許可されたtailnet端末にはログイン画面が見え得る。追加のACL変更は別承認。許可範囲不明を隠して配備しない。
- 計画段階でClaude直利用は前回の組織契約制限が未解消のため結果なし。この本文をそのまま別セッションで渡せる。利用可否に合わせてFableやroutingへ切り替えない。

### 段階ごとの中止

- generator→isolated Agent検証→本番state/loopback→Serve/HTTPS→所有者キー引渡しの順。各前段の安全試験不合格なら後段へ進まない。
- 初回を含め認証/公開範囲/終了/機密の不合格が見つかったら、所有するServe設定のみ照合してoff→該当Agent停止→状態保管。Tailscale自体、SSH、AI watcherは停止しない。設定が他者に変更されていて安全にoffできない場合はapp認証をblock/停止し、現在の転送先リスクを伝えて即時エスカレーションする。設定の一括resetはしない。
- 性能目安超過時も自動で試験運用を継続しない。計測と課題を提示して許可を得る。
- キー引渡し前に所有者が対話terminalでrotate。自動試験のkey/cookie/CSRFはメモリ内だけ、デバッグtrace/ネットワークdump/実画面キャプチャなし。旧試験session401を確認してから利用開始。

### C02 読み取り専用性

- RPC clientの許可methodはstatus/chats.list/messages.history/watch.subscribe/watch.unsubscribe。P0c UIが使うのは最初の3つ。CLI子はstatus --json、RPC子はrpcのみ、shellなし。messages.historyはattachments=false。Web APIには変更系のrouteを作らない。
- 独立assertionで全子引数/全送出methodを合成imsgへ記録し許可リストを照合する。send/read/typing/edit等のWeb要求とclient要求の拒否を検証し、禁止methodが子へ0回であることを確認する。実機ログはmethod/count/errorcodeだけでparams/body/IDなし。メソッドの読み取り実装も固定imsg版で確認する。
- 実機上のDB変化はMessages/既存watcherと競合するため、「DB全体が不変」とは主張しない。アプリが変更操作を発行しない証拠と、既読副作用がないimsg読取実装の確認を分ける。送信試験の再実施はしない。
- capability期待値: 両Macにreadonly基本閲覧。iMac観測でread/typing backend available、M1でunavailableだが両方UIに変更操作なし。その他は承認後probeでbackend観測とUIの対応表を固定し、SIPだけを原因と断定しない。

### C03 到達範囲

- iMac listenerは127.0.0.1:8787だけをassert。別端末からtailnet IPv4/IPv6と実LAN IPの8787拒否を確認する。対象addressは私的検証記録のみ。IPv6またはLANへ試験元から到達不能なら経路未検証と記録する。
- 443は実正規certificate、無認証401、別origin拒否、実browser Host/Origin成功、Serve全3形式でFunnel無しを確認。tailnet外試験は本人のモバイル等の外側端末で実施する。利用可能な試験元がなければ外側直接非到達は未証明とする。設定証拠と到達実験を区別する。
- 現iMacのTailscale v1.102.3一次ソースではHTTP TCP proxyがincoming Hostを保持する。private socket proxyではlocalhostへ変更するため同じ方式とは扱わない。静的確認は本物のHTTPS試験の代替ではない。
- [Tailscale v1.102.3 proxy実装](https://github.com/tailscale/tailscale/blob/v1.102.3/ipn/ipnlocal/serve.go)

### C04 停止/異常試験

| ケース | 期待結果 |
|---|---|
| 正常bootout、active readonly requestあり | ≤30sでapp/所有子終了・port/socket閉鎖・lock解除。次の起動は新sessionのみ。45sの強制killを正常合格にしない |
| isolated RPC処理中の親SIGKILL | lock保持。launchd所有group子の終了を確認、KeepAlive=falseで再spawnなし、同state起動拒否。終了未確認なら復旧を試さない |
| isolated RPC子だけ異常終了 | 進行中readは成功と偽らずエラー。確認済み子終了後のfresh readerは契約に従い許容。親起動中lock保持、正常bootout後解除 |
| owner rotation書込保留中の停止 | 合成writerの期限内完了と期限超過を別試験。後者はlock保持、旧session無効、disk hash巻戻しなし |

- 強制終了/遅延注入は合成backend・isolated stateのみ。実Messages/watcher/本番stateを故障注入しない。配備app PID/PGID/child lineageは開始時に収集し、全imsgを名前だけでkillしない。

### C05 更新切替と保守

- 初回は同じ実artifactの2 path間で生成plistによる旧→新→旧を実行し、各起動で認証読取/hash一致/旧session失効を確認。「異なる旧版へのrollback」は未実証と記録する。実更新時は現稼働版と候補版のschema互換を確認して同じ手順で検証する。
- 所有者が月1回、Node24/runtime dependencies/imsg/Tailscaleのセキュリティ情報を確認。新たにremote到達できる重大脆弱性が判明したら入口を停止し、修正版を別releaseで検証してから再開。自動upgradeはしない。
- 既知重大脆弱性、schema非互換、未検証runtimeのreleaseはrollback候補から除く。安全な旧版がない場合は停止継続。
- 週1回ログsizeと起動状態、異常時は即時確認を所有者の手動運用とする。自動監視の提供やSLA保証とはしない。

### C06 測定定義

- 同一Mac/同じimsg/同じreleaseでforeground対照とAgentを比較。限度はchats=50/messages=50、同じローカル選択会話を使う。実件数が少なければactual countを記録し50件データ性能を達成したとしない。本文/IDは保存しない。
- cold=アプリ新規起動後、最初のcapabilities→chats→選択historyのHTTP開始から最後のbody parse完了まで。OS DB cacheをpurgeしない。warm=同順の1cycle、20回、15s間隔、成功全20回を記録。p95は昇順19番目。API性能であり画面描画性能ではない。別途本人スマホで表示の待ち時間を確認する。
- RSSはappと追跡したRPC/CLI子の合計を5sごとに30分採取、最初の5分をwarmup、5–15分と20–30分の中央値を比較。後半が前半より20%かつ32MiB超増えたら継続調査。ピーク値と子restart数を記録し、PID交代をゼロにして集計しない。
- 2client同時poll＋合成imsg遅延/timeoutも独立試験。source 1 active+32 distinct waiting、重複coalesce、HTTP32 active/TCP64、per-session120/min、失効済み応答非復活をassert。RPC request deadlineとUI poll間隔を混同しない。
- 各C01〜C07に実行したassertion/実測/未実施理由/前提を紐づける。現時点はすべて計画で、既存P0b試験をP0c完了へ付け替えない。


## 完成コードのレビュー範囲

ユーザーは上記の限定配備・信頼前提について「はい」と回答した。再起動/TCC自動変更は含まない。設計レビューは本文のみ・ツールなし。コードレビューではこのimsg-web workspaceだけを対象に、scripts/generate-launch-agent.mjs、scripts/agent-probe.mjs、tests/launch-agent.test.ts、tests/p0c-boundary.test.ts、tests/fixtures/p0c-imsg.mjs、docs/p0c-operations.mdと必要な関連srcの読み取りだけを許可する。書込み・SSH・プログラム実行・外部変更は禁止。過去レビュー結論を参照せず、反論・失敗条件・棄却理由を探す。生成器は新規plistと欠けている0600ログplaceholderだけを生成し、ネットワーク/起動設定を実行しない。実機試験と秘密情報をレビューへ持ち出さない。

