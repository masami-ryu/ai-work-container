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

# find で除外するディレクトリ（パフォーマンス最適化 - GUD-003）
# 注意: .git は除外しない（プロジェクト検出に必要）
PRUNE_DIRS=(
  "node_modules"
  ".pnpm-store"
  "dist"
  "out"
  ".next"
  ".cache"
  "build"
  ".turbo"
)

# プロジェクトタイプ判定用パターン
declare -A PROJECT_TYPE_PATTERNS=(
  ["pnpm"]="pnpm-lock.yaml"
  ["yarn"]="yarn.lock"
  ["npm"]="package-lock.json"
  ["typescript"]="tsconfig.json"
  ["nextjs"]="next.config.js next.config.ts next.config.mjs"
  ["vite"]="vite.config.js vite.config.ts"
)

# プロジェクトタイプごとの対象ディレクトリ
declare -A TYPE_TARGET_DIRS=(
  ["pnpm"]="node_modules .pnpm-store"
  ["yarn"]="node_modules"
  ["npm"]="node_modules"
  ["typescript"]="dist out"
  ["nextjs"]=".next out"
  ["vite"]="dist"
)

# package manager の優先順位（GUD-004）
PKG_MANAGER_PRIORITY=("pnpm" "yarn" "npm")

# ======================================
# フラグ
# ======================================
DRY_RUN=false
VERBOSE=false
DELETE_EXISTING=false
INCLUDE_LOW_PRIORITY=false
PREVENTIVE_MODE=false

# ======================================
# ヘルプメッセージ
# ======================================
show_help() {
  cat << EOF
使用方法: $(basename "$0") [オプション]

works/ 配下の一時ディレクトリを検出し、/workspaces/tmp にシンボリックリンクを作成します。

オプション:
  --preventive            プロジェクトパターンを検出して予防的にシンボリックリンクを作成
  --dry-run               実際の変更を行わず、実行内容のみ表示
  --verbose               詳細なログを出力
  --delete-existing       既存の実ディレクトリを削除（デフォルトは .bak-<timestamp> へ退避）
  --all                   優先度低のパターン（.cache, build, .turbo）も含める
  -h, --help              このヘルプメッセージを表示

予防的作成モード:
  --preventive オプションを使用すると、.git ディレクトリの存在でプロジェクトルートを
  検出し、プロジェクトタイプに応じてまだディレクトリが存在しない場合でも
  シンボリックリンクを予防的に作成します。

  検出されるプロジェクトタイプと作成されるシンボリックリンク:
    - pnpm (pnpm-lock.yaml): node_modules, .pnpm-store ※優先度最高
    - Yarn (yarn.lock): node_modules ※pnpm がない場合
    - npm (package-lock.json): node_modules ※pnpm/yarn がない場合
    - TypeScript (tsconfig.json): dist, out
    - Next.js (next.config.js): .next, out
    - Vite (vite.config.js): dist

検出対象パターン:
  優先度高・中（デフォルト）: ${PRIORITY_HIGH_MID[*]}
  優先度低（--all 指定時）:   ${PRIORITY_LOW[*]}

例:
  $(basename "$0")                        # 既存ディレクトリのみを対象
  $(basename "$0") --preventive           # 予防的作成モードを有効化
  $(basename "$0") --preventive --dry-run # 予防的作成のドライラン
  $(basename "$0") --all --preventive     # 全パターン + 予防的作成
EOF
}

# ======================================
# コマンドライン引数の解析
# ======================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preventive)
      PREVENTIVE_MODE=true
      shift
      ;;
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
# プロジェクト検出関数
# ======================================

# プロジェクトディレクトリを検出（.git ベース - REQ-009）
find_project_directories() {
  local base_dir="$1"
  local -A project_dirs_set  # 連想配列で重複排除（レビュー指摘対応）

  # prune オプションを構築（-name ベース - レビュー指摘対応）
  local prune_opts=()
  local first=true
  for dir in "${PRUNE_DIRS[@]}"; do
    if [ "$first" = true ]; then
      prune_opts+=(-name "$dir")
      first=false
    else
      prune_opts+=(-o -name "$dir")
    fi
  done

  # .git ディレクトリまたはファイルを検出してプロジェクトルートを特定
  # 注意1: Git worktree/submodule では .git がファイルの場合がある（レビュー指摘対応）
  # 注意2: .git ディレクトリ配下は巨大になりやすいため -prune で探索を停止（第3回レビュー指摘対応）
  local project_dir
  while IFS= read -r -d '' git_path; do
    if [ -d "$git_path" ]; then
      # .git がディレクトリの場合
      project_dir=$(dirname "$git_path")
    else
      # .git がファイルの場合（worktree/submodule）
      project_dir=$(dirname "$git_path")
    fi
    # 連想配列に追加（自動的に重複排除）
    project_dirs_set["$project_dir"]=1
  done < <(find "$base_dir" \( "${prune_opts[@]}" \) -prune -o \( -type d -name ".git" -prune -print0 \) -o \( -type f -name ".git" -print0 \) 2>/dev/null || true)

  # 連想配列のキーを出力
  printf '%s\n' "${!project_dirs_set[@]}"
}

