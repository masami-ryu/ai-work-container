# レビュー計測データ

このディレクトリには、PRレビューエージェントが出力する計測データをJSON形式で保存します。

## 目的

- レビュー品質の可視化
- エビデンス付与率の追跡
- MCP呼び出しのパフォーマンス分析
- エラー発生状況の監視

## フォーマット仕様

### ファイル命名規則

```
review_<PR番号>_<YYYYMMDD>_<HHmmss>.json
```

**例**: `review_123_20251210_103045.json`

### JSON構造

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
      "evidence_url": "https://learn.microsoft.com/..."
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

## フィールド説明

### トップレベル

| フィールド | 型 | 説明 |
|----------|-----|------|
| `pr_number` | number | PR番号 |
| `pr_url` | string | PR URL |
| `review_date` | string (ISO 8601) | レビュー実施日時 |
| `pr_size` | string | PR規模（small/medium/large） |
| `workflow` | string | 選択されたワークフロー（quick/standard/deep） |
| `changed_files` | number | 変更ファイル数 |
| `diff_lines` | number | 差分行数（追加+削除） |
| `review_duration_sec` | number | レビュー所要時間（秒） |

### findings（指摘事項）

| フィールド | 型 | 説明 |
|----------|-----|------|
| `severity` | string | 重要度（high/medium/low） |
| `category` | string | カテゴリ（code_quality/security/performance/test/design） |
| `has_evidence` | boolean | エビデンスが付与されているか |
| `evidence_url` | string | エビデンスURL（公式ドキュメント、コード例など） |

### metrics.mcp_calls（MCP呼び出し回数）

| フィールド | 型 | 説明 |
|----------|-----|------|
| `serena` | number | Serena MCP呼び出し回数 |
| `msdocs` | number | Microsoft Docs MCP呼び出し回数 |
| `context7` | number | Context7 MCP呼び出し回数 |
| `github` | number | GitHub MCP呼び出し回数 |

### metrics.timeouts（タイムアウト設定）

| フィールド | 型 | 説明 |
|----------|-----|------|
| `serena_ms` | number | Serena MCPのタイムアウト（ミリ秒） |
| `msdocs_ms` | number | msdocs MCPのタイムアウト（ミリ秒） |
| `context7_ms` | number | context7 MCPのタイムアウト（ミリ秒） |
| `github_ms` | number | GitHub MCPのタイムアウト（ミリ秒） |

### metrics.errors（エラー記録）

| フィールド | 型 | 説明 |
|----------|-----|------|
| `source` | string | エラー発生元（serena/msdocs/context7/github） |
| `code` | string | エラーコード（TIMEOUT/CONNECTION_ERROR/AUTH_ERROR/UNKNOWN） |
| `message` | string | エラーメッセージ |
| `fallback_used` | boolean | フォールバックが使用されたか |
| `fallback_method` | string | 使用されたフォールバック方法 |
| `timestamp` | string (ISO 8601) | エラー発生日時 |
| `duration_ms` | number | エラーまでの処理時間（ミリ秒） |

## 品質指標

### エビデンス付与率

```
evidence_ratio = findings_with_evidence / total_findings
```

**目標**: 80%以上

### レビュー時間目標

- **Quick Review**: 5分以内
- **Standard Review**: 15分以内
- **Deep Review**: 30分以内

## 分析例

### エビデンス付与率の推移

```bash
# 全JSONファイルからエビデンス付与率を抽出
jq -r '.metrics.evidence_ratio' ai/review-metrics/*.json

# 平均値を計算
jq -s 'map(.metrics.evidence_ratio) | add / length' ai/review-metrics/*.json
```

### MCP呼び出し回数の集計

```bash
# Serena MCP呼び出し回数の合計
jq -s 'map(.metrics.mcp_calls.serena) | add' ai/review-metrics/*.json
```

### エラー発生頻度

```bash
# エラーが発生したレビューの数
jq -s 'map(select(.metrics.errors | length > 0)) | length' ai/review-metrics/*.json
```

## データ保持期間

- 計測データは無期限保持
- 古いデータは手動で削除してください
- 定期的に分析し、レビュー品質の改善に活用してください

## 注意事項

- このディレクトリのJSONファイルは**自動生成**されます
- 手動でJSONファイルを編集しないでください
- 計測データはGitにコミットすることを推奨します（品質追跡のため）
