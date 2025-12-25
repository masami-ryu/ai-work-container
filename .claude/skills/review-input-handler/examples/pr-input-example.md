# PR入力の例

このファイルはreview-input-handlerスキルがPR形式の入力を処理する例を示します。

## 入力パターン

### パターン1: PR番号（#付き）

**入力**:
```
#123
```

**判定結果**: PR形式

**実行コマンド**:
```bash
# リポジトリ情報を取得（現在のディレクトリから）
gh repo view --json nameWithOwner --jq '.nameWithOwner'

# PRの基本情報取得
gh pr view 123

# PR差分取得
gh pr diff 123

# 変更ファイル一覧取得
gh pr view 123 --json files --jq '.files[].path'
```

**出力**:
```
review_target_type: pr
review_context:
  repo: anthropics/claude-code
  pr_number: 123
  diff_text: |
    diff --git a/src/auth/login.ts b/src/auth/login.ts
    index abcdef1..1234567 100644
    --- a/src/auth/login.ts
    +++ b/src/auth/login.ts
    @@ -10,7 +10,7 @@ export async function login(credentials: Credentials) {
    -  const response = await fetch('/api/login', {
    +  const response = await fetch('/api/v2/login', {
         method: 'POST',
         body: JSON.stringify(credentials)
       });
  changed_files:
    - src/auth/login.ts
    - tests/auth/login.test.ts
  original_input: #123
```

---

### パターン2: PR番号のみ（数字のみ）

**入力**:
```
456
```

**判定結果**: PR形式

**実行コマンド**:
```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
gh pr view 456
gh pr diff 456
gh pr view 456 --json files --jq '.files[].path'
```

**出力**:
```
review_target_type: pr
review_context:
  repo: anthropics/claude-code
  pr_number: 456
  diff_text: |
    diff --git a/src/utils/parser.ts b/src/utils/parser.ts
    new file mode 100644
    index 0000000..abcdef1
    --- /dev/null
    +++ b/src/utils/parser.ts
    @@ -0,0 +1,15 @@
    +export function parseInput(input: string): ParsedInput {
    +  // Implementation
    +}
  changed_files:
    - src/utils/parser.ts
  original_input: 456
```

---

### パターン3: PR URL（フル）

**入力**:
```
https://github.com/anthropics/claude-code/pull/789
```

**判定結果**: PR形式

**実行コマンド**:
```bash
# URLからowner/repoとPR番号を抽出
# owner/repo: anthropics/claude-code
# pr_number: 789

gh pr view 789 --repo anthropics/claude-code
gh pr diff 789 --repo anthropics/claude-code
gh pr view 789 --repo anthropics/claude-code --json files --jq '.files[].path'
```

**出力**:
```
review_target_type: pr
review_context:
  repo: anthropics/claude-code
  pr_number: 789
  diff_text: |
    diff --git a/README.md b/README.md
    index abcdef1..1234567 100644
    --- a/README.md
    +++ b/README.md
    @@ -1,6 +1,8 @@
     # Claude Code

    -Official CLI for Claude
    +Official command-line interface for Claude
    +
    +Enhanced with AI-powered code review capabilities.
  changed_files:
    - README.md
  original_input: https://github.com/anthropics/claude-code/pull/789
```

---

## エラーケース

### PR番号が存在しない

**入力**:
```
#99999
```

**エラー出力**:
```
エラー: PR #99999 が見つかりません

gh pr viewの実行結果:
PR not found: 99999

入力形式: PR番号（#付き）
リポジトリ: anthropics/claude-code
```

### 認証エラー

**入力**:
```
#123
```

**エラー出力**:
```
エラー: GitHub CLI認証が必要です

gh pr viewの実行結果:
To authenticate, please run: gh auth login

次のアクションを実行してください:
1. gh auth login を実行
2. 認証完了後、再度レビューを実行
```
