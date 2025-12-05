# Claude Code パフォーマンス最適化プラン

作成日: 2025年12月03日  
作成者: GitHub Copilot (Claude Opus 4.5)  
ステータス: Completed

## 1. 概要

### 目的
Claude Code のパフォーマンスを最大限に引き出すために、環境設定・CLAUDE.md（メモリファイル）・カスタムコマンド・サブエージェントを整備し、効率的な開発ワークフローを確立する。

### スコープ
- 対象: プロジェクトレベルの設定・ドキュメント整備
- 対象外: ユーザーレベル（`~/.claude/`）の設定、エンタープライズ設定

### 前提条件
- Claude Code CLIがインストール済み
- VS Code拡張機能が利用可能
- MCPサーバー（msdocs, context7, github-mcp-server, serena）が設定済み

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | CLAUDE.md でプロジェクト固有のコンテキストを提供 | 高 |
| REQ-002 | 要件 | カスタムスラッシュコマンドで頻繁な操作を効率化 | 高 |
| REQ-003 | 要件 | .claude/settings.json で権限と動作を最適化 | 中 |
| REQ-004 | 要件 | カスタムサブエージェントで専門タスクを効率化 | 中 |
| REQ-005 | 要件 | 環境変数で拡張思考・タイムアウト等をチューニング | 中 |
| REQ-006 | 要件 | Hooks で自動化・環境永続化を実現 | 中 |
| REQ-007 | 要件 | 既存ドキュメントとの整合性を保つ | 低 |
| REQ-008 | 要件 | Tool Search (Beta) を調査し、利用可能な場合にコンテキスト消費とツール選択効率を改善 | 低 |
| CON-001 | 制約 | 公式ドキュメントのベストプラクティスに準拠 | - |
| CON-002 | 制約 | MCPサーバーの承認・権限はプロジェクト側で統一管理 | - |
| GUD-001 | ガイドライン | メモリは具体的・簡潔に記述 | - |
| GUD-002 | ガイドライン | スラッシュコマンドはチームで共有可能な形式で | - |

## 3. 実装ステップ

### Phase 1: プロジェクトメモリ（CLAUDE.md）の作成
**目標**: Claude Code が起動時に自動的にプロジェクトコンテキストを読み込めるようにする

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | プロジェクトルートに CLAUDE.md を作成 | `/CLAUDE.md` | ファイルが存在し、`/memory` で確認可能 | [x] |
| TASK-002 | プロジェクト概要を記載 | `/CLAUDE.md` | 目的・技術スタック・構造が明記 | [x] |
| TASK-003 | 頻繁に使用するコマンドを記載 | `/CLAUDE.md` | ビルド・テスト・リント等のコマンドが記載 | [x] |
| TASK-004 | コーディング規約・スタイルガイドを記載 | `/CLAUDE.md` | 命名規則・フォーマット等が記載 | [x] |
| TASK-005 | 重要なアーキテクチャパターンを記載 | `/CLAUDE.md` | ディレクトリ構造・設計原則が記載 | [x] |
| TASK-006 | 既存ドキュメントへの参照を追加（@インポート） | `/CLAUDE.md` | `@docs/`, `@ai/templates/` 等の参照 | [x] |

**CLAUDE.md テンプレート例**:
```markdown
# プロジェクト: ai-work-container

## 概要
AI開発作業用のDevContainer環境。Claude CodeとMCPを活用した効率的な開発ワークフローを提供。

## 技術スタック
- 言語: Markdown, Shell, JSON
- ツール: Claude Code, VS Code, MCP (context7, msdocs, github-mcp-server, serena)
- 環境: DevContainer (Ubuntu 24.04)

## ディレクトリ構造
- `ai/plans/` - 実行プラン
- `ai/templates/` - テンプレート
- `docs/` - ドキュメント
- `.vscode/mcp.json` - MCP設定

## 頻繁に使用するコマンド
- なし（ドキュメント・設定管理プロジェクト）

## コーディング規約
- Markdownはプレビュー可能な形式で
- 日本語で記述
- ファイル命名: `YYMMDD_[概要].md`

## 重要なドキュメント
- @docs/claude-code-usage.md
- @ai/templates/plan-template.md
- @.github/copilot-instructions.md
```

