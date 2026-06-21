# GA4 レポートレシピ集

`ga_run_report` の具体的なパラメータ例。GA4 Data API 直接実行時も同じディメンション・メトリクス名を使う。

## 目次

- [メトリクス選択ルール](#メトリクス選択ルール)
- [基本分析](#基本分析)
- [追加分析](#追加分析)
- [よく使うディメンション一覧](#よく使うディメンション一覧)
- [よく使うメトリクス一覧](#よく使うメトリクス一覧)

## メトリクス選択ルール

GA4ではプロパティによって `conversions` が使えず、`keyEvents` が標準になる場合がある。分析前に metadata を確認し、利用可能なメトリクスだけをリクエストに含める。

優先順:

1. `keyEvents`
2. `keyEvents:<eventName>`（例: `keyEvents:call`, `keyEvents:lead_reservation`）
3. `conversions` は metadata で利用可能な場合だけ使う

このプロジェクトで見つかった主要キーイベント例:

```text
keyEvents
keyEvents:call
keyEvents:lead_reservation
```

以下のレシピにある `keyEvents:<eventName>` は、metadata に存在しない場合は削除する。

## 基本分析

### 0. 全体サマリー

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "screenPageViews" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "limit": 1
}
```

### 1. ランディングページ別

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "landingPage" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "screenPageViews" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 20
}
```

### 2. チャネル別

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "sessionDefaultChannelGroup" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 15
}
```

### 3. デバイス別

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "deviceCategory" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 10
}
```

### 4. 日別トレンド

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "date" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "orderBys": [{ "dimension": { "dimensionName": "date" }, "desc": false }],
  "limit": 35
}
```

### 5. 流入元（ソース / メディア）

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [
    { "name": "sessionSource" },
    { "name": "sessionMedium" }
  ],
  "metrics": [
    { "name": "sessions" },
    { "name": "bounceRate" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 20
}
```

### 6. イベント分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "eventName" }],
  "metrics": [
    { "name": "eventCount" },
    { "name": "totalUsers" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "eventCount" }, "desc": true }],
  "limit": 30
}
```

## 追加分析

### チャネル × デバイス クロス分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [
    { "name": "sessionDefaultChannelGroup" },
    { "name": "deviceCategory" }
  ],
  "metrics": [
    { "name": "sessions" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 30
}
```

### 新規 vs リピーター

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "newVsReturning" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "screenPageViews" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 10
}
```

### 時間帯分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "hour" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "dimension": { "dimensionName": "hour" }, "desc": false }],
  "limit": 24
}
```

### 地域分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "city" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 20
}
```

### ページ別 PV（回遊分析）

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "pagePath" }],
  "metrics": [
    { "name": "screenPageViews" },
    { "name": "activeUsers" },
    { "name": "averageSessionDuration" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "screenPageViews" }, "desc": true }],
  "limit": 20
}
```

### キャンペーン別

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "sessionCampaignName" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "bounceRate" },
    { "name": "keyEvents" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 20
}
```

### 期間比較（直近30日 vs 前30日）

期間比較は Data API の複数 `dateRanges` でもよいが、集計が読みやすいように同じレポートを2期間で個別取得してから比較する方が扱いやすい。

```json
{
  "dateRanges": [{ "startDate": "60daysAgo", "endDate": "31daysAgo", "name": "前30日" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" },
    { "name": "averageSessionDuration" },
    { "name": "screenPageViews" },
    { "name": "keyEvents" },
    { "name": "keyEvents:call" },
    { "name": "keyEvents:lead_reservation" }
  ],
  "limit": 1
}
```

## よく使うディメンション一覧

| ディメンション | 説明 | 用途 |
|---|---|---|
| `date` | 日付 (YYYYMMDD) | トレンド分析 |
| `hour` | 時間 (0-23) | 時間帯分析 |
| `dayOfWeek` | 曜日 (0=日〜6=土) | 曜日パターン |
| `landingPage` | ランディングページ（クエリなし） | LP分析 |
| `pagePath` | ページパス | 回遊分析 |
| `sessionDefaultChannelGroup` | チャネルグループ | チャネル分析 |
| `sessionSource` | 流入元 | ソース分析 |
| `sessionMedium` | メディア | メディア分析 |
| `sessionCampaignName` | キャンペーン名 | 広告分析 |
| `deviceCategory` | デバイス種別 | デバイス分析 |
| `operatingSystem` | OS | OS分析 |
| `browser` | ブラウザ | ブラウザ分析 |
| `city` | 都市 | 地域分析 |
| `country` | 国 | 地域分析 |
| `newVsReturning` | 新規/リピーター | ユーザー定着分析 |
| `eventName` | イベント名 | 行動分析 |

## よく使うメトリクス一覧

| メトリクス | 型 | 説明 |
|---|---|---|
| `sessions` | INTEGER | セッション数 |
| `activeUsers` | INTEGER | アクティブユーザー数 |
| `newUsers` | INTEGER | 新規ユーザー数 |
| `bounceRate` | FLOAT | 直帰率 (0.0〜1.0) |
| `averageSessionDuration` | SECONDS | 平均セッション時間（秒） |
| `screenPageViews` | INTEGER | ページビュー数 |
| `screenPageViewsPerSession` | FLOAT | セッションあたりPV |
| `eventCount` | INTEGER | イベント発生数 |
| `totalUsers` | INTEGER | イベント別ユーザー数 |
| `keyEvents` | FLOAT | キーイベント数 |
| `keyEvents:<eventName>` | FLOAT | 特定イベントのキーイベント数 |
| `conversions` | FLOAT | 旧コンバージョン指標。metadata で利用可能な場合だけ使う |
| `totalRevenue` | CURRENCY | 収益 |
| `engagedSessions` | INTEGER | エンゲージメントセッション数 |
| `engagementRate` | FLOAT | エンゲージメント率 |
| `userEngagementDuration` | SECONDS | ユーザーエンゲージメント時間 |
