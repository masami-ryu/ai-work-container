# MCPスクリプト改善プラン

**作成日**: 2025-11-25  
**対象issue**: `ai/issues/251125_mcpscript改善.md`  
**目的**: setup-claude-mcp.shスクリプトを改善し、動的な設定読み込みと既存サーバー管理機能を追加する

---

## 📋 現状の課題

### 1. ハードコーディングの問題
- MCPサーバー情報がスクリプト内に直接記述されている
- サーバーの追加・変更時にスクリプト本体の修正が必要
- 保守性が低く、柔軟性に欠ける

### 2. 既存サーバー管理の不備
- 既存のMCPサーバーが登録済みかのチェックはあるが、限定的
- 再実行時の挙動が不明確（上書き、スキップ、エラーなど）
- ユーザーの意図に沿った柔軟な対応ができない

### 3. 設定ファイルの活用不足
- `.vscode/mcp.json`に設定があるのに、その情報を十分に活用していない
- `settings.json`も参照可能だが、現在は未利用

---

## 🎯 改善目標

### 主要な要件
1. **動的な設定読み込み**
   - `.vscode/mcp.json`または`.vscode/settings.json`からMCPサーバー情報を自動的に取得
   - 設定ファイルの変更に応じて柔軟に対応

2. **既存サーバーの管理**
   - スクリプト実行時に既存のMCPサーバーを検出
   - ユーザーに対応方法を選択させる（クリーンアップ、スキップ、上書きなど）

3. **保守性の向上**
   - 設定変更時にスクリプト本体を修正する必要をなくす
   - 拡張性の高い構造にする

---

## 🔧 実装計画

### フェーズ1: 設定ファイル読み込み機能の実装

#### ステップ1.1: 設定ファイルの検出と優先順位決定
**実装内容:**
- `.vscode/mcp.json`の存在確認
- `.vscode/settings.json`の存在確認（mcp.json がない場合のフォールバック）
- どちらの設定ファイルを使用するか決定

**設定ファイルの構造**

| ファイル | キー構造 | 備考 |
|---------|---------|------|
| `.vscode/mcp.json` | `{ "servers": { ... }, "inputs": [ ... ] }` | 専用設定ファイル（推奨） |
| `.vscode/settings.json` | `{ "mcp.servers": { ... }, "mcp.inputs": [ ... ] }` | VS Code設定内にネスト |

**処理フロー:**
```bash
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
```

**jqコマンド動作確認例:**
```bash
# mcp.json の場合
$ jq '.servers | keys[]' .vscode/mcp.json
"msdocs"
"context7"
"github-mcp-server"

# settings.json の場合  
$ jq '."mcp.servers" | keys[]' .vscode/settings.json
"msdocs"
"context7"
"github-mcp-server"
```

#### ステップ1.2: jqを使ったJSON解析機能の実装
**実装内容:**
- jqを使用してMCPサーバー情報を動的に抽出
- サーバー名、タイプ（http/stdio）、URL/コマンド、引数などを取得
- 環境変数やヘッダー情報も含めて解析
- **変数の適切な初期化とスコープ管理**

**データ構造の例:**
```bash
# 設定ファイルのタイプに応じてパスを調整
servers=$(jq -r "${SERVER_PATH} | keys[]" "$CONFIG_FILE")

for server in $servers; do
    # ループごとに変数を初期化（値の残留を防ぐ）
    type=""
    url=""
    headers=""
    command=""
    args=()
    
    type=$(jq -r "${SERVER_PATH}.${server}.type" "$CONFIG_FILE")
    
    if [ "$type" = "http" ]; then
        url=$(jq -r "${SERVER_PATH}.${server}.url" "$CONFIG_FILE")
        # ヘッダーが存在する場合のみ取得
        if jq -e "${SERVER_PATH}.${server}.headers" "$CONFIG_FILE" >/dev/null 2>&1; then
            headers=$(jq -r "${SERVER_PATH}.${server}.headers" "$CONFIG_FILE")
        fi
    elif [ "$type" = "stdio" ]; then
        command=$(jq -r "${SERVER_PATH}.${server}.command" "$CONFIG_FILE")
        # 配列を安全に取得
        mapfile -t args < <(jq -r "${SERVER_PATH}.${server}.args[]?" "$CONFIG_FILE" 2>/dev/null || echo "")
    fi
done
```

