# MCP Setup スクリプトエラー解決プラン

## 概要
`setup-claude-mcp.sh` スクリプトで github-mcp-server の追加時に `error: missing required argument 'name'` エラーが発生している問題を解決する。

## 環境情報
- **Claude Code CLI バージョン**: 2.0.50
- **エラー発生日時**: 2025-11-25
- **対象スクリプト**: `/workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh`
- **GitHub MCP URL**: `https://api.githubcopilot.com/mcp/`
- **環境変数 GITHUB_MCP_PAT**: 設定済み

## 問題の原因

### エラー発生箇所
スクリプトの84-85行目で以下のコマンドを実行時にエラーが発生:
```bash
claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" github-mcp-server "$GITHUB_URL"
```

### 実際のエラーログ
```
[3/3] github-mcp-server を追加中...
error: missing required argument 'name'
✗ github-mcp-server の追加に失敗しました
```

### 根本原因
`claude mcp add` コマンドの正しい構文（`claude mcp add --help` より）:
```
claude mcp add [options] <name> <commandOrUrl> [args...]
```

`-H` オプションの定義:
```
-H, --header <header...>     Set WebSocket headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")
```

**問題**: `-H` オプションは可変長引数 `<header...>` を取るため、コマンドラインパーサーが `-H` の後の `github-mcp-server` を次のヘッダー値として解釈し、`<name>` 引数が不足していると判断している。

**証拠**: `-H` オプションの後に位置引数（`<name>` と `<commandOrUrl>`）を配置すると、オプション解析が正しく終了せず、位置引数が認識されない。

## 解決策

### 1. コマンド構文の修正

検証すべき3つのアプローチ:

#### オプション A: ヘッダーオプションを位置引数の後に配置
```bash
claude mcp add --transport http github-mcp-server "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT"
```
**根拠**: 位置引数を先に配置することで、パーサーが `<name>` と `<commandOrUrl>` を正しく認識できる。  
**成功条件**: コマンドがエラーなく完了し、`claude mcp list` で github-mcp-server-test が表示される。

#### オプション B: `--` を使用してオプション解析を明示的に終了
```bash
claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" -- github-mcp-server "$GITHUB_URL"
```
**根拠**: POSIX 標準の `--` を使用し、以降の引数をオプションではなく位置引数として扱わせる。  
**成功条件**: 同上。

#### オプション C: 環境変数を使用（代替案）
```bash
claude mcp add --transport http -e GITHUB_TOKEN="$GITHUB_MCP_PAT" github-mcp-server "$GITHUB_URL"
```
**制約**: HTTP ヘッダーではなく環境変数になるため、GitHub MCP サーバーが環境変数経由の認証に対応している必要がある（未確認）。  
**優先度**: 低（オプション A, B が失敗した場合のみ検討）

### 2. 実装ステップ

#### ステップ1: 環境変数の確認と設定
**目的**: テスト実行に必要な環境変数を確認・設定する。  
**成功条件**: `GITHUB_MCP_PAT` と `GITHUB_URL` が正しく設定されている。

```bash
# 環境変数の確認
echo "GITHUB_MCP_PAT: $([ -n "$GITHUB_MCP_PAT" ] && echo '設定済み' || echo '未設定')"

# GITHUB_URL の取得
export GITHUB_URL=$(jq -r '.servers["github-mcp-server"].url' /workspaces/ai-work-container/.vscode/mcp.json)
echo "GITHUB_URL: $GITHUB_URL"
```

**失敗時の対応**: GITHUB_MCP_PAT が未設定の場合、GitHub Personal Access Token を取得して設定する。

#### ステップ2: コマンド構文のテスト
**目的**: オプション A と B を実際に実行し、どちらが成功するか確認する。  
**成功条件**: コマンドがエラーなく完了し、`claude mcp list` でテストサーバーが表示される。

