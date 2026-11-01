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
- **複数セッション同時運用時**: `session_id` パラメータの指定が**必須**。アクティブセッションが2つ以上ある場合、`session_id` を省略するとエラーが返る（ただし、MCP セッションが既にバインド済みの場合は省略可能）
- **単一セッション運用時**: `session_id` は省略可能（自動検出される）

#### Codex 承認操作の制約

Codex CLI は承認要求を外部フックに転送する仕組みを持たないため、hooks ベースのブラウザ承認（Allow/Deny）には非対応。ただし `CAPTURE_ENABLE_CODEX=true` 設定時は capture-pane ベースの疑似承認に対応する（暫定）。疑似承認は端末出力のパターンマッチに依存するため、CLI バージョンアップで検知精度が変化する可能性がある。

| 機能 | Claude Code | Copilot CLI | Codex CLI |
|------|------------|------------|----------|
| ブラウザ承認（Allow/Deny） | 対応（hooks） | 対応（hooks） | **capture-pane 疑似承認（暫定）** |
| ブラウザ質問回答（ask_user） | 対応 | 対応 | 対応 |
| 端末承認 | 対応 | 対応 | 対応 |

capture-pane 疑似承認が無効（`CAPTURE_ENABLE_CODEX=false` またはデフォルト）の場合、ダッシュボードに「承認操作はブラウザから行えません」のバナーが表示される。

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

## capture-pane ハイブリッド運用ガイド

### 概要

`tmux capture-pane` を使って CLI の端末出力を取得し、中間メッセージの可視化と疑似端末操作（承認応答など）を行うハイブリッド機能。既存の hooks ベースのフローを維持したまま、補助的に capture-pane を導入する。

- **Codex**: hooks による承認フック非対応のため、capture-pane による疑似承認が主要な承認経路（暫定）
- **Copilot**: hooks ベースの承認フローを優先、capture-pane は中間メッセージ可視化と hooks タイムアウト前の補助検知に使用
- **Claude**: alt-screen 未制御のため best-effort（取得が欠落する場合がある）

### 段階導入手順

導入は Codex → Copilot → Claude の順で段階的に行う。各段階で回帰が発生しないことを確認してから次に進む。

#### Stage 1: Codex のみ有効化

```bash
CAPTURE_ENABLE_CODEX=true pnpm start
```

チェックリスト:
- [ ] Codex セッション起動時にターミナルログパネルが表示される
- [ ] Codex 中間出力がストリーム表示される
- [ ] 承認プロンプト検知で操作ボタン（Yes/No/Yes Always）が表示される
- [ ] ボタンクリックで tmux send-keys が正常に実行される
- [ ] `approvalSupported=true` で非対応バナーが非表示になる
- [ ] hooks ベースのイベント（`codex-notify.sh` 経由）が正常に動作する
- [ ] 誤検知時に dismiss が機能する
- [ ] send-keys 失敗時に再試行またはガイダンスが表示される
- [ ] 既存の Claude/Copilot セッションに影響がない

#### Stage 2: Copilot 追加

```bash
CAPTURE_ENABLE_CODEX=true CAPTURE_ENABLE_COPILOT=true pnpm start
```

チェックリスト:
- [ ] Copilot セッションのターミナルログパネルが表示される
- [ ] Copilot 中間出力がストリーム表示される
- [ ] Copilot は hooks authoritative のためトリガーイベントが生成されない
- [ ] `last_capture_detected_at` がタイムアウト判定に寄与する
- [ ] hooks ベースの承認フロー（`copilot-decide.sh`）が正常に動作する
- [ ] hooks 承認解決時に capture の活動検知に影響がない
- [ ] `--no-alt-screen` で capture 取得が安定している
- [ ] Stage 1 の Codex 機能が回帰していない

#### Stage 3: Claude 追加（任意）

```bash
CAPTURE_ENABLE_CODEX=true CAPTURE_ENABLE_COPILOT=true CAPTURE_ENABLE_CLAUDE=true pnpm start
```

チェックリスト:
- [ ] Claude セッションのターミナルログパネルが表示される（best-effort）
- [ ] alt-screen による取得欠落が許容範囲内
- [ ] hooks ベースの承認フロー（`decide.sh`）が正常に動作する
- [ ] Stage 1-2 の機能が回帰していない

#### ロールバック手順

各段階で問題が発生した場合、該当 CLI の feature flag を `false` に戻してサーバー再起動する:

```bash
# 例: Stage 3 で問題 → Claude のみロールバック
CAPTURE_ENABLE_CODEX=true CAPTURE_ENABLE_COPILOT=true CAPTURE_ENABLE_CLAUDE=false pnpm start

# 例: Stage 2 で問題 → Copilot のみロールバック
CAPTURE_ENABLE_CODEX=true CAPTURE_ENABLE_COPILOT=false pnpm start

# 例: 全体ロールバック → capture-pane を全て無効化
pnpm start
```

### capture-pane 環境変数一覧

