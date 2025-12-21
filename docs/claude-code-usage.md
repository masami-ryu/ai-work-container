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

**設定例:**
```json
{
  "permissions": {
    "allow": ["Bash(git:*)", "Read(**)", "Bash(cat:*)"],
    "deny": ["Read(./.env)", "Bash(rm -rf:*)"],
    "defaultMode": "default"
  },
  "enableAllProjectMcpServers": true,
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "BASH_DEFAULT_TIMEOUT_MS": "30000"
  }
}
```

### カスタムスラッシュコマンド
`.claude/commands/` に Markdown ファイルを作成すると、カスタムスラッシュコマンドが利用可能になります。

**このプロジェクトで利用可能なコマンド:**
- `/plan` - 実行可能なプランを作成
- `/review` - PRレビューを実行
- `/doc` - ドキュメントを作成・更新
- `/suggest-claude-md` - CLAUDE.mdの更新提案を生成

**コマンドファイルの例（plan.md）:**
```markdown
---
name: plan
description: 実行可能なプランを作成する
argument-hint: タスクの概要または目的を入力してください
---

## コンテキスト
- プロジェクト: @CLAUDE.md
- テンプレート: @ai/templates/plan-template.md

## タスク
以下のステップでプランを作成してください:
1. 目的の明確化
2. 情報収集
3. プラン策定
4. 保存: `ai/plans/YYMMDD_[タスク概要].md` に保存
```

### カスタムサブエージェント
`.claude/agents/` に Markdown ファイルを作成すると、専門的なサブエージェントが利用可能になります。

**このプロジェクトで利用可能なサブエージェント:**
- `plan-creator` - プラン作成の専門家
- `doc-writer` - ドキュメント作成の専門家
- `pr-reviewer` - PRレビューの専門家

### Hooks
`.claude/hooks/` でセッション開始時やツール使用時の自動処理を設定できます。

**設定されているフック:**
- `session-start.sh` - セッション開始時の環境初期化
- `auto-approve-docs.sh` - ドキュメントファイル読み取りの自動承認

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

Claude Code CLIはnpmパッケージとしてインストールされています。

##### ステップ1: nodenv rehashを実行（最重要）

`npm install -g` でグローバルパッケージをインストールした後は、**必ず** `nodenv rehash` を実行してください。

```bash
# nodenv rehash を実行
nodenv rehash

# 確認
claude --version
which claude
```

**これで解決する場合がほとんどです。** 以下のケースでは必ずrehashが必要です:

- `npm install -g @anthropic-ai/claude-code` を実行した後
- `npm uninstall -g <package>` を実行した後
- `npm update -g <package>` を実行した後
- `npm link` を実行した後

##### ステップ2: PATHを確認（rehashで解決しない場合）

```bash
# PATHを確認
NPM_BIN_DIR=$(npm bin -g 2>/dev/null || echo "$HOME/.npm-global/bin")
echo $PATH | grep -o "$NPM_BIN_DIR"

# 見つからない場合は追加
export PATH="$NPM_BIN_DIR:$PATH"
source ~/.bashrc

# インストール状況を確認
npm list -g @anthropic-ai/claude-code
```

##### ステップ3: shimの確認

```bash
# nodenvのshimが生成されているか確認
ls -la ~/.nodenv/shims/claude

# shimが存在しない場合は再度rehash
nodenv rehash
```

#### Node.jsのバージョン問題

Claude Code CLI には Node.js 18+ が必要です。

```bash
# バージョン確認
node -v

# Node.js 18+ のインストール
nodenv install 18.20.1
nodenv global 18.20.1
nodenv rehash
```

#### npmインストールの失敗

```bash
# キャッシュをクリア
npm cache clean --force

# 再インストール
npm install -g @anthropic-ai/claude-code

# ログを確認
cat ~/.cache/claude-install-logs/install-$(date +%Y%m%d).log
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
