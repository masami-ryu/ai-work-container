# GitHub Copilot Chat 自動承認設定プラン

作成日: 2025年12月13日
作成者: Plan Creator エージェント
ステータス: Approved
最終更新: 2025年12月13日（v3 - 再レビュー反映版）

## 1. 概要

### 目的
GitHub Copilot Chat がMCP実行やツール実行で毎回許可を求めてくる問題を解決し、安全なコマンドは自動承認、危険な操作のみ確認するよう設定する。

**⚠️ 現状のリスク:**
- 現在の `.vscode/settings.json` には `"chat.tools.terminal.autoApprove": {"/.*/": true}` が設定されており、**すべてのコマンドが自動承認される状態**
- これはセキュリティリスクが高く、早急に最小許可の原則に基づく設定へ移行する必要がある

### スコープ
- 対象: `.vscode/settings.json` の GitHub Copilot 自動承認設定
- 対象: 現状の全許可設定から最小許可設定への移行
- 対象外: Claude Code の permissions 設定（既に適切に設定済み）

### 前提条件
- VS Code で GitHub Copilot 拡張機能がインストール済み
- GitHub Copilot Chat（Agent Mode）が有効
- プロジェクトルートに `.vscode/settings.json` が存在
- 現状設定のバックアップが作成されていること

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | 安全なターミナルコマンド（git status、npm run、node等）を自動承認 | 高 |
| REQ-002 | 要件 | MCPツールは初回承認を前提に、以後の確認を最小化（必要に応じて抑止設定を追加） | 中 |
| REQ-003 | 要件 | URL取得を信頼できるドメインのみ自動承認 | 中 |
| REQ-004 | 要件 | 危険なコマンド（rm、curl、chmod等）は自動承認しない（常に手動承認） | 高 |
| REQ-005 | 要件 | 現状の全許可設定を最小許可の原則に基づく設定へ移行 | 高 |
| CON-001 | 制約 | セキュリティを維持するため、すべてを自動承認するグローバル設定は使用しない | - |
| CON-002 | 制約 | 正規表現パターンは `/pattern/` 形式で記述（フラグ付きも可）。アンカー（^, $）の使用は推奨だが必須ではない | - |
| GUD-001 | ガイドライン | VS Code 公式ドキュメントのベストプラクティスに従う | - |
| GUD-002 | ガイドライン | プロジェクト外のファイル編集・削除は許可しない | - |
| GUD-003 | ガイドライン | 最小許可の原則：読み取り専用コマンドから段階的に許可を追加 | - |

## 3. 実装ステップ

### Phase 1: 現状確認とリスク評価
**目標**: 既存設定を保護し、現在の設定内容とリスクを把握

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | `.vscode/settings.json` のバックアップ作成 | `.vscode/settings.json` | バックアップファイルが存在する | [ ] |
| TASK-002 | 現在の Copilot 関連設定を確認 | `.vscode/settings.json` | 既存設定を把握している | [ ] |
| TASK-003 | 現状の全許可設定（`/.*/: true`）のリスクを評価 | - | セキュリティリスクを文書化 | [ ] |

### Phase 2: 最小許可設定への移行
**目標**: 現状の全許可設定を最小許可の原則に基づく設定へ置き換え

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | 全許可設定（`/.*/: true`）を削除 | `.vscode/settings.json` | 全許可パターンが削除されている | [ ] |
| TASK-005 | ターミナルコマンド自動承認設定を追加（最小許可） | `.vscode/settings.json` | 読み取り専用コマンドのみ許可 | [ ] |
| TASK-006 | URL取得の自動承認設定を追加 | `.vscode/settings.json` | `chat.tools.urls.autoApprove` が設定されている | [ ] |
| TASK-007 | 危険なコマンドの手動承認必須設定を追加 | `.vscode/settings.json` | 危険なコマンドが `false` に設定されている | [ ] |

