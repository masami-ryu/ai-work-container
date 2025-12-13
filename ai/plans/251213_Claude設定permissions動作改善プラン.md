# Claude設定permissions動作改善プラン

作成日: 2025年12月13日
作成者: Claude Sonnet 4.5
レビュアー: GitHub Copilot (GPT-5.2 Preview)
ステータス: Rev1 (レビュー反映済み)

## 1. 概要

### 目的
`.claude/settings.json`の`permissions`設定が適用されず、allowに設定している操作でも毎回許可を求められる問題を解決する。

### スコープ
- 対象: `.claude/settings.json`のpermissions設定の見直しと最適化
- 対象: マルチプロジェクト環境での設定ファイル読み込みの検証
- 対象外: MCPサーバー設定、hooks設定（これらは正常動作中）

### 前提条件
- Claude Code CLI v2.0.69が正常にインストールされている
- `.claude/settings.json`がプロジェクトルートに存在する
- マルチプロジェクト環境（シンボリックリンク経由の共有設定）

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | allowリストに含まれるコマンドは毎回プロンプトなしで実行される | 高 |
| REQ-002 | 要件 | denyリストに含まれるコマンドは確実にブロックされる | 高 |
| REQ-003 | 要件 | askリストに含まれるコマンドは毎回確認される | 中 |
| REQ-004 | 要件 | マルチプロジェクト環境でも設定が正しく適用される | 高 |
| CON-001 | 制約 | Bash()パターンはプリフィックスマッチのみサポート（正規表現/グロブ不可） | - |
| CON-002 | 制約 | `:*`ワイルドカードは末尾にのみ使用可能（先頭一致の後続を許可） | - |
| CON-003 | 制約 | Read/Editパターンのパス解釈: `//`=絶対パス, `~`=ホーム, `/`=設定ファイル相対, `./`=CWD相対 | - |
| CON-004 | 制約 | Bashの「Yes, don't ask again」はper project directory and commandで保存（実行場所依存） | - |
| GUD-001 | ガイドライン | 公式ドキュメントの推奨パターンに従う | - |

## 3. 実装ステップ

### Phase 1: 原因調査と問題の特定
**目標**: 設定が適用されない根本原因を特定

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | 現在のBash()パターン記法の検証 | `.claude/settings.json` | 公式ドキュメントとの差異を文書化 | [x] |
| TASK-002 | 設定ファイルの読み込み優先順位を確認 | 複数の`settings.json` | `/permissions` UIでルールのソースを特定・記録、`/etc/claude-code/managed-settings.json`の有無確認、`/doctor`で健全性確認 | [ ] |
| TASK-003 | 実行ディレクトリと設定読み込みの関係を検証 | - | 同一コマンドをルート/子プロジェクト/サブディレクトリで実行し差を確認 | [ ] |
| TASK-003a | 実際にプロンプトされるコマンド文字列を採取 | - | ログ/履歴から正確なBashコマンド文字列を記録 | [ ] |

### Phase 2: 設定ファイルの最適化
**目標**: 正しい記法に修正し、より効果的な設定に変更

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | Bash()パターンを正しいプリフィックスマッチに修正 | `.claude/settings.json` | 不正確なパターンをすべて修正 | [ ] |
| TASK-005 | defaultModeを`acceptEdits`に変更して効果を検証 | `.claude/settings.json` | 変更前後の動作を比較 | [ ] |
| TASK-006 | より具体的なコマンド許可パターンに変更 | `.claude/settings.json` | よく使うコマンドを完全一致で許可 | [ ] |
| TASK-007 | 設定ファイルのバックアップ作成 | `.claude/settings.json.backup` | 変更前の状態を保存 | [ ] |

### Phase 3: マルチプロジェクト環境での検証
**目標**: シンボリックリンク経由の共有設定が正しく機能することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | プロジェクトルートからのClaude実行を検証 | - | ルートディレクトリで設定が適用されるか確認 | [ ] |
| TASK-009 | 子プロジェクトからのClaude実行を検証 | `repo/*/` | シンボリックリンク経由で設定が適用されるか確認 | [ ] |
| TASK-010 | node_modules等のサブディレクトリからの実行を検証 | `node_modules/` | 想定外の場所での動作を確認 | [ ] |

### Phase 4: ドキュメント更新
**目標**: 正しい設定方法と注意事項をドキュメント化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-011 | CLAUDE.mdにpermissions設定の注意事項を追加 | `CLAUDE.md` | 正しいパターン記法を文書化 | [ ] |
| TASK-012 | claude-code-usage.mdにトラブルシューティングを追加 | `docs/claude-code-usage.md` | permissions問題の解決方法を追加 | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 単体 | ルートで`Bash(git status:*)`を実行 | プロンプトなしで実行される |
| TEST-002 | 単体 | ルートで`Bash(npm run test:*)`を実行 | プロンプトなしで実行される |
| TEST-001a | 単体 | 同一コマンドを子プロジェクト/サブディレクトリで再実行 | プロンプトの有無を確認（ディレクトリ依存を検証） |
| TEST-003 | 単体 | `Read(./.env)`を実行 | denyリストによりブロックされる（機密ファイル保護） |
| TEST-004 | 単体 | `Bash(rm -rf:*)`を実行 | denyリストによりブロックされる（危険コマンド保護） |
| TEST-005 | 単体 | Edit/Writeで小編集を実行 | defaultMode:acceptEditsでプロンプトなし |
| TEST-006 | 統合 | プロジェクトルートでClaudeセッション開始 | `/permissions`で設定ソースを確認 |
| TEST-007 | 統合 | 子プロジェクトでClaudeセッション開始 | シンボリックリンク経由で設定が適用される |
| TEST-008 | 統合 | node_modulesディレクトリでClaudeセッション開始 | 最も近い`.claude/settings.json`が適用される |

