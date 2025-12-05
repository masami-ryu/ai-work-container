# Claude Code 設定・ドキュメント改善プラン

作成日: 2025年12月03日  
更新日: 2025年12月04日  
作成者: GitHub Copilot (Claude Opus 4.5)  
ステータス: Completed

## 1. 概要

### 目的
現在のClaude Code関連設定・ドキュメントをベストプラクティスと比較評価し、改善すべき点を特定して実行可能なプランを策定する。

### スコープ
- 対象: `.claude/` 設定、`CLAUDE.md`、ドキュメント（`docs/claude-code-*.md`）
- 対象外: MCP設定（`.vscode/mcp.json`）、DevContainer設定

### 前提条件
- Claude Code CLIがインストール済み
- 既存の設定・ドキュメントが存在

## 2. 現状評価

### 2.1 CLAUDE.md

| 評価項目 | 現状 | ベストプラクティス準拠 | 評価 |
|---------|------|----------------------|------|
| 基本構造 | プロジェクト概要、技術スタック、ディレクトリ構造を記載 | ✅ 準拠 | ⭐⭐⭐⭐☆ |
| 頻繁使用コマンド | 「なし」と記載 | ⚠️ 改善可能 | ⭐⭐⭐☆☆ |
| コーディング規約 | 基本的な記載あり | ✅ 準拠 | ⭐⭐⭐⭐☆ |
| ファイル参照（@インポート） | 3つのファイルを参照 | ✅ 準拠 | ⭐⭐⭐⭐☆ |
| 明確な指示・強調 | IMPORTANTやYOU MUSTなし | ⚠️ 改善可能 | ⭐⭐⭐☆☆ |
| 簡潔さ | 約30行、簡潔 | ✅ 準拠 | ⭐⭐⭐⭐⭐ |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. 頻繁使用コマンドの追加（claude CLI操作等）
2. 重要な指示への強調（IMPORTANT等）の追加
3. トラブルシューティングへのリンク追加

### 2.2 .claude/settings.json

| 評価項目 | 現状 | ベストプラクティス準拠 | 評価 |
|---------|------|----------------------|------|
| 権限設定 (allow/deny) | 17個のallowルール、4個のdenyルール | ✅ 適切 | ⭐⭐⭐⭐⭐ |
| 機密ファイル除外 | .env, secrets除外 | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| Bash安全コマンド許可 | git, cat, ls, tree, find, grep許可 | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| 危険コマンド拒否 | rm -rf拒否 | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| MCP自動承認 | enableAllProjectMcpServers: true | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| 環境変数チューニング | MAX_THINKING_TOKENS, タイムアウト設定 | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| Hooks設定 | SessionStart, PreToolUse設定済み | ✅ 準拠 | ⭐⭐⭐⭐⭐ |
| Sandbox設定 | 未設定 | ⚠️ 検討可能 | ⭐⭐⭐☆☆ |
| askルール | 未設定 | ⚠️ 検討可能 | ⭐⭐⭐☆☆ |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. `ask`ルールの追加（git push等の確認が必要な操作）
2. Sandbox設定の検討（セキュリティ強化）
3. `DISABLE_NON_ESSENTIAL_MODEL_CALLS`の追加検討（コスト削減）

### 2.3 カスタムエージェント (.claude/agents/)

| エージェント | 評価項目 | 評価 | 備考 |
|------------|---------|------|-----|
| plan-creator.md | 専門領域の明確化 | ⭐⭐⭐⭐⭐ | ワークフロー選択が優秀 |
| plan-creator.md | ツール制限 | ⭐⭐⭐⭐☆ | 適切だが`WebFetch`は`mcp`に統合推奨 |
| plan-creator.md | model指定 | ⭐⭐⭐⭐⭐ | sonnet（バランス良い） |
| pr-reviewer.md | レビュー観点 | ⭐⭐⭐⭐⭐ | 5観点が網羅的 |
| pr-reviewer.md | 出力フォーマット | ⭐⭐⭐⭐⭐ | 簡潔版/詳細版が明確 |
| pr-reviewer.md | MCP活用 | ⭐⭐⭐⭐☆ | msdocs/context7参照あり |
| doc-writer.md | 役割定義 | ⭐⭐⭐⭐☆ | 簡潔だがもう少し詳細化可能 |
| doc-writer.md | ワークフロー | ⭐⭐⭐☆☆ | 5ステップあるが詳細度不足 |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. `doc-writer.md`のワークフロー詳細化
2. エージェント間の責任分担の明確化（ハンドオフルール）
3. 各エージェントへの`max_turns`推奨値追加