```bash
# テスト前の準備（既存のテストサーバーを削除）
claude mcp remove github-mcp-server-test 2>/dev/null || true

# オプション A をテスト
echo "=== オプション A のテスト ==="
if claude mcp add --transport http github-mcp-server-test "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT" 2>&1; then
  echo "✓ オプション A: 成功"
  OPTION_A_SUCCESS=true
  # 確認
  claude mcp list | grep github-mcp-server-test
else
  echo "✗ オプション A: 失敗"
  OPTION_A_SUCCESS=false
fi

# クリーンアップ
claude mcp remove github-mcp-server-test 2>/dev/null || true

# オプション B をテスト
echo "=== オプション B のテスト ==="
if claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" -- github-mcp-server-test "$GITHUB_URL" 2>&1; then
  echo "✓ オプション B: 成功"
  OPTION_B_SUCCESS=true
  # 確認
  claude mcp list | grep github-mcp-server-test
else
  echo "✗ オプション B: 失敗"
  OPTION_B_SUCCESS=false
fi

# クリーンアップ
claude mcp remove github-mcp-server-test 2>/dev/null || true

# 結果の記録
echo "=== テスト結果 ==="
echo "オプション A: $([ "$OPTION_A_SUCCESS" = true ] && echo '成功' || echo '失敗')"
echo "オプション B: $([ "$OPTION_B_SUCCESS" = true ] && echo '成功' || echo '失敗')"
```

**テスト結果の記録場所**: このプランファイルの「テスト結果」セクションに記録する。

**失敗時の対応**: 両方失敗した場合、`claude mcp add --help` の出力を再確認し、オプション C を検討する。

#### ステップ3: スクリプトの修正
**目的**: テストで成功した構文を使用して、スクリプトを修正する。  
**成功条件**: スクリプトの該当行が正しく修正され、構文エラーがない。

**修正対象ファイル**: `/workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh`

**修正箇所1（84-85行目）** - 認証ありの場合:
```bash
# 修正前:
if claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" github-mcp-server "$GITHUB_URL"; then

# 修正後（オプション A が成功した場合）:
if claude mcp add --transport http github-mcp-server "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT"; then

# 修正後（オプション B が成功した場合）:
if claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" -- github-mcp-server "$GITHUB_URL"; then
```

**修正箇所2（91-92行目）** - 認証なしの場合（変更不要）:
```bash
# 現状のまま（正しい）:
if claude mcp add --transport http github-mcp-server "$GITHUB_URL"; then
```

**検証方法**: 修正後、`bash -n /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh` で構文チェックを実行。

#### ステップ4: スクリプトのテスト実行
**目的**: 修正したスクリプトを実行し、エラーが解消されることを確認する。  
**成功条件**: スクリプトがエラーなく完了し、github-mcp-server が正常に追加される。

```bash
# 既存のサーバーを削除（再実行のため）
claude mcp remove github-mcp-server 2>/dev/null || true

# スクリプトを実行
bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh 2>&1 | tee /tmp/mcp-setup-test.log

# 実行結果の確認
echo "=== 実行結果 ==="
if grep -q "✓ github-mcp-server を追加しました" /tmp/mcp-setup-test.log; then
  echo "✓ スクリプト実行成功"
else
  echo "✗ スクリプト実行失敗"
  echo "エラーログ:"
  grep "github-mcp-server" /tmp/mcp-setup-test.log
fi
```

**失敗時の対応**: エラーログを確認し、ステップ2に戻って別のオプションを試す。

#### ステップ5: MCP サーバーの動作確認
**目的**: 追加されたサーバーが正常に動作することを確認する。  
**成功条件**: サーバーが一覧に表示され、接続が成功する。

```bash
# サーバー一覧を確認
echo "=== MCP サーバー一覧 ==="
claude mcp list

# 接続状態の確認
echo "=== 接続状態の確認 ==="
claude mcp list | grep -A 1 "github-mcp-server"
```

**期待される出力**:
```
github-mcp-server: https://api.githubcopilot.com/mcp/ (HTTP) - ✓ Connected
```

**失敗時の対応**: 
- `✗ Connection failed` の場合: 認証トークンの有効性を確認
- サーバーが一覧に表示されない場合: スクリプトの実行ログを再確認

### 3. 追加の改善提案（オプション - 本件解決後に実施）

以下の改善は、主要な問題解決後に実施を検討する付加的な改善項目です。

#### 改善1: エラーハンドリングの強化
**目的**: デバッグを容易にするため、詳細なエラー情報を出力する。  
**実施タイミング**: スクリプト修正と同時、または本件解決直後。  
**期待効果**: 将来のトラブルシューティングが容易になる。