### Phase 2: プロジェクト設定（.claude/settings.json）の作成
**目標**: 権限・動作設定・環境変数・MCP承認ポリシーを最適化し、安全かつ効率的な操作を可能にする

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-007 | .claude ディレクトリを作成 | `/.claude/` | ディレクトリが存在 | [x] |
| TASK-008 | settings.json で権限設定を追加 | `/.claude/settings.json` | allow/deny ルールが設定済み | [x] |
| TASK-009 | 機密ファイルの除外設定を追加 | `/.claude/settings.json` | .env, secrets等が deny に設定 | [x] |
| TASK-010 | 安全なBashコマンドの自動許可設定 | `/.claude/settings.json` | git, cat, ls等が許可リストに含まれる | [x] |
| TASK-011 | デフォルト権限モードを設定 | `/.claude/settings.json` | `defaultMode` が設定済み | [x] |
| TASK-012 | MCP サーバー自動承認を設定 | `/.claude/settings.json` | `enableAllProjectMcpServers` が有効 | [x] |
| TASK-013 | 環境変数チューニングを追加 | `/.claude/settings.json` | 拡張思考・タイムアウト等が設定済み | [x] |
| TASK-013b | Tool Search (Beta) の利用可否を調査 | ドキュメント・CLI | ① CLI/API での利用可否を確認 ② 利用可能な場合は有効化手順を記載 ③ 利用不能/影響小の場合は理由をプラン末尾に記録 | [-] |

**settings.json テンプレート例**:
```json
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
      "Read(**)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Bash(rm -rf:*)"
    ],
    "defaultMode": "default"
  },
  "enableAllProjectMcpServers": true,
  "env": {
    "MAX_THINKING_TOKENS": "10000",
    "BASH_DEFAULT_TIMEOUT_MS": "30000",
    "MCP_TIMEOUT": "60000",
    "MCP_TOOL_TIMEOUT": "120000"
  }
}
```

**環境変数チューニングガイド**:
| 変数名 | 用途 | 推奨値 | 備考 |
|--------|------|--------|------|
| `MAX_THINKING_TOKENS` | 拡張思考のトークン予算 | 10000〜20000 | 複雑なタスクで有効、デフォルトは無効 |
| `BASH_DEFAULT_TIMEOUT_MS` | Bashコマンドのデフォルトタイムアウト | 30000 | 長時間実行コマンド用に調整 |
| `MCP_TIMEOUT` | MCPサーバー起動タイムアウト | 60000 | サーバー起動が遅い場合に延長 |
| `MCP_TOOL_TIMEOUT` | MCPツール実行タイムアウト | 120000 | 重いMCPツール用に延長 |
| `DISABLE_NON_ESSENTIAL_MODEL_CALLS` | フレーバーテキスト等の非必須呼び出し無効化 | 1 | コスト削減時に有効 |

### Phase 3: Hooks による自動化と環境永続化
**目標**: SessionStart/SessionEnd/PreCompact/PreToolUse フックを活用し、環境の自動設定・権限の自動処理・CLAUDE.mdの自動育成を実現する

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-014 | hooks ディレクトリを作成 | `/.claude/hooks/` | ディレクトリが存在 | [x] |
| TASK-015 | SessionStart フックで環境永続化を設定 | `/.claude/settings.json` | セッション開始時に環境変数が設定される | [x] |
| TASK-016 | PreToolUse フックで安全なコマンドを自動承認 | `/.claude/settings.json` | ドキュメントファイル読み取りが自動承認 | [x] |
| TASK-017 | 環境セットアップスクリプトを作成 | `/.claude/hooks/session-start.sh` | スクリプトが実行可能 | [x] |
| TASK-017b | SessionEnd/PreCompact フックで会話履歴分析を設定 | `/.claude/settings.json` | セッション終了時・コンテキスト圧縮前にCLAUDE.md更新提案が生成される | [-] |
| TASK-017c | suggest-claude-md スラッシュコマンドを作成 | `/.claude/commands/suggest-claude-md.md` | `/suggest-claude-md` でCLAUDE.md更新提案が可能 | [x] |
| TASK-017d | 会話履歴分析スクリプトを作成 | `/bin/suggest-claude-md-hook.sh` | スクリプトが実行可能、無限ループ対策済み | [-] |

