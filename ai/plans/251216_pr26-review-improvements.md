# PR#26レビュー改善プラン

作成日: 2025年12月16日
作成者: Plan Creator エージェント
ステータス: Completed
最終更新: 2025年12月16日 (v1.2 - Phase 1-4 実装完了)

## 1. 概要

### 目的
PR#26（Claude Code Skills導入）のレビュー妥当性分析で指摘された問題点を解決し、実装品質を向上させる。

### スコープ
- 対象: 妥当性分析で特定された4つの問題点の修正
  1. code-examples-search のリンク切れ修正
  2. enableAllProjectMcpServers 設定の検証と方針化
  3. github-operations/REFERENCE.md の仕様整合性確認
  4. 静的検証のテスト計画への追加
- 対象外: Phase 4の実測タスク（別途実施予定）

### 前提条件
- PR#26のブランチ（feature/claude-skills-implementation）が存在
- 妥当性分析レポート（ai/review-validations/251216_PR26_review_validation.md）が完了

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | code-examples-search のリンク整合性を確保 | 高 |
| REQ-002 | 要件 | enableAllProjectMcpServers とトークン削減目的の整合を確認 | 高 |
| REQ-003 | 要件 | github-operations/REFERENCE.md の仕様を実ツールと一致させる | 中 |
| REQ-004 | 要件 | 静的検証をテスト計画に追加 | 中 |
| CON-001 | 制約 | 既存のPhase 1-3実装を破壊しない | - |
| CON-002 | 制約 | Skills の段階的情報開示パターンを維持 | - |
| GUD-001 | ガイドライン | 各修正は独立してコミット可能な単位にする | - |

## 3. 実装ステップ

### Phase 1: リンク整合性の修正
**目標**: code-examples-search Skill のリンク切れを解消

**方針**: 他SkillsはSKILL→REFERENCEパターンを採用しているため、原則 REFERENCE.md を追加する（CON-002: 段階的情報開示パターンの維持）。例外的に削除するのは、REFERENCEに書くべき内容がゼロの場合のみ。

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | code-examples-search ディレクトリ内のファイル確認 | .claude/skills/code-examples-search/ | ファイル一覧が把握できている | [ ] |
| TASK-002 | REFERENCE.md の内容を設計 | - | context7 MCPツールの使用方法、パラメータ、使用例が定義されている | [ ] |
| TASK-003 | REFERENCE.md を作成 | .claude/skills/code-examples-search/REFERENCE.md（新規） | SKILL.md のリンク `[REFERENCE.md](REFERENCE.md)` が存在し、REFERENCE.md が同ディレクトリに存在する | [ ] |

### Phase 2: 設定と目的の整合性検証
**目標**: enableAllProjectMcpServers とトークン削減の整合を確認・文書化

**成果物の型（アウトプット定義）**:
以下の3点を docs または plan に記載する:
1. **推奨設定**: true / false / 環境別のいずれかを明示
2. **採用理由**: 初期ロード挙動の観測結果または仕様根拠
3. **トレードオフ**: 利便性（全MCP即時利用可能）vs 初期コンテキスト（トークン消費）

※仕様が不明な場合は「Phase 4実測まで保留」も結論として許容し、その場合は主張を「仮説」として記載

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | Claude Code の enableAllProjectMcpServers の仕様を調査 | - | 初期ロード挙動が明確になっている、または「仕様不明・実測必要」と判断できている | [ ] |
| TASK-005 | Skills 導入時の初期トークン消費パターンを確認（可能な範囲で） | - | true/false それぞれの挙動が把握できている、または仮説が立てられている | [ ] |
| TASK-006 | 推奨設定・採用理由・トレードオフを文書化 | ai/plans/251215_claude-code-skills-implementation.md または docs/claude-code-usage.md | 3点（推奨設定、採用理由、トレードオフ）が記載されている | [ ] |
| TASK-007 | 必要に応じて .claude/settings.json を調整 | .claude/settings.json | 設定が文書化された方針と整合している | [ ] |

### Phase 3: REFERENCE.md の仕様整合性確認
**目標**: github-operations/REFERENCE.md のパラメータ仕様を実ツールと一致させる

**情報源（ソース・オブ・トゥルース）**: Claude Code実行環境に定義されている github-mcp-server のツール定義（MCPスキーマ）を一次情報として扱う

**突合の観点**:
- 必須/任意パラメータの区別
- パラメータ名と型
- ページング方式（cursor or page）
- ソート指定の方法

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | github-mcp-server の実ツールスキーマを確認（`claude mcp list` または MCP定義から） | - | list_issues, search_issues, list_pull_requests 等の主要ツールのパラメータ仕様（必須/任意、型、ページング、ソート）が把握できている | [ ] |
| TASK-009 | REFERENCE.md の記述と実スキーマを突合 | .claude/skills/github-operations/REFERENCE.md | 必須/任意、パラメータ名、型、ページング、ソートの不一致箇所が特定されている | [ ] |
| TASK-010 | 不一致があれば REFERENCE.md を修正 | .claude/skills/github-operations/REFERENCE.md | 実スキーマと一致している | [ ] |

### Phase 4: 静的検証のテスト計画追加
**目標**: リンク切れ・ファイル存在チェックをテスト計画に組み込む

