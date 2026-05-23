---
name: google-ads-analyzer
description: |
  Google Ads MCP ツールを使った広告パフォーマンス分析・レポート作成スキル。キャンペーン分析、期間比較、デバイス分析、コンバージョン分析を体系的に実行し、改善提案付きレポートを出力する。
  ユーザーが「広告を分析して」「Google Adsを分析して」「キャンペーンのパフォーマンスを見て」「広告の成果を確認して」「CPAを確認して」「広告費を分析して」と依頼した場合にトリガー。
  また「コンバージョン値を確認して」「CV設定を確認して」「入札戦略の設定を確認して」「広告の設定を検証して」といったGoogle Ads設定の検証・診断依頼でもトリガー。
  Google Ads MCP (google-ads-mcp) が接続されている環境で使用する。GA4分析には使用しない。
---

# Google Ads Analyzer

Google Ads MCP ツール群を使い、体系的な広告パフォーマンス分析レポートを作成する。

## 前提

- MCP サーバー `google-ads-mcp` が接続済みであること
- 利用可能なツール: `list_accessible_customers`, `search`, `get_resource_metadata`

## 重要: クエリ構築ルール

- クエリのフィールド構成は **[references/query-recipes.md](references/query-recipes.md) のレシピをそのまま使う**こと
- `get_resource_metadata` は **原則使用しない**（レシピにないリソースを初めて使う場合のみ許可）

## 重要: 単位変換ルール

Google Ads API の金額は **micros**（1/1,000,000）で返る。表示時に必ず変換する。

```
cost_micros / 1,000,000 = 通貨単位の金額
例: 438858075104 micros → ¥438,858
```

`average_cpc`, `cost_per_conversion` も同様に micros で返る。

## 分析ワークフロー

### Phase 1: アカウント構造の把握（2ステップで完了）

**Step 1**: `list_accessible_customers` でアクセス可能なアカウント一覧を取得

**Step 2**: 全アカウントに対して以下を **並列** 実行
- `customer` リソースでアカウント名・`customer.manager` フラグ・通貨・タイムゾーンを取得
- `customer_client` リソースで配下アカウントを取得（MCC でなければ空が返るだけなので安全）

→ `manager=true` → MCC。`manager=false` → クライアントアカウント（分析対象候補）
→ MCC 配下のクライアントアカウント、または独立したクライアントアカウントを特定して Phase 2 へ

**注意**: MCC に対して metrics を含むクエリを実行するとエラーになる。必ずクライアントアカウントの customer_id を使うこと。

**ルーティング**: 設定検証のみのリクエスト（「設定を確認して」「CV値を検証して」等）は Phase 2-3 をスキップし、後述の **設定検証モード** へ分岐する。

### Phase 2: データ収集（並列実行）

**ガード条件**: まず全クライアントアカウントの **キャンペーン概要（#1）を並列取得** する。ENABLED キャンペーンが **0件** のアカウントは以降のクエリ（#2〜#5）を **スキップ** する。これにより無駄な API 呼び出しを防ぐ。

ENABLED キャンペーンがあるアカウントに対し、以下を **並列** で取得する。フィールド・条件の詳細は [references/query-recipes.md](references/query-recipes.md) を参照。

| # | データ | resource | 目的 |
|---|--------|----------|------|
| 1 | キャンペーン概要 | `campaign` | 全キャンペーンの状態とパフォーマンス（ガード条件で先行取得） |
| 2 | トレンド | `campaign` + セグメント（下記参照） | 期間推移 |
| 3 | デバイス別 | `campaign` + `segments.device` | デバイス配信比率 |
| 4 | CV アクション別 | `campaign` + `segments.conversion_action_name` | CV 種類の内訳 |
| 5 | 予算 | `campaign_budget` | 日予算・消化率 |

**トレンドのセグメント粒度**（分析期間に応じて自動選択）:
- **14日以下** → `segments.date`（日別）
- **15日〜3ヶ月** → `segments.week`（週別）
- **3ヶ月超** → `segments.month`（月別）

**短期間（14日以下）の場合**: 比較期間（同日数の直前期間）のトレンドデータも Phase 2 で **並列取得** する。短期分析では前後比較が不可欠。

**注意点**:
- デフォルト期間: 直近6ヶ月。ユーザー指定があればそれに従う
- `customer_id` はハイフンなしの数字文字列（`1234567890`）
- GAQL の制約事項は [references/query-recipes.md](references/query-recipes.md) の「GAQL クエリの注意事項」を参照

### Phase 3: 深掘り分析（必要に応じて）

Phase 2 の結果から課題が見えた場合、追加クエリを実行する。レシピは [references/query-recipes.md](references/query-recipes.md) の「深掘り分析」セクションを参照。

- **広告グループ別**: `ad_group` リソース（P-MAX では空になる）
- **キーワード別**: `keyword_view` + `ad_group_criterion`
- **曜日別**: `segments.day_of_week` で曜日パターン分析
- **配信面別**: `segments.ad_network_type` でプレースメント傾向

