# Google Ads クエリレシピ集

`search` ツールの具体的なパラメータ例。日付・customer_id は実際の値に置き換えること。

## 目次

- [基本分析（Phase 2）](#基本分析phase-2) — キャンペーン概要、トレンド、デバイス別、CV アクション別、予算
- [深掘り分析（Phase 3）](#深掘り分析phase-3) — CV値診断、入札戦略詳細、デバイス×日別、広告グループ、アカウント情報、MCC
- [P-MAX 設定確認](#p-max-設定確認) — サイトリンク、デバイス条件、YouTube動画アセット
- [よく使うフィールド一覧](#よく使うフィールド一覧) — メトリクス、セグメント、キャンペーン属性
- [GAQL クエリの注意事項](#gaql-クエリの注意事項)

## 基本分析（Phase 2）

### 1. キャンペーン概要

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.id",
    "campaign.name",
    "campaign.status",
    "campaign.advertising_channel_type",
    "campaign.bidding_strategy_type",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc",
    "metrics.cost_per_conversion"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'"
  ]
}
```

### 2. トレンド（期間に応じてセグメント粒度を選択）

**14日以下 → `segments.date`（日別）**:

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.date",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc",
    "metrics.cost_per_conversion"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ],
  "orderings": ["segments.date ASC"]
}
```

**15日〜3ヶ月 → `segments.week`（週別）**:

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.week",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc",
    "metrics.cost_per_conversion"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ],
  "orderings": ["segments.week ASC"]
}
```

**3ヶ月超 → `segments.month`（月別）**:

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.month",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc",
    "metrics.cost_per_conversion"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ],
  "orderings": ["segments.month ASC"]
}
```

**注意**: 14日以下の場合は、比較用に同日数の直前期間も並列取得すること。

### 3. デバイス別

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.device",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ]
}
```

### 4. コンバージョンアクション別

**注意**: `segments.conversion_action_name` と `metrics.cost_per_conversion` は併用不可。`metrics.conversions` と `metrics.conversions_value` のみ使用する。

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.conversion_action_name",
    "metrics.conversions",
    "metrics.conversions_value"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ]
}
```

### 5. 予算確認

**注意**: `campaign.status` でフィルタする場合は fields にも含める必要がある。

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign_budget",
  "fields": [
    "campaign.name",
    "campaign.status",
    "campaign_budget.amount_micros",
    "campaign_budget.delivery_method",
    "campaign_budget.period"
  ],
  "conditions": ["campaign.status = 'ENABLED'"]
}
```

## 深掘り分析（Phase 3）

### コンバージョンアクション設定（CV値診断）

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "conversion_action",
  "fields": [
    "conversion_action.name",
    "conversion_action.status",
    "conversion_action.category",
    "conversion_action.type",
    "conversion_action.value_settings.default_value",
    "conversion_action.value_settings.always_use_default_value"
  ]
}
```

**注意**: 日付フィルタ不要。全CVアクション（ENABLED/HIDDEN/REMOVED）が返る。

### 入札戦略詳細（target_roas / target_cpa の確認）

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "campaign.status",
    "campaign.bidding_strategy_type",
    "campaign.maximize_conversion_value.target_roas",
    "campaign.maximize_conversions.target_cpa_micros"
  ],
  "conditions": ["campaign.status = 'ENABLED'"]
}
```

**注意**: `target_roas` は小数（例: 1.6 = 160%）。`target_cpa_micros` は micros 単位。未設定の場合は 0 が返る。

### デバイス×日別トレンド（施策変更の前後比較）

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.date",
    "segments.device",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ],
  "orderings": ["segments.date ASC"]
}
```

### 配信面別（Search / Maps / YouTube など）

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign",
  "fields": [
    "campaign.name",
    "segments.ad_network_type",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ]
}
```

**用途**: P-MAX の Search / Maps / YouTube / Content などの費用配分、CPA、ROAS を比較する。短期期間では CV 計測ラグを踏まえ、配信面別の悪化を断定しない。

### 広告グループ別（検索キャンペーン向け、P-MAX では空）

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "ad_group",
  "fields": [
    "ad_group.name",
    "ad_group.status",
    "campaign.name",
    "metrics.impressions",
    "metrics.clicks",
    "metrics.cost_micros",
    "metrics.conversions",
    "metrics.conversions_value",
    "metrics.ctr",
    "metrics.average_cpc"
  ],
  "conditions": [
    "segments.date >= '<START_DATE>'",
    "segments.date <= '<END_DATE>'",
    "campaign.status = 'ENABLED'"
  ]
}
```

### アカウント情報

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "customer",
  "fields": [
    "customer.id",
    "customer.descriptive_name",
    "customer.currency_code",
    "customer.time_zone",
    "customer.optimization_score"
  ]
}
```

### MCC 配下のクライアントアカウント一覧

```json
{
  "customer_id": "<MCC_CUSTOMER_ID>",
  "resource": "customer_client",
  "fields": [
    "customer_client.id",
    "customer_client.descriptive_name",
    "customer_client.status",
    "customer_client.manager",
    "customer_client.currency_code"
  ],
  "conditions": ["customer_client.manager = false"]
}
```

## P-MAX 設定確認

設定変更の前に、必ずこのセクションのレシピで対象 `resource_name` と現在値を取得する。変更手順は [operations-recipes.md](operations-recipes.md) を参照。

### P-MAX のキャンペーンサイトリンク

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign_asset",
  "fields": [
    "campaign.id",
    "campaign.name",
    "campaign_asset.resource_name",
    "campaign_asset.status",
    "campaign_asset.field_type",
    "asset.id",
    "asset.final_urls",
    "asset.sitelink_asset.link_text",
    "asset.sitelink_asset.description1",
    "asset.sitelink_asset.description2"
  ],
  "conditions": [
    "campaign.id = <CAMPAIGN_ID>",
    "campaign_asset.field_type = 'SITELINK'"
  ]
}
```

