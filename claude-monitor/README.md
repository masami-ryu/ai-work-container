# Claude Monitor

複数ターミナルで並行動作する Claude Code / Copilot CLI セッションの作業状況を Web ダッシュボードで一覧表示し、承認要求・質問・セッション終了時に通知音を鳴らすツール。

## セットアップ

### 1. 依存パッケージのインストールとビルド

```bash
cd claude-monitor
pnpm install
pnpm run build
```

### 2. Hooks 設定

`.claude/settings.local.json` に `hooks` キーを追加する。既存の `permissions` 設定はそのまま保持すること。

```bash
# 現在の設定を確認
jq . .claude/settings.local.json
```

`hooks` セクションは本リポジトリの `.claude/settings.local.json` に設定済み。別プロジェクトに導入する場合は、既存の `permissions` を維持したまま `hooks` キーをマージする。

```bash
# マージ後の設定が正しい JSON か検証
jq . .claude/settings.local.json
```

### 3. MCP 設定（任意）

`.vscode/mcp.json` の `servers` に `claude-monitor` を追加する。

```json
{
  "claude-monitor": {
    "type": "http",
    "url": "http://localhost:3456/mcp"
  }
}
```

### 4. Copilot CLI Hooks 設定（任意）

Copilot CLI セッションをダッシュボードで監視する場合の追加設定。ダッシュボードからセッションを起動すると自動的に hooks が配置されるため、手動設定は通常不要。

#### 自動配置（推奨）

ダッシュボードの「新規セッション」ボタンから Copilot CLI を起動すると、以下が自動的に行われる:

1. `.github/hooks/claude-monitor.json` に hooks 設定を配置
2. `--additional-mcp-config` で MCP 接続を自動注入

#### 手動配置

既存のプロジェクトで手動設定する場合は、`.github/hooks/` にフック設定ファイルを配置する:

```bash
# hooks ディレクトリを作成
mkdir -p .github/hooks

# テンプレートをコピーして絶対パスに展開
HOOKS_DIR="$(cd claude-monitor/hooks && pwd)"
sed "s|__HOOKS_DIR__|$HOOKS_DIR|g" claude-monitor/hooks/copilot-hooks.json > .github/hooks/claude-monitor.json
```

MCP 接続設定を追加する場合（`.github/hooks/` 配下には置かない）:

```bash
mkdir -p .vscode
cat > .vscode/claude-monitor-mcp.json << 'EOF'
{
  "mcpServers": {
    "claude-monitor": {
      "type": "http",
      "url": "http://localhost:3456/mcp"
    }
  }
}
EOF

# Copilot CLI 起動時に指定
copilot --additional-mcp-config @.vscode/claude-monitor-mcp.json
```

`.github/hooks/` 配下の JSON は Hook 設定として検証されるため、`mcpServers` だけのファイルを置くと `Missing property "hooks"` 警告が表示される。

#### Copilot CLI Hook イベント対応表

| Copilot イベント | claude-monitor イベント | スクリプト |
|---|---|---|
| sessionStart | SessionStart | copilot-notify.sh |
| sessionEnd | SessionEnd | copilot-notify.sh |
| userPromptSubmitted | UserPromptSubmit | copilot-notify.sh |
| preToolUse | PreToolUse + Decision | copilot-decide.sh + copilot-notify.sh |
| postToolUse | PostToolUse | copilot-notify.sh |
| errorOccurred | Notification(error) | copilot-notify.sh |

#### 注意事項

- `CLAUDE_MONITOR_FORCE_HOOKS=1` 環境変数を設定すると、既存の hooks.json をバックアップして上書き
- Copilot CLI セッションの session_id は `copilot-pane-<N>` 形式（tmux pane ID ベース）
- 同一 pane で新規セッションを起動すると前回のデータは自動的にリセットされる

## 使い方

### サーバー起動

```bash
cd claude-monitor
pnpm start
```

ダッシュボードは http://127.0.0.1:3456 で表示。

### ダッシュボードの機能

- **セッション一覧**: 各 Claude Code / Copilot CLI セッションの状態を色分けで表示（ツール種別バッジ付き）
  - 🟢 実行中 / 🟡 承認待ち / 🟠 質問待ち / 🔵 入力待ち / 🔴 エラー / ✅ 完了
- **承認操作**: ブラウザから Allow/Deny をクリックしてターミナルの権限ダイアログをスキップ
- **質問表示**: AskUserQuestion の内容を読み取り専用で表示（回答はターミナルで入力）
- **質問回答（MCP）**: MCP `ask_user` ツール経由の質問にはブラウザから直接回答可能
- **通知音**: 承認要求・質問・セッション終了で異なる通知音を再生
- **デスクトップ通知**: 「通知許可」ボタンで有効化

### MCP ツール

Claude Code が MCP 経由で作業内容を報告:

- `update_status`: 現在の作業内容を更新
- `report_milestone`: マイルストーン到達を報告
- `ask_user`: ユーザーへの質問をダッシュボードに表示し、ブラウザから回答を受け付ける（120秒タイムアウト、タイムアウト時は AskUserQuestion にフォールバック）

## アーキテクチャ

```
Terminal (Claude Code)  ── Hooks ──→ Dashboard Server ←─ WebSocket ─→ Browser
                          │  ↑          │
                    notify.sh  decide.sh ├─ REST API
                   (async)    (blocking) ├─ MCP Endpoint
                                         └─ Static Files
Terminal (Copilot CLI)  ── Hooks ──→
                          │  ↑
              copilot-notify.sh  copilot-decide.sh
```

## Hook イベント

| フック | スクリプト | 動作 |
|--------|-----------|------|
| SessionStart | notify.sh (async) | セッション登録 |
| UserPromptSubmit | notify.sh (async) | idle → running 復帰 |
| Notification(idle_prompt) | notify.sh (async) | ログ記録のみ |
| PreToolUse(AskUserQuestion) | notify.sh (async) | 質問内容の通知 |
| PermissionRequest | decide.sh (blocking) | 承認要求 → ブラウザ応答待ち |
| Stop | notify.sh (async) | idle 遷移 |
| SessionEnd | notify.sh (async) | completed 遷移 + 通知音 |

## セキュリティ

- サーバーは `127.0.0.1` にバインド（外部アクセス不可）
- 状態変更 API と WebSocket で Origin ヘッダーを検証（CSRF/CSWSH 対策）

## 拡張ポイント

将来利用可能な Hook イベント:

- `PostToolUse` / `PostToolUseFailure`: ツール実行結果の記録
- `SubagentStop`: Task ツール完了検知
- `ConfigChange`: 設定変更検知
