---
name: review
description: PRをレビューする（PR番号またはURLを指定）
allowed-tools: Read, Grep, Glob, Write, Bash, mcp__context7, mcp__msdocs, mcp__github-mcp-server, mcp__serena
model: opus
argument-hint: PR番号またはURL（例: "#123" または "https://github.com/owner/repo/pull/123"）
---

## コンテキスト
- プロジェクト: @CLAUDE.md
- エージェント定義: @.claude/agents/pr-reviewer.md
- 出力先: ai/reviews/

## タスク
以下のステップでPRレビューを実施:

### 1. PR情報取得
引数から PR番号/URLを抽出し、GitHub MCP で PR 情報を取得します。

**PR番号の抽出ロジック**:
- `#123` 形式の場合: 123を抽出
- `https://github.com/owner/repo/pull/123` 形式の場合: owner, repo, 123を抽出
- 数字のみの場合: そのまま使用

**GitHub MCP呼び出し**:
```
mcp__github-mcp-server__pull_request_read
  method: "get"
  owner: [抽出したowner]
  repo: [抽出したrepo]
  pullNumber: [抽出したPR番号]
```

### 2. ワークフロー選択
変更規模に応じて適切なワークフローを選択:

**判定基準**:
- **Quick Review**: 変更ファイル数 1-5、差分 200行以下
- **Standard Review**: 変更ファイル数 6-20、差分 201-800行
- **Deep Review**: 変更ファイル数 21以上、差分 800行以上

**PR差分の取得**:
```
mcp__github-mcp-server__pull_request_read
  method: "get_diff"
  owner: [owner]
  repo: [repo]
  pullNumber: [PR番号]
```

または、`gh pr diff [PR番号]` コマンドを使用

### 3. 段階的レビュー
pr-reviewer エージェントの5フェーズプロセスを実行:

#### Phase 1: 初期分析
- git diff / git log で変更内容とコミット履歴を取得
- 変更ファイル一覧を確認
- 変更規模を判定しワークフローを選択

#### Phase 2: 詳細分析
- Serena MCP の `get_symbols_overview` で変更ファイルの構造を把握
- `find_symbol` で変更シンボルを特定
- `find_referencing_symbols` で依存関係を追跡

**重要**: Serena MCPが失敗した場合:
1. エラーをログに記録
2. フォールバック: `Read` ツールでファイル全体を読み取り
3. `Grep` ツールで依存関係を追跡
4. レビュー続行

#### Phase 3: ベストプラクティス参照
- 使用技術を特定（フレームワーク、ライブラリ）
- `mcp__msdocs__microsoft_docs_search` で公式ドキュメントを検索
- `mcp__context7__get-library-docs` でコード例を検索
- CLAUDE.md からプロジェクトガイドラインを確認

**重要**: MCP失敗時は一般的なベストプラクティスを適用し、エビデンスなしとして記録

#### Phase 4: 統合評価
- 収集した情報を統合
- ワークフローに応じた観点でレビュー実施
- 各指摘にエビデンスを付与（目標: 80%以上）

#### Phase 5: 品質検証
- 自己検証チェックリスト実行
- レビュー結果と計測データを保存

### 4. 結果出力
**レビュー結果**: `ai/reviews/review_PR[番号]_[YYYYMMDD].md` に保存

**出力フォーマット**:
```markdown
# PR Review: [PRタイトル]

## 概要
- PR番号: #[番号]
- PR URL: [URL]
- 変更ファイル数: X
- 差分行数: X
- レビュータイプ: Quick/Standard/Deep Review
- レビュー日時: YYYY-MM-DD HH:mm:ss

## フェーズ実行結果
- ✅ Phase 1: 初期分析
- ✅ Phase 2: 詳細分析
- ✅ Phase 3: ベストプラクティス参照
- ✅ Phase 4: 統合評価
- ✅ Phase 5: 品質検証

[pr-reviewer.md の出力フォーマットに従う]
```

### 5. 計測データ保存
**計測データ**: `ai/review-metrics/review_[PR番号]_[YYYYMMDD]_[HHmmss].json` に保存

**JSONフォーマット**:
```json
{
  "pr_number": 123,
  "pr_url": "https://github.com/owner/repo/pull/123",
  "review_date": "2025-12-10T10:30:00Z",
  "pr_size": "small|medium|large",
  "workflow": "quick|standard|deep",
  "changed_files": 3,
  "diff_lines": 150,
  "review_duration_sec": 180,
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "code_quality|security|performance|test|design",
      "has_evidence": true,
      "evidence_url": "https://..."
    }
  ],
  "metrics": {
    "total_findings": 5,
    "findings_with_evidence": 4,
    "evidence_ratio": 0.80,
    "mcp_calls": {
      "serena": 3,
      "msdocs": 1,
      "context7": 2,
      "github": 5
    },
    "timeouts": {
      "serena_ms": 30000,
      "msdocs_ms": 20000,
      "context7_ms": 20000,
      "github_ms": 30000
    },
    "errors": [
      {
        "source": "serena|msdocs|context7|github",
        "code": "TIMEOUT|CONNECTION_ERROR|AUTH_ERROR|UNKNOWN",
        "message": "エラーの詳細説明",
        "fallback_used": true,
        "fallback_method": "Read|Grep|gh_cli|general_best_practice",
        "timestamp": "2025-12-10T10:31:00Z",
        "duration_ms": 30500
      }
    ]
  }
}
```

## タイムアウト設定
- Serena MCP各呼び出し: 30秒
- msdocs/context7検索: 20秒
- GitHub MCP呼び出し: 30秒
- 全体レビュー: Quick 5分 / Standard 15分 / Deep 30分

## 注意事項
- GitHub MCP失敗時は `gh` CLIコマンドにフォールバック
- エラーは必ず計測データに記録すること
- エビデンス付与率80%以上を目標とすること
