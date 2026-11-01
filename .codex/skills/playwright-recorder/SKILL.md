---
name: playwright-recorder
description: local tools/playwright-recorder sidecar でブラウザを操作・確認・共有する場合に使用する。「共有ブラウザを開いて」と依頼された場合にも使用する。Playwright CLI の snapshot、click/fill/press などの操作、noVNC 共有セッション、command-server API、スクリーンショット、共有プロファイルのリセット/復旧を含む。
---

# Playwright Recorder

## 目的

ローカルの `tools/playwright-recorder` ワークスペースを使い、Playwright でブラウザページを操作する。必要に応じて、同じ headed browser を noVNC 経由でユーザーと共有する。

主要リファレンスは `/workspaces/ai-work-container/tools/playwright-recorder/README.md`。コマンド詳細が不明な場合や、プロファイル復旧など頻度の低い手順を使う場合に読む。

## 作業ディレクトリ

`pnpm` で recorder コマンドを実行する場合は、次のディレクトリで実行する。command-server API を `curl` で呼ぶ場合は、この `cd` は不要。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder
```

`npm` ではなく `pnpm` を使う。

## フロー選択

- **ユーザーと共有するブラウザ**: `shared:*` コマンド、または command-server API を使う。ユーザーが noVNC で確認・ログイン・継続操作する必要がある場合のデフォルト。
- **AI 専用ブラウザ**: sidecar の xterm 内で単独操作する場合だけ `cli:*` コマンドを使う。この作業コンテナから AI が操作する場合は、AI 専用ではなく共有ブラウザを command-server API 経由で操作する。
- **目視確認**: noVNC は閲覧またはユーザーの手動操作に使う。AI のキー入力自動化には使わない。

## 共有ブラウザのコマンド

AI がこの作業コンテナから共有ブラウザを起動・操作する場合は、`pnpm shared:open` を直接実行せず、playwright-recorder sidecar の command-server API を使う。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-open","args":["https://example.com"]}'
```

ユーザーが「共有ブラウザを開いて」とだけ依頼した場合は、URL なしで共有ブラウザを起動または再利用する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-open","args":[]}'
```

`pnpm shared:open` は playwright-recorder sidecar の xterm 内で手動実行するためのコマンドとして扱う。

現在のページを確認・操作する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"click","args":["e1"]}'

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"fill","args":["e2","text"]}'

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"screenshot","args":["--filename=screenshots/current.png"]}'
```

共有操作が完了したら、共有ブラウザを閉じる。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"close","args":[]}'
```

共有プロファイルのリセットは、ユーザーがログイン/セッション状態のクリアを求めた場合、または復旧に必要な場合だけ行う。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-reset","args":["--confirm"]}'
```

## Command-Server API

recorder sidecar API 経由で実行する場合は `http://playwright-recorder:6090` を使う。

状態確認:

```bash
curl -sS http://playwright-recorder:6090/health
curl -sS http://playwright-recorder:6090/status
```

許可された Playwright CLI コマンドは `/run` 経由で実行する。

```bash
curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'
```

headed かつ永続的な共有セッションには `shared-open` を使う。コマンドは直列化され、タイムアウトする場合がある。レスポンスに `PROFILE_LOCKED` が含まれる場合は、破壊的な復旧を試す前に返却された `recoveryHint` に従う。

## AI 専用 CLI

ユーザーと共有しないブラウザセッションを sidecar の xterm 内で実行する場合だけ次を使う。この作業コンテナから AI が直接 `pnpm cli:*` を実行する用途ではない。

```bash
pnpm cli:open https://example.com
pnpm cli:snapshot
pnpm cli -- click e1
pnpm cli -- fill e2 "text"
pnpm cli:close
```

この作業コンテナから AI が操作する場合は、AI 専用 CLI ではなく command-server API を使う。command-server の `open` は共有ブラウザ用に `--headed --persistent --profile .pw-profile-shared` を補完するため、AI 専用の一時ブラウザとしては扱わない。

`click`、`fill` などの操作では、最新の `snapshot` に含まれる element refs を使う。利用可能なコマンドは次で確認する。

```bash
pnpm cli:help
```

## noVNC

ユーザーがログインする必要がある場合、または共有ブラウザを確認する必要がある場合は、noVNC を開くよう案内する。

```text
http://localhost:6080/vnc.html
```

コンテナネットワーク内からアクセスする場合:

```text
http://playwright-recorder:6080/vnc.html
```

## ガードレール

- AI 自動化で noVNC に直接入力しない。Playwright CLI または command-server API を使う。
- このツール経由で任意のページ JavaScript を実行しない。
- 明示的に依頼された場合、または復旧に必要な場合を除き、`.pw-profile-shared` を削除しない。
- 業務フローの最終保存・送信ボタンは、ユーザーが明確に依頼した場合を除き押さない。
- ユーザーのログイン、MFA、機密入力が必要な場合は共有ブラウザを開き、その手順はユーザーに noVNC で完了してもらう。