**CV値診断**（以下の条件に該当する場合にトリガー）:
- Phase 2 の CV アクション別データで `default_value = 1` のアクションが多い
- 同一カテゴリの CV 間で値が 10倍以上乖離している
- CPA が異常に高い/低い（CV値設定の問題を示唆）

トリガー時に `conversion_action` リソースと入札戦略詳細を並列取得し、以下を診断する:
1. CV値がデフォルト（1）のまま放置されているアクション
2. 類似アクション間の値の不整合（例: 通話系が 1,600 と 1 で混在）
3. 来店確度とCV値の逆転（例: 予約完了 < 経路検索）
4. `always_use_default_value = false` で意図した動的値が来ていない可能性
5. 入札戦略に `target_roas` / `target_cpa` が設定されているか

### Phase 4: レポート出力

保存先: `ai/reviews/YYMMDD_HHmm_[概要].md`（HHmm は JST）

```
# Google Ads パフォーマンス分析レポート

**対象アカウント**: [名称] (ID: [customer_id])
**分析日**: YYYY-MM-DD
**通貨**: [currency_code]

## 1. アカウント概要
テーブル: キャンペーン名 / タイプ / ステータス / 入札戦略

## 2. 全体サマリー（分析期間）
テーブル: 表示回数 / クリック / 費用 / CV / CTR / CPC / CPA

## 3. 月次トレンド
テーブル + 変動ポイントの説明

## 4. デバイス別パフォーマンス
テーブル: デバイス / 主要指標 / CV構成比

## 5. コンバージョン内訳
テーブル: アクション名 / CV数 / 構成比

## 6. [期間比較]（施策変更があった場合）
前後期間の日平均比較テーブル

## 7. 課題と改善提案
重要度(HIGH/MEDIUM/LOW) / 現状 → 問題 → アクション

## (任意) コンバージョン設定の診断 — Phase 3 でCV値診断を実施した場合のみ出力
テーブル: アクション名 / ステータス / 現在の値 / always_use_default / 判定 / 備考

## (任意) 入札戦略の評価 — target_roas/target_cpa が設定されている場合のみ出力
現在の戦略 / 目標値 / 実績値 / 判定

## 8. 次のアクション
チェックリスト形式
```

**数値フォーマット**:
- 金額: 通貨記号 + カンマ区切り（¥438,858）
- CTR: 小数2桁（1.11%）
- CPC/CPA: 通貨記号 + 整数（¥34）

**分析の観点**:
- CPA 前月比 50% 以上悪化 → HIGH で要因調査
- CTR 1% 未満 → 広告文・アセットの訴求力不足
- モバイル CV 構成比 90% 超 → ローカルビジネス特性として記録
- P-MAX 変更後 2 週間未満 → 学習期間として評価を保留
- ローカルアクション CV は 1〜3 日の計測ラグあり。直近の CV 0 は暫定値として注記
- 予算消化率 50% 未満 → 入札戦略またはターゲティングが制限的
- ENABLED な CV アクションの大半で `default_value = 1` → HIGH でCV値設計を推奨
- 同一カテゴリ（CONTACT, GET_DIRECTIONS 等）の CV 間で値が 10倍以上乖離 → 設定不整合の可能性を指摘
- `MAXIMIZE_CONVERSION_VALUE` で `target_roas = 0`（未設定） → 効率制御なしで費用が青天井になるリスクを注記
- 予算消化率と target_roas/target_cpa の関係 → 目標が厳しすぎて配信制限されていないか確認
- tROAS 設定時: CV値 ÷ tROAS で暗黙CPA上限を算出（例: ¥500 ÷ 1.6 = ¥313）。実績CPAと乖離があれば tROAS 調整を提案
- CV値変更は過去データに遡及しない。変更直後は `conversions_value` に旧値・新値が混在するため注記
- Google 予算ルール: 1日最大=日予算×2、月間上限=日予算×30.4。予算変更の影響分析時に適用

## 設定検証モード

Phase 1 完了後、以下を **並列** 取得（レシピは [references/query-recipes.md](references/query-recipes.md) 参照）:

1. **予算**: campaign_budget レシピ（#5）
2. **入札戦略**: 入札戦略詳細レシピ
3. **CV値**: conversion_action レシピ

**チェックリスト**:
- 日予算が意図した金額か
- 入札戦略タイプと目標値（tROAS/tCPA）が正しいか
- 主要CVアクションの値が設計通り、かつ `always_use_default_value = true` か
- 同カテゴリ内のCV値が一貫しているか（例: 通話系は全て同額）
- Smart Campaign 系アクションは P-MAX に非影響であることを確認
- tROAS 設定時: CV値 ÷ tROAS = 暗黙CPA上限を算出し、実績と比較

## GAQL 既知の制約

→ [references/query-recipes.md](references/query-recipes.md) の「GAQL クエリの注意事項」に一本化。クエリ構築時に必ず参照すること。
