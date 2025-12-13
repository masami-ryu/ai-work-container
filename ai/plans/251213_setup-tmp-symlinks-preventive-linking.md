# setup-tmp-symlinks.sh 予防的シンボリックリンク作成機能追加プラン

作成日: 2025年12月13日
作成者: Plan Creator エージェント
ステータス: Review
最終更新: 2025年12月13日（レビュー結果反映）

## 1. 概要

### 目的
`.devcontainer/setup-tmp-symlinks.sh` にプロジェクトパターン検出機能を追加し、検出対象ディレクトリが存在しない場合でも、プロジェクトの特性（package.json、yarn.lock等の有無）を判定して予防的にシンボリックリンクを作成する。

### スコープ
- 対象: `.devcontainer/setup-tmp-symlinks.sh` の機能拡張
- 対象範囲:
  - プロジェクトパターンファイル検出機能の追加
  - プロジェクトタイプ判定ロジックの実装
  - 予防的シンボリックリンク作成機能の追加
- 対象外:
  - 既存の実ディレクトリ検出・変換ロジック（維持）
  - 他のスクリプトファイルの変更

### 前提条件
- `.devcontainer/setup-tmp-symlinks.sh` が既に実装済みであること
- works/ ディレクトリが存在すること
- `/workspaces/tmp` volumeが正常に動作していること

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | package.json が存在するプロジェクトで node_modules のシンボリックリンクを予防的に作成 | 高 |
| REQ-002 | 要件 | pnpm-lock.yaml が存在する場合、.pnpm-store のシンボリックリンクも作成 | 高 |
| REQ-003 | 要件 | tsconfig.json または next.config.js が存在する場合、dist/.next のシンボリックリンクを作成 | 中 |
| REQ-004 | 要件 | 既に実ディレクトリが存在する場合は予防的作成をスキップ（既存ロジック優先） | 高 |
| REQ-005 | 要件 | 既にシンボリックリンクが存在する場合はスキップ | 高 |
| REQ-006 | 要件 | --preventive オプションで予防的作成機能を有効化（デフォルトは無効） | 中 |
| REQ-007 | 要件 | 予防的作成モードでも既存の実ディレクトリ検出ロジックは動作継続 | 高 |
| REQ-008 | 要件 | ドライランモードで予防的作成の動作確認が可能 | 中 |
| REQ-009 | 要件 | プロジェクト検出は works/**/.git の存在で判定する | 高 |
| CON-001 | 制約 | 既存スクリプトの動作を破壊しないこと | - |
| CON-002 | 制約 | パフォーマンスへの影響を最小限に抑える | - |
| GUD-001 | ガイドライン | プロジェクト検出ロジックは拡張可能に設計 | - |
| GUD-002 | ガイドライン | ログ出力は既存形式と統一 | - |
| GUD-003 | ガイドライン | find は prune で除外ディレクトリを設定し性能劣化を抑える | - |
| GUD-004 | ガイドライン | package manager は優先順位で 1 つに絞る（pnpm > yarn > npm） | - |
| GUD-005 | ガイドライン | カウンタ（PROCESSED_COUNT/SKIPPED_COUNT/ERROR_COUNT）は既存スクリプトと一貫性を保つ | - |

## 3. 実装ステップ

### Phase 1: プロジェクト検出ロジックの実装
**目標**: works/ 配下のプロジェクトディレクトリを検出し、プロジェクトタイプを判定

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-101 | プロジェクトパターン定義の追加 | .devcontainer/setup-tmp-symlinks.sh | プロジェクトタイプ判定パターン配列が定義されている | [ ] |
| TASK-102 | プロジェクト検出関数の実装（.git ベース） | .devcontainer/setup-tmp-symlinks.sh | .git を含むディレクトリをプロジェクトルートとして検出する関数が実装されている | [ ] |
| TASK-103 | プロジェクトタイプ判定関数の実装 | .devcontainer/setup-tmp-symlinks.sh | プロジェクトタイプ（pnpm/yarn/npm/TypeScript/Next.js等）を判定する関数が実装されている | [ ] |
| TASK-104 | 検出スコープとパフォーマンス最適化の実装 | .devcontainer/setup-tmp-symlinks.sh | find の prune、除外ディレクトリ、重複排除（連想配列）が実装されている | [ ] |

**実装の詳細（TASK-101）:**
```bash
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
```

**実装の詳細（TASK-102）:**
```bash
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
```

**実装の詳細（TASK-103）:**
```bash
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
```

**実装の詳細（TASK-104）:**