### 2.4 カスタムコマンド (.claude/commands/)

| コマンド | 評価項目 | 評価 | 備考 |
|---------|---------|------|-----|
| commit.md | タスク定義 | ⭐⭐⭐⭐⭐ | 明確なワークフロー |
| commit.md | コンテキスト | ⭐⭐⭐⭐⭐ | git diff/status活用 |
| plan.md | テンプレート参照 | ⭐⭐⭐⭐⭐ | @インポート活用 |
| plan.md | ステップ | ⭐⭐⭐⭐⭐ | 5ステップが明確 |
| review-plan.md | 観点 | ⭐⭐⭐⭐☆ | 5観点あるがエビデンス要求なし |
| doc.md | 構造 | ⭐⭐⭐⭐☆ | 基本的な構造は良い |
| suggest-claude-md.md | 実用性 | ⭐⭐⭐⭐☆ | セッション知見の蓄積に有用 |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. `allowed-tools`フロントマターの追加（各コマンドで使用するツールを制限）
2. `review-plan.md`にエビデンス要求を追加
3. 新規コマンドの追加検討（`/test`, `/refactor`, `/security-check`等）

### 2.5 Hooks (.claude/hooks/)

| フック | 評価項目 | 評価 | 備考 |
|-------|---------|------|-----|
| session-start.sh | 環境初期化 | ⭐⭐⭐☆☆ | PROJECT_ROOT設定のみ |
| auto-approve-docs.sh | 自動承認 | ⭐⭐⭐⭐⭐ | .md/.txt/.json適切 |
| PreCompact.md | メモリ更新提案 | ⭐⭐⭐⭐⭐ | haiku使用でコスト効率◎ |
| SessionEnd.md | セッション終了 | ⭐⭐⭐⭐☆ | 存在するが内容未確認 |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. `session-start.sh`の機能拡張（MCP接続確認等）
2. `PostToolUse`フックの追加検討（ログ出力等）
3. `NotificationReceived`フックの検討

### 2.6 ドキュメント (docs/)

| ドキュメント | 評価項目 | 評価 | 備考 |
|-------------|---------|------|-----|
| claude-code-mcp-setup.md | 網羅性 | ⭐⭐⭐⭐⭐ | Phase 1-5が詳細 |
| claude-code-mcp-setup.md | トラブルシューティング | ⭐⭐⭐⭐⭐ | 充実 |
| claude-code-mcp-setup.md | 重複コンテンツ | ⭐⭐☆☆☆ | Phase 1-3が重複記載 |
| claude-code-usage.md | 基本使用法 | ⭐⭐⭐⭐☆ | CLI/VS Code両方記載 |
| claude-code-usage.md | 高度な使い方 | ⭐⭐⭐⭐☆ | 設定例あり |
| claude-code-usage.md | SDK情報 | ⭐⭐☆☆☆ | SDK/Agent情報なし |

**総合評価: ⭐⭐⭐⭐☆ (良好)**

**改善点**:
1. `claude-code-mcp-setup.md`の重複コンテンツ削除
2. SDK/Agentの使い方セクション追加
3. Hooks/コマンドのカスタマイズガイド追加

## 3. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | ドキュメントの重複コンテンツを解消 | 高 |
| REQ-002 | 要件 | CLAUDE.mdに頻繁使用コマンドを追加 | 中 |
| REQ-003 | 要件 | settings.jsonにaskルールを追加 | 中 |
| REQ-004 | 要件 | doc-writerエージェントのワークフロー詳細化 | 中 |
| REQ-005 | 要件 | コマンドにallowed-toolsを追加 | 低 |
| REQ-006 | 要件 | session-start.shの機能拡張 | 低 |
| REQ-007 | 要件 | SDK/Agentドキュメント追加 | 低 |
| CON-001 | 制約 | 既存の動作を壊さない | - |
| CON-002 | 制約 | 簡潔さを維持（過度な追記を避ける） | - |
| GUD-001 | ガイドライン | ベストプラクティスに準拠 | - |