**hooks 設定例（settings.json に追加）**:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bin/suggest-claude-md-hook.sh"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bin/suggest-claude-md-hook.sh"
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
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/auto-approve-docs.sh"
          }
        ]
      }
    ]
  }
}
```

**SessionEnd/PreCompact Hook のメリット**:
- セッション終了時・コンテキスト圧縮前に会話履歴を自動分析
- CLAUDE.md に追加すべきルールを自動提案
- Hookは別プロセスで実行されるため、既存のコンテキストウィンドウに影響しない
- チームの知識が自然と蓄積される

参考: [Zenn記事 - チームのCLAUDE.mdが勝手に育つ](https://zenn.dev/appbrew/articles/e2f38677f6a0ce)

**session-start.sh 例**:
```bash
#!/bin/bash
# セッション開始時の環境設定

if [ -n "$CLAUDE_ENV_FILE" ]; then
  # プロジェクト固有の環境変数を永続化
  echo 'export PROJECT_ROOT="$CLAUDE_PROJECT_DIR"' >> "$CLAUDE_ENV_FILE"
  
  # Node.js バージョン設定（nodenv使用時）
  if command -v nodenv &> /dev/null; then
    echo 'eval "$(nodenv init -)"' >> "$CLAUDE_ENV_FILE"
  fi
fi

exit 0
```

**auto-approve-docs.sh 例**:
```bash
#!/bin/bash
# ドキュメントファイルの読み取りを自動承認

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Markdown, テキスト, JSON ファイルは自動承認
if [[ "$file_path" =~ \.(md|mdx|txt|json)$ ]]; then
  echo '{"decision": "approve", "reason": "Documentation file auto-approved", "suppressOutput": true}'
  exit 0
fi

exit 0
```

### Phase 4: カスタムスラッシュコマンドの作成
**目標**: 頻繁に使用するプロンプトを再利用可能なコマンドとして定義

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-018 | commands ディレクトリを作成 | `/.claude/commands/` | ディレクトリが存在 | [x] |
| TASK-019 | /plan コマンドを作成 | `/.claude/commands/plan.md` | `/plan` でプラン作成が開始可能 | [x] |
| TASK-020 | /review-plan コマンドを作成 | `/.claude/commands/review-plan.md` | `/review-plan` でレビューが開始可能 | [x] |
| TASK-021 | /commit コマンドを作成 | `/.claude/commands/commit.md` | `/commit` でコミットメッセージ生成が可能 | [x] |
| TASK-022 | /doc コマンドを作成 | `/.claude/commands/doc.md` | `/doc` でドキュメント生成が開始可能 | [x] |

**コマンド例（commit.md）**:
```markdown
---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*)
description: 変更をコミットする
---

## コンテキスト
- 現在の変更: !`git diff HEAD`
- ステータス: !`git status`

## タスク
上記の変更に基づいて、日本語で適切なコミットメッセージを作成し、コミットを実行してください。

コミットメッセージ形式:
- 1行目: 変更の要約（50文字以内）
- 空行
- 本文: 変更の詳細（必要に応じて）
```

### Phase 5: カスタムサブエージェントの作成
**目標**: 専門的なタスクに特化したサブエージェントを作成し、効率的なタスク委譲を可能にする

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-023 | agents ディレクトリを作成 | `/.claude/agents/` | ディレクトリが存在 | [x] |
| TASK-024 | plan-creator サブエージェントを作成 | `/.claude/agents/plan-creator.md` | `/agents` で表示可能 (Tool Search検討) | [x] |
| TASK-025 | doc-writer サブエージェントを作成 | `/.claude/agents/doc-writer.md` | `/agents` で表示可能 | [x] |
| TASK-026 | code-reviewer サブエージェントを作成 | `/.claude/agents/code-reviewer.md` | `/agents` で表示可能 | [x] |

**サブエージェント例（plan-creator.md）**:
```markdown
---
name: plan-creator
description: 実行可能なプランを作成する専門エージェント。タスクの分析・設計・プラン策定を担当。
tools: Read, Grep, Glob, Bash, WebFetch
model: sonnet
---

あなたはプラン作成の専門家です。

## 役割
- タスクの目的を理解し、実行可能なプランを作成
- ベストプラクティスに基づいた設計
- 具体的なアクションアイテムへの分解

