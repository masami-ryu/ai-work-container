#!/usr/bin/env bash
set -euo pipefail

# ======================================
# Claude Code MCP 自動設定スクリプト
# ======================================
# 目的: VS Codeの.vscode/mcp.jsonに定義されたMCPサーバーを
#       Claude Code CLIの設定に自動的に統合する
# ======================================

# ログ関数
log_info() { echo "[INFO] $1"; }
log_warn() { echo "[警告] $1"; }
log_error() { echo "[エラー] $1" >&2; }
log_success() { echo "✓ $1"; }
log_fail() { echo "✗ $1"; }
log_debug() { [ "${DEBUG:-false}" = "true" ] && echo "[DEBUG] $1" || true; }

# コマンドラインオプションのパース
CLEAN_MODE=false
DRY_RUN=false
FORCE_MODE=false
DEBUG=false

print_usage() {
  cat << EOF
使用方法: $0 [オプション]

オプション:
  --clean, --overwrite   既存のMCPサーバーをクリーンアップしてから追加
  --force                既存サーバーを確認せず上書き追加
  --dry-run              実際の変更を行わず、実行内容のみ表示
  --debug                デバッグ情報を出力
  -h, --help             このヘルプメッセージを表示

モード:
  デフォルト: 既存サーバーをスキップして新規サーバーのみ追加
  --clean:    全既存サーバーを削除してから全サーバーを追加
  --force:    既存チェックをスキップして全サーバーを強制追加
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean|--overwrite)
      CLEAN_MODE=true
      shift
      ;;
    --force)
      FORCE_MODE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --debug)
      DEBUG=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      log_error "不明なオプション: $1"
      print_usage
      exit 1
      ;;
  esac
done

echo "==== Claude Code MCP セットアップ開始 ===="

# jq の存在確認
if ! command -v jq >/dev/null 2>&1; then
  log_error "jq がインストールされていません。JSON操作には jq が必要です。"
  echo "インストール方法: sudo apt-get update && sudo apt-get install -y jq"
  exit 1
fi

# Claude Code がインストールされているか確認
if ! command -v claude >/dev/null 2>&1; then
  log_error "Claude Code CLI が見つかりません。"
  echo "先に Claude Code CLI をインストールしてください。"
  exit 1
fi

# Claude Code 設定ディレクトリの作成
CLAUDE_CONFIG_DIR="$HOME/.config/claude-code"
mkdir -p "$CLAUDE_CONFIG_DIR"

# フェーズ1: 設定ファイルの検出と読み込み
log_info "設定ファイルを検索中..."

CONFIG_FILE=""
CONFIG_TYPE=""
SERVER_PATH=""
INPUT_PATH=""

if [ -f ".vscode/mcp.json" ]; then
    CONFIG_FILE=".vscode/mcp.json"
    CONFIG_TYPE="mcp"
    SERVER_PATH=".servers"
    INPUT_PATH=".inputs"
    log_info "設定ファイル: $CONFIG_FILE (タイプ: mcp)"
elif [ -f ".vscode/settings.json" ]; then
    # settings.json内にmcp.serversキーが存在するか確認
    if jq -e '.["mcp.servers"]' ".vscode/settings.json" >/dev/null 2>&1; then
        CONFIG_FILE=".vscode/settings.json"
        CONFIG_TYPE="settings"
        SERVER_PATH='."mcp.servers"'
        INPUT_PATH='."mcp.inputs"'
        log_info "設定ファイル: $CONFIG_FILE (タイプ: settings - mcp.servers検出)"
    else
        log_error "settings.jsonにmcp.servers定義が見つかりません"
        echo ""
        echo "解決方法:"
        echo "  1. .vscode/mcp.json を作成してMCPサーバー設定を追加"
        echo "  2. .vscode/settings.json に \"mcp.servers\" キーを追加"
        echo ""
        echo "参考: .vscode/mcp.json の例"
        echo '  { "servers": { "server-name": { "type": "http", "url": "..." } } }'
        exit 1
    fi
else
    log_error "MCPサーバー設定ファイルが見つかりません"
    echo ""
    echo "以下のいずれかのファイルが必要です:"
    echo "  - .vscode/mcp.json (推奨)"
    echo "  - .vscode/settings.json (mcp.servers定義を含む)"
    echo ""
    echo "設定ファイルを作成してから再実行してください。"
    exit 1
fi

