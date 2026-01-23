# Code Review: [タイトル]

## レビュー対象情報
- **種別**: PR / git差分 / Markdownメタ
- **対象**:
  - PR: PR番号またはURL
  - git差分: 差分範囲（例: `git diff --staged`, `main...feature`）
  - Markdownメタ: ファイルパス（例: `ai/reviews/251220_pr-123-review.md`）
- 変更ファイル数: X
- 差分行数: X
- レビュータイプ: Standard/Deep Review
- 変更タイプ: 機能追加/バグ修正/リファクタリング

## フェーズ実行結果
- ✅ Phase 1: 初期分析
- ✅ Phase 2: 詳細分析
- ✅ Phase 3: ベストプラクティス参照
- ✅ Phase 4: 統合評価
- ✅ Phase 5: 品質検証

## 評価サマリー
- コード品質: ⭐⭐⭐⭐☆
- セキュリティ: ⭐⭐⭐⭐⭐
- パフォーマンス: ⭐⭐⭐⭐☆
- テスト: ⭐⭐⭐☆☆
- 設計: ⭐⭐⭐⭐☆

## 詳細レビュー

### コード品質
[観点別の詳細評価]

### セキュリティ
[観点別の詳細評価]

### パフォーマンス
[観点別の詳細評価]

### テスト
[観点別の詳細評価]

### 設計
[観点別の詳細評価]

## 指摘事項

### 🔴 重要度: 高（必須対応）

**例:**
**[src/api/auth.ts:42]** ユーザー入力がサニタイズされていない

**カテゴリ**: security
**重要度**: 高

**根拠**:
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)

**影響範囲**（Grep分析結果）:
- 直接参照: 3箇所
  - src/api/users.ts:28
  - src/api/posts.ts:15

**推奨**: `validator`ライブラリでサニタイズ処理を追加

```typescript
import { escape } from 'validator';
const sanitizedInput = escape(userInput);
```

### 🟡 重要度: 中（推奨対応）

**例:**
**[src/utils/data.ts:78]** 同一処理が複数箇所に存在

**カテゴリ**: code_quality
**重要度**: 中

**根拠**:
- DRY原則違反によるメンテナンスコスト増加

**影響範囲**: 2箇所で重複
- src/utils/data.ts:78-85
- src/services/export.ts:112-119

**推奨**: 共通ユーティリティ関数に抽出

### 🟢 重要度: 低（任意対応）

**例:**
**[src/components/Button.tsx:12]** マジックナンバーの使用

**カテゴリ**: code_quality
**重要度**: 低

**推奨**: 定数として定義し意図を明確化

## ポジティブフィードバック
- ✅ [良かった点1]
- ✅ [良かった点2]

## 総評
[総合的な評価]

## 推奨アクション
- [ ] 重要度:高の項目を修正
- [ ] [その他推奨事項]