#### ステップ1.3: 環境変数の置換処理
**実装内容:**
- `${input:github_mcp_pat}`のような変数参照を環境変数に置換
- `inputs`配列からID→環境変数名のマッピングを取得
- 環境変数が未設定の場合の警告処理とフォールバック
- セキュアな情報（PAT等）の扱い（ログ出力時のマスキング）

**inputs配列との対応付け:**
```jsonc
// mcp.json の inputs セクション
"inputs": [
  {
    "type": "promptString",
    "id": "github_mcp_pat",      // ${input:github_mcp_pat} として参照
    "description": "GitHub Personal Access Token",
    "password": true
  }
]
```

**実装例:**
```bash
# inputs からID→環境変数のマッピングを作成
declare -A input_env_map
if jq -e "${INPUT_PATH}" "$CONFIG_FILE" >/dev/null 2>&1; then
    while IFS= read -r input_id; do
        # input:xxx → 環境変数名（大文字、ハイフンをアンダースコアに変換）
        env_var_name=$(echo "$input_id" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
        input_env_map["input:$input_id"]="$env_var_name"
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
            if [ -n "${!env_var}" ]; then
                resolved="${resolved//\$\{$key\}/${!env_var}}"
            else
                echo "[警告] 環境変数 $env_var が未設定です（${key} の解決に失敗）" >&2
                return 1
            fi
        fi
    done
    
    echo "$resolved"
}

# 入出力例とテストパターン
# 入力: "Bearer ${input:github_mcp_pat}"
# input_env_map["input:github_mcp_pat"]="GITHUB_MCP_PAT"
# GITHUB_MCP_PAT="ghp_abc123xyz"
# 出力: "Bearer ghp_abc123xyz"
#
# マッピング処理の流れ:
# 1. inputs配列から "github_mcp_pat" を取得
# 2. 連想配列キーは "input:github_mcp_pat" として格納
# 3. プレースホルダ "${input:github_mcp_pat}" と照合
# 4. 環境変数 GITHUB_MCP_PAT の値で置換

# セキュアな値のマスキング
mask_sensitive() {
    local value="$1"
    if [ ${#value} -gt 8 ]; then
        echo "${value:0:4}****${value: -4}"
    else
        echo "****"
    fi
}
```

---

### フェーズ2: 既存サーバー管理機能の実装

#### ステップ2.1: 既存サーバーの検出と一覧表示
**実装内容:**
- `claude mcp list`で既存サーバーを取得
- 設定ファイルと既存サーバーを照合
- 競合するサーバーを特定
- **出力形式の多様性に対応した堅牢な解析**

**claude mcp list の出力例とパターン:**
```
# パターン1: シンプルなリスト
msdocs
context7
github-mcp-server

# パターン2: 詳細情報付き（想定）
msdocs (http)
context7 (stdio)
github-mcp-server (http)

# パターン3: ヘッダー付き（想定）
Configured MCP Servers:
  msdocs
  context7
  github-mcp-server
```

**処理例:**
```bash
# 既存サーバー一覧を取得（複数パターンに対応）
get_existing_servers() {
    local output
    output=$(claude mcp list 2>/dev/null)
    
    if [ -z "$output" ]; then
        echo ""
        return
    fi
    
    # 出力形式の検証
    local line_count=$(echo "$output" | wc -l)
    local valid_lines=$(echo "$output" | grep -E '^[a-zA-Z0-9_-]+(\s+\(.*\))?$|^[[:space:]]+[a-zA-Z0-9_-]+' | wc -l)
    
    # 想定外フォーマットの検出
    if [ $line_count -gt 0 ] && [ $valid_lines -eq 0 ]; then
        log_error "claude mcp list の出力形式が想定外です"
        log_debug "出力内容:\n$output"
        echo ""
        echo "解決方法:"
        echo "  1. claude CLI が正しくインストールされているか確認"
        echo "  2. claude mcp list を手動で実行して出力を確認"
        echo "  3. 出力が空でない場合、開発者に報告してください"
        echo ""
        return 2  # エラーコード2 = フォーマット不正
    fi
    
    # サーバー名のみを抽出（括弧やヘッダーを除去）
    echo "$output" | \
        grep -v -i "^configured" | \
        grep -v "^$" | \
        sed 's/^[[:space:]]*//' | \
        sed 's/[[:space:]]*(.*//' | \
        grep -E '^[a-zA-Z0-9_-]+$' || echo ""
}

existing_servers=$(get_existing_servers)
existing_servers_status=$?

# 想定外フォーマットの場合は処理中断
if [ $existing_servers_status -eq 2 ]; then
    log_error "既存サーバーの取得に失敗しました（フォーマット不正）"
    exit 1
fi

# デバッグ出力（--verbose時）
log_debug "検出された既存サーバー: $existing_servers"

# 設定ファイルのサーバーと比較
for server in $servers; do
    if echo "$existing_servers" | grep -q "^$server$"; then
        conflicting_servers+=("$server")
    else
        new_servers+=("$server")
    fi
done
```

