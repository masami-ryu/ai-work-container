# Claude Code最適化プラン

作成日: 2025年12月18日
作成者: Plan Creator エージェント
ステータス: Approved
最終更新: 2025年12月19日（レビュー結果反映 v3）

## 1. 概要

### 目的
MCP設定を最小化してトークン消費を削減し、Claude Skillsを活用して効率的な開発環境を構築する。

### スコープ
- 対象: `.vscode/mcp.json`、`.claude/skills/`（新規作成）、関連ドキュメント
- 対象外: 既存の`.claude/commands/`、`.claude/agents/`の変更

### 前提条件
- DevContainer環境が起動していること
- Claude Code CLIがインストール済みであること
- context7 MCPサーバーが接続済みであること
- ghコマンド（GitHub CLI）が利用可能であること

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | msdocs, github-mcp-server, serenaを削除（Claude Code側での利用予定無し）し、context7のみを残す | 高 |
| REQ-002 | 要件 | github-mcp-serverの機能をClaude Skillsで置き換え | 高 |
| REQ-003 | 要件 | 公式ベストプラクティス（Progressive Disclosure、Examples、Limitationsセクション）に基づいたSkills実装 | 高 |
| REQ-004 | 要件 | ドキュメントの更新 | 中 |
| CON-001 | 制約 | 既存のワークフローを破壊しない | - |
| CON-002 | 制約 | バックアップを作成してから変更 | - |
| GUD-001 | ガイドライン | Skillsは焦点を絞った単一機能（Progressive Disclosure） | - |
| GUD-002 | ガイドライン | descriptionに「何をするか」と「いつ使うか」を明記し、第三人称で記述 | - |
| GUD-003 | ガイドライン | フロントマターにname, descriptionを含める（任意でallowed-tools）。versionは本文のVersion Historyセクションに記載 | - |
| GUD-004 | ガイドライン | Markdownコンテンツは公式推奨構造（概要、主要機能、使用方法、Examples、Guidelines、Limitations）に従う | - |
| GUD-005 | ガイドライン | SKILL.md本体は500行以内に収める（最適パフォーマンス） | - |
| GUD-006 | ガイドライン | ファイルパスは常に Unix形式（/）を使用、Windowsパス（\）を避ける | - |
| GUD-007 | ガイドライン | 過剰な選択肢を提示せず、推奨アプローチを明示 | - |

## 3. 実装ステップ

### Phase 1: MCP設定の最適化
**目標**: context7のみを残し、他のMCPサーバーを削除してトークン消費を削減

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | .vscode/mcp.jsonのバックアップ作成 | .vscode/mcp.json | バックアップファイルが存在する | [ ] |
| TASK-002 | msdocs, github-mcp-server, serenaをmcp.jsonから削除 | .vscode/mcp.json | context7のみが定義されている | [ ] |
| TASK-003 | MCP設定の動作確認 | - | `claude mcp list`でcontext7のみ表示される | [ ] |

### Phase 1.5: 環境前提確認
**目標**: gh CLIとその認証状態を確認し、Skills実装の前提条件を満たす

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-003a | gh CLIバージョン確認 | - | `gh --version`が成功する | [ ] |
| TASK-003b | gh CLI認証状態確認 | - | `gh auth status`が成功する | [ ] |
| TASK-003c | ghリポジトリアクセス確認 | - | `gh repo view`が通る | [ ] |

