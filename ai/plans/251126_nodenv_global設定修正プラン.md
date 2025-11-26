# nodenv global 設定修正プラン

## 作成日
2025年11月26日

## 関連イシュー
- `ai/issues/251126_serena導入時のエラー.md`

## 問題の背景

### 発生した問題
serena導入時のonboarding処理中にタイムアウトエラーが発生し、処理が停止した。

### 直接的な原因
`nodenv global`が設定されていなかったため、serenaがBash Language Serverのnpm依存関係をインストールする際にnpmコマンドが実行できなかった。

### 根本原因の分析
現在の`.devcontainer/post-create.sh`スクリプトには以下の問題がある:

1. **条件分岐の複雑さ**: Node.jsバージョン検出ロジックが複雑で、条件が満たされない場合にデフォルトバージョンが設定されない可能性がある
2. **フォールバック処理の不足**: `detect_node_version()`が何も返さない場合、かつnodenvが利用可能な場合にのみデフォルトバージョンを設定している
3. **確実性の欠如**: すべてのケースでnodenv globalが設定されることが保証されていない

## 現在のコードの問題箇所

### 該当部分（行189-217）
```bash
NODE_VER_RAW=$(detect_node_version || true)
NODE_VER=$(echo "$NODE_VER_RAW" | tr -d ' \n\r' || true)

if [ -n "$NODE_VER" ] && command -v nodenv >/dev/null 2>&1; then
  echo "Node.js バージョンを検出: $NODE_VER"
  if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
    echo "Node.js $NODE_VER をインストール中..."
    nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
  else
    echo "Node.js $NODE_VER は既にインストールされています。"
  fi

  # プロジェクトに .node-version がある場合はローカル設定、なければグローバル設定
  if [ -f ".node-version" ]; then
    echo "ローカルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv local "$NODE_VER" || true
  else
    echo "グローバルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv global "$NODE_VER" || true
  fi

  nodenv rehash || true
elif [ -n "$NODE_VER" ]; then
  echo "Node.js バージョン '$NODE_VER' が検出されましたが、nodenv がインストールされていません。"
else
  if [ -n "$DEFAULT_NODE_VERSION" ] && command -v nodenv >/dev/null 2>&1; then
    echo "明示的な Node.js バージョンが見つかりません。デフォルト $DEFAULT_NODE_VERSION を使用します。"
    NODE_VER="$DEFAULT_NODE_VERSION"
    if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
      echo "デフォルトの Node.js $NODE_VER をインストール中..."
      nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || true
    fi
    nodenv global "$NODE_VER" || true
    nodenv rehash || true
  else
    echo "Node.js バージョンが検出されず(.node-version / package.json engines.node)、デフォルトも適用されませんでした。"
  fi
fi
```

### 問題点の詳細
1. `detect_node_version()`が何も返さない場合、`NODE_VER`は空文字列になる
2. else節に到達した場合でも、`DEFAULT_NODE_VERSION`が設定されていない、またはnodenvが利用できない場合は何も実行されない
3. 最終的に「デフォルトも適用されませんでした」というメッセージが表示され、nodenv globalが設定されない

## 解決策

### 修正方針
1. **シンプル化**: 条件分岐をシンプルにし、デフォルトバージョンを必ず設定する
2. **確実性の向上**: nodenvが利用可能であれば、必ずglobalバージョンを設定する
3. **フォールバックの強化**: 検出失敗時は確実にデフォルトバージョンを使用する

