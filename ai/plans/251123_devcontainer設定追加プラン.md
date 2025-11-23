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

### 2. node_modules のマウント除外設定
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

1. **ステップ1**: anyenv-update プラグインのインストール処理を追加
2. **ステップ2**: devcontainer.json に node_modules マウント除外設定を追加

## 検証方法

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

1. **node_modules マウント除外**: `devcontainer.json` から `mounts` 設定を削除し、コンテナを再作成
2. **anyenv-update プラグイン**: 該当のインストール処理をコメントアウトし、コンテナを再作成

## 想定される影響

### ポジティブな影響
- anyenv と nodenv を簡単に更新可能
- Node.js パッケージのインストール・実行が高速化

### 注意が必要な点
- node_modules を volume マウントにすると、ホスト側から直接アクセスできなくなる
- コンテナを削除すると named volume も削除される可能性 (明示的に削除しない限り保持される)
- 初回の `yarn install` 時は volume が空なので、通常通り時間がかかる

## 参考リソース

- [anyenv-update プラグイン](https://github.com/znz/anyenv-update)
- [nodenv 公式ドキュメント](https://github.com/nodenv/nodenv)
- [Dev Container mounts 設定](https://containers.dev/implementors/json_reference/#general-properties)
- [Docker volumes ベストプラクティス](https://docs.docker.com/storage/volumes/)
