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

#### Copilot SessionEnd の reason ベースステータス遷移

Copilot CLI の `sessionEnd` フックは各ターン完了時に発火する。`reason` フィールドに基づいてステータスを決定:

| reason | ステータス遷移 | 説明 |
|--------|---------------|------|
| `complete` | → idle | ターン完了、次のプロンプト入力可能 |
| `user_exit` / `user_quit` | → completed | ユーザーによるセッション終了 |
| `error` / `abort` / `timeout` | → completed | エラー・中断によるセッション終了 |
| 空 / 未知の値 | → completed | 保守的デフォルト（warning ログ出力） |

Claude Code の `SessionEnd` は従来通り常に `completed` に遷移する。

#### Copilot 承認フロー

ダッシュボードで「Allow」をクリックすると、サーバーが tmux send-keys で Copilot CLI のネイティブ承認プロンプトに自動応答する。`copilot-decide.sh` は `allow` 時に出力なしで即座に終了し、サーバー側の自動承認に委譲する。

#### 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `COPILOT_CONFIRM_DELAY_MS` | `500` | Allow 後、tmux send-keys 実行までの遅延（ms） |
| `COPILOT_CONFIRM_RESPONSE` | `y` | Copilot ネイティブ承認プロンプトへの応答文字列 |
| `COPILOT_PROMPT_ENTER_METHOD` | （未設定） | **プロンプト送信（send-keys）用** の Enter 送信方式。未設定時は `enter`。値: `enter` / `c-m` / `enter-delay` / `double-enter` |
| `COPILOT_ENTER_METHOD` | `c-m`（承認） | **承認（auto-approve）用** の Enter 送信方式。send-keys には影響しない |
| `CODEX_PROMPT_ENTER_METHOD` | （未設定） | **Codex プロンプト送信（send-keys）用** の Enter 送信方式。設定時は `CODEX_ENTER_METHOD` より優先。値: `enter` / `c-m` / `enter-delay` / `double-enter` |
| `CODEX_ENTER_METHOD` | （未設定） | **Codex プロンプト送信（send-keys）用** のフォールバック Enter 送信方式。`CODEX_PROMPT_ENTER_METHOD` 未設定時に使用 |
| `COPILOT_DECISION_FAIL_MODE` | `closed` | 通信失敗時の動作: `closed`（deny）/ `open`（デフォルト動作） |
| `COPILOT_APPROVAL_TOOLS` | `bash` | 承認対象ツール（カンマ区切り） |

**Enter 送信方式のフォールバックチェーン**:

| 送信経路 | 優先順位 | デフォルト |
|----------|---------|-----------|
| send-keys（Copilot プロンプト送信） | `COPILOT_PROMPT_ENTER_METHOD` → `enter` | `enter` |
| send-keys（Codex プロンプト送信） | `CODEX_PROMPT_ENTER_METHOD` → `CODEX_ENTER_METHOD` → `enter-delay` | `enter-delay` |
| auto-approve（承認送信） | `COPILOT_ENTER_METHOD` → `c-m` | `c-m` |

非 Copilot/Codex セッション（Claude Code 等）は環境変数に関わらず常に `enter` を使用する。

#### 注意事項

- `CLAUDE_MONITOR_FORCE_HOOKS=1` 環境変数を設定すると、既存の hooks.json をバックアップして上書き
- Copilot CLI セッションの session_id は `copilot-pane-<N>` 形式（tmux pane ID ベース）
- 同一 pane で新規セッションを起動すると前回のデータは自動的にリセットされる

### 5. Codex CLI MCP 設定（任意）

Codex CLI セッションで MCP ツール（`ask_user` 等）を利用する場合の設定。

#### 自動注入（推奨）

ダッシュボードの「新規セッション」ボタンから Codex CLI を起動すると、`-c` フラグで MCP サーバー設定が自動注入される:

```
codex --no-alt-screen -c 'notify=[...]' -c 'mcp_servers={"claude-monitor"={url="http://localhost:3456/mcp"}}'
```