### 修正後のロジック
```bash
# Node.js バージョンの自動検出とインストール
detect_node_version() {
  # ワークスペースルートディレクトリを取得（post-create.shの実行ディレクトリの親）
  # 通常 post-create.sh は /workspaces/<project>/.devcontainer で実行されるため
  local SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  
  # 1) .workspace_node_version ファイルの確認（優先度最高）
  if [ -f "$HOME_DIR/.workspace_node_version" ]; then
    cat "$HOME_DIR/.workspace_node_version"
    return 0
  fi

  # 2) プロジェクトルートの .node-version ファイルの確認
  if [ -f "$WORKSPACE_ROOT/.node-version" ]; then
    cat "$WORKSPACE_ROOT/.node-version"
    return 0
  fi
  
  # カレントディレクトリにも.node-versionがある場合は検出
  if [ -f ".node-version" ]; then
    cat ".node-version"
    return 0
  fi

  # 3) package.json の engines.node フィールドの確認
  local PKG_JSON="$WORKSPACE_ROOT/package.json"
  if [ -f "$PKG_JSON" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$PKG_JSON'));console.log((p.engines&&p.engines.node)||'')" 2>/dev/null || true
      return 0
    else
      NODE_ENGINE=$(grep -oP '"engines"\s*:\s*\{[^}]*"node"\s*:\s*"\K[^"]+' "$PKG_JSON" 2>/dev/null || true)
      if [ -n "$NODE_ENGINE" ]; then
        echo "$NODE_ENGINE"
        return 0
      fi
    fi
  fi

  return 1
}

# nodenv が利用可能な場合のみ、Node.js のセットアップを実行
if command -v nodenv >/dev/null 2>&1; then
  # バージョン検出
  NODE_VER_RAW=$(detect_node_version || true)
  NODE_VER=$(echo "$NODE_VER_RAW" | tr -d ' \n\r' || true)

  # 検出できなかった場合はデフォルトバージョンを使用
  if [ -z "$NODE_VER" ]; then
    NODE_VER="$DEFAULT_NODE_VERSION"
    echo "明示的な Node.js バージョンが見つかりません。デフォルト $DEFAULT_NODE_VERSION を使用します。"
  else
    echo "Node.js バージョンを検出: $NODE_VER"
  fi

  # バージョンが設定されている場合（常にtrueになるはず）
  if [ -n "$NODE_VER" ]; then
    # インストール処理
    if ! nodenv versions --bare | grep -qx "$NODE_VER"; then
      echo "Node.js $NODE_VER をインストール中..."
      nodenv install -s "$NODE_VER" || nodenv install "$NODE_VER" || {
        echo "[警告] Node.js $NODE_VER のインストールに失敗しました。"
      }
    else
      echo "Node.js $NODE_VER は既にインストールされています。"
    fi

    # グローバル設定（.node-versionがあってもglobalは設定する）
    echo "グローバルの Node.js バージョンを $NODE_VER に設定します。"
    nodenv global "$NODE_VER" || echo "[警告] nodenv global の設定に失敗しました。"

    # プロジェクトに.node-versionがある場合はローカル設定も行う
    if [ -f ".node-version" ]; then
      echo "ローカルの Node.js バージョンも $NODE_VER に設定します。"
      nodenv local "$NODE_VER" || echo "[警告] nodenv local の設定に失敗しました。"
    fi

    # rehash
    nodenv rehash || echo "[警告] nodenv rehash に失敗しました。"

    # 設定確認
    CURRENT_GLOBAL=$(nodenv global 2>/dev/null || echo "未設定")
    echo "現在のグローバルバージョン: $CURRENT_GLOBAL"
    
    # グローバル設定が正しく機能しているか検証
    # /workspaces 直下で node コマンドが実行できるか確認（1回のみ実行）
    echo "nodenv global 設定の動作確認中..."
    NODE_VERSION_OUTPUT=$(cd /workspaces && node -v 2>&1)
    NODE_CHECK_EXIT=$?
    
    if [ $NODE_CHECK_EXIT -eq 0 ]; then
      echo "✓ /workspaces で node コマンドが正常に動作します: $NODE_VERSION_OUTPUT"
    else
      echo "[警告] /workspaces で node コマンドが実行できません。nodenv global の設定を確認してください。"
      # デバッグ情報を出力
      echo "  - nodenv global: $(nodenv global 2>&1 || echo '取得失敗')"
      echo "  - nodenv which node: $(nodenv which node 2>&1 || echo '見つかりません')"
      echo "  - PATH: $PATH"
      echo "  - node -v エラー出力: $NODE_VERSION_OUTPUT"
    fi
  fi
else
  echo "[警告] nodenv が利用できません。Node.js のセットアップをスキップします。"
fi
```

