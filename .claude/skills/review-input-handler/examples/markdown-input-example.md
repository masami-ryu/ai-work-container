# Markdown入力の例

このファイルはreview-input-handlerスキルがMarkdown形式（既存のレビュー結果ファイル）の入力を処理する例を示します。

## 入力パターン

### パターン1: 既存のレビュー結果ファイル

**入力**:
```
ai/reviews/251220_pr-123-review.md
```

**判定結果**: Markdown形式

**実行コマンド**:
```bash
# Readツールでファイル読み込み
Read ai/reviews/251220_pr-123-review.md
```

**出力**:
```
review_target_type: meta
review_context:
  diff_text: |
    # コードレビュー結果: PR #123 - Add user authentication

    ## PR情報
    - **リポジトリ**: anthropics/claude-code
    - **PR番号**: #123
    - **タイトル**: Add user authentication
    - **レビュー日時**: 2025-12-20 15:30 JST

    ## 概要
    このPRは新しいユーザー認証機能を追加します。

    ## レビュー結果

    ### コード品質: 8/10

    **Good**:
    - TypeScriptの型定義が適切
    - コンポーネント分割が適切

    **Issues**:
    - エラーハンドリングが不十分（AuthProvider.tsx:15）

    ### セキュリティ: 6/10

    **Critical**:
    - パスワードがログに出力される可能性（login.ts:25）

    **Recommendation**:
    - credentials.passwordをログから除外

    ### 総合評価: 7/10

    セキュリティ問題を修正後、承認可能。
  changed_files:
    - ai/reviews/251220_pr-123-review.md
  original_input: ai/reviews/251220_pr-123-review.md
```

**使用ケース**:
既存のレビュー結果に対して「メタレビュー」を実施する場合。レビュー自体の品質や網羅性を評価。

---

### パターン2: 相対パス指定

**入力**:
```
../reviews/251221_diff-review.md
```

**判定結果**: Markdown形式

**実行コマンド**:
```bash
Read ../reviews/251221_diff-review.md
```

**出力**:
```
review_target_type: meta
review_context:
  diff_text: |
    # コードレビュー結果: git diff main...feature/refactor-parser

    ## 差分情報
    - **コマンド**: git diff main...feature/refactor-parser
    - **レビュー日時**: 2025-12-21 10:45 JST

    ## 概要
    パーサーのリファクタリング。

    ## レビュー結果

    ### コード品質: 9/10

    **Excellent**:
    - 複雑な条件分岐を関数に分割
    - テストカバレッジ95%

    ### パフォーマンス: 9/10

    **Good**:
    - O(n²) → O(n)に改善

    ### 総合評価: 9/10

    優れたリファクタリング。承認。
  changed_files:
    - ../reviews/251221_diff-review.md
  original_input: ../reviews/251221_diff-review.md
```

---

### パターン3: 絶対パス指定

**入力**:
```
/workspaces/ai-work-container/ai/reviews/251222_meta-review.md
```

**判定結果**: Markdown形式

**実行コマンド**:
```bash
Read /workspaces/ai-work-container/ai/reviews/251222_meta-review.md
```

**出力**:
```
review_target_type: meta
review_context:
  diff_text: |
    # メタレビュー結果: 251220_pr-123-review.md

    ## レビュー対象
    - **ファイル**: ai/reviews/251220_pr-123-review.md
    - **元のPR**: #123
    - **メタレビュー日時**: 2025-12-22 14:00 JST

    ## メタレビューの目的
    レビュー自体の品質を評価。

    ## 評価結果

    ### 網羅性: 7/10

    **Good**:
    - 5つのレビュー観点すべてカバー

    **Missing**:
    - テスト観点の評価が不足

    ### エビデンス: 6/10

    **Issues**:
    - エビデンス付与率50%（目標80%）
    - ファイル参照が曖昧

    ### 改善提案

    1. テスト観点を詳細化
    2. エビデンス（公式ドキュメント、行番号）を追加

    ### 総合評価: 6.5/10

    基本的な観点は押さえているが、エビデンスの充実が必要。
  changed_files:
    - /workspaces/ai-work-container/ai/reviews/251222_meta-review.md
  original_input: /workspaces/ai-work-container/ai/reviews/251222_meta-review.md
```

---

## エラーケース

### ファイルが存在しない

**入力**:
```
ai/reviews/nonexistent-file.md
```

**エラー出力**:
```
エラー: Markdownファイルが見つかりません

ファイルパス: ai/reviews/nonexistent-file.md

ファイルの存在を確認してください:
- パスが正しいか
- ファイルが作成されているか
- 拡張子が .md か
```

### 読み取り権限がない

**入力**:
```
/root/protected-file.md
```

**エラー出力**:
```
エラー: ファイルの読み取りに失敗しました

ファイルパス: /root/protected-file.md

Readツールのエラー:
Permission denied

ファイルの読み取り権限を確認してください。
```

### Markdown以外のファイル

**入力**:
```
ai/reviews/review.txt
```

**エラー出力**:
```
エラー: 入力形式を判定できません

入力: ai/reviews/review.txt

サポートされている形式:
- PR番号/URL: #123, https://github.com/owner/repo/pull/123
- git diffコマンド: git diff --staged
- Markdownファイル: *.md

.txt ファイルは対応していません。.md ファイルを指定してください。
```

---

## メタレビューの活用例

Markdown入力（review_target_type: meta）は、既存のレビュー結果をレビューする「メタレビュー」に使用されます。

### メタレビューで評価する観点

1. **網羅性**: 5つのレビュー観点（品質/セキュリティ/パフォーマンス/テスト/設計）がカバーされているか
2. **エビデンス**: 指摘にエビデンス（行番号、公式ドキュメント、コード例）が付与されているか（目標80%以上）
3. **具体性**: フィードバックが具体的で実行可能か
4. **バランス**: Good/Issuesのバランスが適切か
5. **フォーマット**: テンプレートに従っているか

### メタレビューの出力先

メタレビューの結果も `ai/reviews/` ディレクトリに保存されます:
- 元のレビュー: `ai/reviews/251220_pr-123-review.md`
- メタレビュー: `ai/reviews/251222_meta-review-251220.md`
