# 開発タスク・チェックリスト

## 進行中のタスク

### Serena MCP 導入（Feature: feature/install-serena）

#### Phase 1: uv インストール処理実装
**ファイル**: `.devcontainer/post-create.sh`
**挿入位置**: Claude Code CLIインストール直後

**実装内容**:
```bash
# ======================================
# uv (Astral Python Package Manager) のインストール
# ======================================
# 1. インストール済みチェック（冪等性）
# 2. ログディレクトリ作成と古いログ削除
# 3. uvインストール（リトライ付き）
# 4. PATH設定（bash/zsh対応）
# 5. インストール確認
```

**確認項目**:
- [ ] インストール済みチェックロジック
- [ ] ログローテーション（7日以上前のログ削除）
- [ ] リトライ処理（最大3回、2秒間隔）
- [ ] PATH重複排除（case文使用）
- [ ] シェルファイル自動作成
- [ ] インストール後の動作確認

#### Phase 2: 検証
**手順**:
```bash
# コンテナ再ビルド
VS Code: Dev Containers: Rebuild Container

# 確認コマンド
uv --version
uvx --help
command -v uvx
which uv
echo $PATH | grep "\.local/bin\|\.cargo/bin"
```

#### Phase 3: トラブルシューティング
**対応内容**:
- uvインストール失敗時の代替手段（wget使用）
- uvxコマンド未発見時の対処
- PATH設定失敗時の手動設定方法
- Serena サーバー起動失敗時のデバッグ

## 既存課題・解決済みタスク

### Claude Code CLI 導入（完了）
- インストール: `.devcontainer/post-create.sh`
- 環境変数設定: `.devcontainer/post-create.sh`
- MCP 設定: `.vscode/mcp.json`, `setup-claude-mcp.sh`

### MCP サーバー統合（完了）
- Microsoft Learn (msdocs) MCP
- Context7 MCP
- GitHub MCP Server
- Serena MCP（設定済み、実装待ち）

## コード規約・ガイドライン

### Bash スクリプト
- **シェル**: bash (#!/bin/bash)
- **エラーハンドリング**: set -e 推奨
- **ログ出力**: echo, tee 使用
- **条件分岐**: if/then/fi
- **ループ**: while/for

### 冪等性原則
- インストール済みチェック必須（`command -v`）
- 既存設定の重複追加を回避
- 既存ファイルの上書きを避ける

### PATH 設定
- 環境変数使用: `$HOME`, `$PATH`
- 絶対パス推奨: `/home/username/.local/bin`
- 重複排除: `grep -qF "$PATH_ITEM" "$FILE"` で確認後追加
- case文パターン: 実行時重複排除

### ログ管理
- ログディレクトリ: `~/.cache/*/logs` または `/tmp`
- 日付ローテーション: `date '+%Y%m%d'`
- 古いログ削除: `find -mtime +7 -delete`
- タイムスタンプ: `date '+%Y-%m-%d %H:%M:%S'`

## 関連スクリプト

### `.devcontainer/post-create.sh`
- Claude Code CLI インストール
- uv インストール（実装予定）
- 環境変数設定

### `.devcontainer/setup-claude-mcp.sh`
- MCP サーバー自動設定
- `.vscode/mcp.json` 生成
- MCP サーバー検証

## 参考資料

- uv 公式: https://docs.astral.sh/uv/
- Serena GitHub: https://github.com/oraios/serena
- MCP 仕様: https://modelcontextprotocol.io/
- Claude Code: https://claude.ai/
