#!/usr/bin/env bash
# .devcontainer/setup-tmp-symlinks.sh
set -euo pipefail

# ======================================
# 設定値
# ======================================
WORKS_DIR="/workspaces/ai-work-container/works"
TMP_BASE="/workspaces/tmp"

# 検出対象パターン（優先度高・中: 必須）
PRIORITY_HIGH_MID=(
  "node_modules"
  ".pnpm-store"
  "dist"
  "out"
  ".next"
)

# 検出対象パターン（優先度低: 任意）
PRIORITY_LOW=(
  ".cache"
  "build"
  ".turbo"
)

# デフォルトは優先度高・中のみ、--all オプションで全パターンを対象とする
TARGET_PATTERNS=("${PRIORITY_HIGH_MID[@]}")

# ======================================
# フラグ
# ======================================
DRY_RUN=false
VERBOSE=false
DELETE_EXISTING=false
INCLUDE_LOW_PRIORITY=false

# ======================================
# ヘルプメッセージ
# ======================================
show_help() {
  cat << EOF
使用方法: $(basename "$0") [オプション]

works/ 配下の一時ディレクトリを検出し、/workspaces/tmp にシンボリックリンクを作成します。

オプション:
  --dry-run               実際の変更を行わず、実行内容のみ表示
  --verbose               詳細なログを出力
  --delete-existing       既存の実ディレクトリを削除（デフォルトは .bak-<timestamp> へ退避）
  --all                   優先度低のパターン（.cache, build, .turbo）も含める
  -h, --help              このヘルプメッセージを表示

検出対象パターン:
  優先度高・中（デフォルト）: ${PRIORITY_HIGH_MID[*]}
  優先度低（--all 指定時）:   ${PRIORITY_LOW[*]}

例:
  $(basename "$0")                    # 優先度高・中のみ、デフォルト動作
  $(basename "$0") --dry-run          # ドライランモード
  $(basename "$0") --all              # 全パターンを対象
  $(basename "$0") --delete-existing  # 既存ディレクトリを削除
EOF
}

# ======================================
# コマンドライン引数の解析
# ======================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --delete-existing)
      DELETE_EXISTING=true
      shift
      ;;
    --all)
      INCLUDE_LOW_PRIORITY=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "エラー: 不明なオプション: $1" >&2
      show_help
      exit 1
      ;;
  esac
done

# 優先度低のパターンを含める場合
if [ "$INCLUDE_LOW_PRIORITY" = true ]; then
  TARGET_PATTERNS+=("${PRIORITY_LOW[@]}")
fi

# ======================================
# ログ関数
# ======================================
log_info() {
  echo "[$(date)] ℹ $*"
}

log_success() {
  echo "[$(date)] ✓ $*"
}

log_warning() {
  echo "[$(date)] ⚠ $*" >&2
}

log_error() {
  echo "[$(date)] ✗ ERROR: $*" >&2
}

log_verbose() {
  if [ "$VERBOSE" = true ]; then
    echo "[$(date)] [VERBOSE] $*"
  fi
}

# ======================================
# メイン処理
# ======================================
log_info "シンボリックリンク自動化スクリプトを開始します"

if [ "$DRY_RUN" = true ]; then
  log_info "ドライランモード: 実際の変更は行いません"
fi

# works/ ディレクトリの存在確認
if [ ! -d "$WORKS_DIR" ]; then
  log_warning "works/ ディレクトリが存在しません: $WORKS_DIR"
  log_info "スキップします"
  exit 0
fi

# /workspaces/tmp の存在確認
if [ ! -d "$TMP_BASE" ]; then
  log_error "/workspaces/tmp が存在しません。init-tmp-volume.sh を先に実行してください"
  exit 1
fi

# /workspaces/tmp/works/ ディレクトリを作成
TMP_WORKS_DIR="$TMP_BASE/works"
if [ ! -d "$TMP_WORKS_DIR" ]; then
  log_info "$TMP_WORKS_DIR を作成します"
  if [ "$DRY_RUN" = false ]; then
    mkdir -p "$TMP_WORKS_DIR"
    log_success "$TMP_WORKS_DIR を作成しました"
  fi
else
  log_verbose "$TMP_WORKS_DIR は既に存在します"
fi

# 処理したディレクトリ数のカウンタ
PROCESSED_COUNT=0
SKIPPED_COUNT=0
ERROR_COUNT=0