```bash
if ! claude mcp add --transport http github-mcp-server "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT" 2>&1; then
  echo "✗ github-mcp-server の追加に失敗しました"
  echo "  コマンド: claude mcp add --transport http github-mcp-server $GITHUB_URL -H 'Authorization: Bearer \$GITHUB_MCP_PAT'"
  echo "  デバッグ手順:"
  echo "    1. GITHUB_MCP_PAT が設定されているか確認: echo \$GITHUB_MCP_PAT"
  echo "    2. トークンの有効性を確認: curl -H 'Authorization: Bearer \$GITHUB_MCP_PAT' https://api.github.com/user"
  echo "    3. URL の接続を確認: curl -I $GITHUB_URL"
fi
```

#### 改善2: ドライランモードの追加
**目的**: 実行前にコマンドを確認し、安全に動作検証できるようにする。  
**実施タイミング**: 本件解決後、時間がある場合。  
**期待効果**: CI/CD パイプラインへの統合や、初回セットアップ時の安全性向上。

使用方法:
```bash
DRY_RUN=true bash /workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh
```

実装例:
```bash
# スクリプトの先頭に追加
DRY_RUN=${DRY_RUN:-false}

# コマンド実行部分を修正
if $DRY_RUN; then
  echo "[DRY RUN] claude mcp add --transport http github-mcp-server \"$GITHUB_URL\" -H \"Authorization: Bearer \$GITHUB_MCP_PAT\""
else
  if claude mcp add --transport http github-mcp-server "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT"; then
    echo "✓ github-mcp-server を追加しました"
  fi
fi
```

#### 改善3: 既存サーバーの更新機能
**目的**: サーバーが既に存在する場合の動作を明確にし、更新オプションを提供する。  
**実施タイミング**: 本件解決後、必要に応じて。  
**期待効果**: 設定変更時の運用が容易になる。

実装例:
```bash
if echo "$EXISTING_SERVERS" | grep -q "^github-mcp-server$"; then
  echo "⚠ github-mcp-server は既に存在します"
  if [ "${FORCE_UPDATE:-false}" = "true" ]; then
    echo "強制更新モード: サーバーを削除して再追加します"
    claude mcp remove github-mcp-server
    # 追加処理を続行
  else
    echo "スキップしました（強制更新するには FORCE_UPDATE=true を設定）"
  fi
fi
```

## 実装の優先順位

### フェーズ1: 問題解決（即座に実施）
1. **ステップ1**: 環境変数の確認と設定 - 5分
2. **ステップ2**: コマンド構文のテスト - 10分
3. **ステップ3**: スクリプトの修正 - 5分
4. **ステップ4**: スクリプトのテスト実行 - 5分
5. **ステップ5**: MCP サーバーの動作確認 - 5分

**合計所要時間**: 約30分  
**完了条件**: github-mcp-server が正常に追加され、`claude mcp list` で接続が確認できる。

### フェーズ2: 品質向上（問題解決後、同じセッション内で実施）
6. **改善1**: エラーハンドリングの強化 - 10分

**合計所要時間**: 約10分  
**完了条件**: エラー発生時に詳細な情報が表示される。

### フェーズ3: 機能拡張（任意 - 時間があれば実施）
7. **改善2**: ドライランモードの追加 - 15分
8. **改善3**: 既存サーバーの更新機能 - 15分

**合計所要時間**: 約30分  
**完了条件**: 各機能が正常に動作することを確認。

## 期待される成果
- `setup-claude-mcp.sh` スクリプトが github-mcp-server を正常に追加できる
- エラーメッセージが表示されない
- `claude mcp list` で github-mcp-server が表示される
- Claude Code で GitHub MCP サーバーが使用可能になる

## リスクと対策

### リスク1: ヘッダー構文の互換性
- **リスク**: Claude Code CLI のバージョンによってヘッダー指定の構文が異なる可能性がある
- **現在のバージョン**: 2.0.50
- **対策**: 
  - ステップ2で複数のオプションを実際にテストして動作確認
  - テスト結果を記録し、将来のバージョンアップ時に参照可能にする
  - `claude --version` を定期的に確認し、バージョンアップ時は再テスト

### リスク2: 認証トークンの有効性
- **リスク**: GITHUB_MCP_PAT が無効、権限不足、または期限切れの可能性がある
- **現状**: 環境変数は設定済み
- **対策**: 
  - トークンの有効性を確認: `curl -H "Authorization: Bearer $GITHUB_MCP_PAT" https://api.github.com/user`
  - 必要な権限スコープ: `repo`, `read:org` などを確認
  - 期限切れの場合は新しいトークンを生成し、環境変数を更新

