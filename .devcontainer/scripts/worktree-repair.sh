
#!/usr/bin/env bash
set -euo pipefail

# ----- 設定の自動取得 -----
# VS Code の devcontainer.json で渡した絶対パス
LOCAL_WS="${LOCAL_WORKSPACE:-}"
# Fallback: 未設定なら現在ディレクトリ
if [[ -z "${LOCAL_WS}" ]]; then
  LOCAL_WS="$(pwd)"
fi

# work01 の親（= my-app）
PARENT_DIR="$(dirname "${LOCAL_WS}")"

log() { printf "\033[1;36m[worktree-repair]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[warn]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[error]\033[0m %s\n" "$*"; }

# ----- 事前チェック -----
if ! command -v git >/dev/null 2>&1; then
  err "git がコンテナに見当たりません。Dockerfile でインストールしてください。"
  exit 1
fi

if [[ ! -d "${PARENT_DIR}" ]]; then
  err "親ディレクトリが見えません: ${PARENT_DIR}"
  err "devcontainer.json の mounts で親をマウントしているか確認してください。"
  exit 1
fi

if [[ ! -d "${PARENT_DIR}/.git" ]]; then
  # .git がディレクトリでない（bare や別構成）場合にも対応したいが、まずは典型ケースをチェック
  err "親ディレクトリに .git がありません: ${PARENT_DIR}/.git"
  err "親（my-app）側を開いて git init / clone / worktree の作成状況を確認してください。"
  exit 1
fi

if [[ ! -e "${LOCAL_WS}/.git" ]]; then
  err "worktree 側の .git ファイルが見当たりません: ${LOCAL_WS}/.git"
  exit 1
fi

log "parent=${PARENT_DIR}"
log "worktree=${LOCAL_WS}"

# ----- 既存の .git の中身を軽く確認（情報用途） -----
# ここで絶対パスがホスト向けのままなら、repair で直るはず
if head -n 1 "${LOCAL_WS}/.git" | grep -q '^gitdir:'; then
  CURRENT_GITDIR="$(sed -n 's/^gitdir:[[:space:]]*//p' "${LOCAL_WS}/.git" | tr -d '[:space:]')"
  log ".git points to: ${CURRENT_GITDIR}"
else
  warn "${LOCAL_WS}/.git の形式が想定外です（worktreeでは通常 'gitdir:' 行）"
fi

# ----- 修復実行 -----
# 親リポジトリ側から repair を呼ぶのがコツ
set +e
git -C "${PARENT_DIR}" worktree repair "${LOCAL_WS}" >/tmp/worktree-repair.log 2>&1
REPAIR_RC=$?
set -e

if [[ ${REPAIR_RC} -ne 0 ]]; then
  warn "git worktree repair が非ゼロで終了しました（ログ: /tmp/worktree-repair.log）。"
  warn "多くの場合はパスのマウント不整合です。mounts の target を見直してください。"
else
  log "git worktree repair を実行しました。"
fi

# ----- 動作確認（簡易） -----
set +e
git -C "${LOCAL_WS}" rev-parse --show-toplevel >/tmp/worktree-toplevel.txt 2>/dev/null
SHOW_TOP_RC=$?
set -e

if [[ ${SHOW_TOP_RC} -eq 0 ]]; then
  TOP="$(cat /tmp/worktree-toplevel.txt)"
  log "worktree is recognized. toplevel=${TOP}"
else
  warn "worktree 直下で rev-parse が失敗しました。引き続きパス不整合の可能性があります。"
  warn "親ディレクトリのマウント位置・ターゲット絶対パスを確認してください。"
fi

# ----- 参考：Git が新しければ相対パス運用も検討可能 -----
# （ここでは自動実行しません。チーム合意のうえで導入してください）
# git --version | grep -qE '2\.48|2\.49|2\.5[0-9]'
# if [[ $? -eq 0 ]]; then
#   log "Git 2.48+ detected. Consider: 'git worktree add --relative-paths' in future operations."
# fi

exit 0