# inputs からID→環境変数のマッピングを作成
declare -A input_env_map
if jq -e "${INPUT_PATH}" "$CONFIG_FILE" >/dev/null 2>&1; then
    while IFS= read -r input_id; do
        [ -z "$input_id" ] && continue
        # input:xxx → 環境変数名（大文字、ハイフンをアンダースコアに変換）
        env_var_name=$(echo "$input_id" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
        input_env_map["input:$input_id"]="$env_var_name"
        log_debug "入力マッピング: \${input:$input_id} → \$$env_var_name"
    done < <(jq -r "${INPUT_PATH}[]?.id // empty" "$CONFIG_FILE" 2>/dev/null)
else
    log_info "inputs定義が見つかりません（環境変数置換はスキップされます）"
fi

# 環境変数の置換関数
resolve_env_var() {
    local value="$1"
    local resolved="$value"
    
    # ${input:xxx} 形式を検出して置換
    for key in "${!input_env_map[@]}"; do
        env_var="${input_env_map[$key]}"
        if [[ "$value" == *"\${$key}"* ]]; then
            if [ -n "${!env_var:-}" ]; then
                resolved="${resolved//\$\{$key\}/${!env_var}}"
                log_debug "環境変数置換: \${$key} → [MASKED]"
            else
                log_warn "環境変数 $env_var が未設定です（${key} の解決に失敗）"
                return 1
            fi
        fi
    done
    
    echo "$resolved"
}

# フェーズ2: 既存サーバーの管理
log_info "既存のMCPサーバーを確認中..."

# claude mcp list の出力を解析
MCP_LIST_OUTPUT=$(claude mcp list 2>&1 || true)
log_debug "claude mcp list 出力:"
log_debug "$MCP_LIST_OUTPUT"

# フォーマット検証
if echo "$MCP_LIST_OUTPUT" | grep -qE "^(Error|error|Failed|failed)"; then
    log_error "claude mcp list の実行に失敗しました"
    echo ""
    echo "[DEBUG] 出力内容:"
    echo "$MCP_LIST_OUTPUT"
    echo ""
    echo "解決方法:"
    echo "  1. claude CLI が正しくインストールされているか確認"
    echo "  2. claude mcp list を手動で実行して出力を確認"
    exit 1
fi

# サーバー名の抽出（コロンで終わる行からサーバー名のみ取得）
EXISTING_SERVERS=$(echo "$MCP_LIST_OUTPUT" | awk '/^[[:space:]]*[^[:space:]]+:/ {gsub(/^[[:space:]]*/, ""); gsub(/:.*$/, ""); print}' || echo "")

if [ -n "$EXISTING_SERVERS" ]; then
    log_info "既存のMCPサーバー検出: $(echo "$EXISTING_SERVERS" | tr '\n' ', ' | sed 's/,$//')"
    
    if [ "$CLEAN_MODE" = true ]; then
        echo ""
        echo "=== クリーンモード: 既存サーバーを削除 ==="
        for server in $EXISTING_SERVERS; do
            if [ "$DRY_RUN" = true ]; then
                echo "[DRY-RUN] claude mcp remove $server を実行します"
            else
                log_info "削除中: $server"
                if claude mcp remove "$server" 2>/dev/null; then
                    log_success "$server を削除しました"
                else
                    log_warn "$server の削除に失敗しました（スキップして続行）"
                fi
            fi
        done
        EXISTING_SERVERS=""  # クリーン後は既存サーバーなしとして扱う
    elif [ "$FORCE_MODE" = false ] && [ "$DRY_RUN" = false ]; then
        # インタラクティブモード（dry-runでない場合のみ）
        echo ""
        echo "既存のMCPサーバーが検出されました。どのように処理しますか？"
        echo "  1) スキップ - 既存サーバーはそのままで、新規サーバーのみ追加"
        echo "  2) クリーンアップ - すべての既存サーバーを削除してから追加"
        echo "  3) 強制上書き - 既存チェックをスキップして全サーバーを追加"
        echo "  4) キャンセル - セットアップを中止"
        read -p "選択してください [1-4]: " choice
        
        case $choice in
            1)
                log_info "スキップモードで続行します"
                ;;
            2)
                log_info "クリーンアップモードで続行します"
                for server in $EXISTING_SERVERS; do
                    log_info "削除中: $server"
                    if claude mcp remove "$server" 2>/dev/null; then
                        log_success "$server を削除しました"
                    else
                        log_warn "$server の削除に失敗しました（スキップして続行）"
                    fi
                done
                EXISTING_SERVERS=""
                ;;
            3)
                log_info "強制上書きモードで続行します"
                FORCE_MODE=true
                ;;
            4)
                log_info "セットアップをキャンセルしました"
                exit 0
                ;;
            *)
                log_error "無効な選択です。セットアップを中止します。"
                exit 1
                ;;
        esac
    elif [ "$DRY_RUN" = true ]; then
        log_info "DRY-RUNモード: 既存サーバーのクリーンアップはスキップされます"
    fi
else
    log_info "既存のMCPサーバーは検出されませんでした"
fi

# フェーズ3: サーバー追加処理の汎用化
echo ""
echo "=== MCP サーバーを Claude Code に追加 ==="

# サーバー名の一覧を取得
servers=$(jq -r "${SERVER_PATH} | keys[]" "$CONFIG_FILE")
total_count=0
success_count=0
skip_count=0
fail_count=0