### リスク3: API エンドポイントの変更
- **リスク**: GitHub MCP サーバーの URL が変更されている可能性がある
- **現在の URL**: `https://api.githubcopilot.com/mcp/`
- **対策**: 
  - GitHub Copilot 公式ドキュメントで最新の URL を確認
  - エンドポイントの接続テスト: `curl -I https://api.githubcopilot.com/mcp/`
  - 404 エラーの場合は GitHub のドキュメントや変更履歴を確認

### リスク4: スクリプト修正時の構文エラー
- **リスク**: スクリプト修正時にシェルの構文エラーを引き起こす可能性
- **対策**:
  - 修正後は必ず `bash -n` で構文チェック
  - バックアップを作成: `cp setup-claude-mcp.sh setup-claude-mcp.sh.bak`
  - Git でバージョン管理し、問題があれば `git revert` で戻す

## 参考情報

### CLI ツール情報
- **Claude Code CLI バージョン**: 2.0.50
- **コマンドヘルプ**: `claude mcp add --help`
- **完全な構文**:
  ```
  Usage: claude mcp add [options] <name> <commandOrUrl> [args...]
  
  Options:
    -t, --transport <transport>  Transport type (stdio, sse, http)
    -H, --header <header...>     Set WebSocket headers
  ```

### 設定ファイル
- **スクリプト**: `/workspaces/ai-work-container/.devcontainer/setup-claude-mcp.sh`
- **MCP 設定**: `/workspaces/ai-work-container/.vscode/mcp.json`
- **Claude 設定**: `~/.claude.json` (プロジェクトローカル)

### 環境変数
- **GITHUB_MCP_PAT**: GitHub Personal Access Token（設定済み）
- **GITHUB_URL**: `https://api.githubcopilot.com/mcp/`（mcp.json から取得）

### 関連ドキュメント
- GitHub Copilot MCP ドキュメント（要確認）
- Claude Code CLI ドキュメント
- Model Context Protocol 仕様

## テスト結果

このセクションには、ステップ2で実施したテストの結果を記録します。

### テスト実施日時
2025-11-25 1:22

### テスト環境
- Claude Code CLI: 2.0.50
- OS: Ubuntu 24.04.3 LTS (Dev Container)
- Shell: bash

### テスト結果
| オプション | コマンド | 結果 | 備考 |
|-----------|---------|------|------|
| A | `claude mcp add --transport http github-mcp-server-test "$GITHUB_URL" -H "Authorization: Bearer $GITHUB_MCP_PAT"` | ✓ オプション A: 成功 | 未実施 |
| B | `claude mcp add --transport http -H "Authorization: Bearer $GITHUB_MCP_PAT" -- github-mcp-server-test "$GITHUB_URL"` | ✓ オプション B: 成功 | 未実施 |

### 採用した構文
（テスト実施後に記入）

## 次のステップ

### 即座に実施
1. ✅ **プランのレビュー完了** - このドキュメントの内容を確認
2. ⏳ **ステップ1を実行** - 環境変数の確認と設定
3. ⏳ **ステップ2を実行** - コマンド構文のテスト（オプション A, B）
4. ⏳ **テスト結果を記録** - このプランの「テスト結果」セクションに記入
5. ⏳ **ステップ3を実行** - 成功した構文でスクリプトを修正
6. ⏳ **ステップ4を実行** - 修正したスクリプトをテスト
7. ⏳ **ステップ5を実行** - MCP サーバーの動作確認

### 問題解決後
8. ⏳ **ドキュメント更新** - `docs/claude-code-mcp-setup.md` に解決方法を追記
9. ⏳ **改善1を実装** - エラーハンドリングの強化
10. ⏳ **変更をコミット** - Git でスクリプトとドキュメントの変更を記録

### オプション（時間があれば）
11. ⬜ **改善2を実装** - ドライランモード
12. ⬜ **改善3を実装** - 既存サーバーの更新機能
13. ⬜ **GitHub Issue をクローズ** - 問題が完全に解決したら Issue を閉じる

---

**注**: このプランは実行しながら更新してください。各ステップの完了時にチェックボックスを更新し、テスト結果を記録することで、進捗管理とトラブルシューティングが容易になります。