**用途**: P-MAX から特定サイトリンクを外す前に、対象 `campaign_asset.resource_name` を特定する。

### アカウント階層のサイトリンク

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "customer_asset",
  "fields": [
    "customer_asset.resource_name",
    "customer_asset.status",
    "customer_asset.field_type",
    "asset.id",
    "asset.final_urls",
    "asset.sitelink_asset.link_text"
  ],
  "conditions": [
    "customer_asset.field_type = 'SITELINK'"
  ]
}
```

**用途**: キャンペーン直下ではなくアカウント階層で有効なサイトリンクがないか確認する。

### P-MAX のデバイス条件

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "campaign_criterion",
  "fields": [
    "campaign.id",
    "campaign.name",
    "campaign_criterion.resource_name",
    "campaign_criterion.criterion_id",
    "campaign_criterion.type",
    "campaign_criterion.status",
    "campaign_criterion.negative",
    "campaign_criterion.bid_modifier",
    "campaign_criterion.device.type"
  ],
  "conditions": [
    "campaign.id = <CAMPAIGN_ID>",
    "campaign_criterion.type = 'DEVICE'"
  ]
}
```

**用途**: 非モバイル抑制前に、`DESKTOP`、`MOBILE`、`TABLET`、`CONNECTED_TV` の `resource_name` と `bid_modifier` を確認する。

### P-MAX の有効な YouTube 動画アセット

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "asset_group_asset",
  "fields": [
    "asset_group.id",
    "asset_group.name",
    "asset_group_asset.resource_name",
    "asset_group_asset.status",
    "asset_group_asset.field_type",
    "asset.id",
    "asset.resource_name",
    "asset.type"
  ],
  "conditions": [
    "asset_group_asset.field_type = 'YOUTUBE_VIDEO'",
    "asset_group_asset.status = 'ENABLED'"
  ]
}
```

**用途**: YouTubeサイトリンクではなく、P-MAX の動画素材として有効な YouTube アセットを確認する。

### YouTube 動画アセット詳細

```json
{
  "customer_id": "<CUSTOMER_ID>",
  "resource": "asset",
  "fields": [
    "asset.id",
    "asset.resource_name",
    "asset.type",
    "asset.youtube_video_asset.youtube_video_id",
    "asset.youtube_video_asset.youtube_video_title"
  ],
  "conditions": [
    "asset.type = 'YOUTUBE_VIDEO'"
  ]
}
```

**用途**: `asset_group_asset` で取得した `asset.id` の動画ID・タイトルを確認する。

## よく使うフィールド一覧

### メトリクス

| フィールド | 型 | 説明 | 単位変換 |
|-----------|-----|------|---------|
| `metrics.impressions` | INTEGER | 表示回数 | 不要 |
| `metrics.clicks` | INTEGER | クリック数 | 不要 |
| `metrics.cost_micros` | INTEGER | 費用 | ÷1,000,000 |
| `metrics.conversions` | DOUBLE | コンバージョン数 | 不要 |
| `metrics.conversions_value` | DOUBLE | コンバージョン値 | 不要 |
| `metrics.ctr` | DOUBLE | クリック率 | ×100 で % |
| `metrics.average_cpc` | DOUBLE | 平均CPC | ÷1,000,000 |
| `metrics.cost_per_conversion` | DOUBLE | CPA | ÷1,000,000 |
| `metrics.search_impression_share` | DOUBLE | 検索インプレッションシェア | ×100 で % |
| `metrics.interaction_rate` | DOUBLE | インタラクション率 | ×100 で % |

### セグメント

| フィールド | 値の例 | 用途 |
|-----------|--------|------|
| `segments.date` | `2026-03-28` | 日別分析 |
| `segments.month` | `2026-03-01` | 月次トレンド |
| `segments.day_of_week` | `MONDAY` | 曜日分析 |
| `segments.device` | `MOBILE`, `DESKTOP`, `TABLET` | デバイス分析 |
| `segments.conversion_action_name` | `通話ボタンをクリック` | CV内訳分析 |
| `segments.ad_network_type` | `SEARCH`, `SEARCH_PARTNERS`, `YOUTUBE`, `MAPS` | 配信面分析 |

### キャンペーン属性

| フィールド | 値の例 | 説明 |
|-----------|--------|------|
| `campaign.status` | `ENABLED`, `PAUSED`, `REMOVED` | ステータス |
| `campaign.advertising_channel_type` | `SEARCH`, `PERFORMANCE_MAX`, `DISPLAY` | チャネルタイプ |
| `campaign.bidding_strategy_type` | `MAXIMIZE_CONVERSIONS`, `TARGET_CPA`, `TARGET_SPEND` | 入札戦略 |

## GAQL クエリの注意事項

- `segments.conversion_action_name` と `metrics.cost_per_conversion` は **併用不可**（PROHIBITED_SEGMENT_WITH_METRIC エラー）
- `campaign_budget` リソースで `campaign.status` をフィルタ（conditions）に使う場合、**fields にも `campaign.status` を含める**必要がある
- 日付フィルタは必ず **開始日と終了日の両方** を指定
- 日付は `YYYY-MM-DD` 形式（ハイフン必須）。リテラル（`TODAY`, `LAST_7_DAYS`）は不可
- `segments.date` をフィルタで使う場合、`fields` に含める必要はない（`segments.month` 等も同様）
- `campaign.status = 'REMOVED'` のキャンペーンもデフォルトで返る。除外するなら明示的にフィルタ
- `change_event` リソースは LIMIT 10000 以下が必須
- フィールド名は完全修飾（`campaign.id` であって `id` ではない）
