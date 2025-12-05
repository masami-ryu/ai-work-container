# Claude Code 使用方法ガイド

## 概要
Claude CodeはAnthropicが提供するAI支援開発ツールで、VS Code拡張機能とCLIの両方で利用できます。このプロジェクトではMCP (Model Context Protocol)を通じて複数の外部サービスと統合されています。

## 基本的な使い方

### CLI使用方法

#### 対話型セッションの開始
```bash
claude
```

対話型セッションでは、以下のコマンドが利用可能です：
- `/help` - ヘルプを表示
- `/mcp` - 利用可能なMCPツールを表示
- `/exit` - セッションを終了

#### 非対話型（ワンショット）
```bash
claude -p "コードレビューをお願いします"
```

`-p` / `--print` オプションを使用すると、応答を表示して終了します（パイプ処理に便利）。

#### ファイルを指定して質問
```bash
claude -p "このファイルの改善点を教えてください" < src/app.js
```

#### JSON出力
```bash
claude -p --output-format json "TypeScriptの型定義を作成してください"
```

### VS Code拡張機能の使い方

#### Claude Codeパネルの表示
1. VS Codeのサイドバーで Claude Code アイコンをクリック
2. または、コマンドパレット（Ctrl+Shift+P）から `Claude Code: Open` を実行

#### ファイルのコンテキスト追加
- ファイルエクスプローラーからClaude Codeパネルにファイルをドラッグ&ドロップ
- エディタでコードを選択し、右クリックから `Claude Code: Add to Context` を選択

#### コード編集の依頼
Claude Codeパネルのチャットで以下のような依頼が可能です：
- 「この関数をTypeScriptに変換してください」
- 「エラーハンドリングを追加してください」
- 「このコードのテストを書いてください」

## MCP統合機能

### 利用可能なMCPサーバー

#### 1. Microsoft Learn (msdocs)
Microsoft公式ドキュメントの検索・参照が可能。

**使用例（CLI）:**
```
/mcp
# msdocs を選択
search query:"Azure Functions"
```

**使用例（VS Code）:**
「Azure Functionsの最新のベストプラクティスを教えてください（msdocsを参照）」

#### 2. Context7 (context7)
コード例やスニペットを検索。

**使用例（CLI）:**
```
/mcp
# context7 を選択
search query:"React hooks useState"
```

**使用例（VS Code）:**
「React hooksの使用例を見つけてください（context7を使用）」

#### 3. GitHub MCP Server (github-mcp-server)
GitHubリポジトリの情報取得（Issue、PR、コードなど）。