## ワークフロー
1. タスクの目的を明確化
2. 必要な情報を収集（コードベース、ドキュメント、外部リソース）
3. MCPツールを活用して最新情報を取得
4. 具体的なステップに分解
5. プランをMarkdown形式で出力

## 出力形式
- `ai/plans/YYMMDD_[概要].md` に保存
- テンプレート: @ai/templates/plan-template.md を参照
```

### Phase 6: ドキュメント更新と整合性確保
**目標**: 既存ドキュメントを更新し、新しい設定との整合性を確保

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-027 | claude-code-usage.md を更新 | `/docs/claude-code-usage.md` | 新機能（スラッシュコマンド、Hooks等）が記載 | [x] |
| TASK-028 | README.md に Claude Code セットアップ手順を追加 | `/README.md` | セットアップ手順が記載 | [-] |
| TASK-029 | .gitignore に .claude/settings.local.json を追加 | `/.gitignore` | ローカル設定が除外される | [x] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 確認 | `claude` コマンド実行後、`/memory` で CLAUDE.md が読み込まれていることを確認 | メモリファイルが表示される |
| TEST-002 | 確認 | `/plan` コマンドを実行し、プラン作成が開始されることを確認 | プランテンプレートに基づいた出力 |
| TEST-003 | 確認 | `/agents` で作成したサブエージェントが表示されることを確認 | 3つのサブエージェントが一覧に表示 |
| TEST-004 | 確認 | 権限設定が適用され、.env ファイルへのアクセスがブロックされることを確認 | アクセス拒否 |
| TEST-005 | 確認 | `git status` 等の安全なコマンドが確認なしで実行されることを確認 | 自動実行される |
| TEST-006 | 確認 | MCP サーバーが自動承認されることを確認 | 承認ダイアログなしで接続 |
| TEST-007 | 確認 | SessionStart フックが実行され環境変数が設定されることを確認 | `$PROJECT_ROOT` が設定される |
| TEST-008 | 確認 | 拡張思考が有効になっていることを確認（`think` プロンプトで確認） | 思考プロセスが表示される |
| TEST-009 | 確認 | Tool Search 調査結果がプラン末尾に記録されていることを確認（※適用可能な場合のみ挙動確認） | 調査結論が記載済み |
| TEST-010 | 確認 | セッション終了時またはコンテキスト圧縮前にCLAUDE.md更新提案が生成されることを確認 | 提案がターミナルに表示される |

## 5. 成功基準

- [x] CLAUDE.md が作成され、プロジェクトコンテキストが自動的に読み込まれる
- [x] .claude/settings.json で権限設定が機能している
- [x] 環境変数（MAX_THINKING_TOKENS 等）が設定され、拡張思考が有効
- [x] MCP サーバーがプロジェクト設定で自動承認される
- [x] SessionStart フックで環境が自動設定される
- [-] SessionEnd/PreCompact フックでCLAUDE.md更新提案が自動生成される（代替: /suggest-claude-md コマンドで手動実行可能）
- [x] カスタムスラッシュコマンド（/plan, /commit 等）が利用可能
- [x] カスタムサブエージェントが `/agents` で表示・利用可能
- [x] 既存ドキュメントが更新され、整合性が保たれている

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | CLAUDE.md の内容が多すぎてコンテキストを圧迫 | 中 | 中 | 簡潔に記載、@インポートで詳細は外部ファイルに |
| RISK-002 | 権限設定が厳しすぎて作業効率が低下 | 中 | 低 | 実際の使用に基づいて調整 |
| RISK-003 | カスタムコマンドが既存のワークフローと競合 | 低 | 低 | 命名を工夫し、既存コマンドと区別 |
| RISK-004 | Hooks スクリプトのエラーでセッション開始が失敗 | 高 | 低 | スクリプトは必ず exit 0 で終了、エラーハンドリング追加 |
| RISK-005 | 拡張思考トークン設定過大でコスト増加 | 中 | 中 | 初期値は控えめ（10000）に設定、必要に応じて調整 |
| RISK-006 | MCP 自動承認によるセキュリティリスク | 中 | 低 | プロジェクト固有のMCPサーバーのみ許可、定期的に見直し |
| RISK-007 | Tool Search (Beta) の動作不安定またはローカルCLI非対応 | 低 | 中 | 動作しない場合は無効化。影響範囲はサーバーサイド/バッチ処理に限定し、ローカルCLI利用には必須依存させない |

## 7. 次のアクション

1. **即座に開始**: Phase 1（CLAUDE.md の作成）を実行
2. **コア設定**: Phase 2（settings.json + 環境変数 + MCP承認）を実施
3. **自動化**: Phase 3（Hooks）を設定
4. **拡張機能**: Phase 4〜5（コマンド、サブエージェント）を順次実施
5. **ドキュメント整備**: Phase 6 で整合性を確保
6. **継続的改善**: 実際の使用に基づいて設定を調整

## 8. 参考リソース

- [Claude Code公式ドキュメント](https://code.claude.com/docs/en/)
- [メモリ管理](https://code.claude.com/docs/en/memory)
- [設定ファイル](https://code.claude.com/docs/en/settings)
- [スラッシュコマンド](https://code.claude.com/docs/en/slash-commands)
- [サブエージェント](https://code.claude.com/docs/en/sub-agents)
- [フック](https://code.claude.com/docs/en/hooks)
- [Tool Search Tool (Beta)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Zenn: チームのCLAUDE.mdが勝手に育つ](https://zenn.dev/appbrew/articles/e2f38677f6a0ce)

---

## 9. 調査メモ

### Tool Search Tool (Beta) 調査結果

**調査日**: 2025年12月03日  
**調査者**: GitHub Copilot (Claude Opus 4.5)  
**結論**: スキップ（優先度低、現在の構成では効果が限定的）

#### 調査観点
- [x] Claude Code CLI (`claude` コマンド) で Tool Search Tool を有効化できるか
- [x] `.claude/settings.json` で設定可能なオプションがあるか
- [-] MCP サーバーとの連携（`defer_loading` 等）がローカル環境で機能するか
- [x] 現在のツール数（約10〜20）で効果が見込めるか

#### 調査結果詳細
- Tool Search Tool はAPIレベルの機能であり、Claude Code CLIの settings.json での直接設定はサポートされていない
- この機能は主に多数のツール（100以上）を持つ大規模なシステムでコンテキスト消費を最適化するためのもの
- 現在のプロジェクトではMCPサーバーが4つ（msdocs, context7, github-mcp-server, serena）であり、ツール数は限定的
- ローカルCLI環境での有効化手順が公式ドキュメントで明確に示されていない

#### 結論と次のステップ
**見送り**: 現在の構成（少数のMCPサーバー）では効果が限定的。将来的にMCPサーバーやツール数が大幅に増加した場合に再検討する。

---

## 10. 実装完了レポート

**実装日**: 2025年12月03日  
**実装者**: GitHub Copilot (Claude Opus 4.5)

### 実装済み項目

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | CLAUDE.md の作成 | ✅ 完了（既存ファイルを確認） |
| Phase 2 | settings.json の設定 | ✅ 完了（Hooks設定を追加） |
| Phase 3 | Hooks スクリプト | ✅ 完了（session-start.sh, auto-approve-docs.sh） |
| Phase 4 | スラッシュコマンド | ✅ 完了（/plan, /commit, /review-plan, /doc, /suggest-claude-md） |
| Phase 5 | サブエージェント | ✅ 完了（plan-creator, doc-writer, code-reviewer） |
| Phase 6 | ドキュメント更新 | ✅ 完了（claude-code-usage.md, .gitignore） |

### スキップ項目
- TASK-013b: Tool Search (Beta) - 優先度低のため調査のみ実施
- TASK-017b/d: SessionEnd/PreCompact 自動フック - 代替として /suggest-claude-md コマンドを提供
- TASK-028: README.md 更新 - 既存ドキュメントで十分カバー

### 作成・更新ファイル一覧
- `/.claude/settings.json` - Hooks設定を追加
- `/.claude/hooks/session-start.sh` - リネーム済み
- `/.claude/hooks/auto-approve-docs.sh` - 新規作成
- `/.claude/commands/review-plan.md` - 新規作成
- `/.claude/commands/doc.md` - 新規作成
- `/.claude/commands/suggest-claude-md.md` - 新規作成
- `/docs/claude-code-usage.md` - 新機能ドキュメント追加
- `/.gitignore` - ローカル設定除外を追加