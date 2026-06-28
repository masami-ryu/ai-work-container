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

### コンテキストの品質基準

- **抽象化**: ソースコードを読めばわかる具体詳細（メソッド名一覧、定数値、引数リスト等）は不要。構造的な判断材料・ナビゲーション情報を記録する
- **簡潔さ**: 1エントリ300文字以内を目安に。超過すると write 時に警告が出る。超過時は分割か抽象度を上げる
- **非重複**: 他エントリとの重複がないか `index` / `search` で確認してから登録する
- **陳腐化リスク**: 変更頻度の高い情報（定数値、環境変数一覧等）は登録しない。ソースの const 定義を見るほうが正確

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

- コンテキストの `--content` は、プロジェクトの AGENTS.md で指定された言語で記述する
- ダッシュボード・レポート等の成果物も同様
- `export` の `--lang` オプションで言語を明示的に指定可能

### 定期レビュー（品質改善）

1. `index --scope all --project <name>` で全エントリを俯瞰し、品質基準に照らして問題を分類（過剰詳細/重複/動的知識不足/未検証）
2. `export --format json --project <name> --output backup.json` でバックアップ取得
3. 改善実施: `write`（上書き圧縮）/ `delete`（重複削除）/ `write`（caveat/insight 新規追加）
4. `verify --all --project <name>` で全エントリの鮮度を一括更新

### セッション終了時

保存すべき知見がないか振り返る:
- 新たな技術的決定を行ったか？ → `decision`
- デバッグで重要な知見を得たか？ → `insight` / `caveat`
- 将来対応が必要な事項を発見したか？ → `todo`

## データストレージ

- デフォルト: `~/.codex/context/context.db`（初回実行時に自動作成）
- 環境変数 `CODEX_CONTEXT_DB_PATH` でパスをカスタマイズ可能

## CLI

```
node <skill-dir>/scripts/context-db.mjs <操作> [オプション...]
```

主要操作: `project`, `write`, `read`, `index`, `search`, `delete`, `verify`, `export`, `workspace`, `history`, `clean`

デフォルト動作:
- `--scope` 省略時は project。`--project` 省略時は CWD から自動解決
- `index` の ID は先頭8桁。短縮ID（8桁等）は `read`/`delete`/`verify`/`history --id` でそのまま使用可能（一意に解決できない場合はエラー）。`--full-id` でフルUUID表示
- `verify --all --project <name>` で一括検証。`verify` は未解決の上書き履歴も解決済みにする
- `--id` は複数指定可（例: `--id <id1> --id <id2>`）。`read` も複数ID対応

各コマンドの詳細オプション・構文・出力例は [references/cli-reference.md](references/cli-reference.md) を参照。
