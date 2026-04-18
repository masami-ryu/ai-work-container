---
name: plan-manager
description: >
  ディレクトリ型プラン（ai/plans/*/plan.md）のセッション実行管理スキル。
  プランをセッション単位に分割し、進捗追跡・振り返り・セッション間引き継ぎを管理する。
  単一ファイルプラン（ai/plans/*.md）は対象外。
  「プランのセッションを開始して」「プランの振り返りをして」「プランの進捗を確認して」
  「セッションの引き継ぎを準備して」「次のセッションの準備をして」と依頼された場合にトリガー。
  「セッションを分割して」「セッション計画を立てて」「プランの進捗管理して」
  「プランの進捗を見て」もトリガー対象。
  補助的トリガー:「プランを管理して」（plan-creating/plan-review-applierとの誤トリガー防止のため、
  上記の固有トリガーワードを優先する）。
---

# Plan Manager

大規模プランの実行をセッション単位で管理する。プランの分割・進捗追跡・振り返り・セッション間引き継ぎを一貫したワークフローで提供し、コンテキスト肥大化による精度低下を防ぐ。

- **セッション記録テンプレート**: [assets/session-template.md](assets/session-template.md)
- **分割戦略ガイド**: [references/split-strategy.md](references/split-strategy.md)
- **振り返り・ゲート判定チェックリスト**: [references/gate-checklist.md](references/gate-checklist.md)
- **セッション引き継ぎガイド**: [references/handoff-guide.md](references/handoff-guide.md)

## 適用レベル

**対象**: `ai/plans/<dir>/plan.md` を持つディレクトリ型プランのみ。`tasks/` と `tests/` は存在する場合のみ補助入力として読み込む（必須ではない）。単一ファイルプラン（`ai/plans/*.md`）は本スキルの管理対象外であり、セッション分割・進捗管理が不要なため直接実行する。

プランの **タスク数** に応じて管理レベルを変える。plan-creating はプランの **変更ファイル数** でワークフロー（Express / Standard / Comprehensive）を選択するが、plan-manager はその出力であるプランの タスク数 で管理の深さを決定する。両者は補完関係にある。

### 管理レベル

| プラン規模 | タスク数 | 適用レベル |
|-----------|---------|-----------|
| 対象外 | 2以下 | plan-manager の管理対象外 |
| 小規模 | 3-5 | 振り返りのみ（分割なし）。progress/ は作成せず plan.md 末尾に振り返りを追記 |
| 中規模 | 6-9 | セッション分割 + 振り返り。progress/ にセッション記録を保存 |
| 大規模 | 10+ | 全機能適用（分割 + 振り返り + ゲート判定 + 引き継ぎ） |

### plan-creating の出力形式との対応

| plan-creating の出力形式 | 典型タスク数 | plan-manager の対応 |
|-------------------------|------------|-------------------|
| Express（単一ファイル） | 1-2 | 管理対象外 |
| Standard（ディレクトリ構造） | 3-7 | 小規模〜中規模。タスク数で判定 |
| Comprehensive（ディレクトリ構造） | 5-15+ | 中規模〜大規模。タスク数で判定 |

## context-manager との責務境界

| 観点 | context-manager | plan-manager |
|------|----------------|--------------|
| 保存対象 | why（設計判断の理由、ドメイン知識） | what/where（タスク状態、変更済みファイル、未完了前提条件） |
| 粒度 | 抽象的（300文字以内） | 具体的（実装詳細を含む） |
| 永続化先 | SQLite DB | Markdown（progress/SESSION-NNN.md + plan.md 更新） |
| ライフサイクル | プロジェクト全体 | プラン実行期間中 |
| 用途 | 将来のセッションで参照 | 次セッションでの引き継ぎ |

## セッション記録の保存構造

規模に応じて保存構造が異なる:

### 小規模プラン（3-5タスク）

progress/ は作成しない。振り返りは plan.md 末尾に追記する。

```markdown
<!-- plan.md 末尾に追記 -->
## 振り返り

実行日: YYYY-MM-DD

### 実行結果
- [完了タスク・未完了タスクの要約]

### 発見と学び
- [想定外の事実・改善点]

### プラン修正の要否
- [修正不要 / 軽微な修正 / 重大な修正]
```

### 中規模〜大規模プラン（6タスク以上）

progress/ にセッション記録を保存する。

```
ai/plans/YYMMDD_HHmm_[概要]/
├── plan.md
├── tasks/
├── tests/
└── progress/          ← plan-manager が管理
    ├── SESSION-001.md
    ├── SESSION-002.md
    └── ...
```

**注**: progress/ は plan-manager によるセッション管理開始時に初めて作成される。plan-creating のテンプレートには含まれない。

## ワークフロー

> **context-manager が利用できない場合**: 各ステップの context-manager 操作をスキップし、知見は plan.md 末尾の振り返り欄またはセッション記録（SESSION-NNN.md §4）に直接記載する。ワークスペースの作成・アーカイブも不要。
>
> **context-manager ワークスペースの開始/終了フック**（利用可能な場合）:
> - **プラン管理開始時（初回セッション開始）**: `workspace --create --name <ws-name> --project <project>` を実行（命名規則: `plan-YYMMDD-概要`）
> - **プラン完了時（最終セッション終了）**: `workspace --archive --name <ws-name> --project <project>` を実行
> - 詳細は [references/handoff-guide.md](references/handoff-guide.md) §4 を参照

### 小規模プラン（3-5タスク）の軽量運用

小規模プランでは以下を省略・簡略化する:

| ワークフロー段階 | 省略・簡略化する項目 |
|----------------|-------------------|
| 開始 | セッション分割不要。進捗サマリーは省略可（plan.md を直接確認） |
| 実行中 | 通常と同じ（タスク完了時に plan.md 更新） |
| 終了 | session-template.md は使わず plan.md 末尾に振り返りを追記（§セッション記録の保存構造 参照）。ゲート判定の層2 は不要 |

context-manager への知見保存は規模に関わらず実施する（利用可能な場合）。

### 1. セッション開始

1. **プラン読み込み**: plan.md を読み込む。tasks/ が存在する場合は補助入力として併せて読み込む
2. **progress/ の初期化**（中規模以上・初回セッション時）:
   - `progress/` ディレクトリが存在しない場合に作成する
   - **採番規則**: `SESSION-%03d.md`（3桁ゼロ埋め連番）。初回は `SESSION-001.md`
   - **次番号の決定**: `progress/` 内の `SESSION-*.md` を昇順ソートし、最大番号 + 1 を採番する
   - 例: `SESSION-001.md`, `SESSION-002.md` が存在する場合、次は `SESSION-003.md`
3. **進捗サマリー出力**（中規模以上）: 下記フォーマットで現在の進捗を表示する

   ```markdown
   ## 進捗サマリー: [プラン名]

   | 指標 | 値 |
   |------|-----|
   | 全タスク | N 件 |
   | 完了 | N 件（XX%） |
   | 未完了 | N 件 |
   | セッション消化 | N / 全N予定 |

   ### フェーズ別進捗
   | フェーズ | タスク数 | 完了 | 状態 |
   |---------|---------|------|------|
   | Phase 1 | N | N | 完了 / 進行中 / 未着手 |

   ### 未解決事項
   - [ブロッカーや前回セッションの引き継ぎ事項を集約]
   ```

4. **前回セッション記録の読み込み**: progress/SESSION-NNN.md から引き継ぎ情報を取得（初回セッション・小規模プランはスキップ）
5. **context-manager からプロジェクトコンテキスト取得**（利用可能な場合）:
   - `index --scope all --project <name>` で全コンテキスト把握
   - workspace スコープから前回の引き継ぎ知見を取得
   - **フォールバック**: context-manager 不在時は plan.md と前回の SESSION-NNN.md のみで進行
6. **今回のセッション範囲の決定**（中規模以上）: [references/split-strategy.md](references/split-strategy.md) を参照
7. **セッションブリーフィング出力**（中規模以上）: 対象タスク・前提条件・注意事項をまとめて提示

### 2. 実行中（軽量）

実行中の記録は最小限に抑え、タスク実行の妨げにならないようにする。

- **タスク完了時**: plan.md のタスク状態を更新（`[ ]` → `[x]`）
- **ブロッカー検出時**: セッション記録に記載 + ゲート判定（[references/gate-checklist.md](references/gate-checklist.md)）
- **想定外の発見時**: context-manager に insight/caveat として保存（利用可能な場合）。不在時はセッション記録に記載

### 3. セッション終了

1. **振り返り実施**: [references/gate-checklist.md](references/gate-checklist.md) の層1（セッション振り返り）を適用
2. **セッション記録作成**:
   - **中規模以上**: [assets/session-template.md](assets/session-template.md) に従い記録を作成。保存先: `ai/plans/[プラン名]/progress/SESSION-NNN.md`
   - **小規模**: plan.md 末尾に振り返りを追記（§セッション記録の保存構造 参照）
3. **context-manager への知見保存**（利用可能な場合）:
   - 設計判断 → decision カテゴリ
   - 得られた知見 → insight カテゴリ
   - 注意事項 → caveat カテゴリ
   - 将来対応事項 → todo カテゴリ
   - **フォールバック**: 不在時は振り返り欄の「発見と学び」に知見を記録
4. **次セッションの引き継ぎ情報整理**（中規模以上）: [references/handoff-guide.md](references/handoff-guide.md) に従い記録
5. **フェーズ完了時**（大規模のみ）: ゲート判定（[references/gate-checklist.md](references/gate-checklist.md) の層2）を実施 → 必要に応じて plan-creating に軌道修正を委譲

## context-manager ワークスペースライフサイクル

ワークスペースの作成・運用・アーカイブの詳細は [references/handoff-guide.md](references/handoff-guide.md) §4 を参照。

## 連携スキル

| スキル | 連携タイミング | 用途 |
|--------|-------------|------|
| context-manager | セッション開始時・終了時 | コンテキストの取得・保存 |
| plan-creating | ゲート判定でプラン修正が必要な場合 | プランの軌道修正 |
| code-reviewing | フェーズ完了時（任意） | 実装品質の確認 |
| plan-review-applier | レビュー指摘をプランに反映する場合 | プラン修正の実行 |