## 4. 実装ステップ

### Phase 1: ドキュメント品質向上（高優先度）
**目標**: 重複コンテンツの解消とドキュメント構造の改善

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | claude-code-mcp-setup.mdの重複削除 | `docs/claude-code-mcp-setup.md` | 重複するPhase 1-3セクションを統合 | [ ] |
| TASK-002 | 目次の追加 | `docs/claude-code-mcp-setup.md` | ドキュメント冒頭に目次を追加 | [ ] |
| TASK-003 | 最終更新日の追加 | 全docsファイル | 各ドキュメントに最終更新日を記載 | [ ] |

**検証手順**:
```bash
# ドキュメントの行数確認（重複削除後は約250行以下になるはず）
wc -l docs/claude-code-mcp-setup.md

# 目次リンクの動作確認（Markdownプレビューで確認）
```
**期待結果**: 重複セクションが統合され、目次から各セクションへジャンプ可能

### Phase 2: CLAUDE.md改善（中優先度）
**目標**: プロジェクトメモリの実用性向上

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | 頻繁使用コマンドの追加 | `CLAUDE.md` | Claude CLI操作コマンドを記載 | [ ] |
| TASK-005 | 重要な注意事項の強調 | `CLAUDE.md` | IMPORTANTセクションを追加 | [ ] |
| TASK-006 | トラブルシューティングリンク | `CLAUDE.md` | 関連ドキュメントへのリンク追加 | [ ] |

**検証手順**:
```bash
# Claude Codeセッション内でメモリ確認
/memory
```
**期待結果**: CLAUDE.mdの内容が表示され、頻繁使用コマンド・IMPORTANTセクションが含まれる

**CLAUDE.md 改善例**:

> **注意**: 以下は改善後のCLAUDE.md全体像です。そのままコピーして使用できます。

```text
# プロジェクト: ai-work-container

## 概要
AI開発作業用のDevContainer環境。Claude CodeとMCPを活用した効率的な開発ワークフローを提供。

## 技術スタック
- 言語: Markdown, Shell, JSON
- ツール: Claude Code, VS Code, MCP (context7, msdocs, github-mcp-server, serena)
- 環境: DevContainer (Ubuntu 24.04)

## ディレクトリ構造
- ai/plans/ - 実行プラン
- ai/templates/ - テンプレート
- docs/ - ドキュメント
- .claude/ - Claude Code設定
- .vscode/mcp.json - MCP設定

## 頻繁に使用するコマンド
    # MCPサーバー確認
    claude mcp list

    # セッション開始
    claude

    # ワンショット実行
    claude -p "質問内容"

    # メモリ確認
    /memory

## コーディング規約
- Markdownはプレビュー可能な形式で
- 日本語で記述
- ファイル命名: YYMMDD_[概要].md

## IMPORTANT
- プランは必ず ai/plans/ に保存
- レビュー結果は ai/reviews/ に保存
- MCPツールを活用してベストプラクティスを参照すること

## 重要なドキュメント
- @docs/claude-code-usage.md
- @docs/claude-code-mcp-setup.md
- @ai/templates/plan-template.md
- @.github/copilot-instructions.md

## トラブルシューティング
MCPやCLI関連の問題は @docs/claude-code-mcp-setup.md#トラブルシューティング を参照。
```

### Phase 3: settings.json改善（中優先度）
**目標**: 権限設定の最適化とセキュリティ強化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-007 | askルールの追加 | `.claude/settings.json` | git push, 本番環境操作に確認を要求 | [ ] |
| TASK-008 | コスト削減設定の追加 | `.claude/settings.json` | DISABLE_NON_ESSENTIAL_MODEL_CALLSを追加 | [ ] |
| TASK-009 | 設定コメントの追加 | `.claude/settings.json` | 各セクションに説明コメント | [ ] |

**検証手順**:
```bash
# 設定ファイルの構文確認（JSONとして有効か）
cat .claude/settings.json | python3 -m json.tool > /dev/null && echo "Valid JSON"

# Claude Codeセッション内でgit pushを試行し、確認プロンプトが表示されることを確認
```
**期待結果**: JSONが有効であり、`git push`実行時に確認ダイアログが表示される

