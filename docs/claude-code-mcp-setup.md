# Claude Code & MCP セットアップガイド

> **最終更新日:** 2025-12-04

## 目次
- [概要](#概要)
- [セットアップ手順](#セットアップ手順)
  - [Phase 1: 環境確認](#phase-1-環境確認)
  - [Phase 2: Claude Code CLI初期セットアップ](#phase-2-claude-code-cli初期セットアップ)
  - [Phase 3: GitHub PAT設定](#phase-3-github-pat設定)
  - [Phase 4: MCPセットアップスクリプトの実行](#phase-4-mcpセットアップスクリプトの実行)
  - [Phase 5: MCP統合動作確認](#phase-5-mcp統合動作確認)
- [トラブルシューティング](#トラブルシューティング)
- [よくある質問（FAQ）](#よくある質問faq)
- [参考資料](#参考資料)

---

## 概要
このドキュメントでは、devcontainer環境でのClaude CodeとMCP (Model Context Protocol)のセットアップ手順とトラブルシューティング方法を説明します。

## セットアップ手順

### 前提条件
- Dev Container環境が起動していること
- インターネット接続が利用可能であること

### Phase 1: 環境確認

コンテナ起動後、以下のコマンドで環境を確認します：

```bash
# Node.jsバージョン確認
node --version

# Claude Code CLIの確認
claude --version

# MCPサーバー一覧確認
claude mcp list
```

**期待される結果:**
- Node.js: v22.x以降
- Claude Code CLI: v2.0.x以降
- MCPサーバー: msdocs, context7, github-mcp-server の3つ

### Phase 2: Claude Code CLI初期セットアップ

#### 認証

初めてClaude Codeを使用する際は、認証が必要です。

```bash
claude whoami
```

まだ認証していない場合、ブラウザが開いてAnthropicアカウントでのログインが求められます。

**トラブルシューティング:**
- ブラウザが開かない場合: 表示されたURLを手動でブラウザにコピー&ペースト
- 認証エラーが発生する場合: `claude logout` してから再度 `claude whoami` を実行

#### 動作確認

簡単なプロンプトで動作を確認します：

```bash
claude -p "Hello, Claude!"
```

応答が返ってくれば正常に動作しています。

### Phase 3: GitHub PAT設定

GitHub MCP サーバーを使用するには、Personal Access Token (PAT)が必要です。

#### 3.1 GitHub PATの取得

1. GitHubにログイン
2. Settings → Developer settings → Personal access tokens → Tokens (classic) に移動
3. "Generate new token (classic)" をクリック
4. 以下のスコープを選択：
   - `repo:status` - リポジトリステータスへのアクセス
   - `public_repo` - 公開リポジトリへのアクセス
   - `read:org` - 組織情報の読み取り
   - `read:user` - ユーザー情報の読み取り

5. "Generate token" をクリック
6. 表示されたトークンをコピー（この画面を離れると二度と表示されません）

#### 3.2 環境変数に設定

```bash
# .bashrcに追加（永続化）
echo 'export GITHUB_MCP_PAT=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc

# 確認
echo $GITHUB_MCP_PAT
```

### Phase 4: MCPセットアップスクリプトの実行

#### 基本的な使用方法

`.vscode/mcp.json`に定義されたMCPサーバーを自動的にClaude Code CLIに追加します：

```bash
# 基本実行（既存サーバーをスキップ）
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh

# ドライランモード（実際の変更なし）
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh --dry-run

# デバッグモード
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh --debug
```

#### コマンドラインオプション

```bash
使用方法: setup-claude-mcp.sh [オプション]

オプション:
  --clean, --overwrite   既存のMCPサーバーをクリーンアップしてから追加
  --force                既存サーバーを確認せず上書き追加
  --dry-run              実際の変更を行わず、実行内容のみ表示
  --debug                デバッグ情報を出力
  -h, --help             このヘルプメッセージを表示

モード:
  デフォルト: 既存サーバーをスキップして新規サーバーのみ追加
  --clean:    全既存サーバーを削除してから全サーバーを追加
  --force:    既存チェックをスキップして全サーバーを強制追加
```

#### 実行例

**初回セットアップ:**
```bash
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
```

**設定の全リセット:**
```bash
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh --clean
```

**変更内容の事前確認:**
```bash
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh --dry-run --debug
```

**インタラクティブモード:**
スクリプトを引数なしで実行すると、既存サーバーが検出された場合に対話的な選択肢が表示されます：
```
既存のMCPサーバーが検出されました。どのように処理しますか？
  1) スキップ - 既存サーバーはそのままで、新規サーバーのみ追加
  2) クリーンアップ - すべての既存サーバーを削除してから追加
  3) 強制上書き - 既存チェックをスキップして全サーバーを追加
  4) キャンセル - セットアップを中止
選択してください [1-4]:
```

### Phase 5: MCP統合動作確認

#### MCPサーバーのヘルスチェック

```bash
claude mcp list
```

**期待される出力:**
```
Checking MCP server health...

msdocs: https://learn.microsoft.com/api/mcp (HTTP) - ✓ Connected
context7: npx -y @upstash/context7-mcp@latest - ✓ Connected
github-mcp-server: https://api.githubcopilot.com/mcp/ (HTTP) - ✓ Connected
```

#### MCPツールのテスト

**Microsoft Learn検索:**
```bash
claude -p "/mcp msdocs search query:\"Azure Functions\""
```

**Context7検索:**
```bash
claude -p "/mcp context7 search query:\"React hooks\""
```

**GitHub Issue一覧（PAT必須）:**
```bash
claude -p "/mcp github-mcp-server list_issues owner:masami-ryu repo:ai-work-container"
```

## トラブルシューティング

### Claude Code CLIが見つからない

**症状:** `claude: command not found`

**原因:** PATHが正しく設定されていない

**解決方法:**
```bash
# PATHを一時的に追加
export PATH="$HOME/.local/bin:$PATH"

# 永続化
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# 確認
which claude
```

### MCPサーバーが接続できない

**症状:** `claude mcp list` で `✗ Failed to connect`

**原因別の解決方法:**

#### msdocs が接続できない
- インターネット接続を確認
- ファイアウォール設定を確認
- Microsoft Learnのサービスステータスを確認

#### context7 が接続できない
- Node.jsがインストールされているか確認: `node --version`
- npxが利用可能か確認: `npx --version`
- パッケージを手動でインストール: `npm install -g @upstash/context7-mcp@latest`

#### github-mcp-server が接続できない
- GitHub PATが設定されているか確認: `echo $GITHUB_MCP_PAT`
- トークンが有効か確認（有効期限、スコープ）
- MCPサーバーを再設定: `bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh`

### インストールログの確認

Claude Code CLIのインストールログは以下の場所に保存されています：

```bash
# 今日のログ
cat ~/.cache/claude-install-logs/install-$(date +%Y%m%d).log

# 全ログファイルの一覧
ls -lh ~/.cache/claude-install-logs/
```

ログは7日間保持され、古いログは自動的に削除されます。

### VS Code拡張機能が表示されない

**症状:** Claude Code拡張機能がVS Codeに表示されない

**解決方法:**
1. コンテナを再ビルド:
   ```
   Dev Containers: Rebuild Container
   ```
2. 拡張機能が `devcontainer.json` に含まれているか確認:
   ```bash
   cat .devcontainer/devcontainer.json | grep "anthropic.claude-code"
   ```
3. 手動でインストール:
   - VS Code拡張機能パネルで "Claude Code" を検索
   - "Install in Dev Container" をクリック

### 認証エラー

**症状:** `Authentication failed` または `Unauthorized`

**解決方法:**
```bash
# ログアウト
claude logout

# 再認証
claude whoami

# キャッシュクリア（必要に応じて）
rm -rf ~/.config/claude-code/auth-cache
```

### MCPサーバーの削除と再追加

MCPサーバーの設定をリセットしたい場合：

```bash
# 特定のサーバーを削除
claude mcp remove msdocs
claude mcp remove context7
claude mcp remove github-mcp-server

# クリーンモードで全サーバーを再追加
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh --clean
```

### 設定ファイルのカスタマイズ

MCPセットアップスクリプトは `.vscode/mcp.json` または `.vscode/settings.json` から設定を読み込みます。

#### .vscode/mcp.json (推奨)

```json
{
  "servers": {
    "custom-server": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:custom_token}"
      }
    },
    "local-server": {
      "type": "stdio",
      "command": "node",
      "args": ["./path/to/server.js"]
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "custom_token",
      "description": "Custom API Token",
      "password": true
    }
  ]
}
```

#### .vscode/settings.json（代替）

```json
{
  "mcp.servers": {
    "custom-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  },
  "mcp.inputs": []
}
```

#### 環境変数の設定

`inputs` 配列で定義したIDは、自動的に対応する環境変数名に変換されます：

| Input ID | 環境変数名 | 例 |
|----------|----------|-----|
| `github_mcp_pat` | `GITHUB_MCP_PAT` | `export GITHUB_MCP_PAT=ghp_xxx` |
| `custom_token` | `CUSTOM_TOKEN` | `export CUSTOM_TOKEN=abc123` |
| `api-key` | `API_KEY` | `export API_KEY=xyz789` |

変換ルール:
- すべて大文字に変換
- ハイフン（-）をアンダースコア（_）に変換

## よくある質問（FAQ）

### Q: Claude Code CLIとVS Code拡張機能の違いは？
**A:** CLIはターミナルから使用し、スクリプトや自動化に適しています。VS Code拡張機能は統合開発環境での対話的な使用に適しており、ファイルのドラッグ&ドロップなどGUI機能が充実しています。設定（MCP含む）は共有されます。

### Q: コンテナを再起動するとClaude Codeの設定は消える？
**A:** いいえ。設定は `~/.config/claude-code/` と `~/.claude.json` に保存され、永続ボリュームにマウントされているため、コンテナ再起動後も維持されます。

### Q: 複数のプロジェクトで異なるMCP設定を使いたい
**A:** `claude mcp add --scope project` を使用すると、プロジェクトローカルの設定を作成できます。デフォルトは `--scope local` でプロジェクト単位の設定です。

### Q: MCPサーバーの応答が遅い
**A:** 初回接続時はパッケージのダウンロードが発生するため遅くなります。2回目以降はキャッシュが使用されるため高速化します。`context7` の場合、npxキャッシュが有効になっているか確認してください。

### Q: GitHub PATのスコープは最小限にできる？
**A:** はい。読み取り専用の操作のみ行う場合は、`repo:status`, `public_repo`, `read:org`, `read:user` のみで十分です。書き込み操作が必要な場合は追加のスコープが必要です。

## 参考資料

- [Claude Code 公式ドキュメント](https://docs.anthropic.com/claude-code)
- [MCP仕様](https://modelcontextprotocol.io/)
- [使用方法ガイド](./claude-code-usage.md)
- [GitHub PAT作成ガイド](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

## サポート

問題が解決しない場合は、以下の情報とともにissueを作成してください：
- エラーメッセージ
- `claude --version` の出力
- `claude mcp list` の出力
- インストールログ（`~/.cache/claude-install-logs/`）