TASK-102 と TASK-103 の実装に既に含まれています：
- **prune 設定**: `PRUNE_DIRS` 配列で除外ディレクトリを定義（TASK-101）
- **prune 適用**: `find_project_directories` 関数で prune オプションを構築（TASK-102）
- **連想配列での重複排除**: `project_dirs_set` で自動的に重複を排除（TASK-102）
- **package manager 優先順位**: `PKG_MANAGER_PRIORITY` 配列と `detect_project_types` 関数のロジック（TASK-103）

### Phase 2: 予防的シンボリックリンク作成機能の実装
**目標**: プロジェクトタイプに基づいて、ディレクトリが存在しない場合でもシンボリックリンクを作成

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-201 | コマンドライン引数に --preventive オプションを追加 | .devcontainer/setup-tmp-symlinks.sh | --preventive オプションが実装されている | [ ] |
| TASK-202 | 予防的シンボリックリンク作成関数の実装 | .devcontainer/setup-tmp-symlinks.sh | プロジェクトタイプに基づいてシンボリックリンクを作成する関数が実装されている | [ ] |
| TASK-203 | 既存ディレクトリ・リンクのスキップロジック追加 | .devcontainer/setup-tmp-symlinks.sh | 既存のディレクトリやシンボリックリンクが存在する場合はスキップされる | [ ] |
| TASK-204 | メイン処理への統合 | .devcontainer/setup-tmp-symlinks.sh | 既存の実ディレクトリ検出処理の前に予防的作成処理が実行される | [ ] |

**実装の詳細（TASK-201）:**
```bash
# フラグに追加
PREVENTIVE_MODE=false

# コマンドライン引数解析に追加
case "$1" in
  --preventive)
    PREVENTIVE_MODE=true
    shift
    ;;
  # ... 既存のオプション ...
esac
```

**実装の詳細（TASK-202）:**
```bash
# 予防的シンボリックリンク作成
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

  # タイプごとの対象ディレクトリを取得
  local -a target_dirs=()
  for type in "${types[@]}"; do
    local dirs="${TYPE_TARGET_DIRS[$type]}"
    for dir in $dirs; do
      if [[ ! " ${target_dirs[*]} " =~ " ${dir} " ]]; then
        target_dirs+=("$dir")
      fi
    done
  done

  # 各対象ディレクトリについてシンボリックリンクを作成
  for dir_name in "${target_dirs[@]}"; do
    local target_path="$project_dir/$dir_name"
    local link_target="$TMP_WORKS_DIR/$rel_path/$dir_name"

    # 既存チェック（TASK-203、GUD-005）
    if [ -e "$target_path" ] || [ -L "$target_path" ]; then
      log_verbose "  スキップ（既存）: $dir_name"
      ((SKIPPED_COUNT++))
      continue
    fi

    # リンク先の親ディレクトリを作成
    local link_target_dir=$(dirname "$link_target")
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
      if ln -s "$link_target" "$target_path"; then
        log_success "作成成功: $target_path"
        ((PROCESSED_COUNT++))
      else
        log_error "作成失敗: $target_path"
        ((ERROR_COUNT++))
      fi
    else
      ((PROCESSED_COUNT++))
    fi
  done
}
```

**実装の詳細（TASK-204）:**
```bash
# メイン処理の流れ
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

# 既存の実ディレクトリ検出処理（REQ-007）
for PATTERN in "${TARGET_PATTERNS[@]}"; do
  # ... 既存のロジック ...
done
```

### Phase 3: ヘルプとドキュメントの更新
**目標**: 新機能の使用方法を明確にする

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-301 | ヘルプメッセージの更新 | .devcontainer/setup-tmp-symlinks.sh | --preventive オプションの説明が追加されている | [ ] |
| TASK-302 | 使用例の追加 | .devcontainer/setup-tmp-symlinks.sh | 予防的作成モードの使用例が追加されている | [ ] |

**実装の詳細（TASK-301, 302）:**
```bash
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

例:
  $(basename "$0")                        # 既存ディレクトリのみを対象
  $(basename "$0") --preventive           # 予防的作成モードを有効化
  $(basename "$0") --preventive --dry-run # 予防的作成のドライラン
  $(basename "$0") --all --preventive     # 全パターン + 予防的作成
EOF
}
```

