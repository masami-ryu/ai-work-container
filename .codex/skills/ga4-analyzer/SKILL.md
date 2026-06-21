---
name: ga4-analyzer
description: |
  GA4 MCP ツールまたは GA4 Data API fallback を使ったサイト分析・レポート作成スキル。ランディングページ分析、チャネル分析、デバイス分析、トレンド分析、keyEvents/コンバージョン分析を体系的に実行し、改善提案付きレポートを出力する。
  ユーザーが「GA4を分析して」「アクセス解析して」「ランディングページを分析して」「トラフィックを調べて」「コンバージョンを確認して」「サイトのパフォーマンスを見て」と依頼した場合にトリガー。
  GA4 MCP (google-analytics) が接続されている環境で使用する。MCPツールがセッションに露出していない場合でも、サービスアカウント認証済みなら Data API 直接実行で代替する。
---

# GA4 Analyzer

GA4 MCP ツール群を優先して使い、体系的なサイト分析レポートを作成する。MCPツールが露出していない場合は、同じ認証情報で GA4 Data API を直接実行する。

## 前提

- MCP サーバー `google-analytics` が接続済み、または Data API fallback に必要なサービスアカウント鍵が利用可能であること
- Data API が有効であること（Admin API は不要）
- `GA_PROPERTY_ID` と `GA_SERVICE_ACCOUNT_JSON` の実値や鍵JSONの中身をレポート・ログ・チャットに出さないこと

## 分析ワークフロー

### Phase 1: 接続確認

簡易レポートで Data API の疎通を確認する。失敗時は Admin API エラーと区別し、ユーザーに案内する。MCPツールがセッションに露出していない場合は [references/data-api-fallback.md](references/data-api-fallback.md) を使う。

```
ga_run_report:
  dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }]
  metrics: [{ name: "sessions" }]
  limit: 1
```

次に metadata で利用可能なコンバージョン系メトリクスを確認する。GA4では `conversions` が使えず、`keyEvents` が標準になる場合がある。

優先順:

1. `keyEvents`
2. 設定済みなら `keyEvents:<eventName>`（例: `keyEvents:call`, `keyEvents:lead_reservation`）
3. `conversions` は metadata で利用可能な場合だけ使う

### Phase 2: データ収集

以下レポートを取得する。MCPツールが露出している場合は並列実行し、直接Data APIの場合は同等のリクエストを順次またはバッチで実行する。詳細なディメンション・メトリクスの組み合わせは [references/report-recipes.md](references/report-recipes.md) を参照。

| # | レポート名 | 主要ディメンション | 目的 |
|---|-----------|-----------------|------|
| 0 | 全体サマリー | なし | 前後比較の基準値 |
| 1 | ランディングページ別 | `landingPage` | ページ別パフォーマンス |
| 2 | チャネル別 | `sessionDefaultChannelGroup` | 流入経路の質と量 |
| 3 | デバイス別 | `deviceCategory` | デバイス体験の差異 |
| 4 | 日別トレンド | `date` | 時系列の変化 |
| 5 | 流入元/メディア | `sessionSource`, `sessionMedium` | GBP/広告/SNSの評価 |
| 6 | イベント別 | `eventName` | 主要アクションの実態確認 |

**共通メトリクス**: `sessions`, `activeUsers`, `bounceRate`, `averageSessionDuration`, `screenPageViews`, `keyEvents`。metadata で確認できる場合は `keyEvents:<eventName>` も加える。

**注意点**:
- `landingPage`（クエリ文字列なし）を使う。`landingPagePlusQueryString` は fbclid 等で分散するため避ける
- デフォルト期間は `30daysAgo` ~ `yesterday`。ユーザー指定があればそれに従う
- 期間指定がない場合は前30日比較も取得する（直近30日 vs その前30日）
- `limit` は 20 を基本とする。日別トレンドは 30~90 に設定
- `orderBys` でセッション数降順にソートする
- raw data を保存する場合は、秘密情報が含まれないレポートレスポンスだけを `ai/tmp` に置く

### Phase 3: 追加分析（必要に応じて）

Phase 2 の結果から課題が見えた場合、追加レポートを取得する。レシピは [references/report-recipes.md](references/report-recipes.md) の「追加分析」セクションを参照。

- **チャネル × デバイス クロス分析**: 特定チャネルのデバイス偏りを確認
- **新規 vs リピーター**: `newVsReturning` ディメンションで定着率を確認
- **時間帯分析**: `hour` ディメンションでピーク時間を特定
- **地域分析**: `city` / `country` で地域特性を把握
- **イベント分析**: `eventName` でユーザー行動を把握
- **ページ遷移**: `pagePath` で回遊パターンを確認
- **キャンペーン分析**: `sessionCampaignName` で Google広告/P-MAX 由来を確認
- **キーイベント内訳**: `keyEvents:<eventName>` で電話クリックと予約遷移クリックを分ける

### Phase 4: レポート出力

以下の構成でレポートを出力する。

```
## GA4 分析レポート（期間: MM/DD〜MM/DD）

### 1. 全体サマリー
テーブル: セッション / アクティブユーザー / 直帰率 / 平均時間 / keyEvents / keyEvents内訳

必要に応じて前30日比較を併記する。

### 2. ランディングページ別パフォーマンス
テーブル: ページ / セッション / 直帰率 / 平均滞在時間 / keyEvents

### 3. チャネル別パフォーマンス
テーブル: チャネル / セッション / 構成比 / 直帰率 / 平均滞在時間 / keyEvents

### 4. デバイス別パフォーマンス
テーブル: デバイス / セッション / 構成比 / 直帰率 / keyEvents効率

### 5. 流入元/メディア
テーブル: source / medium / セッション / 直帰率 / keyEvents

### 6. 日別トレンド
主要な変動ポイントを文章で説明

### 7. 主要な課題と改善提案
課題ごとに: 現状データ → 問題点 → 改善アクション
```

レポート冒頭に、取得方法（MCPまたはData API直接実行）と raw data パスを明記する。`keyEvents` が予約完了ではなく予約遷移クリック等を表す場合は、必ず注記する。

**数値フォーマット**:
- 直帰率: パーセント表示（小数1桁）例: 58.4%
- 平均滞在時間: 分秒表示 例: 2分31秒
- 構成比: パーセント表示（小数1桁）
- keyEvents効率: `keyEvents / sessions` をパーセント表示（小数1桁）

**分析の観点**:
- 直帰率 60% 以上は要改善フラグ
- モバイル vs デスクトップの直帰率差 20pt 以上はモバイル UX 課題
- Paid トラフィックの直帰率がオーガニックより 15pt 以上高い場合は広告 LP 不一致の疑い
- `keyEvents` 0 の場合はイベント設定未完了または対象期間不足の可能性を指摘
- 平均滞在時間 10 秒未満のチャネルはボットまたは誤クリックの疑い
- `keyEvents` が予約遷移クリック中心の場合、実予約や電話実績との突合を推奨する
- 店舗型LPでは GBP、Organic Search、Google広告、SNS の source/medium 別品質を必ず確認する
