# imsg-web

An early foundation for a single-owner, self-hosted iMessage web interface on macOS.

**P0b internal read-only slice.** Owner authentication, read-only HTTP and a responsive Web UI are implemented. **No sending, read-state changes, service installer or production deployment yet.** Do not treat this as the complete chat application. SIP is never changed; SIP-enabled and bridge-enabled environments are tested separately.

## 開発と診断

Webの機能確認はRPCのみを使用します。既読・入力中の安全な機能確認は未実装のため、状態を「未確認」と表示します。明示的な `doctor` は引き続きCLI statusを呼び、上流実装によりMessages.appを起動・修復する可能性があります。アプリを起動しない検証には使用しないでください。

Node **24.20.0**を専用パスへ用意し、その `bin` をPATHの先頭に置きます。既存のNodeを置き換える必要はありません。`imsg`は別途導入し、Messages DBを読む権限を所有者が設定してください。このツールは権限を変更しません。

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
IMSG_PATH=/absolute/path/to/imsg npm run doctor
```

doctorは `status --json`、RPC `status`、最大1会話と最大1メッセージ、watch購読と解除だけを実行します。送信・既読変更・Messages起動・bridge注入は行いません。出力は状態、理由コード、件数、時間などに限定し、本文・宛先・GUID・内部パスを出しません。`ready`は基本的な読み取り検査の結果であり、送信やWebアプリの安全性を保証しません。通知が0件でも購読自体は成功し得ます。`deliveryVerified`は常にfalseです。

This diagnostic reads at most one chat and one message in memory, but never prints their content or identifiers. It subscribes briefly, unsubscribes, and closes only its own read-only child. Exit status is nonzero when core checks fail. Missing CLI status degrades capability diagnostics independently of DB reads. Empty chat history is reported as skipped, not tested.

Do not store actual RPC responses, chat databases, attachments, secrets, or personal configuration in this repository. Fixtures use explicitly synthetic values; observed protocol structure is labelled separately from injected faults. Do not commit live doctor captures without checking every field.

## Next milestones

1. Remaining P0b/deployment gates: dedicated production runtime and LaunchAgent verification, Tailscale Serve setup review, clean install/recovery rehearsal, performance baselines.
2. P1a: existing conversation UI, invalidation-based refresh, operation ledger and text sending. Uncertain-send recovery policy must be resolved first.
3. P1b: search, new recipients, attachments, clean-install and recovery documentation; candidate v0.1.
4. Later: capability-gated advanced operations and opt-in notifications.

No messages are mirrored into a second archive. No multi-Mac aggregation, automatic resend, SIP/TCC changes, AI replies, or public Internet exposure is planned. Each owner hosts a separate instance. Tailscale access will still require application authentication.

See [architecture](docs/architecture.md), [acceptance evidence](docs/acceptance.md), and [review record](docs/reviews.md).

## 認証付き閲覧の内部版

所有者ログイン、会話/本文の閲覧、15秒更新、セッション失効、所有者キー変更を実装しています。画面は閲覧専用です。imsgが拡張機能を利用可能と報告しても、この版から既読変更・typingなどは実行しません。

[P0b操作と制限](docs/p0b-operations.md)、[P0b受入記録](docs/p0b-acceptance.md)、[独立レビュー依頼](docs/p0b-review-packet.md)を参照してください。localhostのHTTP URLをブラウザーで直接開く構成ではなく、設定したHTTPS originとSecure Cookieを必要とします。Tailscale/LaunchAgent設定はこのrepoや試験で自動変更していません。

ブラウザー受入試験は`npm run build && npm run test:browser`。Linux上のChromiumを既定で使い、別の実行ファイルは`CHROMIUM_PATH`で指定できます。合成データだけの一時HTTPSサーバーを起動し、自己署名証明書はテストcontextだけで許容します。本番のTLS検証を無効にしないでください。

The repository is local and unpublished. The release name and license will be confirmed before publication; no open-source license grant is made by this draft.