### Phase 2: Claude Skills実装（GitHub機能）
**目標**: github-mcp-serverの機能をghコマンドベースのSkillsで置き換え

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | .claude/skills/ディレクトリ作成 | .claude/skills/ | ディレクトリが存在する | [ ] |
| TASK-005 | gh-pr-viewingスキル作成 | .claude/skills/gh-pr-viewing/SKILL.md | 公式ベストプラクティスに準拠したPR参照機能が実装されている | [ ] |
| TASK-006 | gh-issue-managingスキル作成 | .claude/skills/gh-issue-managing/SKILL.md | 公式ベストプラクティスに準拠したIssue管理機能が実装されている | [ ] |
| TASK-007 | Skills品質チェック | .claude/skills/*/SKILL.md | 付録Cのチェックリストを全て満たしている | [ ] |
| TASK-008 | Skillsの動作確認 | - | 各Skillが正しく認識される | [ ] |

### Phase 3: ドキュメント更新と動作確認
**目標**: 変更内容をドキュメントに反映し、全体の動作を確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-009 | CLAUDE.mdのMCPセクション更新 | CLAUDE.md | context7のみ記載されている | [ ] |
| TASK-010 | claude-code-usage.mdの更新 | docs/claude-code-usage.md | Skills使用方法が追記されている | [ ] |
| TASK-011 | README.mdの更新 | README.md | MCP最小構成とSkills使用が記載されている | [ ] |
| TASK-012 | claude-code-mcp-setup.mdの更新 | docs/claude-code-mcp-setup.md | 期待されるMCP一覧とセットアップ手順が更新されている | [ ] |
| TASK-013 | 統合動作確認 | - | 既存ワークフローが正常動作する | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 単体 | `claude mcp list`実行 | context7のみ表示される |
| TEST-002 | 単体 | Skillsの検出確認 | gh-pr-viewing, gh-issue-managingが認識される |
| TEST-002a | 単体 | Skillsファイル存在確認 | `ls .claude/skills/*/SKILL.md`で全Skills発見 |
| TEST-002b | 単体 | Skillsロードエラー確認 | `claude --debug`でSkillsロードエラー無し |
| TEST-003 | 品質 | Skills品質チェック | フロントマター（name, description）が存在し、versionは本文に記載 |
| TEST-004 | 品質 | Skillsコンテンツ確認 | Examples、Guidelines、Limitationsセクションが存在する |
| TEST-005 | 統合 | PR参照タスクの実行 | ghコマンドでPR情報を取得できる |
| TEST-006 | 統合 | Issue確認タスクの実行 | ghコマンドでIssue情報を取得できる |
| TEST-007 | 統合 | 既存の/planコマンド実行 | 正常にプラン作成ができる |
| TEST-008 | 評価 | Skills発見テスト | 「PRを見せて」というクエリでgh-pr-viewingが発動する |
| TEST-009 | 評価 | Skills発見テスト | 「Issueを作成して」というクエリでgh-issue-managingが発動する |
| TEST-010 | 評価 | タスク完遂テスト | Skillを使った実際のタスク（PR確認、Issue作成）が完了する |

## 5. 成功基準

### MCP最適化
- [ ] .vscode/mcp.jsonにcontext7のみが定義されている
- [ ] `claude mcp list`でcontext7のみ表示される

### Skills実装品質
- [ ] `.claude/skills/`に2つのSkills（gh-pr-viewing, gh-issue-managing）が実装されている
- [ ] 各SkillのSKILL.mdにYAMLフロントマター（name, description）が含まれる（任意でallowed-tools）
- [ ] 各Skillにdescriptionが「何をするか」と「いつ使うか」を含み、第三人称で記述されている
- [ ] 各SkillのversionはYAMLフロントマターではなく、本文のVersion Historyセクションに記載されている
- [ ] 各SkillにExamplesセクションが存在し、具体的な使用例が記載されている
- [ ] 各SkillにGuidelinesセクションが存在し、実装時の注意事項が記載されている
- [ ] 各SkillにLimitationsセクションが存在し、制限事項が明記されている（該当する場合）
- [ ] ghコマンドを使用したGitHub操作が可能

### ドキュメント・動作確認
- [ ] ドキュメントが最新の設定を反映している
- [ ] 既存ワークフロー（/plan, /review等）が正常動作する

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | MCP削除後、既存機能が動作しない | 高 | 低 | バックアップ作成、削除前に依存関係を確認 |
| RISK-002 | Skillsのdescriptionが不適切で認識されない | 中 | 中 | ベストプラクティスに従い「いつ使うか」を明記 |
| RISK-003 | ghコマンドが利用不可 | 高 | 低 | 事前に`gh --version`で確認、必要に応じてインストール |
| RISK-004 | トークン削減効果が不十分 | 低 | 低 | context7の使用頻度を監視、必要に応じて更なる最適化 |

## 7. 依存関係

- Claude Code CLI v2.0以降
- GitHub CLI (`gh`)がインストール済み
- context7 MCPサーバーが接続可能
- `.vscode/mcp.json`の編集権限

## 8. 次のアクション

1. [ ] Phase 1のタスクを実行（MCP設定最適化）
2. [ ] Phase 2のタスクを実行（Skills実装）
3. [ ] Phase 3のタスクを実行（ドキュメント更新）
4. [ ] テスト計画に基づいて動作確認
5. [ ] 変更をコミット・プッシュ

---

## 付録A: gh-pr-viewing Skillの実装案

```yaml
---
name: gh-pr-viewing
description: GitHub Pull Requestsを参照・レビューする。gh CLIでPR一覧、詳細、差分を表示する。PRレビュー、コード変更確認、またはpull requestやPR番号が言及された際に使用する。
allowed-tools: Bash, Read
---

