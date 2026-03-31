---
name: context-manager
description: >
  AIコーディングエージェント向けのコンテキスト永続化・管理ツール。セッションを跨いで知識・決定事項・慣例を
  SQLite DBに保存し、検索・参照する。
  「コンテキストを保存して」「記憶して」「覚えておいて」「プロジェクト情報を登録」「CWDを紐付けて」
  「コンテキストを検索」「過去の決定を調べて」「ワークスペースを作成」「アーカイブして」
  「上書き履歴を確認」「コンテキストの鮮度をチェック」
  「コンテキストの一覧」「目次を表示して」「コンテキストを読んで」「詳細を確認して」
  「コンテキストを削除して」と依頼された場合にトリガー。
---

# Context Manager

## ワークフロー

### セッション開始時

1. `project --list` でプロジェクト登録を確認（未登録なら `project --register`）
2. `index --scope all --project <name>` で既存コンテキストを把握
3. （マルチエージェント環境時）`history --unresolved --project <name>` で未解決の上書き競合を確認（あれば `verify` / `restore` で解決）
4. 必要に応じて `search` で関連する過去の決定事項を検索

### コンテキスト保存の判断基準

カテゴリは自由文字列。以下は代表例:

| カテゴリ | いつ使うか | 例 |
|---------|-----------|-----|
| decision | 技術選定・設計決定 | PostgreSQL を採用、REST API は OpenAPI 3.1 で定義 |
| architecture | アーキテクチャ構成 | モノレポ構成、packages/ 配下に分離 |
| convention | 繰り返し適用されるルール・規約 | 変数名は camelCase、コミットメッセージは日本語 |
| domain | ドメイン知識・業務ルール | 予約は24時間前までキャンセル可 |
| tech-stack | 技術スタック情報 | Node.js 22, TypeScript 5.7, NestJS 11 |
| insight | 調査やデバッグで得た知見 | JWT の有効期限を短くしないとリフレッシュトークン漏洩時のリスクが高い |
| reference | 参照情報・ファイルパス | session管理 → docs/session-management.md |
| caveat | 踏んだ地雷、注意すべき挙動 | SQLite の FTS5 trigram は Node.js ビルドによっては無効 |
| todo | 今は対応しないが将来必要な事項 | パフォーマンステスト追加 |

### スコープの選択基準

| スコープ | いつ使うか | 例 |
|---------|-----------|-----|
| global | 全プロジェクト共通のルール | コーディング規約、共通慣例 |
| project | プロジェクト固有の決定 | アーキテクチャ決定、技術選定 |
| workspace | 作業ブランチ固有の一時的な知見 | 実装中の調査結果、一時的な決定 |

### スコープの可視範囲

`--scope all` で参照すると、下位から上位へのカスケードで全スコープのエントリが見える。
同一 `category` + `title` が複数スコープに存在する場合、**下位スコープが優先**される（上位は `(overridden)` 注釈付き）。

- workspace（子）→ workspace（親）→ ... → project → global
- project → global
- global のみ

アーカイブ済みワークスペースのエントリはデフォルトで対象外（`--include-archived` で明示的に含める）。
継承チェーン内にアーカイブ済みワークスペースがある場合、そのワークスペースをスキップして上位に継続する。

index / search の結果には鮮度閾値（デフォルト 30 日）を超えたエントリに警告マークが付与される。

### セッション終了時

保存すべき知見がないか振り返る:
- 新たな技術的決定を行ったか？ → `decision`
- デバッグで重要な知見を得たか？ → `insight` / `caveat`
- 将来対応が必要な事項を発見したか？ → `todo`

## データストレージ

- デフォルト: `~/.claude/context/context.db`（初回実行時に自動作成）
- 環境変数 `CLAUDE_CONTEXT_DB_PATH` でパスをカスタマイズ可能

## CLI

スクリプトは以下のパスに配置されている。実行時はスキルディレクトリからの相対パスで指定する。

```
node <skill-dir>/scripts/context-db.mjs <操作> [オプション...]
```

