# devcontainer で Git ローディングが終わらない問題

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

4. **原因の特定**
   - **Biome 拡張機能 (`biomejs.biome`) を無効化したら問題が解消**

### 環境情報

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

### 暫定対処

devcontainer の拡張設定から Biome を除外する:

`.devcontainer/devcontainer.json`:
```jsonc
"customizations": {
  "vscode": {
    "extensions": [
      "ms-ceintl.vscode-language-pack-ja",
      "eamodio.gitlens",
      "github.vscode-pull-request-github",
      "github.vscode-github-actions"
      // "biomejs.biome" を削除
    ]
  }
}
```

### Biome を使用したい場合

CLI ベースで使用する:

```bash
# インストール
npm install -D @biomejs/biome

# 実行
npx biome check .
npx biome format --write .
```

## 結論

- devcontainer の設定（`Dockerfile`, `post-create.sh`, `devcontainer.json`）自体は問題なし
- Biome 拡張と VS Code Remote Containers の組み合わせバグと判断
- 現状は devcontainer 内では Biome 拡張を無効化して運用
