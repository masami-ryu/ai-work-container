# Playwright sidecar だけ rebuild する手順

Dev Container 本体ではなく、Playwright sidecar (`playwright-recorder`) だけを rebuild する。

## 手順

ホスト側のターミナルで実行する。

```bash
docker ps --format 'table {{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}'
```

`com.docker.compose.service` が `devcontainer` または `playwright-recorder` の行から、`com.docker.compose.project` の値を確認する。

```bash
cd /workspaces/ai-work-container/.devcontainer

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

Playwright sidecar は `pw_batch` consumer を自動起動しない。疎結合を保つため、consumer は必要なときだけ sidecar 内で手動起動する。

queue も使う場合は、ホスト側で LocalStack を起動しておく。

```bash
cd /workspaces/ai-work-container/.devcontainer

PROJECT_NAME=確認した_project_name

docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.yml \
  -f docker-compose.playwright.yml \
  up -d localstack
```

sidecar 内で起動する場合:

```bash
cd /workspaces/ai-work-container/works_pw_batch/pw_batch

QUEUE_ENDPOINT=http://localstack:4566 \
CDP_ENDPOINT=http://127.0.0.1:9222 \
pnpm consumer
```

この起動方法では consumer のライフサイクルは sidecar 起動スクリプトから分離される。監査ログと実行結果は `pw_batch` の `PW_BATCH_OUTPUT_DIR` 配下に保存される。

## 注意

`-p "$PROJECT_NAME"` を付けないと、VS Code Dev Containers が作成した compose project とは別扱いになり、新しいコンテナが作成される。

環境によっては、例えば次のような値になる。

```bash
cd projects/private/ai-work-container/.devcontainer
PROJECT_NAME=ai-work-container_devcontainer
```
