# GA4 Data API fallback

MCPサーバー `google-analytics` が Codex セッションに露出していない場合に、同じサービスアカウント認証で GA4 Data API を直接実行する手順。

## 目次

- [前提](#前提)
- [疎通確認](#疎通確認)
- [metadataでkeyEventsを確認](#metadataでkeyeventsを確認)
- [標準レポート取得パターン](#標準レポート取得パターン)
- [秘密情報チェック](#秘密情報チェック)
- [トラブルシュート](#トラブルシュート)

## 前提

必要な値:

```text
GA_PROPERTY_ID
GA_SERVICE_ACCOUNT_JSON
```

値は `~/.codex/config.toml` の `mcp_servers.google-analytics.env` から確認できるが、秘密情報や鍵JSONの中身をレポート・チャット・ログに出さない。

実行前に対象プロパティと鍵パスを明示する。

```bash
export GA_PROPERTY_ID=485401944
export GA_SERVICE_ACCOUNT_JSON=/home/vscode/.config/gcp/ga4-credentials.json
```

権限:

```bash
chmod 600 /home/vscode/.config/gcp/ga4-credentials.json
```

## 疎通確認

```bash
uvx --from google-analytics-data python -c "from google.analytics.data_v1beta import BetaAnalyticsDataClient; print(BetaAnalyticsDataClient.__name__)"
```

期待値:

```text
BetaAnalyticsDataClient
```

最小レポート:

```bash
uvx --from google-analytics-data python - <<'PY'
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Metric, RunReportRequest
import os

property_id = os.environ["GA_PROPERTY_ID"]
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.environ["GA_SERVICE_ACCOUNT_JSON"]

client = BetaAnalyticsDataClient()
request = RunReportRequest(
    property=f"properties/{property_id}",
    date_ranges=[DateRange(start_date="7daysAgo", end_date="yesterday")],
    metrics=[Metric(name="sessions")],
    limit=1,
)

response = client.run_report(request)
for row in response.rows:
    print(row.metric_values[0].value)
PY
```

## metadataでkeyEventsを確認

`conversions` が使えないプロパティがあるため、分析前に metadata を確認する。

```bash
uvx --from google-analytics-data python - <<'PY'
from google.analytics.data_v1beta import BetaAnalyticsDataClient
import os

property_id = os.environ["GA_PROPERTY_ID"]
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.environ["GA_SERVICE_ACCOUNT_JSON"]

client = BetaAnalyticsDataClient()
metadata = client.get_metadata(name=f"properties/{property_id}/metadata")

for metric in metadata.metrics:
    name = metric.api_name
    if "conversion" in name.lower() or "keyevent" in name.lower():
        print(name, "|", metric.ui_name)
PY
```

`keyEvents:<eventName>` は metadata に存在するものだけをレポート取得に含める。

## 標準レポート取得パターン

以下はレポートレスポンスだけを JSON に保存する最小パターン。`metrics_common` の `keyEvents:<eventName>` は metadata に合わせて調整する。

```bash
uvx --from google-analytics-data python - <<'PY'
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, OrderBy, RunReportRequest
import json
import os
from pathlib import Path

property_id = os.environ["GA_PROPERTY_ID"]
credential_path = os.environ["GA_SERVICE_ACCOUNT_JSON"]
out_path = Path("ai/tmp/ga4_raw.json")

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credential_path
client = BetaAnalyticsDataClient()

current = ("30daysAgo", "yesterday")
previous = ("60daysAgo", "31daysAgo")
metrics_common = [
    "sessions",
    "activeUsers",
    "bounceRate",
    "averageSessionDuration",
    "screenPageViews",
    "keyEvents",
    "keyEvents:call",
    "keyEvents:lead_reservation",
]

def metric_order(name, desc=True):
    return OrderBy(metric=OrderBy.MetricOrderBy(metric_name=name), desc=desc)

def dim_order(name, desc=False):
    return OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name=name), desc=desc)

def run(name, dimensions, metrics, date_range, limit=20, order_bys=None):
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=date_range[0], end_date=date_range[1])],
        dimensions=[Dimension(name=d) for d in dimensions],
        metrics=[Metric(name=m) for m in metrics],
        limit=limit,
    )
    if order_bys:
        request.order_bys.extend(order_bys)
    response = client.run_report(request)
    return {
        "name": name,
        "dateRange": {"startDate": date_range[0], "endDate": date_range[1]},
        "dimensions": [header.name for header in response.dimension_headers],
        "metrics": [header.name for header in response.metric_headers],
        "rowCount": response.row_count,
        "rows": [
            {
                "dimensions": [value.value for value in row.dimension_values],
                "metrics": [value.value for value in row.metric_values],
            }
            for row in response.rows
        ],
    }

reports = {
    "current_summary": run("current_summary", [], metrics_common, current, 1),
    "previous_summary": run("previous_summary", [], metrics_common, previous, 1),
    "landing_pages": run("landing_pages", ["landingPage"], metrics_common, current, 20, [metric_order("sessions")]),
    "channels": run("channels", ["sessionDefaultChannelGroup"], metrics_common, current, 15, [metric_order("sessions")]),
    "devices": run("devices", ["deviceCategory"], metrics_common, current, 10, [metric_order("sessions")]),
    "daily_trend": run("daily_trend", ["date"], ["sessions", "activeUsers", "bounceRate", "keyEvents"], current, 35, [dim_order("date")]),
    "source_medium": run("source_medium", ["sessionSource", "sessionMedium"], ["sessions", "bounceRate", "keyEvents"], current, 20, [metric_order("sessions")]),
    "events": run("events", ["eventName"], ["eventCount", "totalUsers", "keyEvents"], current, 30, [metric_order("eventCount")]),
    "channel_device": run("channel_device", ["sessionDefaultChannelGroup", "deviceCategory"], ["sessions", "bounceRate", "averageSessionDuration", "keyEvents"], current, 30, [metric_order("sessions")]),
    "campaigns": run("campaigns", ["sessionCampaignName"], ["sessions", "bounceRate", "keyEvents"], current, 20, [metric_order("sessions")]),
}

raw = {
    "propertyId": property_id,
    "currentRange": {"startDate": current[0], "endDate": current[1]},
    "previousRange": {"startDate": previous[0], "endDate": previous[1]},
    "reports": reports,
}

out_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
print(out_path)
PY
```

保存先は実行前に日時付きへ変更する。

```text
ai/tmp/YYMMDD_HHmm_ga4_raw.json
```

## 秘密情報チェック

raw data とレポートに秘密情報が混入していないか確認する。

```bash
rg -n "private_key|client_email|GA_SERVICE_ACCOUNT_JSON|BEGIN PRIVATE KEY" \
  ai/reviews/<report>.md \
  ai/tmp/<raw>.json
```

ヒットしなければ問題なし。`propertyId` は秘密情報ではないが、必要に応じてレポート上では対象プロパティ例として扱う。

## トラブルシュート

### `keyEvents:<eventName>` でエラーになる

metadata に存在しないイベント別メトリクスを指定している。`keyEvents:<eventName>` を削除し、`keyEvents` だけで取得する。

### 権限エラーになる

確認点:

1. Google Analytics Data API が有効か。
2. サービスアカウントが GA4 プロパティの閲覧者に追加されているか。
3. `property_id` が GA4 プロパティID（数字）か。
4. `credential_path` がサービスアカウント鍵JSONの絶対パスか。

### `Measurement Protocol not configured` が出る

`mcp-google-analytics` 起動時の警告。Data API の読み取り分析では問題ない。イベント送信を行う場合だけ `GA_MEASUREMENT_ID` と `GA_API_SECRET` を追加する。
