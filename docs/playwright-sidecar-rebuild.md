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

## pw_batch consumer を sidecar で起動する

`pw_batch` consumer は既定では起動しない。起動する場合は `PW_BATCH_ENABLED=1` を指定する。

```bash
cd /workspaces/ai-work-container/.devcontainer

PROJECT_NAME=確認した_project_name
PW_BATCH_ENABLED=1 \
PW_BATCH_DIR=/workspaces/ai-work-container/works_pw_batch/pw_batch \
docker compose \
  -p "$PROJECT_NAME" \
  -f docker-compose.yml \
  -f docker-compose.playwright.yml \
  up -d --force-recreate playwright-recorder
```

consumer の標準出力と標準エラーは sidecar 内の `/tmp/pw-batch-consumer.log` に出力される。ジョブの監査ログと実行結果は `PW_BATCH_OUTPUT_DIR` 配下に保存される。

## 注意

`-p "$PROJECT_NAME"` を付けないと、VS Code Dev Containers が作成した compose project とは別扱いになり、新しいコンテナが作成される。

環境によっては、例えば次のような値になる。

```bash
cd projects/private/ai-work-container/.devcontainer
PROJECT_NAME=ai-work-container_devcontainer
```
