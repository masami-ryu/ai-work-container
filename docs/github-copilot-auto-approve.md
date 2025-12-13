# GitHub Copilot Chat 自動承認設定

**作成日**: 2025年12月13日  
**最終更新**: 2025年12月13日  
**ステータス**: 実装済み

## 概要

GitHub Copilot Chat のツール実行に関する自動承認設定を、セキュリティを維持しながら作業効率を向上させるために構成しています。

## 設定ファイル

- **ファイルパス**: `.vscode/settings.json`
- **バックアップ**: `.vscode/settings.json.backup-20251213-090423`

## 設定内容

### 1. ターミナルコマンド自動承認（`chat.tools.terminal.autoApprove`）

最小許可の原則に基づき、読み取り専用コマンドのみを自動承認しています。

#### 自動承認されるコマンド（安全）

- **Git コマンド（読み取り専用）**: `git status`, `git diff`, `git log`, `git show`, `git branch`, `git remote`
- **情報表示コマンド**: `ls`, `cat`, `head`, `tail`, `grep`, `pwd`

#### 手動承認が必要なコマンド（危険）

- **ファイル削除**: `rm`, `rm -rf`, `rmdir`, `del`
- **ネットワークアクセス**: `curl`, `wget`
- **権限変更**: `chmod 777`, `chmod -R`, `sudo`
- **Git 変更操作**: `git push`, `git commit`, `git reset`, `git rebase`, `git merge`, `git add`
- **パッケージインストール**: `npm install`, `pip install`, `pip3 install`, `yarn install`

### 2. URL取得の自動承認（`chat.tools.urls.autoApprove`）

信頼できる公式ドキュメントサイトのみを自動承認しています。

#### 自動承認されるドメイン

- **Microsoft / VS Code**: `https://docs.github.com/**`, `https://code.visualstudio.com/**`, `https://learn.microsoft.com/**`
- **開発者ドキュメント**: `https://developer.mozilla.org/**`, `https://www.typescriptlang.org/**`, `https://nodejs.org/**`
- **React**: `https://reactjs.org/**`, `https://react.dev/**`
- **npm**: `https://www.npmjs.com/**`, `https://registry.npmjs.org/**`
- **Q&Aサイト**: `https://stackoverflow.com/**`

指定外のURLは都度確認プロンプトが表示されます。

### 3. グローバル自動承認

セキュリティリスク軽減のため、グローバル自動承認は**無効**に設定しています。

```json
"chat.tools.global.autoApprove": false
```

### 4. ターミナル自動承認機能の有効化

```json
"chat.tools.terminal.enableAutoApprove": true,
"chat.tools.terminal.ignoreDefaultAutoApproveRules": false
```

## セキュリティ上の注意事項

### 変更前の設定（リスク大）

```json
{
    "chat.tools.terminal.autoApprove": {
        "/.*/": true  // すべてのコマンドを自動承認（危険）
    }
}
```

この設定では、`rm -rf /`, `sudo rm -rf`, `curl | bash` などの**極めて危険なコマンド**も自動実行される可能性がありました。

### 変更後の設定（最小許可）

- 読み取り専用コマンドのみ自動承認
- 書き込み・削除・ネットワークアクセス等は手動承認必須
- 段階的な許可追加が可能

## 段階的な許可追加（オプション）

チームの方針に応じて、以下のコマンドを段階的に追加することができます：

```json
{
    "chat.tools.terminal.autoApprove": {
        // ... 既存設定 ...

        // Node.js / npm コマンド（チームで合意した場合のみ）
        "/^node\\s+/": true,
        "/^npm\\s+(run|test|start)\\b/": true,
        "/^npx\\s+/": true,

        // Python コマンド（チームで合意した場合のみ）
        "/^python3?\\s+/": true,

        // Git add コマンド（チームで合意した場合のみ）
        "/^git\\s+add\\b/": true
    }
}
```

**⚠️ 注意**: 許可を追加する際は、既存の `false` 設定との競合を避けるため、該当パターンを削除または調整してください。

## リスクと対策

### リダイレクトによる書き込みリスク

一部の読み取り専用コマンドでも、リダイレクトやオプションにより書き込みが可能です：

- `echo foo > file` - ファイル書き込み
- `find ... -delete` - ファイル削除
- `cat > file` - 標準入力からファイル書き込み

**対策**:
- 必要に応じて `echo` と `find` を許可リストから除外
- `chat.tools.terminal.blockDetectedFileWrites` を有効化（追加の安全弁）

## テスト方法

GitHub Copilot Chat で以下をテストしてください：

### 自動実行されるべきコマンド
- `git status` → 確認なしで実行
- `ls` → 確認なしで実行

### 確認プロンプトが表示されるべきコマンド
- `rm -rf` → 確認プロンプト表示
- `git push` → 確認プロンプト表示
- `npm install` → 確認プロンプト表示

## 参考資料

- [GitHub Copilot in VS Code settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)
- [Use agent mode in VS Code](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)
- プラン: `ai/plans/251213_GitHub_Copilot_Chat自動承認設定プラン.md`

## Claude Code との違い

このプロジェクトでは、Claude Code の permissions 設定（`.claude/settings.json`）も利用していますが、これは **Claude Code CLI** 専用の設定です。

- **Claude Code** (`.claude/settings.json`): Claude Code CLI のパーミッション設定
- **GitHub Copilot** (`.vscode/settings.json`): VS Code の GitHub Copilot Chat のツール実行設定

両者は異なるツールであり、設定ファイルも異なります。
