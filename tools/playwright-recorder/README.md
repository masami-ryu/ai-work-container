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
```

現在のページ状態を snapshot として取得する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'
```

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

## 人間操作用 Chrome

既存の手動操作用ブラウザは次で起動する。

```bash
pnpm chrome
```