## 実装手順

### ステップ1: バックアップの作成
```bash
cp .devcontainer/post-create.sh .devcontainer/post-create.sh.backup
```

### ステップ2: スクリプトの修正
`.devcontainer/post-create.sh`の該当箇所（行189-217）を上記の修正後のロジックに置き換える。

### ステップ3: 権限の確認
```bash
chmod +x .devcontainer/post-create.sh
```

### ステップ4: テスト実行
Dev Containerを再ビルドして動作確認:
```bash
# VS Code コマンドパレットから
# "Dev Containers: Rebuild Container" を実行
```

### ステップ5: 検証
コンテナ起動後に以下の順序でコマンドを実行して確認:

```bash
# 1. 基本設定の確認（優先度高）
nodenv global
nodenv versions

# 2. PATH設定の確認（node実行に失敗した場合の優先調査項目）
echo $PATH | grep -o '[^:]*nodenv[^:]*'
nodenv which node
nodenv which npm

# 3. /workspaces で node コマンドが動作するか確認（**最重要**）
cd /workspaces && node -v

# 上記が失敗した場合のリカバリ手順:
# eval "$(nodenv init -)" を実行してから再度 node -v を試行

# 4. npmの動作確認
npm --version
npm config get prefix

# 5. serena onboardingを実行
uvx --from git+https://github.com/oraios/serena serena project index --log-level DEBUG
```

### ステップ6: ドキュメント更新
serena実行手順を`docs/serena-setup.md`に記載する（詳細は後述）。

## 変更のポイント

### 1. デフォルトバージョンの必須適用
- `NODE_VER`が空の場合、必ず`DEFAULT_NODE_VERSION`を使用
- nodenvが利用可能であれば、常に何らかのバージョンがglobalに設定される

### 2. エラーハンドリングの改善
- インストール失敗時に明確な警告メッセージを表示
- 各ステップで`|| echo "[警告]..."`を使用して処理を継続

### 3. 設定確認の追加
- 最後に`nodenv global`の現在値を表示して、設定が成功したか確認できるようにする
- `nodenv which npm`でnpmのパスも確認し、正しくshimが使われているか検証
- `/workspaces`直下で`node -v`を実行し、グローバル設定が正しく機能しているか確認
  - serenaは`/workspaces`ディレクトリでnpmを実行するため、この検証が重要

### 4. グローバル設定の優先
- `.node-version`がある場合でも、**必ず**グローバル設定を行う
- これにより、プロジェクト外でもnpmが使用可能になり、serenaなどのツールが確実に動作する
- グローバル設定は他プロジェクトにも影響するが、Dev Container環境では各プロジェクトが独立しているため問題ない

### 5. ワークスペースルート基準の検索
- `detect_node_version()`関数でスクリプトの実行ディレクトリから親ディレクトリを取得
- `post-create.sh`は通常`.devcontainer`ディレクトリで実行されるため、その親がプロジェクトルート
- カレントディレクトリに依存しない確実なバージョン検出を実現

## 期待される効果

### 即時的な効果
1. Dev Container起動時に必ずnodenv globalが設定される
2. serena onboarding時にnpmコマンドが利用可能になる
3. Bash Language Serverのインストールがタイムアウトせずに完了する

### 長期的な効果
1. スクリプトの保守性向上（ロジックがシンプルになる）
2. トラブルシューティングの容易化（ログメッセージが明確）
3. 他のnpm依存ツールも問題なく動作する

## リスク評価

### 低リスク
- Dev Container環境では各プロジェクトが独立しているため、グローバル設定の影響範囲は限定的
- デフォルトバージョンが明示的に設定されているため、予測可能
- 既存の動作に対する影響は最小限

### グローバル設定の影響範囲について
- **nodenv globalを常に上書きする方針を採用**
- Dev Container内では他プロジェクトとの競合がないため、グローバル設定で問題ない
- コンテナ外の環境には影響しない（コンテナごとに独立）
- 必要に応じて`$HOME_DIR/.workspace_node_version`で上書き可能

