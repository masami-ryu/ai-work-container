# ai-work-container

AI エージェント作業用の Dev Container 環境。

## 概要

Node.js（nodenv 経由）、pnpm、Python / uv、Codex CLI を使う共通環境です。業務プロジェクトは `works*` 配下に別途配置します。

## リポジトリ構成

| パス | 用途 |
| --- | --- |
| `.devcontainer/` | コンテナ、ツール導入、sidecar の設定 |
| `.node-version` | Dev Container 本体で使う Node.js バージョン |
| `.codex/skills/` | このリポジトリで管理するスキルの正本 |
| `.agents/skills` | `.codex/skills` への互換用 symlink |
| `.vscode/` | VS Code の設定と MCP サーバー定義 |
| `tools/playwright-recorder/` | 共有ブラウザ操作・録画用ツール |
| `tools/tmux-codex-sidebar/` | tmuxのwindow一覧・Codex状態表示・マウス操作 |
| `docs/` | セットアップ・運用手順 |
| `ai/` | プラン・レビューなどのローカル成果物（成果物は Git 管理対象外） |
| `works*` | 独立リポジトリなどを置く作業ディレクトリ（Git 管理対象外） |

`works*` の中身はこのリポジトリの clone には含まれません。作業時は各ディレクトリや対象リポジトリの `AGENTS.md` があれば確認してください。

## 主要機能

- **開発ツール**: anyenv / nodenv、pnpm、uv、tmux をセットアップ
- **Codex CLI と Skills**: ターミナルからの作業と `.codex/skills` のワークフロー
- **設定の永続化**: Docker volume `dev-home-data` で Codex の設定・認証・状態と tmux 設定を保持
- **Git 統合**: GitLens、GitHub Pull Request、GitHub Actions 拡張機能
- **MCP 接続**: VS Code 用の Microsoft Learn（`msdocs`）と Context7 の定義を同梱

Compose には以下のサービスを定義しています。

| サービス | 用途・接続先 |
| --- | --- |
| `devcontainer` | VS Code と AI エージェントの作業環境 |
| `playwright-recorder` | ホストの `http://localhost:6080/vnc.html` で共有デスクトップを表示。操作 API はコンテナ間の `http://playwright-recorder:6090` |
| `localstack` | SQS 互換の開発用 queue。コンテナ間の `http://localstack:4566` |

Node.js の指定は [`.node-version`](./.node-version)、pnpm・npm・Codex の初期導入バージョンは [`node-tools.env`](./.devcontainer/node-tools.env) が正本です。詳細は [DevContainer 設定ガイド](./.devcontainer/README.md) を参照してください。

## セットアップ

### 前提条件

- Docker Desktop
- Visual Studio Code
- Dev Containers 拡張機能

### 起動手順

1. ホスト側でリポジトリを clone して VS Code で開く。

   ```bash
   git clone https://github.com/masami-ryu/ai-work-container.git
   cd ai-work-container
   code .
   ```

2. コマンドパレット（Ctrl+Shift+P / Cmd+Shift+P）で `Dev Containers: Reopen in Container` を選び、ビルドと初期セットアップの完了を待つ。

3. Dev Container 内の新しいターミナルで確認する。

   ```bash
   node --version
   pnpm --version
   uv --version
   codex --version
   codex login status
   ```

   未ログインの場合は `codex login` または `codex` 起動時の案内に従って認証する。

### MCP 設定

[`.vscode/mcp.json`](./.vscode/mcp.json) は VS Code 用の設定で、`msdocs` と `context7` を定義しています。GitHub MCP の定義は同梱していません。