**想定外フォーマット検出時の動作:**
1. エラーログを出力
2. デバッグモード時は実際の出力内容を表示
3. 解決方法のガイダンスを表示
4. 処理を中断（exit 1）

#### ステップ2.2: ユーザー選択インターフェースの実装
**実装内容:**
- インタラクティブモードで対応方法を選択
- 非インタラクティブモード（オプション指定）のサポート
- 選択肢の明確化

**モードの定義:**

| モード | 動作 | 用途 |
|--------|------|------|
| **clean** | 既存サーバーを削除→設定ファイルから再追加 | 設定を完全にリセットしたい場合 |
| **skip** | 既存サーバーはそのまま、新規サーバーのみ追加 | 既存設定を保持したい場合 |
| **overwrite** | 既存サーバーを削除→設定ファイルから再追加（cleanと同じ） | cleanの別名 |

**ユーザーインターフェース:**
```bash
echo "既存のMCPサーバーが検出されました: ${conflicting_servers[@]}"
echo ""
echo "対応方法を選択してください:"
echo "  1) クリーンアップ（既存を削除して再追加）"
echo "  2) スキップ（既存をそのまま残す）"
echo "  3) キャンセル"
read -p "選択 [1-3]: " choice

case $choice in
    1) MODE="clean" ;;
    2) MODE="skip" ;;
    3) echo "キャンセルしました"; exit 0 ;;
    *) echo "無効な選択: $choice"; exit 1 ;;
esac
```

**UI/CLIモードマッピング:**

| インタラクティブ選択 | 内部モード | CLIオプション | 動作 |
|---------------------|-----------|--------------|------|
| 1) クリーンアップ | `clean` | `-c`, `--clean`, `--overwrite` | 削除→再追加 |
| 2) スキップ | `skip` | `-s`, `--skip` | 既存保持、新規のみ追加 |
| 3) キャンセル | - | - | 処理中断 |

**コマンドラインオプション:**
```bash
# スクリプト実行時のオプション
# -c, --clean: 自動的にクリーンアップ（既存削除→再追加）
# -s, --skip: 既存サーバーをスキップ
# -i, --interactive: インタラクティブモード（デフォルト）
# --overwrite: --clean の別名

MODE="interactive"  # デフォルト

while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--clean|--overwrite) MODE="clean"; shift ;;
        -s|--skip) MODE="skip"; shift ;;
        -i|--interactive) MODE="interactive"; shift ;;
        -d|--dry-run) DRY_RUN=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "不明なオプション: $1"; exit 1 ;;
    esac
done
```

#### ステップ2.3: 各モードの実装
**実装内容:**

1. **クリーンアップモード**
   ```bash
   for server in "${conflicting_servers[@]}"; do
       echo "削除中: $server"
       if ! claude mcp remove "$server" 2>/dev/null; then
           echo "[警告] $server の削除に失敗しました（権限不足または存在しない可能性）"
           # エラーを記録するが処理は継続
           failed_removals+=("$server")
       fi
   done
   # 削除後、新しい設定で追加
   ```

2. **スキップモード**
   ```bash
   for server in "${conflicting_servers[@]}"; do
       echo "スキップ: $server (既存の設定を保持)"
   done
   # 新規サーバーのみ追加処理へ
   ```

**エラーハンドリング戦略:**