for server in $servers; do
    total_count=$((total_count + 1))
    
    # 変数の初期化（ループごとに必須）
    type=""
    url=""
    command=""
    args=()
    headers=""
    header_args=()
    
    echo ""
    log_info "[$total_count] $server サーバーを処理中..."
    
    # 既存チェック（FORCE_MODE でない場合）
    if [ "$FORCE_MODE" = false ] && echo "$EXISTING_SERVERS" | grep -q "^${server}$"; then
        log_success "$server は既に追加されています（スキップ）"
        skip_count=$((skip_count + 1))
        continue
    fi
    
    # サーバータイプの取得
    type=$(jq -r "${SERVER_PATH}.\"${server}\".type" "$CONFIG_FILE")
    log_debug "タイプ: $type"
    
    if [ "$type" = "http" ]; then
        # HTTPサーバーの処理
        url=$(jq -r "${SERVER_PATH}.\"${server}\".url" "$CONFIG_FILE")
        
        # ヘッダーの取得と環境変数置換
        if jq -e "${SERVER_PATH}.\"${server}\".headers" "$CONFIG_FILE" >/dev/null 2>&1; then
            # ヘッダーをJSON形式で取得
            headers_json=$(jq -c "${SERVER_PATH}.\"${server}\".headers" "$CONFIG_FILE")
            log_debug "ヘッダーJSON: $headers_json"
            
            # 各ヘッダーを処理
            header_args=()
            while IFS= read -r header_line; do
                key=$(echo "$header_line" | cut -d: -f1)
                value=$(echo "$header_line" | cut -d: -f2-)
                
                # 環境変数置換
                if resolved_value=$(resolve_env_var "$value"); then
                    header_args+=("-H" "$key: $resolved_value")
                    log_debug "ヘッダー追加: $key: [MASKED]"
                else
                    log_warn "ヘッダー $key の環境変数置換に失敗（スキップ）"
                fi
            done < <(echo "$headers_json" | jq -r 'to_entries[] | "\(.key):\(.value)"')
        fi
        
        # コマンド構築
        if [ "$DRY_RUN" = true ]; then
            # ヘッダーをマスクして表示
            masked_headers=""
            for ((i=0; i<${#header_args[@]}; i+=2)); do
                if [ "${header_args[i]}" = "-H" ]; then
                    key=$(echo "${header_args[i+1]}" | cut -d: -f1)
                    masked_headers+=" -H \"$key: [MASKED]\""
                fi
            done
            echo "[DRY-RUN] claude mcp add --transport http $server \"$url\"$masked_headers"
        else
            if [ ${#header_args[@]} -gt 0 ]; then
                if claude mcp add --transport http "$server" "$url" "${header_args[@]}"; then
                    log_success "$server を追加しました (URL: $url, 認証: あり)"
                    success_count=$((success_count + 1))
                else
                    log_fail "$server の追加に失敗しました"
                    fail_count=$((fail_count + 1))
                fi
            else
                if claude mcp add --transport http "$server" "$url"; then
                    log_success "$server を追加しました (URL: $url)"
                    success_count=$((success_count + 1))
                else
                    log_fail "$server の追加に失敗しました"
                    fail_count=$((fail_count + 1))
                fi
            fi
        fi
        
    elif [ "$type" = "stdio" ]; then
        # STDIOサーバーの処理
        command=$(jq -r "${SERVER_PATH}.\"${server}\".command" "$CONFIG_FILE")
        
        # 配列を安全に取得
        mapfile -t args < <(jq -r "${SERVER_PATH}.\"${server}\".args[]? // empty" "$CONFIG_FILE" 2>/dev/null)
        
        log_debug "コマンド: $command, 引数: ${args[*]}"
        
        # コマンド構築
        if [ "$DRY_RUN" = true ]; then
            echo "[DRY-RUN] claude mcp add --transport stdio $server -- $command ${args[*]}"
        else
            if [ ${#args[@]} -gt 0 ]; then
                if claude mcp add --transport stdio "$server" -- "$command" "${args[@]}"; then
                    log_success "$server を追加しました"
                    success_count=$((success_count + 1))
                else
                    log_fail "$server の追加に失敗しました"
                    fail_count=$((fail_count + 1))
                fi
            else
                if claude mcp add --transport stdio "$server" -- "$command"; then
                    log_success "$server を追加しました"
                    success_count=$((success_count + 1))
                else
                    log_fail "$server の追加に失敗しました"
                    fail_count=$((fail_count + 1))
                fi
            fi
        fi
    else
        log_warn "$server: 不明なタイプ '$type' （スキップ）"
        skip_count=$((skip_count + 1))
    fi
done

echo ""
echo "=== セットアップ完了 ==="
echo "処理サマリー:"
echo "  合計: $total_count サーバー"
echo "  成功: $success_count"
echo "  スキップ: $skip_count"
echo "  失敗: $fail_count"
echo ""
echo "MCP サーバー一覧確認:"
echo "  claude mcp list"
echo ""

# 環境変数未設定の警告
missing_env_vars=false
for key in "${!input_env_map[@]}"; do
    env_var="${input_env_map[$key]}"
    if [ -z "${!env_var:-}" ]; then
        if [ "$missing_env_vars" = false ]; then
            echo "⚠ 未設定の環境変数:"
            missing_env_vars=true
        fi
        echo "  - $env_var (${key} に必要)"
    fi
done

if [ "$missing_env_vars" = true ]; then
    echo ""
    echo "環境変数を設定後、スクリプトを再実行してください。"
fi

echo ""
echo "==== Claude Code MCP セットアップ完了 ===="
