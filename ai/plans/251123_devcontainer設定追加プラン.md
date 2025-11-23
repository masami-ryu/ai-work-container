# devcontainer 設定追加プラン

## 目的
devcontainer の開発環境を改善し、以下の課題を解決する:
- anyenv update プラグインが導入されていない
- node_modules がマウントされることでパフォーマンスが低下している

## 前提条件
- `.devcontainer/post-create.sh` が既に存在している
- `.devcontainer/devcontainer.json` が設定されている
- anyenv と nodenv が post-create.sh でセットアップされている

## 実装ステップ

### 1. anyenv-update プラグインの導入
**目的**: anyenv と配下の **env (nodenv 含む) を一括で更新できるようにする

**作業内容**:
- `post-create.sh` に anyenv-update プラグインのインストール処理を追加
- anyenv のプラグインディレクトリ (`$ANYENV_DIR/plugins/anyenv-update`) を作成
- GitHub から公式の anyenv-update リポジトリをクローン

**実装位置**: 
- anyenv 初期化後、nodenv インストール前のセクション
- 既存の anyenv-install 定義リポジトリ準備の後

**コード例**:
```bash
# anyenv-update プラグインのインストール
ANYENV_UPDATE_DIR="$ANYENV_DIR/plugins/anyenv-update"
if [ ! -d "$ANYENV_UPDATE_DIR" ]; then
  mkdir -p "$ANYENV_DIR/plugins"
  if git clone https://github.com/znz/anyenv-update.git "$ANYENV_UPDATE_DIR"; then
    echo "anyenv-update プラグインをインストールしました。"
  else
    echo "[警告] anyenv-update プラグインのクローンに失敗しました。"
  fi
else
  echo "anyenv-update プラグインは既にインストールされています。"
  # 既存の場合は最新に更新
  (cd "$ANYENV_UPDATE_DIR" && git fetch --depth 1 origin && git reset --hard origin/HEAD || echo "[警告] anyenv-update の更新に失敗しました")
fi
```

### 2. GitHub Copilot CLI の導入
**目的**: devcontainer 内で GitHub Copilot CLI を使用可能にし、コマンドライン上でAIアシスタンスを受けられるようにする

**作業内容**:
- `post-create.sh` に GitHub Copilot CLI のインストール処理を追加
- npm を使ってグローバルインストール
- PATH を設定して copilot コマンドを利用可能にする
- nodenv の shim を更新

**実装位置**: 
- Node.js のインストールとバージョン設定の後
- スクリプトの最後のセクション

**コード例**:
```bash
# GitHub Copilot CLI のインストール
echo "GitHub Copilot CLI をインストール中..."
if command -v node >/dev/null 2>&1; then
  npm install -g @github/copilot || echo "[警告] GitHub Copilot CLI のインストールに失敗しました。"
  
  # npm グローバル bin ディレクトリを PATH に追加（現在のセッション用）
  NPM_BIN_DIR="$(npm bin -g 2>/dev/null || true)"
  if [ -n "$NPM_BIN_DIR" ]; then
    export PATH="$NPM_BIN_DIR:$PATH"
    echo "GitHub Copilot CLI をインストールしました。"
    echo "PATH に npm グローバル bin を追加: $NPM_BIN_DIR"
    
    # .bashrc への PATH 設定追加（永続化・重複チェック付き）
    # 複数回実行されても既存の設定はスキップされる
    if ! grep -q "# GitHub Copilot CLI" ~/.bashrc; then
      echo "" >> ~/.bashrc
      echo "# GitHub Copilot CLI" >> ~/.bashrc
      echo "export PATH=\"$NPM_BIN_DIR:\\\$PATH\"" >> ~/.bashrc
      echo ".bashrc に npm グローバル bin の PATH を追加しました: $NPM_BIN_DIR"
      
      # 即座に設定を反映（現在のセッションで利用可能にする）
      source ~/.bashrc || true
    else
      echo ".bashrc には既に GitHub Copilot CLI の設定が存在します。"
      echo "※ PATH が変更されている場合は、手動で .bashrc の該当行を更新してください。"
    fi
  fi
  
  # nodenv の shim を更新
  if command -v nodenv >/dev/null 2>&1; then
    nodenv rehash || true
  fi
else
  echo "[警告] Node.js がインストールされていないため、GitHub Copilot CLI のインストールをスキップします。"
fi
```