# プロジェクトタイプを判定（package manager は優先順位で 1 つに絞る - GUD-004）
detect_project_types() {
  local project_dir="$1"
  local -a detected_types=()
  local pkg_manager_found=""

  # package manager は優先順位で 1 つだけ選択
  for pkg_manager in "${PKG_MANAGER_PRIORITY[@]}"; do
    local patterns="${PROJECT_TYPE_PATTERNS[$pkg_manager]}"
    for pattern in $patterns; do
      if [ -f "$project_dir/$pattern" ]; then
        detected_types+=("$pkg_manager")
        pkg_manager_found="$pkg_manager"
        break 2  # 外側のループも抜ける
      fi
    done
  done

  # その他のタイプを検出（package manager 以外）
  for type in "${!PROJECT_TYPE_PATTERNS[@]}"; do
    # package manager はスキップ
    if [[ " ${PKG_MANAGER_PRIORITY[*]} " =~ " ${type} " ]]; then
      continue
    fi

    local patterns="${PROJECT_TYPE_PATTERNS[$type]}"
    for pattern in $patterns; do
      if [ -f "$project_dir/$pattern" ]; then
        detected_types+=("$type")
        break
      fi
    done
  done

  printf '%s\n' "${detected_types[@]}"
}

# 対象ディレクトリを検出（TASK-007: 関数分割）
detect_target_directories() {
  local -a types=("$@")

  local -a target_dirs=()
  for type in "${types[@]}"; do
    # 連想配列にキーが存在するか確認
    if [[ -v TYPE_TARGET_DIRS[$type] ]]; then
      local dirs="${TYPE_TARGET_DIRS[$type]}"
      for dir in $dirs; do
        if [[ ! " ${target_dirs[*]} " =~ " ${dir} " ]]; then
          target_dirs+=("$dir")
        fi
      done
    else
      log_verbose "  未知のプロジェクトタイプ: $type（スキップ）"
    fi
  done

  printf '%s\n' "${target_dirs[@]}"
}

# シンボリックリンクを作成（TASK-007: 関数分割）
create_symlink_with_target() {
  local target_path="$1"
  local link_target="$2"

  # 既存チェック
  if [ -e "$target_path" ] || [ -L "$target_path" ]; then
    log_verbose "  スキップ（既存）: $(basename "$target_path")"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    return
  fi

  # リンク先の親ディレクトリを作成
  local link_target_dir
  link_target_dir=$(dirname "$link_target")
  if [ ! -d "$link_target_dir" ]; then
    log_verbose "  リンク先の親ディレクトリを作成: $link_target_dir"
    if [ "$DRY_RUN" = false ]; then
      mkdir -p "$link_target_dir"
    fi
  fi

  # リンク先ディレクトリを作成
  if [ ! -d "$link_target" ]; then
    log_verbose "  リンク先ディレクトリを作成: $link_target"
    if [ "$DRY_RUN" = false ]; then
      mkdir -p "$link_target"
    fi
  fi

  # シンボリックリンクを作成
  log_info "予防的シンボリックリンクを作成: $target_path -> $link_target"
  if [ "$DRY_RUN" = false ]; then
    if ln -s -- "$link_target" "$target_path"; then
      log_success "作成成功: $target_path"
      PROCESSED_COUNT=$((PROCESSED_COUNT + 1))
    else
      log_error "作成失敗: $target_path"
      ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
  else
    PROCESSED_COUNT=$((PROCESSED_COUNT + 1))
  fi
}