### Phase 4: テストと検証
**目標**: 実装した機能が正常に動作することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-401 | プロジェクト検出のテスト（.git ディレクトリ） | - | .git ディレクトリを含むディレクトリがプロジェクトルートとして正しく検出される | [ ] |
| TASK-401b | プロジェクト検出のテスト（.git ファイル） | - | .git ファイル（worktree/submodule）の場合もプロジェクトルートとして正しく検出される（レビュー指摘対応） | [ ] |
| TASK-402 | プロジェクトタイプ判定のテスト | - | pnpm/yarn/npm/TypeScript/Next.js が正しく判定され、package manager は優先順位で 1 つに絞られる | [ ] |
| TASK-403 | 予防的シンボリックリンク作成のテスト | - | node_modules が存在しない状態でシンボリックリンクが作成される | [ ] |
| TASK-404 | 既存ディレクトリスキップのテスト | - | 既に node_modules が存在する場合はスキップされる | [ ] |
| TASK-405 | ドライランモードのテスト | - | --preventive --dry-run で変更なく動作確認できる | [ ] |
| TASK-405b | ドライランでの可視化テスト | - | --preventive --dry-run でプロジェクト検出数、各プロジェクトの作成対象（dir_name）が十分に出力される（レビュー指摘対応） | [ ] |
| TASK-406 | 既存ロジックとの共存テスト | - | 予防的作成と既存の実ディレクトリ検出が両方正常動作する | [ ] |
| TASK-406b | 予防的作成リンクのスキップテスト | - | 予防的に作成した node_modules が後段の既存ループで正しいリンクとしてスキップされる（レビュー指摘対応） | [ ] |
| TASK-407 | モノレポでの検出範囲テスト | - | モノレポ（ルートと packages/* に .git がある場合）で意図通りの検出になる | [ ] |
| TASK-408 | prune による除外テスト | - | node_modules, dist 等の除外ディレクトリが走査から除外される | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 単体 | プロジェクト検出関数のテスト（.git ディレクトリ） | .git ディレクトリを含むディレクトリがプロジェクトルートとして検出される |
| TEST-001b | 単体 | プロジェクト検出関数のテスト（.git ファイル） | .git ファイル（worktree/submodule）の場合もプロジェクトルートとして検出される（レビュー指摘対応） |
| TEST-002 | 単体 | プロジェクトタイプ判定のテスト | pnpm-lock.yaml がある場合、pnpm タイプが判定される。pnpm と yarn 両方ある場合は pnpm のみ |
| TEST-003 | 単体 | 予防的シンボリックリンク作成 | node_modules がない状態でシンボリックリンクが作成される |
| TEST-004 | 統合 | --preventive オプションの動作確認 | 予防的作成が実行される |
| TEST-005 | 統合 | --preventive --dry-run の動作確認 | 変更なしで実行内容が表示される |
| TEST-005b | 統合 | --preventive --dry-run での可視化確認 | プロジェクト検出数、各プロジェクトの作成対象が十分に出力される（レビュー指摘対応） |
| TEST-006 | 統合 | 既存ロジックとの共存 | 予防的作成と既存の実ディレクトリ検出が両方動作する |
| TEST-006b | 統合 | 予防的作成リンクのスキップ確認 | 予防的に作成した node_modules が後段の既存ループで正しくスキップされる（レビュー指摘対応） |
| TEST-007 | 境界 | 既存ディレクトリが存在する場合 | 予防的作成がスキップされる |
| TEST-008 | 境界 | 既存シンボリックリンクが存在する場合 | 予防的作成がスキップされる |
| TEST-009 | 境界 | .git が存在しない場合 | エラーなく正常終了する |
| TEST-010 | 境界 | モノレポ（ルートと packages/* に .git）での検出 | すべての .git ディレクトリが検出され、それぞれが独立したプロジェクトとして処理される |
| TEST-011 | 性能 | prune による除外ディレクトリのテスト | node_modules, dist 等が find の走査から除外される |

## 5. 成功基準

- [ ] .git ディレクトリの存在でプロジェクトルートが正しく検出される
- [ ] .git ファイル（worktree/submodule）でもプロジェクトルートが正しく検出される（レビュー指摘対応）
- [ ] package manager は優先順位（pnpm > yarn > npm）で 1 つに絞られる
- [ ] pnpm-lock.yaml が存在する場合、.pnpm-store のシンボリックリンクも作成される
- [ ] tsconfig.json または next.config.js が存在する場合、対応するディレクトリのシンボリックリンクが作成される
- [ ] 既に実ディレクトリが存在する場合は予防的作成がスキップされる
- [ ] 既にシンボリックリンクが存在する場合はスキップされる
- [ ] --preventive オプションで予防的作成が有効化される
- [ ] 既存の実ディレクトリ検出ロジックが正常に動作し続ける
- [ ] ドライランモードで予防的作成の動作確認が可能
- [ ] ドライランモードでプロジェクト検出数と作成対象が十分に出力される（レビュー指摘対応）
- [ ] 予防的に作成したシンボリックリンクが後段の既存ループで正しくスキップされる（レビュー指摘対応）
- [ ] find の prune により除外ディレクトリが走査から除外される
- [ ] ヘルプメッセージに新機能の説明が含まれる

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | プロジェクト検出ロジックのパフォーマンス低下 | 低 | 中 | find コマンドの最適化、必要に応じて maxdepth 制限 |
| RISK-002 | 誤ったプロジェクトタイプ判定 | 中 | 低 | 複数パターンを確認、優先順位を明確化 |
| RISK-003 | 予防的作成したシンボリックリンクが不要になる | 低 | 低 | ユーザーが手動で削除可能、--preventive はオプトイン |
| RISK-004 | 既存ロジックとの競合 | 高 | 低 | 予防的作成を既存処理の前に実行、既存チェックを厳密化 |
| RISK-005 | 複雑なプロジェクト構成での誤検出 | 中 | 中 | プロジェクトルート判定を厳密化、ログで可視化 |

## 7. 依存関係

- 既存の `.devcontainer/setup-tmp-symlinks.sh` の実装
- `/workspaces/tmp` volume
- works/ ディレクトリ構造

## 8. 次のアクション

1. [ ] Phase 1実施: プロジェクト検出ロジックの実装
2. [ ] Phase 2実施: 予防的シンボリックリンク作成機能の実装
3. [ ] Phase 3実施: ヘルプとドキュメントの更新
4. [ ] Phase 4実施: テスト計画に従って検証
5. [ ] 動作確認完了後、別プランで devcontainer の post-create.sh 統合を検討（既存プラン @ai/plans/251213_tmp-volume-symlink-automation.md への統合または新規プラン作成）

**スコープ外:**
- devcontainer の post-create.sh への統合（別プランで対応）

---
## 9. 変更履歴

### 2025-12-13 - レビュー結果反映（第3回）
- **ガイドライン追加**:
  - GUD-005: カウンタの一貫性を明示化
- **実装詳細修正（ブロッカー対応）**:
  - TASK-102: `.git` ディレクトリ配下を `-prune` で探索停止する処理を追加
  - TASK-202: スキップ時に `SKIPPED_COUNT++` を追加（GUD-005対応）

### 2025-12-13 - レビュー結果反映（第2回）
- **実装詳細修正（ブロッカー対応）**:
  - TASK-101: `PRUNE_DIRS` から `.git` を削除（プロジェクト検出のため除外不可）
  - TASK-102: `.git` ファイル（worktree/submodule）にも対応、prune を `-name` ベースに変更
- **Phase 4 テスト追加**:
  - TASK-401b: `.git` ファイルのケースのテスト
  - TASK-405b: ドライランでの可視化テスト
  - TASK-406b: 予防的作成リンクのスキップテスト
- **テスト計画追加**:
  - TEST-001b: `.git` ファイルの検出テスト
  - TEST-005b: ドライランでの可視化確認
  - TEST-006b: 予防的作成リンクのスキップ確認
- **成功基準追加**:
  - `.git` ファイルでの検出対応
  - ドライランでの可視化
  - 予防的作成リンクの後段スキップ

### 2025-12-13 - レビュー結果反映（第1回）
- **REQ-009 追加**: プロジェクト検出を .git ベースに変更
- **GUD-003 追加**: find の prune による性能最適化
- **GUD-004 追加**: package manager の優先順位を明確化（pnpm > yarn > npm）
- **TASK-104 追加**: 検出スコープとパフォーマンス最適化の実装
- **実装詳細更新**:
  - TASK-102: .git ベースの検出、連想配列での重複排除
  - TASK-103: package manager の優先順位ロジック追加
- **Phase 4 テスト追加**:
  - TASK-407: モノレポでの検出範囲テスト
  - TASK-408: prune による除外テスト
- **テスト計画更新**:
  - TEST-001: .git ベースの検出テスト
  - TEST-002: package manager 優先順位テスト
  - TEST-010, TEST-011 追加
- **成功基準更新**: .git 検出、優先順位、prune の項目追加
- **次のアクション更新**: post-create 統合を別プランに切り出し

---
*このプランは Plan Creator エージェントによって作成されました*