### Phase 3: 動作確認とドキュメント更新
**目標**: 設定が正しく動作することを確認し、ドキュメントに記録

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | VS Code を再起動して設定を反映 | - | 設定が有効になっている | [ ] |
| TASK-009 | workspace 設定が効いているか確認、URL autoApprove の型確認 | - | Settings UI で `chat.tools.urls.autoApprove` の型（配列/オブジェクト）とサンプルを確認し、設定が適用されていることを確認 | [ ] |
| TASK-010 | GitHub Copilot Chat で安全なコマンドが自動実行されることを確認 | - | 確認プロンプトが表示されない | [ ] |
| TASK-011 | 危険なコマンドで確認プロンプトが表示されることを確認 | - | 確認プロンプトが表示される | [ ] |
| TASK-012 | 複合コマンド（`echo hello && git status`）の動作確認 | - | サブコマンド判定が正しく機能 | [ ] |
| TASK-013 | CLAUDE.md または docs/ に設定内容を記録 | `CLAUDE.md` または `docs/` | ドキュメントに記載されている | [ ] |

## 4. 推奨設定内容

### 重要な注意事項

**⚠️ 最小許可の原則:**
- まずは読み取り専用コマンドのみ許可
- 書き込み系コマンド（`git add`, `npm run` など）はチーム方針次第で段階的に追加
- 全許可パターン（`/.*/: true`）は使用しない

**マッチ仕様（サブコマンド判定）:**
- デフォルトでは「サブコマンド単位」で判定
- 複合コマンド（`a && b`）は**全サブコマンドが許可に一致**しないと自動承認されない
- 全コマンドライン一致が必要な場合は `matchCommandLine` を使用（高度設定）

### ターミナルコマンド自動承認（`chat.tools.terminal.autoApprove`）

#### フェーズ1: 最小許可（読み取り専用コマンドのみ）

```json
{
  "chat.tools.terminal.autoApprove": {
    // Git コマンド（読み取り専用のみ）
    "/^git\\s+(status|diff|log|show|branch|remote)\\b/": true,

    // 安全な情報表示コマンド
    "/^(ls|cat|head|tail|grep|find|tree|pwd|echo)\\b/": true,

    // 危険なコマンドは手動承認必須
    "/^rm\\b/": false,
    "/^rm\\s+-rf\\b/": false,
    "/^rmdir\\b/": false,
    "/^del\\b/": false,
    "/^curl\\b/": false,
    "/^wget\\b/": false,
    "/^chmod\\s+777\\b/": false,
    "/^chmod\\s+-R\\b/": false,
    "/^sudo\\b/": false,

    // Git の変更操作は手動承認必須
    "/^git\\s+(push|commit|reset|rebase|merge|add)\\b/": false,

    // パッケージインストールも手動承認必須
    "/^npm\\s+install\\b/": false,
    "/^pip3?\\s+install\\b/": false,
    "/^yarn\\s+install\\b/": false
  }
}
```

#### フェーズ2: 段階的に許可を追加（チーム方針に応じて）

**⚠️ 重要 - 競合回避:**
フェーズ2に移行する際は、フェーズ1で `false` に設定したコマンドとの競合を避けるため、以下のいずれかを実施してください：
- フェーズ1の該当する `false` 設定を削除
- または、より狭い正規表現に変更して競合を回避

例: `git add` をフェーズ2で許可する場合、フェーズ1の `/^git\\s+(push|commit|reset|rebase|merge|add)\\b/: false` から `add` を削除し、`/^git\\s+(push|commit|reset|rebase|merge)\\b/: false` に変更する。

```json
{
  "chat.tools.terminal.autoApprove": {
    // フェーズ1の設定に加えて...

    // Node.js / npm コマンド（チームで合意した場合のみ追加）
    "/^node\\s+/": true,
    "/^npm\\s+(run|test|start)\\b/": true,
    "/^npx\\s+/": true,

    // Python コマンド（チームで合意した場合のみ追加）
    "/^python3?\\s+/": true,

    // Git add コマンド（チームで合意した場合のみ追加）
    "/^git\\s+add\\b/": true
  }
}
```

### URL取得の自動承認（`chat.tools.urls.autoApprove`）

#### 基本設定

```json
{
  "chat.tools.urls.autoApprove": {
    // 信頼できる公式ドキュメント（リクエスト・レスポンス両方自動承認）
    "https://docs.github.com/**": true,
    "https://code.visualstudio.com/**": true,
    "https://learn.microsoft.com/**": true,
    "https://developer.mozilla.org/**": true,
    "https://www.typescriptlang.org/**": true,
    "https://nodejs.org/**": true,
    "https://reactjs.org/**": true,
    "https://react.dev/**": true,

    // Stack Overflow（信頼できるQ&Aサイト）
    "https://stackoverflow.com/**": true,

    // npm パッケージ情報
    "https://www.npmjs.com/**": true,
    "https://registry.npmjs.org/**": true

    // 指定以外のURLは未設定（都度確認）
  }
}
```