| エラー状況 | 対処方法 | 理由 |
|-----------|---------|------|
| `claude mcp remove` 失敗 | 警告を表示して継続 | 既に削除済みの場合もあるため |
| `claude mcp add` 失敗 | エラーカウント、最後にサマリー表示 | 一部失敗でも他のサーバーは追加したい |
| 権限エラー | エラーメッセージに権限確認を含める | ユーザーが対処可能に |
| 設定ファイル不正 | 早期に終了、詳細なエラー表示 | データ破損を防ぐ |

---

### フェーズ3: サーバー追加処理の汎用化

#### ステップ3.1: サーバー追加関数の作成
**実装内容:**
- HTTPサーバー追加関数
- STDIOサーバー追加関数
- エラーハンドリングと結果のログ出力

**関数例:**
```bash
add_http_server() {
    local name="$1"
    local url="$2"
    local headers="$3"
    
    echo "追加中: $name (HTTP) ..."
    
    if [ -n "$headers" ]; then
        # ヘッダーありの場合
        if claude mcp add --transport http "$name" "$url" $headers; then
            echo "✓ $name を追加しました"
            return 0
        fi
    else
        # ヘッダーなしの場合
        if claude mcp add --transport http "$name" "$url"; then
            echo "✓ $name を追加しました"
            return 0
        fi
    fi
    
    echo "✗ $name の追加に失敗しました"
    return 1
}

add_stdio_server() {
    local name="$1"
    local command="$2"
    shift 2
    local args=("$@")
    
    echo "追加中: $name (STDIO) ..."
    
    if claude mcp add --transport stdio "$name" -- "$command" "${args[@]}"; then
        echo "✓ $name を追加しました"
        return 0
    else
        echo "✗ $name の追加に失敗しました"
        return 1
    fi
}
```

#### ステップ3.2: ループ処理による全サーバー追加
**実装内容:**
- 設定ファイルから取得した全サーバーを順次処理
- タイプに応じて適切な関数を呼び出し
- 成功・失敗をカウントし、最後にサマリーを表示

**処理フロー:**
```bash
success_count=0
fail_count=0
skip_count=0

for server in $servers; do
    # ループ開始時に変数を初期化（フェーズ1の原則に従う）
    type=""
    url=""
    headers=""
    command=""
    args=()
    
    type=$(jq -r "${SERVER_PATH}.\"${server}\".type" "$CONFIG_FILE")
    
    case "$type" in
        http)
            # HTTP用の変数を取得
            url=$(jq -r "${SERVER_PATH}.\"${server}\".url" "$CONFIG_FILE")
            
            # ヘッダーの存在確認と取得
            if jq -e "${SERVER_PATH}.\"${server}\".headers" "$CONFIG_FILE" >/dev/null 2>&1; then
                # ヘッダーをJSON形式で取得し、claude CLIの引数形式に変換
                headers=$(jq -r "${SERVER_PATH}.\"${server}\".headers | to_entries | map(\"-H \\(.key): \\(.value)\") | join(\" \")" "$CONFIG_FILE")
            fi
            
            # 環境変数の置換（URLとheadersに対して）
            url=$(resolve_env_var "$url") || { 
                log_warn "$server: 環境変数の解決に失敗（スキップ）"
                ((skip_count++))
                continue
            }
            
            if [ -n "$headers" ]; then
                headers=$(resolve_env_var "$headers") || {
                    log_warn "$server: ヘッダーの環境変数解決に失敗（スキップ）"
                    ((skip_count++))
                    continue
                }
            fi
            
            if add_http_server "$server" "$url" "$headers"; then
                ((success_count++))
            else
                ((fail_count++))
            fi
            ;;
        stdio)
            # STDIO用の変数を取得
            command=$(jq -r "${SERVER_PATH}.\"${server}\".command" "$CONFIG_FILE")
            mapfile -t args < <(jq -r "${SERVER_PATH}.\"${server}\".args[]?" "$CONFIG_FILE" 2>/dev/null || echo "")
            
            if add_stdio_server "$server" "$command" "${args[@]}"; then
                ((success_count++))
            else
                ((fail_count++))
            fi
            ;;
        *)
            log_warn "$server: 未対応のサーバータイプ '$type'（スキップ）"
            ((skip_count++))
            ;;
    esac
done

echo ""
echo "=== セットアップ結果 ==="
echo "成功: $success_count"
echo "失敗: $fail_count"
echo "スキップ: $skip_count"
```

