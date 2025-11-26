# Serena セットアップガイド

## 概要

SerenaはAIアシスタントツールで、プロジェクトのコードベースをインデックス化し、効率的なコード検索・理解を支援します。

## 前提条件

Dev Containerが正常に起動していること。以下が自動的に設定されます：

- `nodenv global`が設定されていること（`post-create.sh`で自動設定）
- `npm`コマンドが利用可能であること
- Node.jsが正しくインストールされていること

## インストールと実行

### 基本的な実行方法

```bash
# uvxを使用してserenaを実行（推奨）
uvx --from git+https://github.com/oraios/serena serena project index
```

### デバッグモードでの実行

問題が発生した場合は、デバッグモードで詳細なログを確認できます：

```bash
uvx --from git+https://github.com/oraios/serena serena project index --log-level DEBUG
```

## トラブルシューティング

### npmコマンドが見つからない場合

以下の順序で確認してください：

1. nodenvのグローバル設定を確認
   ```bash
   nodenv global
   ```

2. PATH設定を確認
   ```bash
   echo $PATH | grep nodenv
   ```

3. npmのshimパスを確認
   ```bash
   nodenv which npm
   ```

4. /workspacesディレクトリでnode動作確認
   ```bash
   cd /workspaces && node -v
   ```

5. **リカバリ方法**：nodenv初期化を実行
   ```bash
   eval "$(nodenv init -)"
   ```
   実行後、再度serenaを試してください。

### タイムアウトエラーが発生する場合

1. npmが正常に動作するか確認
   ```bash
   npm --version
   ```

2. /workspacesディレクトリでnodeコマンドが使えるか確認
   ```bash
   cd /workspaces && node -v
   ```

3. PATHとnodenv初期化状態を確認
   ```bash
   echo $PATH | grep nodenv
   nodenv init
   ```

### Language Serverのインストールに失敗する場合

1. セットアップログで確認
   ```bash
   cat ~/.anyenv_setup.log | grep "workspaces で node"
   ```
   「✓ /workspaces で node コマンドが正常に動作」が表示されるか確認

2. npmのグローバル設定を確認
   ```bash
   npm config get prefix
   ```
   nodenv管理下のパス（例：`/home/vscode/.nodenv/versions/22.21.1`）が表示されるべきです。

3. nodenvのrehashを実行
   ```bash
   nodenv rehash
   ```

## 検証方法

serenaを実行する前に、以下のコマンドで環境が正しく設定されているか確認できます：

### nodenv設定の確認

```bash
# インストールされているバージョンの一覧
nodenv versions

# 現在のグローバルバージョン
nodenv global

# npmとnodeのshimパス
nodenv which npm
nodenv which node
```

### Node.js/npm動作確認

```bash
# Node.jsバージョン確認
node -v

# npmバージョン確認
npm --version

# npm設定確認（nodenv管理下のパスか確認）
npm config get prefix

# /workspacesでの動作確認（serenaの実行環境）
cd /workspaces && node -v
```

### PATH設定の確認

```bash
# nodenvがPATHに含まれているか確認
echo $PATH | grep nodenv
```

## 参考情報

### 関連ドキュメント

- `.devcontainer/post-create.sh` - Dev Container起動時のセットアップスクリプト
- `docs/devcontainer-git-loading-issue.md` - Dev Container関連のトラブルシューティング
- `ai/plans/251126_nodenv_global設定修正プラン.md` - nodenv設定の詳細な解説

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

# nodenv の初期化状態確認と再初期化
nodenv init
eval "$(nodenv init -)"
```

## よくある質問

### Q: serenaの実行に時間がかかります

A: 初回実行時は依存関係のインストールとプロジェクトのインデックス化に時間がかかります。デバッグモードで進行状況を確認できます。

### Q: Dev Container再起動後にnpmが使えなくなりました

A: シェルセッションでnodenvが初期化されていない可能性があります。以下を実行してください：

```bash
eval "$(nodenv init -)"
```

通常は `.bashrc` や `.zshrc` で自動的に初期化されますが、一時的な問題の場合はこのコマンドで解決します。

### Q: 複数のNode.jsバージョンを使い分けたい

A: プロジェクトごとに `.node-version` ファイルを作成することで、ローカルバージョンを設定できます：

```bash
echo "18.20.0" > .node-version
nodenv local 18.20.0
```

グローバル設定は維持され、プロジェクトディレクトリ外では引き続き使用できます。