# GitHub PR Viewing

## 概要

このスキルはGitHub CLIを使用してPull Requestsの情報を参照し、レビューを支援する。PR一覧の表示、詳細情報の取得、コード差分の確認が可能。

## 主要機能

- PR一覧の表示（オープン、クローズ、全て）
- PR詳細情報の取得（タイトル、説明、レビューステータス）
- PRの差分表示（ファイル別、行別）
- PR番号またはURL形式での指定サポート

## 使用方法

### PR一覧の表示
\`\`\`bash
# デフォルト（現在のリポジトリのオープンPR）
gh pr list

# 特定のリポジトリ
gh pr list --repo owner/repo

# 全てのPR（オープン + クローズ）
gh pr list --state all
\`\`\`

### PR詳細の表示
\`\`\`bash
# PR番号で指定
gh pr view <PR番号>

# 特定のリポジトリのPR
gh pr view <PR番号> --repo owner/repo

# URLで指定
gh pr view https://github.com/owner/repo/pull/123
\`\`\`

### PRの差分表示
\`\`\`bash
# PR番号で差分表示
gh pr diff <PR番号>

# 特定のリポジトリのPR差分
gh pr diff <PR番号> --repo owner/repo
\`\`\`

## Examples

**例1: 現在のリポジトリのオープンPRを一覧表示**
\`\`\`
User: "オープンしているPRを教えて"
Assistant: gh pr list を実行してPR一覧を表示
\`\`\`

**例2: 特定のPRの詳細を確認**
\`\`\`
User: "PR #42の内容を教えて"
Assistant: gh pr view 42 を実行してPR詳細を表示
\`\`\`

**例3: PRの変更内容を確認**
\`\`\`
User: "PR #42のコード変更を見せて"
Assistant: gh pr diff 42 を実行して差分を表示
\`\`\`

## Guidelines

- **デフォルトリポジトリ**: 引数なしの場合は現在のリポジトリを使用
- **PR番号とURL**: 両方の形式をサポート（柔軟性のため）
- **状態フィルタ**: `--state` オプションでオープン、クローズ、全てを切り替え可能
- **読み取り専用**: このスキルはPRの参照のみを行い、作成や更新は行わない

## Limitations

- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- 大きなPRの差分表示は時間がかかる場合がある

## Version History

- **1.0.0** (2025-12-19): 初版リリース
```

## 付録B: gh-issue-managing Skillの実装案