**変数初期化の原則:**
- ループ開始時に全変数をクリア（type, url, headers, command, args）
- タイプ判定後、該当するタイプの変数のみ再取得
- 環境変数置換は取得直後に実行し、失敗時は即座にスキップ

---

### フェーズ4: エラーハンドリングとログ改善

#### ステップ4.1: 詳細なエラーメッセージ
**実装内容:**
- エラー発生時の詳細情報を提供
- トラブルシューティングのヒントを表示
- ログレベルの導入（DEBUG、INFO、WARN、ERROR）

**ログレベル定義:**

| レベル | 用途 | 出力条件 | 例 |
|--------|------|---------|-----|
| DEBUG | デバッグ情報 | `--verbose`指定時 | 変数の値、JSON解析結果 |
| INFO | 通常の処理情報 | 常時 | サーバー追加成功、処理開始 |
| WARN | 警告（処理継続） | 常時 | 環境変数未設定、削除失敗 |
| ERROR | エラー（処理中断） | 常時 | 設定ファイル不正、致命的エラー |

**実装例:**
```bash
# ログレベル設定
LOG_LEVEL="${LOG_LEVEL:-INFO}"
VERBOSE=false

log_debug() { [ "$VERBOSE" = true ] && echo "[DEBUG] $*" >&2; }
log_info() { echo "[INFO] $*"; }
log_warn() { echo "[警告] $*" >&2; }
log_error() { echo "[エラー] $*" >&2; }

# エラー時のトラブルシューティングヒント
show_troubleshooting() {
    local error_type="$1"
    case "$error_type" in
        "no_jq")
            log_error "jq がインストールされていません"
            echo "解決方法: sudo apt-get update && sudo apt-get install -y jq"
            ;;
        "permission")
            log_error "権限エラーが発生しました"
            echo "解決方法: claude CLI の設定を確認してください"
            echo "  claude mcp list で現在の設定を確認"
            ;;
        "invalid_json")
            log_error "設定ファイルのJSON形式が不正です"
            echo "解決方法: ${CONFIG_FILE} を確認してください"
            echo "  jq . ${CONFIG_FILE} で構文チェック"
            ;;
    esac
}
```

#### ステップ4.2: ドライランモード
**実装内容:**
- `--dry-run`オプションの追加
- 実際の追加処理を行わず、実行内容を表示
- 設定の検証に使用
- **期待されるログ出力の例を明示**

**実装例:**
```bash
DRY_RUN=false

execute_command() {
    local cmd="$1"
    shift
    local args=("$@")
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] 実行予定: $cmd ${args[*]}"
        return 0
    else
        log_debug "実行中: $cmd ${args[*]}"
        "$cmd" "${args[@]}"
        return $?
    fi
}

# 使用例
execute_command claude mcp add --transport http "$name" "$url"
```

**ドライラン時の期待出力:**
```
[INFO] ==== Claude Code MCP セットアップ開始（ドライランモード） ====
[INFO] 設定ファイル: /workspaces/ai-work-container/.vscode/mcp.json
[INFO] 検出されたサーバー: msdocs, context7, github-mcp-server
[INFO] 既存サーバー: msdocs, context7
[INFO] 新規サーバー: github-mcp-server
[INFO] [DRY RUN] 実行予定: claude mcp add --transport http msdocs https://learn.microsoft.com/api/mcp
[INFO] [DRY RUN] 実行予定: claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp@latest
[INFO] [DRY RUN] 実行予定: claude mcp add --transport http github-mcp-server https://api.githubcopilot.com/mcp/ -H Authorization: Bearer ghp_****
[INFO] ==== ドライラン完了 ====
[INFO] 実際に実行するには --dry-run オプションを外してください
```

---

## 📝 改善後のスクリプト仕様

### コマンドライン引数
```bash
./setup-claude-mcp.sh [OPTIONS]

OPTIONS:
  -c, --clean         既存サーバーをクリーンアップ（削除して再追加）
  -s, --skip          既存サーバーをスキップ
  -i, --interactive   インタラクティブモード（デフォルト）
  -d, --dry-run       ドライランモード（実際には追加しない）
  -v, --verbose       詳細なログを出力（DEBUGレベル）
  -h, --help          ヘルプメッセージを表示

注: --overwrite は --clean の別名として扱われます
```

### 設定ファイルの優先順位と構造