## 操作一覧

### project — プロジェクト管理

```bash
# プロジェクト登録（CWD マッピング付き）
node scripts/context-db.mjs project --register --name myproject --cwd /path/to/project

# CWD マッピング追加（worktree 用）
node scripts/context-db.mjs project --add-cwd --name myproject --cwd /path/to/worktree

# プロジェクト一覧
node scripts/context-db.mjs project --list

# プロジェクト削除（関連データすべて削除）
node scripts/context-db.mjs project --delete --name myproject
```

### write — コンテキスト書き込み

```bash
# project スコープ（デフォルト、--project 省略時は CWD から自動解決）
node scripts/context-db.mjs write --category decision --title api-design --content "REST API は OpenAPI 3.1 で定義する" --source claude-code:session-abc

# global スコープ
node scripts/context-db.mjs write --scope global --category convention --title naming --content "変数名は camelCase" --tags coding,style

# workspace スコープ
node scripts/context-db.mjs write --scope workspace --project myproject --workspace feature-auth --category insight --title jwt-caveat --content "JWT の有効期限は短めに"

# タグ付き（カンマ区切りで複数指定）
node scripts/context-db.mjs write --category decision --title db-choice --content "PostgreSQL を採用" --tags database,infrastructure --source codex:session-xyz
```

- `--scope` 省略時は `project` がデフォルト
- `--project` 省略時は CWD から自動解決（`project --register` で事前登録が必要）
- 同一論理キー（scope + project + workspace + category + title）への再 write は上書き
- 異なる `--source` による上書き時は旧内容を履歴に退避
- スコープ別上限（global: 100, project: 200, workspace: 50）超過時は警告表示（書き込みは継続）

### read — コンテキスト読み取り

```bash
# ID 指定
node scripts/context-db.mjs read --id <uuid>

# カテゴリ + タイトル指定
node scripts/context-db.mjs read --scope project --project myproject --category decision --title api-design

# カテゴリ一括
node scripts/context-db.mjs read --scope all --project myproject --category decision

# workspace 絞り込み
node scripts/context-db.mjs read --scope workspace --project myproject --workspace feature-auth --category decision

# archived WS のエントリも含める
node scripts/context-db.mjs read --scope all --project myproject --include-archived
```

### index — コンテキスト目次

```bash
# プロジェクト内の全エントリ目次
node scripts/context-db.mjs index --scope all --project myproject

# カテゴリ絞り込み
node scripts/context-db.mjs index --scope project --project myproject --category decision

# workspace 絞り込み
node scripts/context-db.mjs index --scope workspace --project myproject --workspace feature-auth

# archived 含む
node scripts/context-db.mjs index --scope all --project myproject --include-archived
```

出力例:

```
| ID       | スコープ  | カテゴリ   | タイトル          | 経過日数 | タグ              | 注釈       |
| ---      | ---      | ---       | ---              | ---     | ---              | ---       |
| a1b2c3d4 | global   | convention | package-manager  | (3d)    | coding,style     |           |
| e5f6g7h8 | global   | convention | typescript-strict| (12d)   |                  |           |
| 11223344 | project  | architecture| monorepo        | (7d)    | structure        |           |
| 55667788 | project  | decision   | api-design       | (2d)    | api              |           |
| 99aabbcc | project  | decision   | scope-model      | (45d) ⚠| design           | overridden |
| ddeeff00 | workspace| decision   | jwt-library      | (1d)    | auth             |           |
```

### search — 全文検索・タグ検索

```bash
# キーワード検索（FTS5 trigram、日本語対応）
node scripts/context-db.mjs search --query "OpenAPI" --scope all --project myproject

# カテゴリフィルタ付き
node scripts/context-db.mjs search --query "パフォーマンス" --category insight --project myproject

# タグ AND 検索
node scripts/context-db.mjs search --query "API" --tags api,backend --project myproject

# workspace 絞り込み
node scripts/context-db.mjs search --query "JWT" --scope workspace --project myproject --workspace feature-auth

# タグ一覧
node scripts/context-db.mjs search --list-tags --project myproject

# archived 含む検索
node scripts/context-db.mjs search --query "旧仕様" --include-archived --project myproject
```