```yaml
---
name: gh-issue-managing
description: GitHub Issuesを管理する。gh CLIでIssue一覧、詳細、作成、更新を実行する。Issue確認、作成、更新、またはissueやIssue番号が言及された際に使用する。
allowed-tools: Bash, Read
---

# GitHub Issue Managing

## 概要

このスキルはGitHub CLIを使用してIssuesの管理を支援する。Issue一覧の表示、詳細情報の取得、新規Issue作成、既存Issueの更新が可能。

## 主要機能

- Issue一覧の表示（オープン、クローズ、全て）
- Issue詳細情報の取得（タイトル、説明、ラベル、アサイン）
- 新規Issueの作成（タイトル、本文、ラベル、アサイン指定）
- 既存Issueの更新（ラベル追加、アサイン変更）
- Issue番号またはURL形式での指定サポート

## 使用方法

### Issue一覧の表示
\`\`\`bash
# デフォルト（現在のリポジトリのオープンIssue）
gh issue list

# 特定のリポジトリ
gh issue list --repo owner/repo

# 全てのIssue（オープン + クローズ）
gh issue list --state all

# ラベルでフィルタ
gh issue list --label bug,enhancement
\`\`\`

### Issue詳細の表示
\`\`\`bash
# Issue番号で指定
gh issue view <Issue番号>

# 特定のリポジトリのIssue
gh issue view <Issue番号> --repo owner/repo

# URLで指定
gh issue view https://github.com/owner/repo/issues/123
\`\`\`

### Issueの作成
\`\`\`bash
# 基本的な作成
gh issue create --title "タイトル" --body "本文"

# ラベルとアサインを指定
gh issue create --title "タイトル" --body "本文" --label bug --assignee username

# 特定のリポジトリに作成
gh issue create --title "タイトル" --body "本文" --repo owner/repo
\`\`\`

### Issueの更新
\`\`\`bash
# ラベル追加
gh issue edit <Issue番号> --add-label "priority:high"

# アサイン変更
gh issue edit <Issue番号> --add-assignee username

# クローズ
gh issue close <Issue番号>
\`\`\`

## Examples

**例1: 現在のリポジトリのオープンIssueを一覧表示**
\`\`\`
User: "オープンしているIssueを教えて"
Assistant: gh issue list を実行してIssue一覧を表示
\`\`\`

**例2: 特定のIssueの詳細を確認**
\`\`\`
User: "Issue #15の内容を教えて"
Assistant: gh issue view 15 を実行してIssue詳細を表示
\`\`\`

**例3: 新しいバグIssueを作成**
\`\`\`
User: "ログイン機能のバグを報告するIssueを作成して"
Assistant: gh issue create --title "ログイン機能のバグ" --body "詳細な説明" --label bug を実行
\`\`\`

**例4: Issueにラベルを追加**
\`\`\`
User: "Issue #15に高優先度ラベルを追加して"
Assistant: gh issue edit 15 --add-label "priority:high" を実行
\`\`\`

## Guidelines

- **デフォルトリポジトリ**: 引数なしの場合は現在のリポジトリを使用
- **Issue番号とURL**: 両方の形式をサポート（柔軟性のため）
- **状態フィルタ**: `--state` オプションでオープン、クローズ、全てを切り替え可能
- **ラベルとアサイン**: 複数のラベル・アサインをカンマ区切りで指定可能
- **確認**: Issueの作成・更新前にユーザーに確認を取る

## Limitations

- GitHub CLIが認証済みである必要がある（`gh auth status`で確認）
- プライベートリポジトリにアクセスするには適切な権限が必要
- Issue作成・更新には書き込み権限が必要
- 大量のIssueを一度に操作すると時間がかかる場合がある

## Version History

- **1.0.0** (2025-12-19): 初版リリース
```

## 付録C: Skills品質チェックリスト

プラン実行時にSkillsの品質を確保するため、以下のチェックリストを使用してください。

### フロントマター（YAML）チェック

- [ ] `name`フィールドが存在し、小文字・ハイフン区切り、gerund形式（例: gh-pr-viewing, gh-issue-managing）になっている
- [ ] `name`に予約語（anthropic, claude）が含まれていない
- [ ] `description`フィールドが存在し、「何をするか」と「いつ使うか」を含んでいる
- [ ] `description`が第三人称で記述されている（「〜する」など）
- [ ] `description`が簡潔である（80文字以内推奨）
- [ ] `allowed-tools`フィールドが任意で含まれ、適切なツール名（Bash, Read, Write等）が指定されている
- [ ] `version`フィールドはフロントマターに含めず、本文の「Version History」セクションに記載している

### Markdownコンテンツチェック

