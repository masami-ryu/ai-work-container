# レビュー計測データ仕様

## 概要

このディレクトリには、Pull Requestレビューの品質と効率性を計測するためのデータを保存します。

## データフォーマット

各レビュー結果は以下のJSON形式で保存されます:

### ファイル命名規則

```
review_<PR番号>_<日付YYYYMMDD>_<時刻HHmmss>.json
```

例: `review_123_20251202_143000.json`

### JSON構造

```json
{
  "pr_number": 123,
  "review_date": "2025-12-02T14:30:00Z",
  "pr_size": "small|medium|large",
  "changed_files": 3,
  "diff_lines": 150,
  "workflow": "quick|standard|deep",
  "review_duration_sec": 180,
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "code_quality|security|performance|testing|design",
      "has_evidence": true,
      "evidence_url": "https://docs.microsoft.com/...",
      "has_code_example": true,
      "has_impact_analysis": true
    }
  ],
  "metrics": {
    "total_findings": 5,
    "findings_with_evidence": 4,
    "evidence_ratio": 0.80,
    "mcp_calls": {
      "serena": 3,
      "msdocs": 1,
      "context7": 2
    },
    "errors": []
  },
  "phases": {
    "context_understanding": {
      "completed": true,
      "duration_sec": 45,
      "symbols_analyzed": 12,
      "dependencies_found": 8
    },
    "best_practices": {
      "completed": true,
      "duration_sec": 30,
      "docs_found": 2,
      "examples_found": 3
    },
    "project_context": {
      "completed": true,
      "duration_sec": 15,
      "memories_used": 1,
      "codeowners_checked": true
    },
    "integration": {
      "completed": true,
      "duration_sec": 60
    },
    "quality_check": {
      "completed": true,
      "duration_sec": 30,
      "checklist_items": 5,
      "checklist_passed": 5
    }
  }
}
```

## フィールド説明

### 基本情報
- `pr_number`: PRの番号
- `review_date`: レビュー実施日時（ISO 8601形式）
- `pr_size`: PRの規模（small/medium/large）
- `changed_files`: 変更ファイル数
- `diff_lines`: 差分行数
- `workflow`: 使用したワークフロー（quick/standard/deep）
- `review_duration_sec`: レビュー全体の所要時間（秒）

### 指摘事項（findings）
- `severity`: 重要度（high/medium/low）
- `category`: カテゴリ（code_quality/security/performance/testing/design）
- `has_evidence`: エビデンス（参照URL）があるか
- `evidence_url`: 参照したドキュメントのURL
- `has_code_example`: コード例を含むか
- `has_impact_analysis`: 影響範囲分析を含むか

### 計測指標（metrics）
- `total_findings`: 指摘事項の総数
- `findings_with_evidence`: エビデンス付き指摘の数
- `evidence_ratio`: エビデンス付き指摘の割合（0.0～1.0）
- `mcp_calls`: 各MCPツールの呼び出し回数
  - `serena`: Serena MCPの呼び出し回数
  - `msdocs`: msdocs MCPの呼び出し回数
  - `context7`: context7 MCPの呼び出し回数
- `errors`: エラーが発生した場合のリスト

### フェーズ情報（phases）
各フェーズの実行結果と所要時間を記録:
- `context_understanding`: コンテキスト理解フェーズ
- `best_practices`: ベストプラクティス参照フェーズ
- `project_context`: プロジェクトコンテキストフェーズ
- `integration`: 統合評価フェーズ
- `quality_check`: 品質検証フェーズ

## 週次集計

週次で以下のコマンドを実行し、レビュー品質を評価します:

```bash
# 過去7日間のレビューデータを集計
find ai/review-metrics/*.json -mtime -7 | xargs jq -s '
  {
    total_reviews: length,
    avg_evidence_ratio: (map(.metrics.evidence_ratio) | add / length),
    error_rate: (map(.metrics.errors | length) | add) / length,
    avg_duration_sec: (map(.review_duration_sec) | add / length),
    workflow_distribution: group_by(.workflow) | map({key: .[0].workflow, value: length}) | from_entries,
    phase_performance: {
      context_understanding: (map(.phases.context_understanding.duration_sec) | add / length),
      best_practices: (map(.phases.best_practices.duration_sec) | add / length),
      project_context: (map(.phases.project_context.duration_sec) | add / length),
      integration: (map(.phases.integration.duration_sec) | add / length),
      quality_check: (map(.phases.quality_check.duration_sec) | add / length)
    }
  }
'
```

## 品質目標

- **エビデンス比率**: 80%以上（指摘の80%以上がエビデンス付き）
- **エラー率**: 5%以下
- **レビュー時間**: 従来比130%以内
- **フェーズ完了率**: 各フェーズ95%以上

## データ保持期間

- 90日間のデータを保持
- 古いデータは四半期ごとにアーカイブ

## プライバシー

- コードスニペットや機密情報は含めない
- 統計情報のみを記録
