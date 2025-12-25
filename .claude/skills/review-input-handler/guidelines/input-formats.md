# 入力形式ガイドライン

このドキュメントはreview-input-handlerスキルがサポートする入力形式の詳細仕様を定義します。

## Contents
- [入力形式の判定優先順位](#入力形式の判定優先順位)
- [PR形式](#pr形式)
- [git diff形式](#git-diff形式)
- [Markdown形式](#markdown形式)
- [判定フローチャート](#判定フローチャート)
- [エッジケース](#エッジケース)

## 入力形式の判定優先順位

入力は以下の優先順位で判定されます。最初にマッチしたパターンが採用されます。

| 優先順位 | 形式 | 判定パターン | 理由 |
|---------|------|------------|------|
| 1 | PR URL | `https://github.com/.*/pull/[0-9]+` | 最も明示的 |
| 2 | PR番号（#付き） | `^#[0-9]+$` | PR意図が明確 |
| 3 | PR番号のみ | `^[0-9]+$` | 数字のみはPRと想定 |
| 4 | git diff | `^git diff` | コマンド文字列として明確 |
| 5 | Markdown | `.md$` かつファイル存在 | 拡張子で判定 |

**優先順位の理由**:
- URL形式が最優先: 他の形式と誤判定する可能性が最も低い
- git diffが数字のみより後: `git diff 123` のようなコミットハッシュを考慮
- Markdownが最後: ファイル存在確認が必要でコストが高い

## PR形式

### 対応パターン

#### 1. PR URL（フル）

**パターン**:
```
https://github.com/{owner}/{repo}/pull/{number}
```

**例**:
```
https://github.com/anthropics/claude-code/pull/123
https://github.com/octocat/Hello-World/pull/456
```

**抽出情報**:
- `owner/repo`: URLから直接抽出（例: `anthropics/claude-code`）
- `pr_number`: URLから直接抽出（例: `123`）

**実行コマンド**:
```bash
gh pr view {number} --repo {owner/repo}
gh pr diff {number} --repo {owner/repo}
gh pr view {number} --repo {owner/repo} --json files --jq '.files[].path'
```

---

#### 2. PR番号（#付き）

**パターン**:
```
#{number}
```

**例**:
```
#123
#4567
```

**抽出情報**:
- `owner/repo`: 現在のディレクトリから取得
- `pr_number`: `#` を除いた数字部分（例: `123`）

**実行コマンド**:
```bash
# リポジトリ情報を取得
gh repo view --json nameWithOwner --jq '.nameWithOwner'

# PR情報を取得
gh pr view {number}
gh pr diff {number}
gh pr view {number} --json files --jq '.files[].path'
```

---

#### 3. PR番号のみ

**パターン**:
```
{number}
```

**例**:
```
123
4567
```

**抽出情報**:
- `owner/repo`: 現在のディレクトリから取得
- `pr_number`: 入力された数字（例: `123`）

**実行コマンド**:
PR番号（#付き）と同じ

**注意事項**:
- 数字のみの入力は常にPR番号として扱われます
- git diffでコミットハッシュに数字のみを使いたい場合は `git diff 123` のように明示してください

---

### 情報取得の詳細

#### gh pr view

**目的**: PRの基本情報（タイトル、本文、ステータス）を取得

**コマンド例**:
```bash
gh pr view 123
gh pr view 123 --repo anthropics/claude-code
```

**出力例**:
```
Add user authentication #123
Draft • user wants to merge 3 commits into main from feature/auth

  This PR adds user authentication using JWT tokens.

  Changes:
  - Add AuthProvider component
  - Implement login/logout functions
  - Add protected route wrapper

View this pull request on GitHub: https://github.com/anthropics/claude-code/pull/123
```

#### gh pr diff

**目的**: PRの差分を取得

**コマンド例**:
```bash
gh pr diff 123
gh pr diff 123 --repo anthropics/claude-code
```

**出力例**:
```
diff --git a/src/auth/AuthProvider.tsx b/src/auth/AuthProvider.tsx
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/auth/AuthProvider.tsx
@@ -0,0 +1,25 @@
+import React from 'react';
...
```

#### gh pr view --json files

**目的**: 変更ファイル一覧を取得

**コマンド例**:
```bash
gh pr view 123 --json files --jq '.files[].path'
```

**出力例**:
```
src/auth/AuthProvider.tsx
src/auth/types.ts
src/App.tsx
tests/auth/AuthProvider.test.tsx
```

---

## git diff形式

### 対応パターン

git diffで始まる任意のコマンド文字列を受け付けます。

#### 1. ステージされた変更

**パターン**:
```
git diff --staged
git diff --cached
```

**実行コマンド**:
```bash
git diff --staged
git diff --staged --name-status
```

---

#### 2. ブランチ間差分

**パターン**:
```
git diff {base}...{head}
git diff {base}..{head}
```

**例**:
```
git diff main...feature/add-auth
git diff develop..feature/refactor
```

**実行コマンド**:
```bash
git diff main...feature/add-auth
git diff main...feature/add-auth --name-status
```

**注意事項**:
- `...` (3つのドット): マージベースからの差分
- `..` (2つのドット): 直接的な差分
- 詳細は `git help diff` を参照

---

#### 3. コミット範囲

**パターン**:
```
git diff {commit1}..{commit2}
git diff {commit}
```

**例**:
```
git diff abc123..def456
git diff HEAD~3..HEAD
git diff abc123
```

**実行コマンド**:
```bash
git diff abc123..def456
git diff abc123..def456 --name-status
```

---

#### 4. ファイル/ディレクトリ指定

**パターン**:
```
git diff {ref} -- {path}
```

**例**:
```
git diff HEAD -- src/utils/
git diff main...feature -- src/auth/ tests/
```

**実行コマンド**:
```bash
git diff HEAD -- src/utils/
git diff HEAD --name-status -- src/utils/
```

---

### 情報取得の詳細

#### git diff

**目的**: 差分テキストを取得

**実行**: 入力されたコマンドをそのまま実行

**出力**: unified diff形式

#### git diff --name-status

**目的**: 変更ファイル一覧をステータス付きで取得

**実行**: 元のコマンドに `--name-status` を追加

**出力例**:
```
M   src/components/Button.tsx
A   tests/components/Button.test.tsx
D   src/legacy/OldButton.tsx
```

**ステータス**:
- `M`: Modified（変更）
- `A`: Added（追加）
- `D`: Deleted（削除）
- `R`: Renamed（名前変更）
- `C`: Copied（コピー）

---

## Markdown形式

### 対応パターン

拡張子が `.md` で、ファイルが存在するパスを受け付けます。

#### 1. 相対パス

**パターン**:
```
{relative-path}.md
```

**例**:
```
ai/reviews/251220_pr-123-review.md
../reviews/251221_diff-review.md
./docs/review.md
```

**実行コマンド**:
```bash
Read ai/reviews/251220_pr-123-review.md
```

---

#### 2. 絶対パス

**パターン**:
```
/{absolute-path}.md
```

**例**:
```
/workspaces/ai-work-container/ai/reviews/251220_pr-123-review.md
/home/user/documents/review.md
```

**実行コマンド**:
```bash
Read /workspaces/ai-work-container/ai/reviews/251220_pr-123-review.md
```

---

### 情報取得の詳細

#### Read tool

**目的**: Markdownファイルの内容を読み込み

**実行**: Readツールでファイルパスを指定

**出力**: ファイルの全内容

**用途**: メタレビュー（既存のレビュー結果を評価）

---

## 判定フローチャート

```
入力受信
  ↓
┌─────────────────────────┐
│ https://github.com で始まる? │ → Yes → PR URL形式
│ かつ /pull/ を含む?      │
└─────────────────────────┘
  ↓ No
┌─────────────────────────┐
│ ^#[0-9]+$ にマッチ?     │ → Yes → PR番号（#付き）形式
└─────────────────────────┘
  ↓ No
┌─────────────────────────┐
│ ^[0-9]+$ にマッチ?      │ → Yes → PR番号のみ形式
└─────────────────────────┘
  ↓ No
┌─────────────────────────┐
│ ^git diff で始まる?     │ → Yes → git diff形式
└─────────────────────────┘
  ↓ No
┌─────────────────────────┐
│ .md$ で終わる?          │ → Yes → ファイル存在確認
│                         │           ↓
│                         │         存在する → Markdown形式
│                         │         存在しない → エラー
└─────────────────────────┘
  ↓ No
エラー: 入力形式を判定できません
```

---

## エッジケース

### ケース1: 数字のみの入力

**入力**: `123`

**判定**: PR番号形式（優先順位3）

**理由**:
- git diffでコミットハッシュ `123` を使う可能性もあるが、PRレビューのコンテキストでは数字のみ入力はPR番号の可能性が高い
- コミットハッシュを使いたい場合は `git diff 123` と明示することを推奨

**回避方法**:
```bash
# コミットハッシュとして使いたい場合
git diff 123

# PR番号として使いたい場合
#123
```

---

### ケース2: 相対パスvs絶対パス

**入力**: `ai/reviews/review.md`

**判定**: Markdown形式

**実行**:
- カレントディレクトリからの相対パスとして解釈
- Readツールに渡される

**注意事項**:
- カレントディレクトリがプロジェクトルートでない場合、パスが解決できない可能性
- 確実性を求める場合は絶対パスを推奨

---

### ケース3: git diffコマンドの引数エラー

**入力**: `git diff nonexistent-branch`

**判定**: git diff形式（正常）

**実行**: `git diff nonexistent-branch` を実行 → エラー

**エラーハンドリング**:
- gitコマンドのエラー出力をキャプチャ
- 分かりやすいエラーメッセージを返却
- 入力形式自体は正しいため、ユーザーにブランチ名の修正を促す

---

### ケース4: 差分が空

**入力**: `git diff --staged`

**判定**: git diff形式（正常）

**実行**: `git diff --staged` を実行 → 空の出力

**エラーハンドリング**:
- 警告メッセージを返す（エラーではない）
- レビュー対象がないことを明示
- 次のアクション（変更をステージする）を提案

---

### ケース5: PRが存在しない

**入力**: `#99999`

**判定**: PR番号形式（正常）

**実行**: `gh pr view 99999` を実行 → PRが見つからない

**エラーハンドリング**:
- ghコマンドのエラー出力をキャプチャ
- PR番号の確認を促す
- リポジトリ情報を表示（正しいリポジトリか確認）

---

### ケース6: GitHub CLI未認証

**入力**: `#123`

**判定**: PR番号形式（正常）

**実行**: `gh pr view 123` を実行 → 認証エラー

**エラーハンドリング**:
- 認証が必要であることを明示
- 次のアクション（`gh auth login`）を提案
- 認証後に再実行を促す

---

### ケース7: Markdownファイルが存在しない

**入力**: `ai/reviews/nonexistent.md`

**判定**: Markdown形式（拡張子は`.md`）

**ファイル存在確認**: 存在しない → エラー

**エラーハンドリング**:
- ファイルパスを表示
- 存在確認のチェック項目を提示（パス、拡張子など）
- 類似ファイルの提案（可能であれば）

---

## 判定ロジックの実装ガイド

### 推奨される実装順序

1. **入力の前処理**:
   - 前後の空白を削除（`.trim()`）
   - 改行を削除（単一行の入力を想定）

2. **優先順位順に判定**:
   - PR URL → PR番号（#付き） → PR番号のみ → git diff → Markdown

3. **形式確定後に情報取得**:
   - 判定時点ではコマンド実行しない
   - 形式が確定してから必要なコマンドを実行

4. **エラーハンドリング**:
   - コマンド失敗時は詳細なエラーメッセージ
   - ユーザーが修正しやすい情報を提供

### 判定例（疑似コード）

```javascript
function detectInputFormat(input) {
  input = input.trim();

  // 1. PR URL
  if (input.match(/^https:\/\/github\.com\/.*\/pull\/[0-9]+/)) {
    return { type: 'pr', subtype: 'url', input };
  }

  // 2. PR番号（#付き）
  if (input.match(/^#[0-9]+$/)) {
    return { type: 'pr', subtype: 'hash', input };
  }

  // 3. PR番号のみ
  if (input.match(/^[0-9]+$/)) {
    return { type: 'pr', subtype: 'number', input };
  }

  // 4. git diff
  if (input.startsWith('git diff')) {
    return { type: 'diff', input };
  }

  // 5. Markdown
  if (input.endsWith('.md')) {
    if (fileExists(input)) {
      return { type: 'markdown', input };
    } else {
      throw new Error(`Markdown file not found: ${input}`);
    }
  }

  throw new Error('Unknown input format');
}
```

---

## まとめ

- **優先順位が重要**: 曖昧な入力（数字のみなど）は優先順位に従って判定
- **ユーザーフレンドリー**: 明示的な形式（#123、git diff、URL）を推奨
- **エラーは詳細に**: コマンド失敗時は次のアクションを提案
- **拡張性**: 新しい形式の追加は優先順位リストに挿入するだけ
