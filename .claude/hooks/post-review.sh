#!/bin/bash
# post-review.sh
# レビュー完了後の自動保存フック

set -e

REVIEW_OUTPUT_DIR="ai/reviews"
METRICS_OUTPUT_DIR="ai/review-metrics"

# ディレクトリ存在確認・作成
mkdir -p "$REVIEW_OUTPUT_DIR"
mkdir -p "$METRICS_OUTPUT_DIR"

# タイムスタンプ生成
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "========================================="
echo "PR Review Post-Processing Hook"
echo "========================================="
echo "Timestamp: $TIMESTAMP"
echo "Review Output Dir: $REVIEW_OUTPUT_DIR"
echo "Metrics Output Dir: $METRICS_OUTPUT_DIR"
echo ""

# レビュー結果ファイル数を確認
REVIEW_FILES=$(find "$REVIEW_OUTPUT_DIR" -name "review_*.md" 2>/dev/null | wc -l)
METRICS_FILES=$(find "$METRICS_OUTPUT_DIR" -name "review_*.json" 2>/dev/null | wc -l)

echo "📊 Current Status:"
echo "  - Review files: $REVIEW_FILES"
echo "  - Metrics files: $METRICS_FILES"
echo ""

# 最新のレビュー結果を表示（存在する場合）
LATEST_REVIEW=$(find "$REVIEW_OUTPUT_DIR" -name "review_*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -f2- -d" ")
if [ -n "$LATEST_REVIEW" ]; then
  echo "📝 Latest Review: $(basename "$LATEST_REVIEW")"
  echo "   Path: $LATEST_REVIEW"
fi

# 最新の計測データを表示（存在する場合）
LATEST_METRICS=$(find "$METRICS_OUTPUT_DIR" -name "review_*.json" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -f2- -d" ")
if [ -n "$LATEST_METRICS" ]; then
  echo "📈 Latest Metrics: $(basename "$LATEST_METRICS")"
  echo "   Path: $LATEST_METRICS"

  # エビデンス付与率を表示（jqが利用可能な場合）
  if command -v jq &> /dev/null; then
    EVIDENCE_RATIO=$(jq -r '.metrics.evidence_ratio // "N/A"' "$LATEST_METRICS" 2>/dev/null)
    TOTAL_FINDINGS=$(jq -r '.metrics.total_findings // "N/A"' "$LATEST_METRICS" 2>/dev/null)
    WORKFLOW=$(jq -r '.workflow // "N/A"' "$LATEST_METRICS" 2>/dev/null)

    echo ""
    echo "📊 Metrics Summary:"
    echo "  - Workflow: $WORKFLOW"
    echo "  - Total Findings: $TOTAL_FINDINGS"
    echo "  - Evidence Ratio: $EVIDENCE_RATIO"
  fi
fi

echo ""
echo "========================================="
echo "Post-processing completed successfully"
echo "========================================="

exit 0