### ディレクトリ依存性の解消
- スクリプト自身の位置から相対的にワークスペースルートを特定
- `BASH_SOURCE[0]`を使用してスクリプトのディレクトリを取得し、その親をプロジェクトルートとする
- カレントディレクトリが異なる場合でも、確実にプロジェクトの`.node-version`や`package.json`を検出できる
- 環境変数に依存しないため、より確実に動作する

## 完了条件

- [ ] `.devcontainer/post-create.sh`の修正完了
- [ ] Dev Containerの再ビルド成功
- [ ] セットアップログに「✓ /workspaces で node コマンドが正常に動作します」が表示される
- [ ] `nodenv global`でバージョンが表示される
- [ ] `/workspaces`直下で`node -v`が成功する（**最重要**）
- [ ] `nodenv which npm`が正しいshimパスを返す
- [ ] `nodenv which node`が正しいshimパスを返す
- [ ] `npm --version`が正常に動作する
- [ ] `npm config get prefix`がnodenv管理下のパスを示す
- [ ] node実行失敗時のリカバリ手順（`eval "$(nodenv init -)"`）を確認
- [ ] serena onboardingがタイムアウトせずに完了する
- [ ] `docs/serena-setup.md`にserena実行手順を記載（新規作成）
- [ ] 修正内容をコミット・プッシュ

## serena実行手順ドキュメント

### 作成するドキュメント: `docs/serena-setup.md`（新規作成）

**位置づけ**: serenaツール固有のセットアップと使用方法を記載する独立したドキュメント。他のドキュメントとのリンク戦略は今後検討。

以下の内容を記載する:

#### 1. 前提条件
- Dev Containerが正常に起動していること
- `nodenv global`が設定されていること（`post-create.sh`で自動設定）
- `npm`コマンドが利用可能であること

#### 2. serenaのインストールと実行
```bash
# uvxを使用してserenaを実行（推奨）
uvx --from git+https://github.com/oraios/serena serena project index

# デバッグモードで実行
uvx --from git+https://github.com/oraios/serena serena project index --log-level DEBUG
```

#### 3. トラブルシューティング
- npmコマンドが見つからない場合: 
  1. `nodenv global`を確認
  2. `echo $PATH | grep nodenv`でPATH設定を確認
  3. `nodenv which npm`でshimパスを確認
  4. `/workspaces`で`node -v`が動作するか確認
  5. **リカバリ**: `eval "$(nodenv init -)"`を実行してから再試行
- タイムアウトエラーが発生する場合: 
  1. `npm --version`が動作するか確認
  2. `/workspaces`ディレクトリでnodeコマンドが使えるか確認
  3. PATHとnodenv初期化状態を確認
- Language Serverのインストールに失敗する場合: 
  1. セットアップログで「✓ /workspaces で node コマンドが正常に動作」を確認
  2. ログを確認して原因特定
  3. npmのグローバル設定を確認

#### 4. 検証方法
```bash
# nodenv設定の確認
nodenv global
nodenv versions
nodenv which npm
nodenv which node

# /workspaces でのnode動作確認（serenaの実行環境）
cd /workspaces && node -v

# npm設定の確認
npm --version
npm config get prefix

# PATHの確認
echo $PATH | grep nodenv
```

## 参考情報

### 関連ドキュメント
- `docs/devcontainer-git-loading-issue.md` - Dev Container関連のトラブルシューティング
- `.devcontainer/post-create.sh` - 現在のセットアップスクリプト

### デバッグコマンド
```bash
# nodenv の状態確認
nodenv versions
nodenv global
nodenv local
nodenv which npm

# npm の確認
which npm
npm --version
npm config get prefix

# PATH の確認
echo $PATH | grep -o '[^:]*nodenv[^:]*'

# serena のログ付き実行
uvx --from git+https://github.com/oraios/serena serena project index --log-level DEBUG

# nodenv の初期化状態確認
nodenv init
eval "$(nodenv init -)"
```