# 予防的シンボリックリンク作成（メイン処理 - TASK-007: 関数分割）
create_preventive_symlinks() {
  local project_dir="$1"
  local rel_path="${project_dir#$WORKS_DIR/}"

  log_info "プロジェクトを検出: $rel_path"

  # プロジェクトタイプを判定
  local -a types
  mapfile -t types < <(detect_project_types "$project_dir")

  if [ ${#types[@]} -eq 0 ]; then
    log_verbose "  プロジェクトタイプを特定できませんでした"
    return
  fi

  log_verbose "  検出されたタイプ: ${types[*]}"

  # 対象ディレクトリを検出
  local -a target_dirs
  mapfile -t target_dirs < <(detect_target_directories "${types[@]}")

  # 各対象ディレクトリについてシンボリックリンクを作成
  for dir_name in "${target_dirs[@]}"; do
    local target_path="$project_dir/$dir_name"
    local link_target="$TMP_WORKS_DIR/$rel_path/$dir_name"
    create_symlink_with_target "$target_path" "$link_target"
  done
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

# 予防的シンボリックリンク作成モード（REQ-007）
if [ "$PREVENTIVE_MODE" = true ]; then
  log_info "予防的シンボリックリンク作成モードを開始"

  # プロジェクトディレクトリを検出
  mapfile -t PROJECT_DIRS < <(find_project_directories "$WORKS_DIR")

  log_info "検出されたプロジェクト数: ${#PROJECT_DIRS[@]}"

  # 各プロジェクトについて予防的シンボリックリンクを作成
  for project_dir in "${PROJECT_DIRS[@]}"; do
    create_preventive_symlinks "$project_dir"
  done
fi

# 各パターンについて検索（既存の実ディレクトリ検出処理 - REQ-007）
for PATTERN in "${TARGET_PATTERNS[@]}"; do
  log_info "パターン '$PATTERN' を検索中..."

  # 除外するディレクトリのリスト（現在のPATTERNは除外しない - TASK-002, TASK-003）
  prune_list=()
  for dir in "${PRUNE_DIRS[@]}"; do
    if [ "$dir" != "$PATTERN" ]; then
      prune_list+=("$dir")
    fi
  done

  # find で検出（grep 依存を撤廃 - TASK-002, TASK-003）
  # PRUNE_DIRS配下を探索せず、PATTERNにマッチするディレクトリ/シンボリックリンクを検出
  # -name "$PATTERN" は完全一致なので、誤検出（例: .next で anext）を防止
  # パイプラインのエラーを一時的に無視するため set +e を使用
  set +e
  while IFS= read -r -d '' DIR_PATH; do
    # シンボリックリンクの場合、リンク先がディレクトリであることを確認
    if [ -L "$DIR_PATH" ] && [ ! -d "$DIR_PATH" ]; then
      # 壊れたシンボリックリンクの場合（REQ-008）
      log_warning "壊れたシンボリックリンクを検出: $DIR_PATH"
      log_warning "スキップします（手動で削除してください）"
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
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
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
      else
        # 想定外のリンク先の場合（REQ-008）
        log_warning "想定外のリンク先: $DIR_PATH -> $CURRENT_TARGET (想定: $EXPECTED_TARGET)"
        log_warning "スキップします"
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
      fi
    elif [ -e "$DIR_PATH" ] && [ ! -L "$DIR_PATH" ]; then
      # 実ディレクトリの場合
      log_info "実ディレクトリを検出: $DIR_PATH"

      if [ "$DELETE_EXISTING" = true ]; then
        # 削除モード（REQ-009）
        log_info "  既存ディレクトリを削除します"
        if [ "$DRY_RUN" = false ]; then
          rm -rf -- "$DIR_PATH"
          log_success "  削除しました: $DIR_PATH"
        fi
      else
        # 退避モード（デフォルト - REQ-009）
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_PATH="${DIR_PATH}.bak-${TIMESTAMP}"
        log_info "  既存ディレクトリを退避します: $BACKUP_PATH"
        if [ "$DRY_RUN" = false ]; then
          mv -- "$DIR_PATH" "$BACKUP_PATH"
          log_success "  退避しました: $DIR_PATH -> $BACKUP_PATH"
        fi
      fi
    elif [ -L "$DIR_PATH" ] && [ ! -e "$DIR_PATH" ]; then
      # 壊れたシンボリックリンクの場合（REQ-008）
      log_warning "壊れたシンボリックリンクを検出: $DIR_PATH"
      log_warning "スキップします（手動で削除してください）"
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
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
      if ln -s -- "$LINK_TARGET" "$DIR_PATH"; then
        log_success "作成成功: $DIR_PATH"
        PROCESSED_COUNT=$((PROCESSED_COUNT + 1))
      else
        log_error "作成失敗: $DIR_PATH"
        ERROR_COUNT=$((ERROR_COUNT + 1))
      fi
    else
      PROCESSED_COUNT=$((PROCESSED_COUNT + 1))
    fi

  done < <(
    # PRUNE_DIRSからPATTERNを除外したディレクトリを-pruneで除外
    if [ ${#prune_list[@]} -gt 0 ]; then
      # prune条件の構築
      prune_cond=()
      first=true
      for dir in "${prune_list[@]}"; do
        if [ "$first" = true ]; then
          prune_cond=(-name "$dir")
          first=false
        else
          prune_cond+=(-o -name "$dir")
        fi
      done
      # find実行: 除外ディレクトリを-pruneし、PATTERNにマッチするものを検出
      # 検出後は-pruneでその配下を探索しない
      find "$WORKS_DIR" \( "${prune_cond[@]}" \) -prune -o \( -type d -o -type l \) -name "$PATTERN" -print0 -prune 2>/dev/null || true
    else
      # 除外対象がない場合（通常は発生しない）
      find "$WORKS_DIR" \( -type d -o -type l \) -name "$PATTERN" -print0 -prune 2>/dev/null || true
    fi
  )
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
