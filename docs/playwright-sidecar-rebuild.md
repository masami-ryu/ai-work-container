# Playwright sidecar だけ rebuild する手順

Dev Container 本体ではなく、Playwright sidecar (`playwright-recorder`) だけを rebuild する。

## 手順

ホスト側のターミナルで実行する。`/path/to/ai-work-container` はホスト上で clone した実際のパスに置き換える。

```bash
docker ps --format 'table {{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}'
```

`com.docker.compose.service` が `devcontainer` または `playwright-recorder` の行から、`com.docker.compose.project` の値を確認する。

```bash
cd /path/to/ai-work-container/.devcontainer

PROJECT_NAME=確認した_project_name

docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.yml \
  -f docker-compose.playwright.yml \
  build playwright-recorder

docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.yml \
  -f docker-compose.playwright.yml \
  up -d --no-deps --force-recreate playwright-recorder
```

## pw_batch consumer について

`works_pw_batch/pw_batch` は別途配置する独立リポジトリで、このリポジトリの clone には含まれない。以下はその作業環境を用意している場合の手順。

Playwright sidecar は `pw_batch` consumer を自動起動しない。疎結合を保つため、consumer は必要なときだけ sidecar 内で手動起動する。

queue も使う場合は、ホスト側で LocalStack を起動しておく。

```bash
cd /path/to/ai-work-container/.devcontainer

PROJECT_NAME=確認した_project_name

docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.yml \
  -f docker-compose.playwright.yml \
  up -d localstack
```

共有 Chrome を起動した後、sidecar の noVNC デスクトップ内の xterm で consumer を起動する。ここで使うパスはコンテナ内のパス。

```bash
cd /workspaces/ai-work-container/works_pw_batch/pw_batch

QUEUE_ENDPOINT=http://localstack:4566 \
CDP_ENDPOINT=http://127.0.0.1:9222 \
pnpm consumer
```

この起動方法では consumer のライフサイクルは sidecar 起動スクリプトから分離される。監査ログと実行結果は `pw_batch` の `PW_BATCH_OUTPUT_DIR` 配下に保存される。

## 注意

`-p "$PROJECT_NAME"` を付けないと、VS Code Dev Containers が作成した compose project とは別扱いになり、新しいコンテナが作成される。

project 名は環境ごとに異なるため、先頭の `docker ps` で確認した値を使う。