# 各パターンについて検索
for PATTERN in "${TARGET_PATTERNS[@]}"; do
  log_info "パターン '$PATTERN' を検索中..."

  # find で検出（-prune で node_modules 配下を探索しない - REQ-012）
  # works/ 直下の node_modules は検出するが、その配下は探索しない
  # -type d -o -type l でディレクトリとシンボリックリンクの両方を検出
  # パイプラインのエラーを一時的に無視するため set +e を使用
  set +e
  while IFS= read -r -d '' DIR_PATH; do
    # シンボリックリンクの場合、リンク先がディレクトリであることを確認
    if [ -L "$DIR_PATH" ] && [ ! -d "$DIR_PATH" ]; then
      # 壊れたシンボリックリンクの場合（REQ-008）
      log_warning "壊れたシンボリックリンクを検出: $DIR_PATH"
      log_warning "スキップします（手動で削除してください）"
      ((SKIPPED_COUNT++))
      continue
    fi

    log_verbose "検出: $DIR_PATH"

    # works/ からの相対パスを取得
    REL_PATH="${DIR_PATH#$WORKS_DIR/}"

    # /workspaces/tmp/works/ 配下のミラーパスを生成
    LINK_TARGET="$TMP_WORKS_DIR/$REL_PATH"
    LINK_TARGET_DIR="$(dirname "$LINK_TARGET")"

    log_verbose "  相対パス: $REL_PATH"
    log_verbose "  リンク先: $LINK_TARGET"

    # リンク先の親ディレクトリを作成
    if [ ! -d "$LINK_TARGET_DIR" ]; then
      log_verbose "  リンク先の親ディレクトリを作成: $LINK_TARGET_DIR"
      if [ "$DRY_RUN" = false ]; then
        mkdir -p "$LINK_TARGET_DIR"
      fi
    fi

    # 既存の状態を確認
    if [ -L "$DIR_PATH" ]; then
      # 既にシンボリックリンクの場合
      CURRENT_TARGET=$(readlink -f "$DIR_PATH" 2>/dev/null || echo "")
      EXPECTED_TARGET=$(readlink -f "$LINK_TARGET" 2>/dev/null || echo "$LINK_TARGET")

      if [ "$CURRENT_TARGET" = "$EXPECTED_TARGET" ]; then
        log_verbose "  既に正しいシンボリックリンクです: $DIR_PATH -> $CURRENT_TARGET"
        ((SKIPPED_COUNT++))
        continue
      else
        # 想定外のリンク先の場合（REQ-008）
        log_warning "想定外のリンク先: $DIR_PATH -> $CURRENT_TARGET (想定: $EXPECTED_TARGET)"
        log_warning "スキップします"
        ((SKIPPED_COUNT++))
        continue
      fi
    elif [ -e "$DIR_PATH" ] && [ ! -L "$DIR_PATH" ]; then
      # 実ディレクトリの場合
      log_info "実ディレクトリを検出: $DIR_PATH"

      if [ "$DELETE_EXISTING" = true ]; then
        # 削除モード（REQ-009）
        log_info "  既存ディレクトリを削除します"
        if [ "$DRY_RUN" = false ]; then
          rm -rf "$DIR_PATH"
          log_success "  削除しました: $DIR_PATH"
        fi
      else
        # 退避モード（デフォルト - REQ-009）
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_PATH="${DIR_PATH}.bak-${TIMESTAMP}"
        log_info "  既存ディレクトリを退避します: $BACKUP_PATH"
        if [ "$DRY_RUN" = false ]; then
          mv "$DIR_PATH" "$BACKUP_PATH"
          log_success "  退避しました: $DIR_PATH -> $BACKUP_PATH"
        fi
      fi
    elif [ -L "$DIR_PATH" ] && [ ! -e "$DIR_PATH" ]; then
      # 壊れたシンボリックリンクの場合（REQ-008）
      log_warning "壊れたシンボリックリンクを検出: $DIR_PATH"
      log_warning "スキップします（手動で削除してください）"
      ((SKIPPED_COUNT++))
      continue
    fi

    # /workspaces/tmp 配下にリンク先ディレクトリを作成
    if [ ! -d "$LINK_TARGET" ]; then
      log_verbose "  リンク先ディレクトリを作成: $LINK_TARGET"
      if [ "$DRY_RUN" = false ]; then
        mkdir -p "$LINK_TARGET"
      fi
    fi

    # シンボリックリンクを作成
    log_info "シンボリックリンクを作成: $DIR_PATH -> $LINK_TARGET"
    if [ "$DRY_RUN" = false ]; then
      if ln -s "$LINK_TARGET" "$DIR_PATH"; then
        log_success "作成成功: $DIR_PATH"
        ((PROCESSED_COUNT++))
      else
        log_error "作成失敗: $DIR_PATH"
        ((ERROR_COUNT++))
      fi
    else
      ((PROCESSED_COUNT++))
    fi

  done < <(find "$WORKS_DIR" \( -type d -o -type l \) \( -name "$PATTERN" -o -name node_modules -prune \) -print0 2>/dev/null | grep -z "/$PATTERN$" || true)
  set -e
done

# ======================================
# サマリー
# ======================================
log_info "================================================"
log_info "処理完了"
log_info "  処理済み: $PROCESSED_COUNT"
log_info "  スキップ: $SKIPPED_COUNT"
log_info "  エラー:   $ERROR_COUNT"
log_info "================================================"

if [ "$DRY_RUN" = true ]; then
  log_info "ドライランモードのため、実際の変更は行われていません"
  log_info "実際に変更を適用するには、--dry-run オプションを外して再実行してください"
fi

# エラーがあった場合は終了コード1
if [ "$ERROR_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
