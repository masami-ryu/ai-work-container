# Claude Monitor

複数ターミナルで並行動作する Claude Code セッションの作業状況を Web ダッシュボードで一覧表示し、承認要求・質問・セッション終了時に通知音を鳴らすツール。

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

## 使い方

### サーバー起動

```bash
cd claude-monitor
pnpm start
```

ダッシュボードは http://127.0.0.1:3456 で表示。

### ダッシュボードの機能

- **セッション一覧**: 各 Claude Code セッションの状態を色分けで表示
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
Terminal (Claude Code) ── Hooks ──→ Dashboard Server ←─ WebSocket ─→ Browser
                          │  ↑          │
                    notify.sh  decide.sh ├─ REST API
                   (async)    (blocking) ├─ MCP Endpoint
                                         └─ Static Files
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