#### 高度な設定（2段階承認）

ユーザー生成コンテンツを含むサイトは、リクエストのみ自動承認し、レスポンスは手動確認する設定が可能：

```json
{
  "chat.tools.urls.autoApprove": {
    // 公式ドキュメントは全自動承認
    "https://learn.microsoft.com/**": true,

    // GitHub は request は自動承認、response は手動確認
    "https://github.com/**": {
      "approveRequest": true,
      "approveResponse": false
    },
    "https://raw.githubusercontent.com/**": {
      "approveRequest": true,
      "approveResponse": false
    }
  }
}
```

### グローバル自動承認（使用しない）

```json
{
  // セキュリティリスクが高いため、使用しない
  "chat.tools.global.autoApprove": false
}
```

### ターミナル自動承認機能の有効化

```json
{
  "chat.tools.terminal.enableAutoApprove": true,
  "chat.tools.terminal.ignoreDefaultAutoApproveRules": false
}
```

## 5. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 単体 | `git status` を Copilot Chat で実行 | 確認なしで実行される |
| TEST-002 | 単体 | `ls` を Copilot Chat で実行 | 確認なしで実行される |
| TEST-003 | 単体 | `rm -rf` を Copilot Chat で実行しようとする | 確認プロンプトが表示される |
| TEST-004 | 単体 | `git push` を Copilot Chat で実行しようとする | 確認プロンプトが表示される |
| TEST-005 | 単体 | `npm install` を Copilot Chat で実行しようとする | 確認プロンプトが表示される |
| TEST-006 | 単体 | `curl https://example.com` を実行しようとする | 確認プロンプトが表示される |
| TEST-007 | 単体 | `sudo rm -rf /` を実行しようとする | 確認プロンプトが表示される |
| TEST-008 | 統合 | `echo hello && git status` の複合コマンド | 両方のサブコマンドが許可されていれば自動実行 |
| TEST-009 | 統合 | 信頼できるURLの取得（Microsoft Learn） | 確認なしで実行される |
| TEST-010 | 統合 | 未登録URLの取得 | 確認プロンプトが表示される |

**注意:** MCPツールの自動承認はVS Code側の設定では制御できないため、初回承認後の「確認の記憶」機能に依存します。

## 6. 成功基準

- [ ] 現状の全許可設定（`/.*/: true`）が削除されている
- [ ] 最小許可の原則に基づく設定が適用されている
- [ ] 読み取り専用コマンド（git status, ls等）が確認なしで実行される
- [ ] 危険なコマンド（rm, curl, chmod 777, sudo等）で確認プロンプトが表示される
- [ ] 書き込み系コマンド（git push, npm install等）で確認プロンプトが表示される
- [ ] 複合コマンドのサブコマンド判定が正しく機能している
- [ ] 信頼できるドメインのURL取得が確認なしで行われる
- [ ] 未登録URLで確認プロンプトが表示される
- [ ] セキュリティが維持されている（グローバル自動承認は使用しない）
- [ ] workspace設定が正しく適用されている
- [ ] 設定内容がドキュメントに記録されている

## 7. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | 正規表現パターンのミスで意図しないコマンドが実行される | 高 | 中 | パターンを慎重にテストし、危険なコマンドは手動承認必須に設定 |
| RISK-002 | 自動承認設定が広すぎてセキュリティホールになる | 高 | 低 | 最小許可の原則を採用し、グローバル承認は使用しない |
| RISK-003 | VS Code のバージョンアップで設定形式が変わる | 中 | 低 | 公式ドキュメントを定期的に確認し、必要に応じて更新 |
| RISK-004 | MCPツールが悪意のある操作を実行する | 中 | 低 | 信頼できるMCPサーバーのみ使用し、定期的に監視 |
| RISK-005 | **現状の全許可設定（`/.*/: true`）によるセキュリティリスク** | **高** | **高** | **早急に最小許可設定へ移行。移行前にバックアップを作成** |

## 8. 依存関係

