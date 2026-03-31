# CLI リファレンス（詳細）

SKILL.md のクイックリファレンスで不足する場合に参照する。

## write — 詳細オプション

```bash
# global スコープ
node scripts/context-db.mjs write --scope global --category convention --title naming --content "変数名は camelCase" --tags coding,style

# workspace スコープ
node scripts/context-db.mjs write --scope workspace --project myproject --workspace feature-auth --category insight --title jwt-caveat --content "JWT の有効期限は短めに"

# タグ付き（カンマ区切りで複数指定）
node scripts/context-db.mjs write --category decision --title db-choice --content "PostgreSQL を採用" --tags database,infrastructure --source codex:session-xyz
```

- 同一論理キー（scope + project + workspace + category + title）への再 write は上書き
- 異なる `--source` による上書き時は旧内容を履歴に退避
- スコープ別上限（global: 100, project: 200, workspace: 50）超過時は警告表示（書き込みは継続）

## read — 詳細オプション

```bash
# カテゴリ + タイトル指定
node scripts/context-db.mjs read --scope project --project myproject --category decision --title api-design

# workspace 絞り込み
node scripts/context-db.mjs read --scope workspace --project myproject --workspace feature-auth --category decision

# archived WS のエントリも含める
node scripts/context-db.mjs read --scope all --project myproject --include-archived
```

## search — 詳細オプション

```bash
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

## workspace — ワークスペース管理

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

### アーカイブ後の昇格手順

候補に基づき手動で実行:

```bash
# 1. project スコープに新規 write で昇格
node scripts/context-db.mjs write --scope project --project myproject --category decision --title api-design --content "REST API は OpenAPI 3.1 で定義する"

# 2. 元の workspace エントリを delete
node scripts/context-db.mjs delete --id <uuid>
```

## history — 上書き履歴管理

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

## clean — 鮮度チェック

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

## index — 出力例

```
| ID       | スコープ  | カテゴリ   | タイトル          | 経過日数 | タグ              | 注釈       |
| ---      | ---      | ---       | ---              | ---     | ---              | ---       |
| a1b2c3d4 | global   | convention | package-manager  | (3d)    | coding,style     |           |
| 55667788 | project  | decision   | api-design       | (2d)    | api              |           |
| 99aabbcc | project  | decision   | scope-model      | (45d) ⚠| design           | overridden |
```

- `⚠`: 鮮度閾値（30日）超過
- `overridden`: 下位スコープに同一 category+title が存在