**注意事項**:
- Node.js が正常にインストールされた後に実行される必要がある
- `.bashrc` には `npm bin -g` の動的実行ではなく、post-create 時に解決された絶対パスを設定する（起動時の警告を回避）
- `$PATH` は `\$PATH` として記述し、シェルセッション開始時に展開される形で保存される
- 設定追加後に `source ~/.bashrc` を実行し、post-create 実行直後から Copilot CLI を利用可能にする
- 設定は post-create.sh 内で完結するため、別途 postCreateCommand は不要
- 複数回実行されても既存の設定はコメント行で判定してスキップされる（既存設定がある場合、PATH が変更されていても自動更新されないため、必要に応じて手動で .bashrc の該当行を修正する必要がある）

### 3. node_modules のマウント除外設定
**目的**: Docker ボリュームマウントから node_modules を除外し、コンテナ内のファイルシステムに配置することでパフォーマンスを向上

**作業内容**:
- `devcontainer.json` に `mounts` 設定を追加
- node_modules ディレクトリを named volume としてマウント
- プロジェクト固有の名前を付けることで、他のコンテナとの競合を回避

**実装方法**:
```json
{
  "mounts": [
    "type=volume,source=ai-work-container-node_modules,target=/workspaces/ai-work-container/node_modules"
  ]
}
```

**採用理由**:
- 明示的なボリューム名（`ai-work-container-node_modules`）により、プロジェクト識別が容易
- 他の devcontainer プロジェクトと volume 名が衝突しない
- コンテナ再作成時にも `docker volume ls` で簡単に識別・管理可能

**注意事項**:
- コンテナ再作成時に node_modules が保持される（ボリュームを手動削除しない限り）
- `yarn install` や `npm install` 時のパフォーマンスが向上
- ホスト側から node_modules に直接アクセスできなくなる（コンテナ経由のみ）

## 実装順序

1. **ステップ1**: anyenv-update プラグインのインストール処理を post-create.sh に追加（anyenv 初期化後、nodenv インストール前）
2. **ステップ2**: GitHub Copilot CLI のインストール処理を post-create.sh に追加（Node.js インストール後、スクリプト末尾）
3. **ステップ3**: devcontainer.json に node_modules マウント除外設定を追加

## 検証方法

### GitHub Copilot CLI の確認
```bash
# コンテナ内で実行
copilot --version
```
- コマンドが正常に実行され、バージョン情報が表示されること
- `which copilot` でパスが表示されること

### anyenv-update プラグインの確認
```bash
# コンテナ内で実行
anyenv update
```
- エラーなく実行され、anyenv と nodenv の更新状態が表示されること

### node_modules マウント除外の確認
```bash
# コンテナ内で実行
yarn install  # または npm install
# パフォーマンスを計測
time yarn install
```
- インストール時間が短縮されていること
- `df -h` や `mount | grep node_modules` でマウント状態を確認

## ロールバック方法

各変更は独立しているため、問題が発生した場合は以下の順で個別にロールバック可能:

1. **GitHub Copilot CLI**: post-create.sh の該当処理をコメントアウトし、`.bashrc` から関連行を削除してコンテナを再作成（または `npm uninstall -g @github/copilot` を実行）
2. **anyenv-update プラグイン**: post-create.sh の該当処理をコメントアウトし、コンテナを再作成
3. **node_modules マウント除外**: `devcontainer.json` から `mounts` 設定を削除し、コンテナを再作成

## 想定される影響

### ポジティブな影響
- コマンドライン上で GitHub Copilot を使用可能（コード生成、説明、デバッグ支援など）
- anyenv と nodenv を簡単に更新可能
- Node.js パッケージのインストール・実行が高速化

### 注意が必要な点
- node_modules を volume マウントにすると、ホスト側から直接アクセスできなくなる
- コンテナを削除すると named volume も削除される可能性 (明示的に削除しない限り保持される)
- 初回の `yarn install` 時は volume が空なので、通常通り時間がかかる

## 参考リソース

- [GitHub Copilot CLI](https://www.npmjs.com/package/@github/copilot)
- [anyenv-update プラグイン](https://github.com/znz/anyenv-update)
- [nodenv 公式ドキュメント](https://github.com/nodenv/nodenv)
- [Dev Container mounts 設定](https://containers.dev/implementors/json_reference/#general-properties)
- [Docker volumes ベストプラクティス](https://docs.docker.com/storage/volumes/)