- VS Code バージョン: 1.99 以降（Agent Mode サポート）
- GitHub Copilot 拡張機能: 最新版
- `.vscode/settings.json` ファイル

## 9. セキュリティ考慮事項

### 自動承認すべきコマンド（安全）
- **読み取り専用の Git コマンド**: `git status`, `git diff`, `git log`, `git show`, `git branch`
- **情報表示コマンド**: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `tree`, `pwd`, `echo`
- **開発用実行コマンド**: `node`, `python`, `npm run`, `npm test`, `npm start`, `npx`
- **Claude Code MCP コマンド**: `claude mcp list`, `claude mcp status`

### 確認が必要なコマンド（潜在的に危険）
- **ファイル削除**: `rm`, `rmdir`, `del`
- **ネットワークアクセス**: `curl`, `wget`
- **権限変更**: `chmod`, `chown`, `sudo`
- **Git の変更操作**: `git push`, `git commit`, `git reset`, `git rebase`, `git merge`
- **パッケージインストール**: `npm install`, `pip install`, `pip3 install`, `yarn install`
- **Docker 操作**: `docker`, `docker-compose`

### 明示的に拒否すべきパターン
- `rm -rf` - ディレクトリの再帰的削除
- `chmod 777` - 全ユーザーへの完全な権限付与
- `sudo` - 管理者権限での実行

### ⚠️ 注意が必要な"読み取り専用"コマンド

一部のコマンドは一見安全に見えますが、オプションやリダイレクトによって書き込み操作が可能です：

**リスクのある例:**
- `echo foo > file` - リダイレクトでファイル書き込み
- `find … -delete` - ファイル削除が可能
- `cat > file` - 標準入力からファイル書き込み

**対策:**
- フェーズ1では `echo` と `find` を許可リストから除外することを推奨
- または、`chat.tools.terminal.blockDetectedFileWrites` を有効化して追加の安全弁とする
  - `"chat.tools.terminal.blockDetectedFileWrites": "prompt"` - 書き込み検知時に確認
  - `"chat.tools.terminal.blockDetectedFileWrites": "block"` - 書き込みを完全にブロック

## 10. 次のアクション

1. [ ] **重要**: 現状の全許可設定（`/.*/: true`）のリスクを理解
2. [ ] `.vscode/settings.json` のバックアップを作成
3. [ ] 現状の全許可設定を削除
4. [ ] 最小許可設定（フェーズ1: 読み取り専用のみ）を `.vscode/settings.json` に追加
5. [ ] VS Code を再起動（設定を反映）
6. [ ] workspace設定が効いているか確認
7. [ ] テスト計画に従って動作確認
8. [ ] 問題があればパターンを調整
9. [ ] チーム方針に応じて段階的に許可を追加（フェーズ2）
10. [ ] 最終的な設定内容をドキュメントに記録

## 11. 参考資料

