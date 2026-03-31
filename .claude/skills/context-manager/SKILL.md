---
name: context-manager
description: >
  AIコーディングエージェント向けのコンテキスト永続化・管理ツール。セッションを跨いで知識・決定事項・慣例を
  SQLite DBに保存し、検索・参照する。スコープ階層（global/project/workspace）、FTS5全文検索、
  上書き履歴・復元、鮮度管理、HTML/JSON/Markdownエクスポートに対応。
  「コンテキストを保存して」「記憶して」「覚えておいて」「プロジェクト情報を登録」「CWDを紐付けて」
  「コンテキストを検索」「過去の決定を調べて」「ワークスペースを作成」「アーカイブして」
  「上書き履歴を確認」「コンテキストの鮮度をチェック」
  「コンテキストの一覧」「目次を表示して」「コンテキストを読んで」「詳細を確認して」
  「コンテキストを削除して」「エクスポートして」「ダッシュボードを生成して」と依頼された場合にトリガー。
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
| decision | 技術選定・設計決定 | PostgreSQL を採用 |
| architecture | アーキテクチャ構成 | モノレポ構成 |
| convention | 繰り返し適用されるルール・規約 | 変数名は camelCase |
| domain | ドメイン知識・業務ルール | 予約は24時間前までキャンセル可 |
| tech-stack | 技術スタック情報 | Node.js 22, TypeScript 5.7 |
| insight | 調査やデバッグで得た知見 | JWT の有効期限は短めに |
| reference | 参照情報・ファイルパス | session管理 → docs/session-management.md |
| caveat | 踏んだ地雷、注意すべき挙動 | SQLite FTS5 trigram は環境依存 |
| todo | 今は対応しないが将来必要な事項 | パフォーマンステスト追加 |

### スコープの選択基準

| スコープ | いつ使うか | 例 |
|---------|-----------|-----|
| global | 全プロジェクト共通のルール | コーディング規約 |
| project | プロジェクト固有の決定 | 技術選定 |
| workspace | 作業ブランチ固有の一時的な知見 | 実装中の調査結果 |

`--scope all` で下位から上位へのカスケード参照。同一 category+title は下位スコープが優先。
鮮度閾値（30日）超過エントリには `⚠` が付与される。

### 言語の規約

- コンテキストの `--content` は、プロジェクトの CLAUDE.md で指定された言語で記述する
- ダッシュボード・レポート等の成果物も同様
- `export` の `--lang` オプションで言語を明示的に指定可能

### セッション終了時

保存すべき知見がないか振り返る:
- 新たな技術的決定を行ったか？ → `decision`
- デバッグで重要な知見を得たか？ → `insight` / `caveat`
- 将来対応が必要な事項を発見したか？ → `todo`

## データストレージ

- デフォルト: `~/.claude/context/context.db`（初回実行時に自動作成）
- 環境変数 `CLAUDE_CONTEXT_DB_PATH` でパスをカスタマイズ可能

## CLI クイックリファレンス

```
node <skill-dir>/scripts/context-db.mjs <操作> [オプション...]
```

各コマンドの詳細オプション・出力例は [references/cli-reference.md](references/cli-reference.md) を参照。

### project — プロジェクト管理

```bash
node scripts/context-db.mjs project --register --name myproject --cwd /path/to/project
node scripts/context-db.mjs project --add-cwd --name myproject --cwd /path/to/worktree
node scripts/context-db.mjs project --list
node scripts/context-db.mjs project --delete --name myproject
```

### write — コンテキスト書き込み

```bash
node scripts/context-db.mjs write --category decision --title api-design --content "REST API は OpenAPI 3.1 で定義する" --source claude-code:session-abc --tags api
```

`--scope` 省略時は project。`--project` 省略時は CWD から自動解決。

### read — コンテキスト読み取り

```bash
node scripts/context-db.mjs read --id <uuid>
node scripts/context-db.mjs read --scope all --project myproject --category decision
```

### index — コンテキスト目次

```bash
node scripts/context-db.mjs index --scope all --project myproject
node scripts/context-db.mjs index --scope project --project myproject --category decision
```

### search — 全文検索

```bash
node scripts/context-db.mjs search --query "OpenAPI" --scope all --project myproject
```

### delete / verify

```bash
node scripts/context-db.mjs delete --id <uuid>
node scripts/context-db.mjs verify --id <uuid>
```

`verify`: `verified_at` を更新し、未解決の上書き履歴も解決済みにする。

### export — エクスポート

```bash
node scripts/context-db.mjs export --project myproject --output dashboard.html
node scripts/context-db.mjs export --project myproject --format json --output contexts.json
node scripts/context-db.mjs export --project myproject --format md --lang en
```

- `--format`: `html`（デフォルト）/ `json` / `md`
- `--lang`: `ja`（デフォルト）/ `en`
- `--output`: ファイル出力（省略時は標準出力）

### workspace / history / clean

低頻度操作。詳細は [references/cli-reference.md](references/cli-reference.md) を参照。

```bash
node scripts/context-db.mjs workspace --create --name feature-auth --project myproject
node scripts/context-db.mjs workspace --list --project myproject
node scripts/context-db.mjs history --unresolved --project myproject
node scripts/context-db.mjs clean --project myproject
```
