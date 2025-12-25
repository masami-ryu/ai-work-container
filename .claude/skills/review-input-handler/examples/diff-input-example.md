# git diff入力の例

このファイルはreview-input-handlerスキルがgit diff形式の入力を処理する例を示します。

## 入力パターン

### パターン1: ステージされた変更

**入力**:
```
git diff --staged
```

**判定結果**: git diff形式

**実行コマンド**:
```bash
# 差分取得
git diff --staged

# 変更ファイル一覧取得
git diff --staged --name-status
```

**出力**:
```
review_target_type: diff
review_context:
  diff_text: |
    diff --git a/src/components/Button.tsx b/src/components/Button.tsx
    index abcdef1..1234567 100644
    --- a/src/components/Button.tsx
    +++ b/src/components/Button.tsx
    @@ -5,10 +5,12 @@ interface ButtonProps {
       onClick: () => void;
       disabled?: boolean;
    +  variant?: 'primary' | 'secondary';
     }

    -export function Button({ label, onClick, disabled }: ButtonProps) {
    +export function Button({ label, onClick, disabled, variant = 'primary' }: ButtonProps) {
       return (
    -    <button onClick={onClick} disabled={disabled}>
    +    <button
    +      className={`btn btn-${variant}`}
    +      onClick={onClick}
    +      disabled={disabled}>
           {label}
         </button>
  changed_files:
    - M src/components/Button.tsx
    - A tests/components/Button.test.tsx
  original_input: git diff --staged
```

---

### パターン2: ブランチ間の差分

**入力**:
```
git diff main...feature/add-auth
```

**判定結果**: git diff形式

**実行コマンド**:
```bash
git diff main...feature/add-auth
git diff main...feature/add-auth --name-status
```

**出力**:
```
review_target_type: diff
review_context:
  diff_text: |
    diff --git a/src/auth/AuthProvider.tsx b/src/auth/AuthProvider.tsx
    new file mode 100644
    index 0000000..abcdef1
    --- /dev/null
    +++ b/src/auth/AuthProvider.tsx
    @@ -0,0 +1,35 @@
    +import React, { createContext, useContext, useState } from 'react';
    +
    +interface AuthContextType {
    +  user: User | null;
    +  login: (credentials: Credentials) => Promise<void>;
    +  logout: () => void;
    +}
    +
    +const AuthContext = createContext<AuthContextType | undefined>(undefined);
    +
    +export function AuthProvider({ children }: { children: React.ReactNode }) {
    +  const [user, setUser] = useState<User | null>(null);
    +
    +  const login = async (credentials: Credentials) => {
    +    const response = await fetch('/api/login', {
    +      method: 'POST',
    +      body: JSON.stringify(credentials)
    +    });
    +    const userData = await response.json();
    +    setUser(userData);
    +  };
    +
    +  const logout = () => setUser(null);
    +
    +  return (
    +    <AuthContext.Provider value={{ user, login, logout }}>
    +      {children}
    +    </AuthContext.Provider>
    +  );
    +}
  changed_files:
    - A src/auth/AuthProvider.tsx
    - A src/auth/types.ts
    - M src/App.tsx
  original_input: git diff main...feature/add-auth
```

---

### パターン3: 特定のコミット範囲

**入力**:
```
git diff abc123..def456
```

**判定結果**: git diff形式

**実行コマンド**:
```bash
git diff abc123..def456
git diff abc123..def456 --name-status
```

**出力**:
```
review_target_type: diff
review_context:
  diff_text: |
    diff --git a/package.json b/package.json
    index abcdef1..1234567 100644
    --- a/package.json
    +++ b/package.json
    @@ -15,6 +15,7 @@
       "dependencies": {
         "react": "^18.2.0",
    +    "react-router-dom": "^6.20.0",
         "typescript": "^5.3.0"
       }
  changed_files:
    - M package.json
    - M package-lock.json
  original_input: git diff abc123..def456
```

---

### パターン4: 特定のファイルパス指定

**入力**:
```
git diff HEAD -- src/utils/
```

**判定結果**: git diff形式

**実行コマンド**:
```bash
git diff HEAD -- src/utils/
git diff HEAD --name-status -- src/utils/
```

**出力**:
```
review_target_type: diff
review_context:
  diff_text: |
    diff --git a/src/utils/format.ts b/src/utils/format.ts
    index abcdef1..1234567 100644
    --- a/src/utils/format.ts
    +++ b/src/utils/format.ts
    @@ -1,5 +1,9 @@
     export function formatDate(date: Date): string {
    -  return date.toISOString();
    +  return date.toLocaleDateString('ja-JP', {
    +    year: 'numeric',
    +    month: '2-digit',
    +    day: '2-digit'
    +  });
     }
  changed_files:
    - M src/utils/format.ts
  original_input: git diff HEAD -- src/utils/
```

---

## エラーケース

### 無効なブランチ名

**入力**:
```
git diff main...nonexistent-branch
```

**エラー出力**:
```
エラー: git diffコマンドの実行に失敗しました

git diffの実行結果:
fatal: ambiguous argument 'nonexistent-branch': unknown revision or path not in the working tree.

入力形式: git diff（ブランチ間差分）
入力コマンド: git diff main...nonexistent-branch
```

### 差分が空

**入力**:
```
git diff --staged
```

**エラー出力**:
```
警告: 差分がありません

git diffの実行結果:
(空の出力)

入力形式: git diff（ステージ済み）
入力コマンド: git diff --staged

レビュー対象がありません。変更をステージしてから再度実行してください。
```