**⚠️ 注意:** GitHub MCPは認証が必要です。[セットアップガイド](./claude-code-mcp-setup.md#github-pat設定)を参照してください。

**使用例（CLI）:**
```
/mcp
# github-mcp-server を選択
list_issues owner:masami-ryu repo:ai-work-container
```

**使用例（VS Code）:**
「このリポジトリの未解決Issueを一覧表示してください」

## CLIとVS Code拡張の使い分け

### CLIが適している場合
- スクリプトや自動化に組み込む
- パイプライン処理で使用
- リモートサーバーでの作業
- 軽量な単発の質問

### VS Code拡張が適している場合
- コードを見ながら対話的に作業
- ファイルのドラッグ&ドロップで簡単にコンテキスト追加
- 長期的なコーディングセッション
- UIでの視覚的な操作を好む場合

## 高度な使い方

### カスタム設定
プロジェクトルートに `CLAUDE.md` を作成すると、プロジェクト固有の指示を追加できます。

**例: `CLAUDE.md`**
```markdown
# プロジェクトガイドライン

このプロジェクトはTypeScriptとNode.jsを使用しています。

## コーディング規約
- ESLintとPrettierの設定に従う
- 関数には必ずJSDocコメントを付ける
- エラーハンドリングは必須

## テスト
- Jestを使用
- カバレッジ80%以上を維持
```

### プロジェクト設定（.claude/settings.json）
`.claude/settings.json` でプロジェクト固有の権限と動作を設定できます。

**設定例（このプロジェクトの実際の設定）:**
```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(npm run:*)",
      "Bash(npm test:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
      "Bash(python:*)",
      "Bash(claude mcp:*)",
      "Read(**)",
      "Grep",
      "Glob",
      "Write",
      "Edit",
      "WebFetch",
      "WebSearch",
      "Task",
      "TodoWrite",
      "mcp__context7",
      "mcp__msdocs"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(**/.git/config)",
      "Bash(rm -rf:*)",
      "Bash(chmod 777:*)"
    ],
    "ask": [
      "Bash(git push:*)",
      "Bash(git commit:*)",
      "Bash(docker:*)",
      "Bash(npm install:*)",
      "Bash(pip install:*)"
    ],
    "defaultMode": "default"
  },
  "enableAllProjectMcpServers": true,
  "env": {
    "MAX_THINKING_TOKENS": "16000",
    "BASH_DEFAULT_TIMEOUT_MS": "60000",
    "MCP_TIMEOUT": "60000",
    "MCP_TOOL_TIMEOUT": "120000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "16000"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/session-start.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/auto-approve-docs.sh"
          }
        ]
      }
    ]
  }
}
```

#### パーミッション設定のベストプラクティス

**最小権限の原則**に基づき、パーミッションを適切に設定することでセキュリティとユーザビリティのバランスを取ります。

**allow（確認なし実行）:**
- 読み取り専用コマンド（`git status`, `git log`, `ls`, `cat`等）
- スクリプト実行（`npm run`, `npm test`, `node`, `python`）
- 開発ツール（`npx`, `claude mcp`）
- Claude Codeツール（`Read`, `Grep`, `Glob`, `Write`, `Edit`, `Task`等）
- MCPツール（`mcp__context7`, `mcp__msdocs`）

**ask（確認が必要）:**
- パッケージインストール（`npm install`, `pip install`） - 意図しない依存関係追加を防ぐ
- リモート操作（`git push`, `git commit`） - 誤ったコミット/プッシュを防ぐ
- コンテナ操作（`docker`） - リソース消費の大きい操作

**deny（実行禁止）:**
- 機密情報（`.env`, `secrets/**`, `.git/config`）
- 危険なコマンド（`rm -rf`, `chmod 777`）

**環境変数の推奨値:**
- `MAX_THINKING_TOKENS`: `16000` - 複雑な問題の思考に十分なトークン
- `BASH_DEFAULT_TIMEOUT_MS`: `60000` - 長時間実行コマンドに対応
- `MCP_TIMEOUT`: `60000` - MCPサーバー接続タイムアウト
- `MCP_TOOL_TIMEOUT`: `120000` - MCPツール実行タイムアウト
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`: `16000` - 長い応答を可能に

### カスタムスラッシュコマンド
`.claude/commands/` に Markdown ファイルを作成すると、カスタムスラッシュコマンドが利用可能になります。

**このプロジェクトで利用可能なコマンド:**
- `/plan` - 実行可能なプランを作成
- `/review-plan` - 既存のプランをレビュー
- `/commit` - 変更をコミット（コミットメッセージ自動生成）
- `/doc` - ドキュメントを作成・更新
- `/suggest-claude-md` - CLAUDE.mdの更新提案を生成

**コマンドファイルの例（commit.md）:**
```markdown
---
name: commit
description: 変更をコミットする
---

## タスク
変更内容を確認し、適切なコミットメッセージを生成してコミットを実行
```

### カスタムサブエージェント
`.claude/agents/` に Markdown ファイルを作成すると、専門的なサブエージェントが利用可能になります。

**このプロジェクトで利用可能なサブエージェント:**
- `plan-creator` - プラン作成の専門家（model: haiku, MCPツール統合）
- `doc-writer` - ドキュメント作成の専門家（model: haiku, MCPツール統合）
- `pr-reviewer` - PRレビューの専門家（model: haiku, MCPツール統合）

**サブエージェントのパフォーマンス最適化:**
- すべてのサブエージェントは `model: haiku` を使用してコストとレイテンシを最適化
- MCPツール（`mcp__context7`, `mcp__msdocs`）を直接利用可能
- 専門タスクに必要なツールのみを権限付与

**エージェント定義例:**
```markdown
---
name: plan-creator
description: 実行可能なプランを作成する専門エージェント
tools: Read, Grep, Glob, Bash, WebFetch, mcp__context7, mcp__msdocs
model: haiku
---
```

### Hooks
`.claude/hooks/` でセッション開始時やツール使用時の自動処理を設定できます。

**設定されているフック:**
- `session-start.sh` - セッション開始時の軽量な環境初期化（パフォーマンス最適化済み）
- `auto-approve-docs.sh` - ドキュメントファイル読み取りの自動承認

**SessionStart フックの最適化:**
最新の `session-start.sh` は、セッション開始を高速化するため以下の最適化を実施：
- 不要な MCP 状態確認を削除
- 最小限の環境変数設定とステータス出力のみ
- エラーが発生してもセッションを妨げない設計

### パフォーマンス最適化ガイド

Claude Codeのパフォーマンスを最大限引き出すための設定とベストプラクティス。

#### 環境変数の最適化

**推奨設定（このプロジェクトの値）:**
```json
{
  "env": {
    "MAX_THINKING_TOKENS": "16000",
    "BASH_DEFAULT_TIMEOUT_MS": "60000",
    "MCP_TIMEOUT": "60000",
    "MCP_TOOL_TIMEOUT": "120000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "16000"
  }
}
```

**各変数の説明:**
- `MAX_THINKING_TOKENS`: 思考に使用できる最大トークン数。複雑な問題には `16000` を推奨
- `BASH_DEFAULT_TIMEOUT_MS`: Bashコマンドのデフォルトタイムアウト（ミリ秒）。ビルド等の長時間実行には `60000` 以上を推奨
- `MCP_TIMEOUT`: MCPサーバー接続タイムアウト。安定した接続には `60000` を推奨
- `MCP_TOOL_TIMEOUT`: MCPツール実行タイムアウト。外部API呼び出しには `120000` を推奨
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`: 応答の最大トークン数。長い応答には `16000` を推奨

#### サブエージェントのモデル選択

**Haiku vs Sonnet:**

| モデル | 用途 | コスト | レイテンシ | 推奨用途 |
|--------|------|--------|-----------|---------|
| haiku  | 軽量タスク | 低 | 高速 | プラン作成、ドキュメント作成、PRレビュー |
| sonnet | 複雑タスク | 高 | 中速 | 複雑なコード生成、アーキテクチャ設計 |

**このプロジェクトの選択:**
すべてのサブエージェント（plan-creator, doc-writer, pr-reviewer）は `haiku` を使用。
理由：専門化されたタスクは明確な指示で十分な品質を達成でき、コストとレイテンシの最適化を優先。

#### パーミッション最適化

**パフォーマンスへの影響:**
- `allow` リストを適切に設定することで、確認ダイアログを削減し、ワークフローを高速化
- 頻繁に使用する読み取り専用コマンドとツールは `allow` に含める
- パッケージインストール等の破壊的操作は `ask` で安全性を確保

**セキュリティとパフォーマンスのバランス:**
```
高速 ← allow (確認なし) | ask (確認あり) | deny (禁止) → 安全
```

適切なバランス：
- 読み取り専用 → `allow`
- 書き込み（可逆） → `allow`
- 書き込み（不可逆） → `ask`
- 危険な操作 → `deny`

### 環境変数
`.bashrc` または `.zshrc` に以下の環境変数が設定されています：

```bash
export CLAUDE_CODE_EXIT_AFTER_STOP_DELAY=5000
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0
export DISABLE_AUTOUPDATER=0
```

- `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`: 停止後の遅延時間（ミリ秒）
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: 不要な通信を無効化（0=無効、1=有効）
- `DISABLE_AUTOUPDATER`: 自動更新を無効化（0=自動更新有効、1=無効）

### MCPサーバーの管理

#### MCPサーバー一覧
```bash
claude mcp list
```

#### MCPサーバーの削除
```bash
claude mcp remove <server-name>
```

#### MCPサーバーの再追加
```bash
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
```

## トラブルシューティング

詳細なトラブルシューティング情報は [claude-code-mcp-setup.md](./claude-code-mcp-setup.md) を参照してください。

### よくある問題

#### Claude CLIが見つからない
```bash
# PATHを確認
echo $PATH | grep -o "$HOME/.local/bin"

# 見つからない場合は追加
export PATH="$HOME/.local/bin:$PATH"
source ~/.bashrc
```

#### MCPサーバーが接続できない
```bash
# ヘルスチェック
claude mcp list

# ログを確認
cat ~/.cache/claude-install-logs/install-$(date +%Y%m%d).log
```

## 参考資料
- [Claude Code 公式ドキュメント](https://docs.anthropic.com/claude-code)
- [MCP仕様](https://modelcontextprotocol.io/)
- [セットアップガイド](./claude-code-mcp-setup.md)
