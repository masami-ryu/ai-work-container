# Playwright recorder

AI 操作用は `@playwright/cli` を基本にし、noVNC は目視確認用として使う。ユーザーと AI が同じブラウザを触る場合は共有操作用の `shared:*` を使う。

`@playwright/cli` は alpha 系の Playwright 依存を含むため、この用途では実験的な補助として扱う。

## 共有操作

sidecar の xterm で共有用ブラウザを起動する。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder
pnpm shared:open https://example.com
```

ユーザーは noVNC でそのブラウザを操作する。ユーザー操作が終わったら、AI は同じ session の状態を見て続きから操作する。

```bash
pnpm shared:snapshot
pnpm cli -- click e1
pnpm cli -- fill e2 "text"
pnpm cli -- screenshot --filename=screenshots/current.png
```

共有操作を終える場合は閉じる。

```bash
pnpm shared:close
```

ログイン状態や profile を消して初期化したい場合は次を使う。

```bash
pnpm shared:reset
```

コンテナ内 Chrome は sandbox 用 namespace を作れないことがあるため、`.playwright/cli.config.json` で `--no-sandbox` を指定している。

## AI からの操作 API

sidecar 起動時に `6090` 番ポートで command server が起動する。AI は noVNC へキー入力せず、この API 経由で Playwright CLI を実行する。ホストには公開せず、Docker ネットワーク内の `http://playwright-recorder:6090` から使う。

```bash
curl -sS http://playwright-recorder:6090/health
curl -sS http://playwright-recorder:6090/status
```

`/status` は共有ブラウザの想定状態に加えて、`.pw-profile-shared` の lock 状態を返す。Chrome プロセスが存在しない stale lock は `shared-open` 実行前に自動削除される。

noVNC に表示される共有ブラウザを起動する。API 経由の `open` は既定で `--headed --persistent --profile .pw-profile-shared` を付けて実行される。意図を明確にしたい場合は `shared-open` を使う。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-open","args":["https://www.google.com/"]}'
```

共有 profile を明示的に初期化する場合は、最終手段として `shared-reset --confirm` を使う。通常の stale lock 復旧は `shared-open` が lock ファイルだけを自動削除する。`shared-reset --confirm` は実行前に `.pw-profile-shared.backup-<timestamp>` へ profile 全体を退避してから削除する。Chrome が実行中の場合は失敗し、noVNC 側で Chrome を閉じるように返す。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-reset","args":["--confirm"]}'
```

現在のページ状態を snapshot として取得する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'
```

noVNC の前面タブと Playwright CLI の current tab がずれる場合は、共有ブラウザ内の全ページを診断する。これは `page.context().pages()` から URL、タイトル、viewport、入力欄のメタ情報だけを取得し、入力値は取得しない。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-pages","args":[]}'
```

`shared-pages` でも noVNC 側のページが見えない場合は、Chrome DevTools Protocol の target 一覧を診断する。共有ブラウザは `.playwright/cli.config.json` で `--remote-debugging-port=9222` を付けて起動する。設定変更後は共有ブラウザを閉じて開き直す。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-targets","args":[]}'
```

noVNC の実ページと Playwright CLI の current target がずれていないか確認する。ズレている場合は `shared-attach-target` を推奨する警告を返す。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-guard","args":[]}'
```

CDP target 一覧から指定した URL 断片に一致する page target を選び、別セッション `shared-cdp` として attach する。既存の `default` セッションは閉じない。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-attach-target","args":["example.com"]}'
```

`shared-snapshot` は snapshot 前に target ズレを検査する。ズレを検出した場合は対象の page target へ `shared-cdp` セッションで attach し、そのセッションで snapshot を取得する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-snapshot","args":["snapshots/current.md"]}'
```

`shared-cdp` への attach がタイムアウトする場合は、CDP から直接ページメタ情報を取得して Markdown に保存する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-cdp-snapshot","args":["snapshots/current.md","example.com"]}'
```

ID/パスワード欄などの機密入力は、入力値を取得しない。診断コマンドで扱うのは URL、タイトル、target 種別、入力欄の `type` / `id` / `name` / `placeholder` / `autocomplete` / 表示状態などのメタ情報だけにする。

同じ共有ブラウザを続きから操作する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"fill","args":["e43","福岡 ニュース"]}'

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"press","args":["Enter"]}'
```

実行できるのは `command-server.js` で許可した Playwright CLI コマンドだけ。任意 shell コマンドとページ上の任意 JavaScript は実行しない。

コマンドは同時に 1 つだけ実行される。既定で 30 秒を超えたコマンドはタイムアウトし、`PLAYWRIGHT_COMMAND_TIMEOUT_MS` で変更できる。

共有 profile が lock されて起動できない場合は、応答に `errorCode: "PROFILE_LOCKED"`、`profileLock`、`recoveryHint` が含まれる。`shared-reset` の成功応答には `backup.path` が含まれる。

## CLI 操作

AI が単独で操作する場合は sidecar の xterm で実行する。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder
pnpm cli:open https://example.com
pnpm cli:snapshot
pnpm cli -- click e1
pnpm cli -- fill e2 "text"
pnpm cli:close
```

`snapshot` で取得した element ref を `click` / `fill` などに渡す。詳しいコマンドは次で確認する。

```bash
pnpm cli:help
```

## 目視確認

ホスト側ブラウザまたは VS Code Ports から noVNC を開く。

```text
http://localhost:6080/vnc.html
```

この作業コンテナ内から確認する場合は次を使う。

```text
http://playwright-recorder:6080/vnc.html
```