**優先順位:**
1. `.vscode/mcp.json`（最優先）
2. `.vscode/settings.json`（フォールバック）

**キー構造の違い:**

| 設定項目 | mcp.json | settings.json |
|---------|----------|---------------|
| サーバー定義 | `.servers` | `.mcp.servers` |
| 入力定義 | `.inputs` | `.mcp.inputs` |

### 環境変数とinputsマッピング

**inputs定義からの自動マッピング:**
- `${input:github_mcp_pat}` → 環境変数 `GITHUB_MCP_PAT`
- `${input:api_key}` → 環境変数 `API_KEY`
- 変換ルール: 小文字→大文字、ハイフン→アンダースコア

**必須環境変数:**
- 設定ファイルで参照されるinputsに対応する環境変数
- 未設定の場合は警告を表示し、該当サーバーの追加をスキップ

---

## ✅ テストケース

### テストケース1: 初回セットアップ
- **条件**: 既存のMCPサーバーなし
- **期待結果**: mcp.jsonの全サーバーが正常に追加される

### テストケース2: 既存サーバーありでスキップ
- **条件**: 一部のサーバーが既に登録済み
- **実行**: `./setup-claude-mcp.sh --skip`
- **期待結果**: 既存サーバーはそのまま、新規サーバーのみ追加

### テストケース3: 既存サーバーありでクリーンアップ
- **条件**: 一部のサーバーが既に登録済み
- **実行**: `./setup-claude-mcp.sh --clean`
- **期待結果**: 既存サーバーを削除後、全サーバーを再追加

### テストケース4: インタラクティブモード
- **条件**: 既存サーバーあり
- **実行**: `./setup-claude-mcp.sh --interactive`
- **期待結果**: ユーザーに選択肢を提示し、選択に応じた処理を実行

### テストケース5: ドライランモード
- **実行**: `./setup-claude-mcp.sh --dry-run`
- **期待結果**: 実行内容を表示するが、実際には追加しない
- **期待ログ例**:
  ```
  [INFO] ==== Claude Code MCP セットアップ開始（ドライランモード） ====
  [INFO] [DRY RUN] 実行予定: claude mcp add --transport http msdocs ...
  [INFO] ==== ドライラン完了 ====
  ```

### テストケース6: 環境変数未設定
- **条件**: GITHUB_MCP_PAT未設定
- **期待結果**: 警告を表示し、該当サーバーをスキップして他のサーバーは追加
- **期待ログ例**:
  ```
  [警告] 環境変数 GITHUB_MCP_PAT が未設定です（${input:github_mcp_pat} の解決に失敗）
  [INFO] github-mcp-server の追加をスキップしました
  [INFO] 成功: 2, 失敗: 0, スキップ: 1
  ```

### テストケース7: claude mcp remove 失敗
- **条件**: 削除権限なし、または既に削除済み
- **実行**: `./setup-claude-mcp.sh --clean`
- **期待結果**: 警告を表示して処理を継続
- **期待ログ例**:
  ```
  [INFO] 削除中: msdocs
  [警告] msdocs の削除に失敗しました（権限不足または存在しない可能性）
  [INFO] 追加処理を続行します...
  ```

### テストケース8: settings.jsonのみ存在
- **条件**: `.vscode/mcp.json`が存在せず、`.vscode/settings.json`のみ（mcp.servers定義あり）
- **期待結果**: settings.jsonから設定を読み込み、正常に処理
- **期待ログ例**:
  ```
  [INFO] 設定ファイル: /workspaces/ai-work-container/.vscode/settings.json (タイプ: settings - mcp.servers検出)
  [INFO] 成功: 3, 失敗: 0, スキップ: 0
  ```

### テストケース9: inputs定義が空
- **条件**: 設定ファイルにinputs配列がない、または空
- **期待結果**: 環境変数参照がないサーバーは正常に追加
- **期待ログ例**:
  ```
  [INFO] inputs定義が見つかりません（環境変数置換はスキップされます）
  [INFO] 成功: 3, 失敗: 0, スキップ: 0
  ```

### テストケース10: claude mcp listの出力形式が異なる
- **条件**: `claude mcp list`の出力にヘッダーや追加情報が含まれる
- **期待結果**: サーバー名を正しく抽出して処理
- **期待ログ例**:
  ```
  [DEBUG] claude mcp list 出力:
  Configured MCP Servers:
    msdocs (http)
    context7 (stdio)
  [DEBUG] 抽出されたサーバー名: msdocs context7
  ```

