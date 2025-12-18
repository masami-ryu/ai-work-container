#!/bin/bash
# post-review.sh
# レビュー完了後の自動保存フック

set -e          # Exit on error
set -u          # Exit on undefined variable
set -o pipefail # Exit on pipe failure

REVIEW_OUTPUT_DIR="ai/reviews"

# ディレクトリ存在確認・作成
mkdir -p "$REVIEW_OUTPUT_DIR"

# タイムスタンプ生成
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "========================================="
echo "PR Review Post-Processing Hook"
echo "========================================="
echo "Timestamp: $TIMESTAMP"
echo "Review Output Dir: $REVIEW_OUTPUT_DIR"
echo ""

# レビュー結果ファイル数を確認
REVIEW_FILES=$(find "$REVIEW_OUTPUT_DIR" -name "review_*.md" 2>/dev/null | wc -l)

echo "📊 Current Status:"
echo "  - Review files: $REVIEW_FILES"
echo ""

# 最新のレビュー結果を表示（存在する場合）
LATEST_REVIEW=$(find "$REVIEW_OUTPUT_DIR" -name "review_*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -f2- -d" ")
if [ -n "$LATEST_REVIEW" ]; then
  echo "📝 Latest Review: $(basename "$LATEST_REVIEW")"
  echo "   Path: $LATEST_REVIEW"
fi

echo ""
echo "========================================="
echo "Post-processing completed successfully"
echo "========================================="

exit 0
