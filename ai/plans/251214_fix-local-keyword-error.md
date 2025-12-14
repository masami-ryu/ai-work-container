# setup-tmp-symlinks.sh local キーワードエラー修正プラン

作成日: 2025年12月14日
作成者: Plan Creator エージェント
ステータス: Draft

## 1. 概要

### 目的
DevContainer Rebuild時に発生する `local: can only be used in a function` エラーを修正する。

### スコープ
- 対象: `.devcontainer/setup-tmp-symlinks.sh`
- 対象外: その他のスクリプト

### 前提条件
- PR #25 レビュー指摘対応（TASK-009）で `local` 宣言が追加された
- 関数外のスクリプト本体でも誤って `local` が使用されている

## 2. 原因分析

### エラーメッセージ
```
/workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh: line 418: local: can only be used in a function
```

### 根本原因
Bashの `local` キーワードは関数内でのみ使用可能。以下の3箇所で関数外で使用されている：

| 行番号 | 問題のコード | 場所 |
|--------|--------------|------|
| 418 | `local -a prune_list=()` | メインスクリプトのforループ内 |
| 532 | `local -a prune_cond=()` | プロセス置換内（サブシェル） |
| 533 | `local first=true` | プロセス置換内（サブシェル） |

### 発生経緯
TASK-009「関数内変数に `local` 宣言を追加」の実装時に、関数外の変数にも誤って `local` を追加してしまった。

## 3. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | DevContainer Rebuild が正常に完了すること | 高 |
| REQ-002 | 要件 | 既存のシンボリックリンク作成機能が正常に動作すること | 高 |
| CON-001 | 制約 | 関数内の `local` 宣言は維持する（正しい使用） | - |

## 4. 実装ステップ

### Phase 1: バグ修正（緊急）
**目標**: `local` キーワードエラーを解消する

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| FIX-001 | 行418の `local -a prune_list=()` を `prune_list=()` に変更 | `.devcontainer/setup-tmp-symlinks.sh` | 構文エラーが発生しない | [ ] |
| FIX-002 | 行532の `local -a prune_cond=()` を `prune_cond=()` に変更 | `.devcontainer/setup-tmp-symlinks.sh` | 構文エラーが発生しない | [ ] |
| FIX-003 | 行533の `local first=true` を `first=true` に変更 | `.devcontainer/setup-tmp-symlinks.sh` | 構文エラーが発生しない | [ ] |

### 修正コード

**行418（修正前）:**
```bash
  local -a prune_list=()
```

**行418（修正後）:**
```bash
  prune_list=()
```

**行532-533（修正前）:**
```bash
      local -a prune_cond=()
      local first=true
```

**行532-533（修正後）:**
```bash
      prune_cond=()
      first=true
```

## 5. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 構文検証 | `bash -n setup-tmp-symlinks.sh` を実行 | 構文エラーなし |
| TEST-002 | 統合 | DevContainer Rebuild を実行 | エラーなく初期化完了 |
| TEST-003 | 機能 | `setup-tmp-symlinks.sh` を手動実行 | シンボリックリンク作成成功 |

## 6. 成功基準

- [ ] 3箇所の `local` キーワードが削除されている
- [ ] `bash -n setup-tmp-symlinks.sh` で構文エラーがゼロ
- [ ] DevContainer Rebuild が正常に完了する

## 7. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | 変数スコープの問題 | 低 | 低 | メインスクリプトではグローバル変数で問題ない |

## 8. 依存関係

- PR #25 レビュー指摘対応の一部として修正

## 9. 次のアクション

1. [ ] FIX-001〜003 を実施
2. [ ] `bash -n` で構文検証
3. [ ] DevContainer Rebuild でテスト
4. [ ] テスト結果ドキュメント更新

---
*このプランは Plan Creator エージェントによって作成されました*
