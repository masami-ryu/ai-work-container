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

## 注意

`-p "$PROJECT_NAME"` を付けないと、VS Code Dev Containers が作成した compose project とは別扱いになり、新しいコンテナが作成される。