#### 確認方法

Codex セッション内で MCP サーバーが認識されているか確認:

```bash
codex mcp list
# claude-monitor が表示されれば有効
```

#### `ask_user` の利用

- Codex セッション内で `ask_user` ツールを使用すると、ブラウザダッシュボードに質問が表示される
- ユーザーがブラウザから回答すると、Codex セッションに結果が返る
- **タイムアウト**: 120秒で応答がない場合はエラーが返る。`AskUserQuestion` にフォールバックすること
- **複数セッション同時運用時**: `session_id` パラメータを明示的に指定し、質問の紐付けを確実にすることを推奨

#### 前提条件

- `claude-monitor` サーバーが起動済みであること（`pnpm start`）
- `claude-monitor` が未起動の場合、`ask_user` はエラーを返す。`AskUserQuestion` にフォールバックすること

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
Terminal (Codex CLI)   ── Hooks ──→
                          │
                  codex-notify.sh
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
| SessionEnd | notify.sh (async) | completed 遷移 + 通知音（Copilot: `reason=complete` → idle 遷移） |

## Codex セッション完了判定

Codex セッションの Pane Monitor は Copilot とは異なる判定ルールを使用する。`commandAlive`（pane の現在コマンドが `codex` または `node`）を優先し、フック通信途絶だけでは完了させない。

### 判定条件

| 状態 | commandAlive | フック通信 | 判定 |
|------|-------------|-----------|------|
| idle | true | - | スキップ（prompt_ready 復帰のみ） |
| running/waiting_answer | true | 新鮮（60秒以内） | アクティブ維持 |
| running/waiting_answer | true | 途絶（60秒超） | **アクティブ維持**（hard timeout のみで完了判定） |
| running/waiting_answer | true | - | hard timeout（`last_run_started_at` 基準、10分）で完了 |
| running/waiting_answer | false | 途絶（60秒超） | 完了（`codex プロセス終了を検出しました`） |
| - | - | pane 消失 | 完了（`tmuxペインが終了しました`） |

### hard timeout の判定起点

hard timeout は `last_run_started_at`（`UserPromptSubmit` または send-keys 成功時に更新）を基準に計測する。未設定時は `last_init_at` にフォールバックする。これにより、長寿命セッションで新しい run を開始した直後に即タイムアウトすることを防ぐ。

### SessionStore.cleanup との関係

`SessionStore.cleanup` の staleness 判定（10分更新なし → idle 遷移）は Codex `running`/`waiting_answer` セッションには適用されない。Codex セッションの状態管理は Pane Monitor に委ねる。ただし cleanup 側でも hard timeout 超過を検出した場合は `onHardTimeout` コールバック経由で `completeSessionWithCleanup` を呼び出し、永久残留を防止する。

### reason_code サーバーログフォーマット

`completeSessionWithCleanup` の各呼び出し箇所で、サーバーログに `[reason_code] メッセージ本文` 形式で出力する。`last_message`（UI 表示用）には人間向けメッセージのみを保持する。

| reason_code | 条件 |
|-------------|------|
| `hard_timeout` | commandAlive + hard timeout 超過、または hooks 未到達 hard timeout |
| `command_mismatch` | コマンド不一致 + フック途絶、または hooks 未到達 soft timeout |
| `pane_lost` | tmux pane 消失 |
| `manual_close` | UI からの手動終了 |

ログから reason_code を抽出する正規表現: `/\[(\w+)\]/`

## セキュリティ

- サーバーは `127.0.0.1` にバインド（外部アクセス不可）
- 状態変更 API と WebSocket で Origin ヘッダーを検証（CSRF/CSWSH 対策）

## 拡張ポイント

将来利用可能な Hook イベント:

- `PostToolUse` / `PostToolUseFailure`: ツール実行結果の記録
- `SubagentStop`: Task ツール完了検知
- `ConfigChange`: 設定変更検知
