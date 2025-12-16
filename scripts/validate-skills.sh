#!/bin/bash
# Skills静的検証スクリプト
#
# このスクリプトは以下をチェックします:
# 1. SKILL.mdのfrontmatter（name, description）の存在
# 2. REFERENCE.mdリンクがある場合、ファイルの存在

set -e

SKILLS_DIR=".claude/skills"
EXIT_CODE=0

echo "=== Skills静的検証 ==="
echo ""

# 全SKILL.mdを検索
SKILL_FILES=$(find "$SKILLS_DIR" -type f -name "SKILL.md" 2>/dev/null || true)

if [ -z "$SKILL_FILES" ]; then
    echo "❌ エラー: SKILL.mdファイルが見つかりません"
    exit 1
fi

# 各SKILL.mdをチェック
while IFS= read -r skill_file; do
    echo "チェック中: $skill_file"
    SKILL_DIR=$(dirname "$skill_file")

    # frontmatterのチェック
    HAS_FRONTMATTER=$(head -n 5 "$skill_file" | grep -c "^---$" || true)
    if [ "$HAS_FRONTMATTER" -lt 2 ]; then
        echo "  ❌ エラー: frontmatterが見つかりません"
        EXIT_CODE=1
    else
        # nameのチェック
        HAS_NAME=$(grep -E "^name:" "$skill_file" || true)
        if [ -z "$HAS_NAME" ]; then
            echo "  ❌ エラー: frontmatterにnameが見つかりません"
            EXIT_CODE=1
        else
            echo "  ✅ frontmatter: name"
        fi

        # descriptionのチェック
        HAS_DESCRIPTION=$(grep -E "^description:" "$skill_file" || true)
        if [ -z "$HAS_DESCRIPTION" ]; then
            echo "  ❌ エラー: frontmatterにdescriptionが見つかりません"
            EXIT_CODE=1
        else
            echo "  ✅ frontmatter: description"
        fi
    fi

    # REFERENCE.mdリンクのチェック
    HAS_REFERENCE_LINK=$(grep -c "REFERENCE.md" "$skill_file" || true)
    if [ "$HAS_REFERENCE_LINK" -gt 0 ]; then
        REFERENCE_FILE="$SKILL_DIR/REFERENCE.md"
        if [ -f "$REFERENCE_FILE" ]; then
            echo "  ✅ REFERENCE.md: 存在"
        else
            echo "  ❌ エラー: REFERENCE.mdへのリンクがありますが、ファイルが存在しません"
            EXIT_CODE=1
        fi
    else
        echo "  ⚪ REFERENCE.md: リンクなし（オプション）"
    fi

    echo ""
done <<< "$SKILL_FILES"

if [ $EXIT_CODE -eq 0 ]; then
    echo "=== ✅ すべての検証に合格しました ==="
else
    echo "=== ❌ 検証に失敗しました ==="
fi

exit $EXIT_CODE