### テストケース11: settings.jsonにmcp.servers定義がない
- **条件**: `.vscode/settings.json`は存在するが`mcp.servers`キーがない、mcp.jsonも存在しない
- **期待結果**: エラーメッセージと解決方法を表示して終了
- **期待ログ例**:
  ```
  [エラー] settings.jsonにmcp.servers定義が見つかりません

  解決方法:
    1. .vscode/mcp.json を作成してMCPサーバー設定を追加
    2. .vscode/settings.json に "mcp.servers" キーを追加
  ```

### テストケース12: 設定ファイルが存在しない
- **条件**: `.vscode/mcp.json`も`.vscode/settings.json`も存在しない
- **期待結果**: エラーメッセージと必要なファイルの説明を表示して終了
- **期待ログ例**:
  ```
  [エラー] MCPサーバー設定ファイルが見つかりません

  以下のいずれかのファイルが必要です:
    - .vscode/mcp.json (推奨)
    - .vscode/settings.json (mcp.servers定義を含む)
  
  設定ファイルを作成してから再実行してください。
  ```

### テストケース13: claude mcp listが想定外フォーマット
- **条件**: `claude mcp list`が全く異なる形式（例: エラーメッセージ、HTML等）を返す
- **期待結果**: フォーマット不正エラーを表示して処理中断
- **期待ログ例**:
  ```
  [エラー] claude mcp list の出力形式が想定外です
  [DEBUG] 出力内容:
  Error: Failed to load configuration
  
  解決方法:
    1. claude CLI が正しくインストールされているか確認
    2. claude mcp list を手動で実行して出力を確認
  ```

---

## 📊 実装時の注意事項

### 変数スコープとメモリ管理
1. **ループ内変数の初期化**: 各イテレーションの開始時に変数を明示的に初期化
2. **配列の安全な操作**: `mapfile`使用時のエラーハンドリング
3. **連想配列の活用**: input→環境変数マッピングには連想配列を使用

### エラーハンドリングの原則
1. **早期検出**: 設定ファイル不正などは処理開始前にチェック
2. **継続可能性**: 一部のサーバー追加失敗でも他は継続
3. **詳細な報告**: 失敗時は原因と対処方法を明示

### セキュリティ考慮事項
1. **認証情報のマスキング**: ログ出力時にトークンを隠す
2. **環境変数の安全な扱い**: シェルインジェクション対策
3. **ファイルパーミッション**: 設定ファイルの権限確認

---

## 📦 成果物

### 1. 改善されたスクリプト
- **ファイル**: `.devcontainer/setup-claude-mcp.sh`
- **特徴**:
  - 動的な設定読み込み
  - 既存サーバー管理機能
  - コマンドラインオプション対応
  - 詳細なエラーハンドリング

### 2. ドキュメント更新
- **ファイル**: `docs/claude-code-mcp-setup.md`
- **内容**:
  - 新しいスクリプトの使用方法
  - オプションの説明
  - トラブルシューティングガイド

---

## 🎯 実装の優先順位

### 高優先度（必須）
1. ✅ フェーズ1: 設定ファイル読み込み機能
2. ✅ フェーズ2: 既存サーバー管理機能
3. ✅ フェーズ3: サーバー追加処理の汎用化

### 中優先度（推奨）
4. ⚠️ フェーズ4: エラーハンドリングとログ改善
5. ⚠️ ドライランモードの実装

### 低優先度（オプション）
6. 📝 詳細なドキュメント作成
7. 📝 テストスクリプトの作成

---

## 📅 実装スケジュール（目安）

| フェーズ | 作業内容 | 想定工数 | 主なリスク |
|---------|---------|---------|----------|
| フェーズ1 | 設定ファイル読み込み | 2-3時間 | settings.json形式の多様性 |
| フェーズ2 | 既存サーバー管理 | 3-4時間 | claude CLI の挙動の不確実性 |
| フェーズ3 | サーバー追加処理汎用化 | 2-3時間 | ヘッダー処理の複雑さ |
| フェーズ4 | エラーハンドリング改善 | 2-3時間 | 網羅的なテストの必要性 |
| テスト | 各種テストケースの実施 | 2-3時間 | 環境依存の問題 |
| **合計** | | **11-16時間** | |

