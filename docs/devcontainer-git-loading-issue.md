# devcontainer で Git ローディングが終わらない問題

この文書は過去の調査記録。現在の [devcontainer.json](../.devcontainer/devcontainer.json) の拡張一覧には Biome を含めていない。

## 問題の概要

devcontainer でこのフォルダを開くと、VS Code の Git パネルに `Scanning folder for Git repositories...` と表示されたままローディングが終わらない問題が発生した。

- **初回ビルド直後**: 問題なく動作
- **devcontainer を一度閉じて再度開く**: Git ローディングが無限に続く

## 調査結果

### 検証した内容

1. **Git コマンド自体は正常**
   - `git status`: 即座に動作
   - `git fetch --all -vv`: すぐに完了
   - `git remote -v`: GitHub URL で正常

2. **VS Code 設定の影響なし**
   - `git.autofetch: false` に変更しても改善せず

3. **リポジトリ固有の問題ではない**
   - 空ディレクトリで `git init` だけしたミニマルリポジトリでも同じ症状が発生

4. **回避策の確認**
   - **Biome 拡張機能 (`biomejs.biome`) を無効化したら問題が解消**

### 調査時の環境情報

- VS Code: `1.106.2`
- Remote - Containers: `0.431.1`
- 問題の拡張機能: `biomejs.biome`

## 原因（推測）

Biome 拡張と VS Code / Remote Containers / Git 拡張の組み合わせによる相性問題。

考えられる要因:

- Biome 拡張がワークスペーススキャン時に Git 検出 API をフックし、処理が詰まっている
- devcontainer 環境特有のパス/権限との相性問題
- ファイルウォッチャと Git スキャンの競合

## 対処方法

### 適用済みの対処

devcontainer の拡張設定から `biomejs.biome` を除外済み。手動で追加した環境で同じ症状が出る場合は、コンテナ側の Biome 拡張を無効化して再読み込みする。

### Biome を使用したい場合

対象プロジェクトのルートで pnpm 経由の CLI を使う。このコンテナ設定リポジトリのルートには `package.json` を置いていない。

```bash
# インストール
pnpm add -D @biomejs/biome

# 実行
pnpm exec biome check .
pnpm exec biome format --write .
```

## 結論

- 調査環境では Biome 拡張の無効化で解消した。
- 内部原因や別バージョンでの再現性は未確認。
- コンテナの標準構成には Biome 拡張を含めない。
