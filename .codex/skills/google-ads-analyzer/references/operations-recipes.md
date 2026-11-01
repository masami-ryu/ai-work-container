# Google Ads 操作レシピ

Google Ads API の mutate を伴う操作手順。ユーザーが広告設定の変更を明示した場合のみ使う。

## 目次

- [安全ルール](#安全ルール)
- [MCP未露出時の直接実行](#mcp未露出時の直接実行)
- [P-MAX サイトリンクをキャンペーンから外す](#p-max-サイトリンクをキャンペーンから外す)
- [P-MAX の非モバイルを抑制する](#p-max-の非モバイルを抑制する)

## 安全ルール

- 変更前に [query-recipes.md](query-recipes.md) の確認クエリで対象を特定する。
- `resource_name`、URL、デバイス種別、現在ステータスを確認してから mutate する。
- ユーザー依頼の範囲だけ変更する。
- mutate 後は同じ確認クエリで再取得し、変更後状態を確認する。
- Developer Token、OAuth client secret、Refresh Token は出力しない。
- 変更ログには `resource_name`、変更前後、確認結果を残す。

## MCP未露出時の直接実行

MCPツールがセッションに露出していない場合は、`uvx` で `google-ads-mcp` パッケージの関数を直接使う。

```bash
set -a
. ~/.config/google-ads/google-ads.env
set +a

uvx --from git+https://github.com/googleads/google-ads-mcp.git python - <<'PY'
from ads_mcp.tools.core import list_accessible_customers

for customer_id in list_accessible_customers():
    print(customer_id)
PY
```

`GOOGLE_ADS_DEVELOPER_TOKEN` が未設定またはプレースホルダの場合、Google Ads API 呼び出しは失敗する。

`search` は `ads_mcp.tools.search` から import する。MCP ツール未露出時にレシピの GAQL 相当を直接実行する最小例:

```bash
set -a
. ~/.config/google-ads/google-ads.env
set +a

uvx --from git+https://github.com/googleads/google-ads-mcp.git python - <<'PY'
from ads_mcp.tools.search import search

customer_id = "<CUSTOMER_ID>"
rows = search(
    customer_id=customer_id,
    resource="campaign",
    fields=[
        "campaign.name",
        "campaign.status",
        "metrics.impressions",
        "metrics.clicks",
        "metrics.cost_micros",
        "metrics.conversions",
        "metrics.conversions_value",
    ],
    conditions=[
        "segments.date >= '<START_DATE>'",
        "segments.date <= '<END_DATE>'",
    ],
)

for row in rows:
    print(row)
PY
```

必要に応じて Python 側で `cost_micros / 1_000_000`、`conversions_value / cost` を計算する。Developer Token、OAuth client secret、Refresh Token は出力しない。

## P-MAX サイトリンクをキャンペーンから外す

対象確認:

- `query-recipes.md` の「P-MAX のキャンペーンサイトリンク」を使う。
- YouTubeリンクなど、削除対象の `campaign_asset.resource_name` を特定する。

実行例:

```bash
set -a
. ~/.config/google-ads/google-ads.env
set +a

uvx --from git+https://github.com/googleads/google-ads-mcp.git python - <<'PY'
from ads_mcp.utils import get_googleads_client

customer_id = "<CUSTOMER_ID>"
resource_name = "<CAMPAIGN_ASSET_RESOURCE_NAME>"

client = get_googleads_client()
service = client.get_service("CampaignAssetService")
operation = client.get_type("CampaignAssetOperation")
operation.remove = resource_name

response = service.mutate_campaign_assets(
    customer_id=customer_id,
    operations=[operation],
)

for result in response.results:
    print(result.resource_name)
PY
```

確認:

- 同じ `campaign_asset` クエリを再実行する。
- 対象の `campaign_asset.status` が `REMOVED` であることを確認する。
- `asset` 本体は削除しない。別キャンペーンや履歴確認に使われる可能性がある。

## P-MAX の非モバイルを抑制する

対象確認:

- `query-recipes.md` の「P-MAX のデバイス条件」を使う。
- `DESKTOP`、`MOBILE`、`TABLET`、`CONNECTED_TV` の `resource_name` を取得する。

注意:

- デバイス条件は削除できない。削除を試すと `CANNOT_REMOVE_CRITERION` が返る。
- 抑制は `campaign_criterion.bid_modifier = 0.0` で行う。
- モバイルは `1.0` に明示して維持する。

実行例:

```bash
set -a
. ~/.config/google-ads/google-ads.env
set +a

uvx --from git+https://github.com/googleads/google-ads-mcp.git python - <<'PY'
from ads_mcp.utils import get_googleads_client
from google.protobuf import field_mask_pb2

customer_id = "<CUSTOMER_ID>"
settings = {
    "<DESKTOP_CAMPAIGN_CRITERION_RESOURCE_NAME>": 0.0,
    "<MOBILE_CAMPAIGN_CRITERION_RESOURCE_NAME>": 1.0,
    "<TABLET_CAMPAIGN_CRITERION_RESOURCE_NAME>": 0.0,
    "<CONNECTED_TV_CAMPAIGN_CRITERION_RESOURCE_NAME>": 0.0,
}

client = get_googleads_client()
service = client.get_service("CampaignCriterionService")
operations = []

for resource_name, bid_modifier in settings.items():
    criterion = client.get_type("CampaignCriterion")
    criterion.resource_name = resource_name
    criterion.bid_modifier = bid_modifier

    operation = client.get_type("CampaignCriterionOperation")
    operation.update = criterion
    operation.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["bid_modifier"]))
    operations.append(operation)

response = service.mutate_campaign_criteria(
    customer_id=customer_id,
    operations=operations,
)

for result in response.results:
    print(result.resource_name)
PY
```

確認:

- 同じ `campaign_criterion` クエリを再実行する。
- `MOBILE = 1.0`、その他デバイス `= 0.0` を確認する。
- P-MAX の反映にはラグがあるため、3〜7日後にデバイス別実績を再確認する。