**検証スコープ（最小限）**:
1. `.claude/skills/**/SKILL.md` に `REFERENCE.md` リンクがある場合、同ディレクトリに `REFERENCE.md` が存在する
2. `SKILL.md` の frontmatter（name, description）が存在する

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-011 | 静的検証テストケースを設計（上記スコープ範囲） | - | 2つの検証項目（リンク整合性、frontmatter存在）に対するテストケースが定義されている | [ ] |
| TASK-012 | プランのテスト計画セクションに追加 | ai/plans/251215_claude-code-skills-implementation.md | TEST-012 として静的検証テストが追加されている | [ ] |
| TASK-013 | 簡易 lint スクリプトの作成（任意） | scripts/validate-skills.sh（新規） | Skills の整合性チェックが自動化されている | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 静的 | code-examples-search/SKILL.md のリンクチェック | リンク先ファイルが存在するまたはリンクが削除されている |
| TEST-002 | 静的 | 全 Skills の SKILL.md → REFERENCE.md リンク整合性 | すべてのリンクが有効 |
| TEST-003 | 動作 | enableAllProjectMcpServers の設定値確認 | .claude/settings.json が Phase 2 で文書化された推奨設定と一致している |
| TEST-004 | 動作 | Skills 導入後の初期セッション起動 | トークン消費が想定範囲内（ドキュメント記載と整合） |
| TEST-005 | 単体 | github-operations Skill の使用 | REFERENCE.md の手順通りに動作する |

## 5. 成功基準

- [ ] code-examples-search のリンク切れが解消されている
- [ ] enableAllProjectMcpServers の設定根拠がドキュメント化されている
- [ ] github-operations/REFERENCE.md の仕様が実ツールと一致している
- [ ] 静的検証がテスト計画に含まれている
- [ ] すべての修正が元プランの Phase 1-3 実装を破壊していない

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | enableAllProjectMcpServers の仕様が不明確でトークン削減効果が検証できない | 中 | 中 | Claude Code 公式ドキュメントまたは実測で確認。最悪の場合は Phase 4 の実測まで保留 |
| RISK-002 | github-operations の実スキーマが REFERENCE.md と大きく異なる | 低 | 低 | MCPツール定義から直接生成する運用に切り替え |
| RISK-003 | REFERENCE.md を追加すると初期トークン消費が増える | 低 | 低 | REFERENCE.md は必要時のみ読み込まれる前提を確認。実測で検証 |

## 7. 依存関係

- PR#26 の既存実装（Phase 1-3）
- Claude Code の enableAllProjectMcpServers 仕様
- github-mcp-server のツールスキーマ定義

## 8. 次のアクション

1. [x] Phase 1（TASK-001〜003）を実施してリンク切れを修正 - 完了（コミット: 38788b2）
2. [x] Phase 2（TASK-004〜007）で設定の妥当性を検証・文書化 - 完了（コミット: 13b5160）
3. [x] Phase 3（TASK-008〜010）で REFERENCE.md の仕様を確認 - 完了（コミット: fa914d2）
4. [x] Phase 4（TASK-011〜013）で静的検証をテスト計画に追加 - 完了（コミット: 97c9ef7）
5. [x] 修正内容を PR#26 にコミット（推奨粒度: Phase 1〜4 をそれぞれ独立したコミットとする。GUD-001 に準拠） - 完了
6. [x] プランのステータスを「Completed」に更新 - 完了
7. [ ] Phase 4（トークン削減効果の実測）の実施準備 - 別途実施予定

## 9. 変更履歴

### v1.2 (2025年12月16日)
**Phase 1-4 実装完了**

**実装内容**:
- **Phase 1**: code-examples-search/REFERENCE.md 作成（コミット: 38788b2）
- **Phase 2**: docs/claude-code-usage.md に enableAllProjectMcpServers設定を文書化（コミット: 13b5160）
- **Phase 3**: github-operations/REFERENCE.md の仕様整合性修正（コミット: fa914d2）
- **Phase 4**: 静的検証テスト追加、scripts/validate-skills.sh 作成（コミット: 97c9ef7）

**検証結果**:
- ✅ すべてのSkillsで静的検証合格（7/7）
- ✅ リンク整合性: 問題なし
- ✅ frontmatter検証: 問題なし
- ✅ REFERENCE.md仕様: 実ツールスキーマと一致

**ステータス**: Completed

### v1.1 (2025年12月16日)
**レビュー反映**: ai/reviews/251216_PR26_review_improvements_plan_review.md のフィードバックを反映

**変更内容**:
- **Must-1**: Phase 1 に方針明記（REFERENCE.md追加が本命）、完了条件を観測可能に修正
- **Must-2**: Phase 3 に情報源（ソース・オブ・トゥルース）と突合の観点を明記
- **Should-1**: Phase 2 に成果物の型（推奨設定・採用理由・トレードオフ）を定義
- **Should-2**: Phase 4 に検証スコープ（最小限）を明記
- **追加修正**: TEST-003 の期待結果を Phase 2 の結論と紐づけ
- **追加修正**: 次のアクションにコミット粒度の推奨を追加

**レビュアー**: Plan Creator エージェント
**レビュー結果**: すべてのフィードバックが妥当と判断し、プランに反映

---
*このプランは Plan Creator エージェントによって作成されました*