---

## 🔄 今後の拡張可能性

### 将来的な改善案
1. **設定ファイルのバリデーション**
   - mcp.jsonのスキーマ検証
   - 不正な設定の早期検出

2. **複数の設定プロファイル対応**
   - 開発環境、本番環境などで異なる設定を使い分け

3. **自動アップデート機能**
   - MCPサーバーのバージョン管理
   - 定期的なアップデートチェック

4. **GUIツールとの連携**
   - VS Code拡張機能としての実装
   - 視覚的な設定管理

---

## 📚 参考情報

- 現在のスクリプト: `.devcontainer/setup-claude-mcp.sh`
- 設定ファイル: `.vscode/mcp.json`
- 関連ドキュメント: `docs/claude-code-mcp-setup.md`
- 関連issue: `ai/issues/251125_mcpscript改善.md`

---

**プラン作成者**: GitHub Copilot (Claude Sonnet 4.5)  
**最終更新**: 2025-11-25  
**レビュー**: v1.3 (第3回レビュー対応完了)

---

## 🔍 レビュー対応履歴

### v1.1 (2025-11-25)
以下のレビュー指摘に対応:

1. **settings.json構造の明確化**
   - キー構造の違いを表で整理
   - パス取得方法を動的に切り替える実装を追加

2. **変数管理の改善**
   - ループ内変数の初期化を明示
   - 配列処理のエラーハンドリングを追加

3. **環境変数置換の詳細化**
   - inputs配列とのマッピング方法を明示
   - 未設定時のフォールバック戦略を追加
   - セキュアな値のマスキング処理を追加

4. **モードの整理**
   - --clean と --overwrite の関係を明確化
   - claude mcp remove 失敗時の扱いを明記

5. **ログとテストの強化**
   - ログレベル定義を表で整理
   - 期待するログ出力例を追加
   - エラーケースのテストを追加

### v1.2 (2025-11-25)
第2回レビュー指摘に対応:

1. **UI/CLIモードの整合性確保**
   - インタラクティブ選択肢とCLIオプションのマッピング表を追加
   - 選択肢の処理フローを明示化
   - --overwriteを--cleanの別名として実装に含める

2. **環境変数マッピングの具体化**
   - 入出力例とテストパターンを追加
   - プレースホルダとマッピングキーの対応関係を明記
   - マッピング処理の流れを段階的に説明

3. **claude mcp list解析の堅牢化**
   - 複数の出力パターン例を追加
   - ヘッダーや追加情報を除去する処理を実装
   - フォールバック案とデバッグ出力を追加

4. **テストケースの拡充**
   - settings.jsonのみ存在する場合のテスト追加
   - inputs定義が空の場合のテスト追加
   - 出力形式が異なる場合のテスト追加

### v1.3 (2025-11-25)
第3回レビュー指摘と追加要件に対応:

1. **フェーズ3ループの変数管理修正**（重大）
   - ループ内変数の明示的な初期化を追加
   - タイプ別の変数取得を分離
   - 環境変数置換を取得直後に実行
   - skip_countカウンタを追加

2. **settings.json対応の厳格化**（中）
   - mcp.serversキーの存在確認を追加
   - jqコマンドの動作確認例を記載
   - キーが存在しない場合のエラーハンドリング追加

3. **inputs配列が空の場合の挙動改善**（軽微）
   - `jq -r "${INPUT_PATH}[]?.id // empty"` で安全に処理
   - inputs未定義時のログメッセージ追加

4. **claude mcp list想定外フォーマット対応**（新規）
   - フォーマット検証ロジックを追加
   - 想定外の場合は処理中断（exit 1）
   - エラーメッセージと解決方法ガイダンスを表示

5. **設定ファイル不在時の処理明確化**（新規）
   - mcp.json不在 + settings.json不在 → エラー終了
   - settings.json存在 + mcp.servers不在 → エラー終了
   - 各ケースで適切なエラーメッセージを表示

6. **テストケース追加**
   - テストケース11: settings.jsonにmcp.servers定義がない
   - テストケース12: 設定ファイルが存在しない
   - テストケース13: claude mcp listが想定外フォーマット