### delete — コンテキスト削除

```bash
# 単一削除
node scripts/context-db.mjs delete --id <uuid>

# 複数削除
node scripts/context-db.mjs delete --id <uuid1> --id <uuid2>
```

### verify — コンテキスト検証

エントリの `verified_at` を現在日時に更新し、内容が正確であることを確認済みとする。
未解決の上書き履歴がある場合、それらも解決済みになる（`history --unresolved` から消える）。

```bash
# 単一検証
node scripts/context-db.mjs verify --id <uuid>

# 複数検証
node scripts/context-db.mjs verify --id <uuid1> --id <uuid2>
```

### clean — 鮮度チェック

```bash
# プロジェクト内の鮮度チェック（デフォルト 30 日）
node scripts/context-db.mjs clean --project myproject

# 閾値カスタマイズ
node scripts/context-db.mjs clean --project myproject --days 14
```

対象条件:

- `updated_at` から閾値日数を超過したエントリ
- `verified_at` が未設定かつ作成から閾値日数を超過したエントリ
- 解決済みかつ閾値日数を超過した上書き履歴（未解決の履歴は対象外）

候補の提示のみ。削除は出力に含まれる ID を使い `delete` または `history --purge` で手動実行。

出力例:

```
## クリーン候補

### 鮮度閾値超過エントリ（2件）

| ID       | スコープ | カテゴリ   | タイトル    | 最終更新            | 経過日数 |
|----------|---------|-----------|------------|---------------------|---------|
| a1b2c3d4 | project | decision  | old-choice | 2026-01-15 10:00:00 | 75d     |
| e5f6g7h8 | global  | convention| naming     | 2026-01-20 08:30:00 | 70d     |

エントリを削除するには: `node context-db.mjs delete --id <id>`
```

### workspace — ワークスペース管理

階層の最大深度は 5。子ワークスペースを持つワークスペースは削除できない（先に子を削除する）。

```bash
# 作成
node scripts/context-db.mjs workspace --create --name feature-auth --project myproject

# 子ワークスペース作成
node scripts/context-db.mjs workspace --create --name jwt-impl --parent feature-auth --project myproject

# 一覧
node scripts/context-db.mjs workspace --list --project myproject

# アーカイブ（昇格先候補を提示）
node scripts/context-db.mjs workspace --archive --name feature-auth --project myproject

# 削除（子がない場合のみ）
node scripts/context-db.mjs workspace --delete --name feature-auth --project myproject
```

アーカイブ後の昇格手順（候補に基づき手動で実行）:

```bash
# 1. project スコープに新規 write で昇格
node scripts/context-db.mjs write --scope project --project myproject --category decision --title api-design --content "REST API は OpenAPI 3.1 で定義する"

# 2. 元の workspace エントリを delete
node scripts/context-db.mjs delete --id <uuid>
```

### history — 上書き履歴管理

```bash
# コンテキスト ID で履歴参照
node scripts/context-db.mjs history --id <context-uuid>

# 未解決一覧
node scripts/context-db.mjs history --unresolved --project myproject

# プロジェクト内の全履歴
node scripts/context-db.mjs history --project myproject

# 履歴から復元（現在値を履歴に退避した後、指定した履歴の内容で上書きする）
# 復元で生成された履歴は未解決扱い（verify が必要）
node scripts/context-db.mjs history --restore --history-id <history-uuid> --source agent-name

# 解決済み履歴の削除
node scripts/context-db.mjs history --purge --history-id <history-uuid>
```

## 配布

リポジトリ内の `.claude/skills/context-manager/` を canonical path とし、シンボリックリンクで配布する。

```bash
# Claude Code 用
ln -sfn <リポジトリの絶対パス>/.claude/skills/context-manager ~/.claude/skills/context-manager

# Codex 用
ln -sfn ~/.claude/skills/context-manager ~/.codex/skills/context-manager
```