#### 必須セクション
- [ ] `# [スキル名]` - H1見出しが存在する
- [ ] `## 概要` - スキルの目的と主な用途が説明されている
- [ ] `## 主要機能` - 箇条書きで主要機能がリストされている
- [ ] `## 使用方法` - 具体的な使用手順がコードブロックで示されている
- [ ] `## Examples` - 最低3つの具体的な使用例が記載されている
- [ ] `## Guidelines` - 実装時の注意事項が記載されている

#### オプションセクション（該当する場合）
- [ ] `## Limitations` - 制限事項や前提条件が明記されている
- [ ] `## Version History` - バージョン履歴が記載されている（セマンティックバージョニング形式）

#### サイズとパフォーマンス
- [ ] SKILL.md本体が500行以内（最適パフォーマンス）
- [ ] 500行を超える場合、追加コンテンツを別ファイルに分割している

### Progressive Disclosure チェック

- [ ] `description`は簡潔で、必要最小限の情報のみを含んでいる（80文字以内推奨）
- [ ] Markdownコンテンツは包括的だが焦点を絞っている
- [ ] Examples は具体的で実用的である

### コード品質チェック

- [ ] コードブロックはシンタックスハイライトが有効になっている（\`\`\`bash など）
- [ ] コマンド例にはコメントが付いている（分かりやすさのため）
- [ ] プレースホルダー（`<PR番号>` など）が明確に示されている
- [ ] ファイルパスは全てUnix形式（/）で、Windows形式（\）は使用していない
- [ ] 過剰な選択肢を提示せず、推奨アプローチを明示している
- [ ] 一貫した用語を使用している（同じ概念に異なる用語を使わない）

### ドキュメント完全性チェック

- [ ] タイポや文法エラーがない
- [ ] リンクが正しく機能する（該当する場合）
- [ ] 一貫したフォーマットが使用されている

### 参考資料

- [Claude Skills Best Practices（公式）](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Skills公式リポジトリ](https://github.com/anthropics/skills)
- [Agent Skills - Claude Code Docs](https://docs.claude.com/en/docs/claude-code/skills)
- [Creating custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)

---
*このプランは Plan Creator エージェントによって作成されました*
*最終更新: 2025年12月19日（レビュー結果反映 v3）*

## 変更履歴

### 2025年12月19日 v3（レビュー結果反映）
- **レビュー結果**: ai/reviews/251219_claude-optimization_review.md の指摘を反映
- **GUD-003修正**: frontmatter必須フィールドを「name, description（任意でallowed-tools）」に変更、versionは本文のVersion Historyへ移動
- **REQ-001具体化**: 削除対象を「msdocs, github-mcp-server, serena」と明記（Claude Code側での利用予定無し）
- **Phase 1.5追加**: 環境前提確認タスク（gh CLI確認、認証確認、リポジトリアクセス確認）を追加
- **Phase 3拡張**: README.md、claude-code-mcp-setup.mdの更新タスクを追加（ドキュメント整合性の確保）
- **テスト計画具体化**: TEST-002a/2b（Skillsファイル存在確認、ロードエラー確認）を追加
- **Skill名変更**: gerund形式に統一（gh-pr-viewer → gh-pr-viewing、gh-issue-manager → gh-issue-managing）
- **付録A/B修正**: Skill名、frontmatter（allowed-tools記法修正）、description（第三人称統一）、Version History追加
- **成功基準更新**: フロントマター要件を修正、versionの扱いを明記
- **品質チェックリスト強化**: gerund形式チェック、allowed-tools任意化、Version History記載要件を追加

### 2025年12月19日 v2
- 公式ベストプラクティス（https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices）を分析して反映
- GUD-002を更新: descriptionの第三人称記述を明記
- GUD-005追加: SKILL.md本体500行以内の推奨
- GUD-006追加: Unixパス形式の使用
- GUD-007追加: 過剰な選択肢を避ける
- 付録A, Bのdescriptionを第三人称かつ簡潔に改善
- 品質チェックリストを強化（第三人称チェック、サイズチェック、アンチパターンチェック）
- テスト計画に評価テスト（TEST-008〜010）を追加
- 参考資料に公式ベストプラクティスへのリンクを追加

### 2025年12月18日 v1
- 初版作成