Codex の MCP 設定は `~/.codex/config.toml`、または信頼済みプロジェクトの `.codex/config.toml` に置きます。登録状況は `codex mcp list` で確認できます。追加方法は [OpenAI の MCP ドキュメント](https://developers.openai.com/codex/mcp) を参照してください。

## 使い方

### Codex CLI

```bash
# 対話型セッション
codex

# 初期プロンプト付きで起動
codex "このリポジトリの構成を説明してください"

# 非対話実行
codex exec "git status を確認して要約してください"
```

設定は `~/.codex/config.toml` を使います。devcontainer rebuild 後も Codex 認証と設定を維持する手順は [開発ツール設定の永続化と Codex 認証情報のバックアップ](./docs/codex-backup-restore.md) を参照してください。

### Playwright recorder

ブラウザは `playwright-recorder` sidecar で動かします。ホストの `http://localhost:6080/vnc.html` を開くと、共有デスクトップを操作できます。

録画用のコマンドは noVNC デスクトップ内の xterm で実行します。

```bash
cd /workspaces/ai-work-container/tools/playwright-recorder

# 初回ログイン用。認証状態を .auth/user.json に保存
pnpm codegen:auth https://example.com/login

# 認証済み状態で業務操作だけ録画
pnpm codegen:shift https://example.com/shifts
```

Dev Container 内の AI からは sidecar の command server を使います。`shared-open` は noVNC に表示される共有ブラウザを開きます。

```bash
curl -sS http://playwright-recorder:6090/status

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"shared-open","args":["https://example.com/"]}'

curl -sS http://playwright-recorder:6090/run \
  -H 'content-type: application/json' \
  -d '{"command":"snapshot","args":["--filename=snapshots/current.md"]}'
```

`snapshot` で取得した element ref を `click` / `fill` などに渡します。共有 profile の復旧や診断コマンドは [Playwright recorder の README](./tools/playwright-recorder/README.md) を参照してください。

`@playwright/cli` は alpha 系の Playwright 依存を含むため、現時点では共有ブラウザ操作のための実験的な補助として扱います。

認証状態ファイル `tools/playwright-recorder/.auth/user.json` は `.gitignore` 済みです。録画後は生成コードを `tools/playwright-recorder/tests/` などに整理して保管してください。

## ドキュメント

- [DevContainer 設定ガイド](./.devcontainer/README.md) - バージョン管理、初期セットアップ、復旧
- [Codex sandbox 運用メモ](./docs/codex-sandbox.md) - devcontainer 内での sandbox 設定
- [Codex Skills セットアップ](./docs/codex-skills-setup.md) - `.codex/skills` と互換パスの構成
- [開発ツール設定の永続化と Codex 認証情報のバックアップ](./docs/codex-backup-restore.md) - rebuild 後の設定復元
- [Playwright recorder](./tools/playwright-recorder/README.md) - 共有ブラウザ操作・診断 API
- [tmux Codexサイドバー](./tools/tmux-codex-sidebar/README.md) - window一覧・状態表示・改名・並べ替え
- [Playwright sidecar だけ rebuild する手順](./docs/playwright-sidecar-rebuild.md)
- [devcontainer で Git ローディングが終わらない問題](./docs/devcontainer-git-loading-issue.md) - 過去の調査記録と適用済みの対処

## トラブルシューティング

以下のコマンドは Dev Container 内のリポジトリルートで実行します。

### Node.js の選択が古い・コマンドが見つからない

古いシェルのバージョン指定を解除し、nodenv を初期化します。

```bash
unset NODENV_VERSION NODENV_DIR
eval "$(nodenv init -)"
nodenv rehash
nodenv version
node --version
```

`.node-version` の Node.js が未導入なら、コンテナを再ビルドして初期セットアップを実行してください。

### pnpm / Codex CLI を導入し直す

Node.js が `.node-version` の指定に一致していることを確認してから、固定バージョンの導入スクリプトを実行します。

```bash
bash .devcontainer/setup-node-tools.sh "$(nodenv prefix)"
nodenv rehash
pnpm --version
pnpm list -g --depth 0
codex --version
```

`pnpm add -g` などでグローバルパッケージを変更した後も `nodenv rehash` を実行してください。

### Codex の診断

```bash
codex doctor
codex mcp list
codex mcp --help
```

## ライセンス

このプロジェクトは個人使用を目的としています。