## 5. 成功基準

- [x] 原因が特定され、文書化されている
- [ ] `.claude/settings.json`が公式推奨の記法に修正されている
- [ ] allowリストのコマンドが毎回プロンプトなしで実行できる
- [ ] マルチプロジェクト環境でも設定が正しく適用される
- [ ] ドキュメントが更新され、正しい設定方法が記載されている

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | 設定変更により予期しないコマンドが自動承認される | 高 | 低 | バックアップを作成し、段階的に変更を適用 |
| RISK-002 | `defaultMode: acceptEdits`が広範すぎて危険 | 中 | 中 | まずテスト環境で検証してから適用 |
| RISK-003 | シンボリックリンクが正しく機能しない環境がある | 中 | 低 | 各プロジェクトに`.claude/settings.local.json`を配置する代替案を用意 |
| RISK-004 | Claude Code CLIのバージョンアップで記法が変わる | 低 | 低 | 公式ドキュメントを定期的に確認 |

## 7. 依存関係

- Claude Code CLI v2.0.69以降
- 公式ドキュメント（Settings, IAM, Troubleshooting）
- マルチプロジェクト環境のシンボリックリンク設定

## 8. 次のアクション

1. [ ] 設定ファイルのバックアップを作成
2. [ ] プロジェクトルート以外からClaude実行時の動作を検証
3. [ ] `.claude/settings.json`を最適化（フェーズ2実施）
4. [ ] 最適化後の動作をテスト（テスト計画実施）
5. [ ] ドキュメントを更新（フェーズ4実施）

---

## 詳細: 判明した問題点

### 問題1: Bash()パターンの不正確な記法

**現在の記法:**
```json
"allow": [
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(npm run:*)"
]
```

**問題:**
- `:*`は「このプリフィックスで始まるコマンド」を意味し、正しい用途では機能する
- しかし、以下のケースではマッチしない：
  - `git -u diff` → マッチしない（オプションがコマンド前に来る）
  - `command git status` → マッチしない（ラッパーコマンドが前に付く）
  - エイリアスや環境変数経由の実行 → マッチしない

**重要な訂正（レビュー反映）:**
- `Bash(git status)`（`:*`なし）は**完全一致のみ**で、オプション付きは許可されない
- オプション付きを許可するには`Bash(git status:*)`が必須

**推奨される修正:**
```json
"allow": [
  "Bash(git status:*)",    // git status + 任意のオプション/引数
  "Bash(git diff:*)",      // git diff + 任意のオプション/引数
  "Bash(npm run test:*)",  // npm run test + 任意のオプション
  "Bash(npm run build:*)", // npm run build + 任意のオプション
  "Bash(git add:*)",       // git add + ファイル指定
  "Bash(git:*)"            // より広いパターン（git全コマンドを許可）
]
```

**または、より安全な具体的パターン:**
```json
"allow": [
  "Bash(git status)",      // 完全一致（オプションなし）
  "Bash(git status -s)",   // 特定のオプション組み合わせ
  "Bash(git diff)",        // 完全一致
  "Bash(git diff --stat)", // 特定のオプション組み合わせ
]
```

### 問題2: defaultModeの最適化不足

**現在の設定:**
```json
"defaultMode": "default"
```

**より効果的な設定:**
```json
"defaultMode": "acceptEdits"
```

**効果:**
- ファイル編集（Read, Write, Edit）が自動承認される
- Bashコマンドは引き続き個別の許可ルールに従う

### 問題3: 実行ディレクトリと「Yes, don't ask again」の永続性

**公式仕様（重要）:**
- Bashコマンドの「Yes, don't ask again」は **per project directory and command** で保存される
- つまり、実行時のプロジェクトディレクトリ認識が変わると、同じコマンドでも再度プロンプトされる

**検証が必要な点:**
- `/workspaces/ai-work-container`からClaudeを実行した場合の「プロジェクトディレクトリ」認識
- `/workspaces/ai-work-container/node_modules`から実行した場合の認識
- `/workspaces/ai-work-container/repo/project-a`から実行した場合の認識
- シンボリックリンク経由の設定ファイルが正しく解決されるか

**根本原因の仮説:**
実行場所が変わることで「プロジェクトディレクトリ」が異なると判断され、毎回新しいディレクトリでの初回実行として扱われている可能性が高い。

### 問題4: 設定ファイルの優先順位（追加）

**公式の優先順位（高→低）:**
1. Enterprise managed policies (`/etc/claude-code/managed-settings.json` または管理者指定パス)
2. CLI引数
3. `.claude/settings.local.json` (プロジェクトローカル、Git管理外)
4. `.claude/settings.json` (プロジェクト共有、Git管理対象)
5. `~/.claude/settings.json` (ユーザーグローバル)

**確認すべき点:**
- `/permissions` UIで現在適用されているルールのソースを特定
- 上位の設定ファイルが存在し、意図しない設定を上書きしていないか確認

---

## 参考資料

- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings.md)
- [Claude Code IAM and Access Control](https://code.claude.com/docs/en/iam.md)
- [Claude Code Troubleshooting Guide](https://code.claude.com/docs/en/troubleshooting.md)

---
*このプランはClaude Sonnet 4.5によって作成されました*