#### CLI 別有効化フラグ

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CAPTURE_ENABLE_CODEX` | `false` | Codex CLI の capture-pane を有効化 |
| `CAPTURE_ENABLE_COPILOT` | `false` | Copilot CLI の capture-pane を有効化 |
| `CAPTURE_ENABLE_CLAUDE` | `false` | Claude Code の capture-pane を有効化（best-effort） |

#### イベント保持・TTL

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CAPTURE_MAX_EVENTS_PER_SESSION` | `200` | セッションあたりの最大イベント保持数 |
| `CAPTURE_MAX_EVENTS_GLOBAL` | `2000` | グローバル最大イベント保持数（全セッション合計） |
| `CAPTURE_MAX_EVENT_CHARS` | `4096` | 1イベントあたりの最大文字数（超過時は切り詰め） |
| `CAPTURE_EVENT_TTL_MINUTES` | `10` | pending/failed トリガーイベントの有効期限（分） |
| `CAPTURE_TOMBSTONE_TTL_MINUTES` | `20` | expired イベントの tombstone 保持期間（分） |

#### 誤検知保護・スロットリング

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CAPTURE_TRIGGER_COOLDOWN_MS` | `5000` | 同一セッションでのトリガー再発火抑制間隔（ms） |
| `CAPTURE_DEDUP_TTL_MS` | `60000` | 同一パターンの重複トリガー抑制ウィンドウ（ms） |
| `CAPTURE_DISMISS_TTL_MS` | `300000` | ユーザー dismiss 後の再表示までの時間（ms、デフォルト5分） |
| `CAPTURE_ABSOLUTE_TIMEOUT_MINUTES` | `30` | capture-pane トリガーの絶対タイムアウト（分） |
| `CAPTURE_BATCH_MAX_EVENTS` | - | WebSocket バッチ配信の最大イベント数 |
| `CAPTURE_MAX_MSG_PER_SEC` | - | WebSocket 配信のレート制限（メッセージ/秒） |

#### Hard Timeout

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `COPILOT_HARD_TIMEOUT_MINUTES` | `10` | Copilot セッションの hard timeout（分） |
| `CODEX_HARD_TIMEOUT_MINUTES` | `10` | Codex セッションの hard timeout（分、`last_run_started_at` 基準） |

#### トリガー再試行

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `TRIGGER_MAX_RETRIES` | `3`（定数） | capture トリガーの最大再試行回数（`before_text` 失敗のみ再試行可能） |

### マスク設定ファイル

端末出力に含まれる機密情報を自動マスクする。

- **ファイルパス**: `claude-monitor/mask-patterns.json`
- **フォーマット**: JSON 正規表現文字列の配列

```json
[
  "(?<=CUSTOM_SECRET\\s*=\\s*).+",
  "ghp_[A-Za-z0-9_]{36}"
]
```

- **ロード順序**: ビルトインパターン → 設定ファイルのパターン（両方適用）
- **エラー時挙動**: 設定ファイルの読み込みやパースに失敗した場合、ビルトインパターンのみで動作し、警告ログを出力
- **ビルトインパターン**: API_KEY, SECRET_KEY, ACCESS_KEY, PRIVATE_KEY, TOKEN, PASSWORD, Bearer トークン, AWS アクセスキー, SSH 秘密鍵ヘッダー等

### 検知精度について

- capture-pane によるパターン検知は CLI の表示文言に依存するため、CLI バージョンアップで文言が変更されると検知が失敗する可能性がある
- 検知ロジックは feature flag（`CAPTURE_ENABLE_*`）で即時無効化可能
- feature flag の変更は**サーバー再起動で反映**される（既存セッションへの即時再計算は行わない）
- `approvalSupported` はセッション開始時に評価され、セッション存続中は変化しない

### 失敗時の復帰手順

1. **誤検知が発生した場合**: UI の「dismiss」ボタンで一時的に非表示にする（`CAPTURE_DISMISS_TTL_MS` 経過後に再表示）
2. **send-keys が `before_text` で失敗した場合**: UI の「再試行」ボタンで再送信（最大 `TRIGGER_MAX_RETRIES` 回）
3. **send-keys が `after_text` で失敗した場合**: テキストは端末に送信済みのため再試行不可。端末で手動操作し、UI の「手動復帰済みとしてマーク」ボタンをクリック
4. **capture 機能全体の不具合**: 下記の緊急無効化手順を実行

### 緊急無効化手順

capture-pane 機能に問題が発生した場合、以下の手順で即時無効化できる:

```bash
# サーバーを停止し、capture 機能を全て無効化して再起動
CAPTURE_ENABLE_CODEX=false CAPTURE_ENABLE_COPILOT=false CAPTURE_ENABLE_CLAUDE=false pnpm start
```

既存の hooks ベースのフロー（状態遷移・承認管理）は tmux 非依存のため、capture-pane 無効化の影響を受けない。

## 拡張ポイント

将来利用可能な Hook イベント:

- `PostToolUse` / `PostToolUseFailure`: ツール実行結果の記録
- `SubagentStop`: Task ツール完了検知
- `ConfigChange`: 設定変更検知