- [GitHub Copilot in VS Code settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)
- [Use agent mode in VS Code](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)
- [Auto-approve terminal command execution in Copilot Agent Mode](https://github.com/microsoft/vscode/issues/252496)
- [VSCode / Copilot YOLO Mode - Gist](https://gist.github.com/ichim-david/8c2ad537068137a658d938b229d3adef)
- [How to Automate GitHub Copilot Agent Mode](https://naonao-na.com/en/posts/vscode-copilot-make-auto/)

## 12. 補足: Claude Code との違い

このプロジェクトでは、Claude Code の permissions 設定（`.claude/settings.json`）も利用していますが、これは **Claude Code CLI** 専用の設定です。

- **Claude Code** (`.claude/settings.json`): Claude Code CLI のパーミッション設定
- **GitHub Copilot** (`.vscode/settings.json`): VS Code の GitHub Copilot Chat のツール実行設定

両者は異なるツールであり、設定ファイルも異なります。このプランは **GitHub Copilot Chat** の自動承認設定を対象としています。

## 13. 変更履歴

### v2 (2025年12月13日) - レビュー反映版

**レビュー元**: `ai/reviews/251213_GitHub_Copilot_Chat自動承認設定プラン_レビュー.md`

**主要な変更:**

1. **現状リスクの明示化**
   - 概要セクションに現状の全許可設定（`/.*/: true`）のリスクを追記
   - RISK-005 を追加（影響度：高、発生確率：高）

2. **要件の明確化**
   - REQ-002: 「MCPツールの実行を自動承認」→「MCPツールは初回承認を前提に、以後の確認を最小化」
   - REQ-004: 「危険なコマンドは明示的に拒否」→「危険なコマンドは自動承認しない（常に手動承認）」
   - REQ-005: 現状の全許可設定を最小許可へ移行（新規追加）
   - GUD-003: 最小許可の原則（新規追加）

3. **実装ステップの強化**
   - Phase 1: 現状リスク評価タスクを追加（TASK-003）
   - Phase 2: 全許可設定削除タスクを追加（TASK-004）、タスク名を明確化
   - Phase 3: workspace設定確認、複合コマンドテスト追加（TASK-009, TASK-012）

4. **推奨設定の改善**
   - 最小許可の原則を明記
   - サブコマンド判定の説明を追加
   - フェーズ1（読み取り専用のみ）とフェーズ2（段階的追加）に分離
   - URL設定に `approveRequest/approveResponse` の2段階承認例を追加
   - `"**": false` パターンを削除（公式仕様に準拠）

5. **テスト計画の拡充**
   - TEST-008: 複合コマンドのサブコマンド判定テスト追加
   - TEST-010: 未登録URLのテスト追加
   - MCPツールの自動承認に関する注記を追加

6. **成功基準の精緻化**
   - すべて未チェック状態に変更（Draft段階との整合性）
   - 11項目に拡充（全許可設定削除、複合コマンド、workspace設定確認等）

7. **次のアクションの具体化**
   - すべて未チェック状態に変更
   - 10ステップに詳細化
   - 現状リスク理解を最優先アクションとして追加

**レビューアの主要指摘への対応:**

- ✅ Must Fix 1: 現状の全許可設定リスクを明示化
- ✅ Must Fix 2: 「拒否」という表現を「手動承認必須」に修正
- ✅ Must Fix 3: MCPツール自動承認の要件を実現可能な内容に修正
- ✅ Should Fix A: URL設定を公式仕様に準拠
- ✅ Should Fix B: terminal autoApprove のマッチ仕様を追記
- ✅ Should Fix C: workspace設定の動作確認項目を追加
- ✅ 整合性チェック: 成功基準とタスクのチェック状態を統一

### v3 (2025年12月13日) - 再レビュー反映版

**レビュー元**: `ai/reviews/251213_GitHub_Copilot_Chat自動承認設定プラン_再レビュー.md`

**判定**: 軽微な修正推奨（Approved with minor changes）

**主要な変更:**

1. **CON-002 の正規表現制約を緩和**
   - 変更前: `/^pattern$/` 形式で固定
   - 変更後: `/pattern/` 形式（フラグ付きも可）。アンカーは推奨だが必須ではない
   - 理由: 公式ドキュメントに準拠し、柔軟性を向上

2. **allow/deny 競合時の運用ルールを明記**
   - フェーズ2 の設定説明に競合回避の注意事項を追加
   - 具体例: `git add` をフェーズ2で許可する際のフェーズ1設定の調整方法
   - 目的: 設定競合による意図しない動作を防止

3. **読み取り専用コマンドの書き込みリスクを注意喚起**
   - セクション 9「セキュリティ考慮事項」に新サブセクション追加
   - リスク例: `echo > file`, `find -delete`, `cat > file`
   - 対策: `echo` と `find` の除外推奨、`blockDetectedFileWrites` の活用
   - 目的: リダイレクト等による意図しない書き込み操作を防止

4. **URL autoApprove の型確認手順を追加**
   - TASK-009 に Settings UI での型確認手順を追加
   - 確認項目: 配列/オブジェクトのどちらがサポートされているか
   - 目的: VS Code バージョンによる仕様差異への対応

**レビューアの主要指摘への対応:**

- ✅ Must Fix 1: 正規表現の書式制約を緩和
- ✅ Should Fix A: allow/deny 競合時の挙動を明記
- ✅ Should Fix B: 読み取り専用コマンドの書き込みリスクを注意喚起
- ✅ Should Fix C: URL autoApprove の型確認手順を追加

**総評:**
再レビューの指摘はすべて妥当であり、セキュリティリスクの軽減と運用時の想定外を減らすための実践的な改善を実施。

---
*このプランは Plan Creator エージェントによって作成され、レビュー結果を反映して改訂されました*
