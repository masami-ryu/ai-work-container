# devcontainer 設定追加

## 課題
- anyenv update のプラグインが導入されていない。
- nodenv rehash のコマンドが実行されていない。
- node_modules がマウントされるのでパフォーマンスが悪い。

## タスク
`.devcontainer/post-create.sh` を修正する。
- anyenv update プラグインを導入する。
- nodenv rehash コマンドを実行する。
- node_modules をマウントしないように設定する。