**ロールバック手順**:
```bash
# 変更前にバックアップを作成
cp .claude/settings.json .claude/settings.json.bak

# 問題発生時はバックアップから復元
cp .claude/settings.json.bak .claude/settings.json
```

**Sandbox設定について**:
> 現時点ではSandbox設定は **スコープ外** とします。理由:
> - 本プロジェクトはドキュメント・設定管理が主目的であり、危険なBashコマンド実行リスクが低い
> - `deny`ルールで`rm -rf`等の危険コマンドは既にブロック済み
> - Sandbox導入による複雑性増加のデメリットが、セキュリティ向上のメリットを上回る
>
> 将来、コード実行を伴うプロジェクトに拡張する場合は再検討してください。

**settings.json 改善例**:
```jsonc
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)",
      "Bash(git add:*)",
      "Bash(cat:*)",
      "Bash(ls:*)",
      "Bash(tree:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(find:*)",
      "Bash(grep:*)",
      "Read(**)",
      "Grep",
      "Glob",
      "Write",
      "Edit",
      "WebFetch"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Bash(rm -rf:*)"
    ],
    "ask": [
      "Bash(git push:*)",
      "Bash(git commit:*)",
      "Write(./production/**)"
    ],
    "defaultMode": "default"
  },
  "enableAllProjectMcpServers": true,
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "BASH_DEFAULT_TIMEOUT_MS": "30000",
    "MCP_TIMEOUT": "60000",
    "MCP_TOOL_TIMEOUT": "120000",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1"
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

### Phase 4: エージェント・コマンド改善（中優先度）
**目標**: エージェントの実用性向上とコマンドの標準化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-010 | doc-writerワークフロー詳細化 | `.claude/agents/doc-writer.md` | 5ステップを具体化 | [ ] |
| TASK-011 | コマンドにallowed-tools追加 | `.claude/commands/*.md` | 各コマンドにツール制限を追加 | [ ] |
| TASK-012 | review-planにエビデンス要求追加 | `.claude/commands/review-plan.md` | MCP参照を必須化 | [ ] |

**検証手順**:
```bash
# エージェント・コマンドの一覧確認
ls -la .claude/agents/ .claude/commands/

# フロントマターにallowed-toolsが含まれているか確認
grep -l "allowed-tools" .claude/commands/*.md
```
**期待結果**: 各コマンドファイルに`allowed-tools`が設定されている

### Phase 5: Hooks改善（低優先度）
**目標**: 自動化とログ出力の強化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-013 | session-start.sh機能拡張 | `.claude/hooks/session-start.sh` | MCP接続確認を追加 | [ ] |
| TASK-014 | PostToolUseフック追加 | `.claude/hooks/` | ツール実行ログ出力 | [ ] |

**検証手順**:
```bash
# セッション開始時にMCP確認が実行されるか確認
claude
# → セッション開始時にMCPサーバー状態が表示されることを確認
```
**期待結果**: セッション開始時にMCPサーバーの接続状態が出力される

### Phase 6: ドキュメント拡張（低優先度）
**目標**: SDK/Agent情報の追加

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-015 | SDK使い方ガイド作成 | `docs/claude-code-sdk.md` | 基本的なSDK使用例を記載 | [ ] |
| TASK-016 | カスタム設定ガイド作成 | `docs/claude-code-customization.md` | Hooks/コマンド/エージェントのカスタマイズ方法 | [ ] |

**検証手順**:
```bash
# ドキュメントが作成されているか確認
ls -la docs/claude-code-sdk.md docs/claude-code-customization.md
```
**期待結果**: 両ファイルが存在し、必要セクションが含まれている

**新規ドキュメントのアウトライン**:

<details>
<summary>docs/claude-code-sdk.md（クリックで展開）</summary>

```text
# Claude Code SDK 使い方ガイド

## 概要
Claude Code SDKを使用したプログラマティックな操作方法

## 前提条件
- Claude Code CLIがインストール済み
- Node.js v22以降 または Python 3.10以降

## インストール
### TypeScript/JavaScript
### Python

## 基本的な使い方
### セッションの開始
### プロンプトの送信
### レスポンスの処理

## 高度な使い方
### カスタムツールの定義
### Hooksとの連携
### MCPサーバーの利用

## 参考資料
- 公式SDKドキュメント
- Context7: /anthropics/claude-code-sdk-python
```
</details>

<details>
<summary>docs/claude-code-customization.md（クリックで展開）</summary>

```text
# Claude Code カスタマイズガイド

## 概要
Hooks、コマンド、エージェントのカスタマイズ方法

## ディレクトリ構造
.claude/
├── agents/      # カスタムエージェント
├── commands/    # スラッシュコマンド
├── hooks/       # フックスクリプト
└── settings.json

## カスタムコマンドの作成
### フロントマター
### コンテキスト定義
### タスク定義
### 例: /commit コマンド

## カスタムエージェントの作成
### 役割定義
### ツール制限
### ワークフロー定義
### 例: doc-writer エージェント

## Hooksの設定
### SessionStart
### PreToolUse / PostToolUse
### PreCompact
### 例: 自動承認フック

## ベストプラクティス
- 単一責任の原則
- テスト可能な設計
- ドキュメント化

## 参考資料
- Awesome Claude Code
- Claude Log
```
</details>

## 5. 成功基準

### 品質チェックリスト
- [ ] 重複コンテンツが解消されている
- [ ] CLAUDE.mdが実用的で簡潔
- [ ] settings.jsonが最適化されている
- [ ] エージェント・コマンドが標準化されている
- [ ] ドキュメントが最新の状態

### 測定可能な基準
- ドキュメントの重複行数: 0行
- CLAUDE.mdの行数: 50行以下
- settings.jsonの権限ルール: allow/deny/askが適切に設定
- 全タスク完了率: 80%以上（Phase 1-4必須）

## 6. リスクと対策

| リスク | 影響度 | 対策 | ロールバック手順 |
|--------|-------|------|----------------|
| 既存動作の破壊 | 高 | 変更前にバックアップ、段階的な適用 | `git checkout -- <file>` で復元 |
| 過度な複雑化 | 中 | 簡潔さを維持、必要最小限の変更 | 不要な変更を取り消す |
| 設定の互換性 | 中 | Claude Code CLIのバージョン確認 | 旧バージョン互換の設定に戻す |
| settings.json構文エラー | 高 | JSON検証を実施 | `.bak`ファイルから復元 |

### 共通ロールバック手順
```bash
# 変更前にブランチを作成
git checkout -b feature/claude-code-improvement

# 各Phase完了後にコミット
git add -A && git commit -m "Phase X: 内容"

# 問題発生時は前のコミットに戻す
git revert HEAD

# または変更を完全に破棄
git checkout main -- <file>
```

## 6.1 Phase間の依存関係

```
Phase 1 (ドキュメント品質向上)
    ↓ 依存なし（並行実行可能）
Phase 2 (CLAUDE.md改善)
    ↓ 依存なし（並行実行可能）
Phase 3 (settings.json改善)
    ↓
Phase 4 (エージェント・コマンド改善) ← Phase 3完了後に実施
    ↓
Phase 5 (Hooks改善) ← Phase 4完了後に実施
    ↓
Phase 6 (ドキュメント拡張) ← Phase 1-5の知見を反映
```

**並行実行可能なPhase**: Phase 1, 2, 3 は相互依存がないため並行実行可能  
**順次実行が必要なPhase**: Phase 4以降は前Phaseの設定を前提とするため順次実行

## 7. 次のアクション

1. **即時対応（Phase 1）**: `docs/claude-code-mcp-setup.md`の重複削除
2. **短期対応（Phase 2-3）**: CLAUDE.mdとsettings.jsonの改善
3. **中期対応（Phase 4）**: エージェント・コマンドの標準化
4. **長期対応（Phase 5-6）**: Hooks改善とドキュメント拡張

---

## 参考資料

- [Claude Code Best Practices](https://github.com/thevibeworks/claude-code-docs)
- [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code)
- [Claude Log - CLAUDE.md Best Practices](https://claudelog.com/mechanics/claude-md-supremacy)
