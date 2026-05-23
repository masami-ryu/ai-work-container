# GA4 レポートレシピ集

ga_run_report の具体的なパラメータ例。

## 基本分析（Phase 2）

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
    { "name": "conversions" }
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
    { "name": "conversions" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 10
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
    { "name": "conversions" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 5
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
    { "name": "bounceRate" }
  ],
  "orderBys": [{ "dimension": { "dimensionName": "date" }, "desc": false }],
  "limit": 30
}
```

## 追加分析（Phase 3）

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
    { "name": "averageSessionDuration" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 20
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
    { "name": "screenPageViews" }
  ],
  "limit": 5
}
```

### 時間帯分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "hour" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" }
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
    { "name": "activeUsers" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 15
}
```

### イベント分析

```json
{
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "eventName" }],
  "metrics": [
    { "name": "eventCount" },
    { "name": "totalUsers" }
  ],
  "orderBys": [{ "metric": { "metricName": "eventCount" }, "desc": true }],
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
    { "name": "averageSessionDuration" }
  ],
  "orderBys": [{ "metric": { "metricName": "screenPageViews" }, "desc": true }],
  "limit": 20
}
```

### 流入元（ソース / メディア）

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
    { "name": "conversions" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 15
}
```

### 期間比較（前月 vs 当月）

dateRanges に2つの期間を指定する:

```json
{
  "dateRanges": [
    { "startDate": "30daysAgo", "endDate": "yesterday", "name": "当月" },
    { "startDate": "60daysAgo", "endDate": "31daysAgo", "name": "前月" }
  ],
  "dimensions": [{ "name": "sessionDefaultChannelGroup" }],
  "metrics": [
    { "name": "sessions" },
    { "name": "activeUsers" },
    { "name": "bounceRate" }
  ],
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 10
}
```

## よく使うディメンション一覧

| ディメンション | 説明 | 用途 |
|--------------|------|------|
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
|----------|-----|------|
| `sessions` | INTEGER | セッション数 |
| `activeUsers` | INTEGER | アクティブユーザー数 |
| `newUsers` | INTEGER | 新規ユーザー数 |
| `bounceRate` | FLOAT | 直帰率 (0.0〜1.0) |
| `averageSessionDuration` | SECONDS | 平均セッション時間（秒） |
| `screenPageViews` | INTEGER | ページビュー数 |
| `screenPageViewsPerSession` | FLOAT | セッションあたりPV |
| `eventCount` | INTEGER | イベント発生数 |
| `conversions` | FLOAT | コンバージョン数 |
| `totalRevenue` | CURRENCY | 収益 |
| `engagedSessions` | INTEGER | エンゲージメントセッション数 |
| `engagementRate` | FLOAT | エンゲージメント率 |
| `userEngagementDuration` | SECONDS | ユーザーエンゲージメント時間 |
