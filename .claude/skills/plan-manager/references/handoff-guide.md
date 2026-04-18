# セッション引き継ぎガイド

> **context-manager が利用できない場合**: 本ガイド中の context-manager 操作はすべてスキップする。保存すべき知見は SESSION-NNN.md §4「context-manager 保存項目」欄に記載し、将来 context-manager が利用可能になった際にまとめて登録する。ワークスペースの作成・アーカイブも不要。

## 1. 引き継ぎ情報の分類と保存先

| 情報の種類 | 保存先 | 例 |
|-----------|--------|-----|
| 設計判断の理由（why） | context-manager（decision） | 「認証にJWTを選択。理由: ステートレスでスケーラブル」 |
| 踏んだ地雷（why） | context-manager（caveat） | 「SQLite FTS5 trigram は環境依存」 |
| 汎用的な知見（why） | context-manager（insight） | 「DatabaseSync の busy_timeout は接続単位で設定」 |
| タスク完了状態（what） | plan.md 状態列更新 | `[ ]` → `[x]` |
| 未完了タスクの残作業（what） | SESSION-NNN.md 引き継ぎ | 「TASK-003 の write 操作: upsert 実装済み、上書き履歴の生成が未了」 |
| 変更済みファイルの状態（where） | SESSION-NNN.md 実行メモ | 「database.mjs にスキーマ v2 を追加。マイグレーション関数は未テスト」 |
| ブロッカー（what） | SESSION-NNN.md 引き継ぎ | 「FTS5 trigram の動作確認が必要。Node.js 22 のビルトイン SQLite で未検証」 |
| プラン前提の変更（what） | SESSION-NNN.md + ゲート判定 | 「REQ-03 の FTS5 trigram が使えない場合、LIKE フォールバックの設計が必要」 |

## 2. context-manager 保存ルール

### 保存する

- 将来の別プラン・別セッションでも参照される知見
- プロジェクト全体に適用される設計判断
- 再発見に時間がかかる地雷情報

### 保存しない

- 今回のプラン実行でのみ意味がある一時的な情報
- ソースコードを読めばわかる具体的な実装詳細
- タスク完了状態（plan.md で管理）

### 保存時の注意

- 300文字以内（context-manager の品質基準に準拠）
- scope は原則 project（workspace は実行期間中のみ有効な情報に限定）
- tags にプラン名を含める（後から検索可能にする）

## 3. 次セッション開始手順

1. plan.md を読み込み、全体の進捗を確認
2. 最新の SESSION-NNN.md を読み込み、引き継ぎ情報を確認
3. context-manager から関連コンテキストを取得（利用可能な場合）
   - `index --scope all --project <name>`
   - 必要に応じて `search --query <キーワード>`
   - **フォールバック**: context-manager 不在時は手順 1-2 の情報のみで進行
4. 今回のセッション範囲を決定（split-strategy.md 参照）
5. セッションブリーフィングを生成（対象タスク・前提条件・注意事項）

## 4. context-manager ワークスペースライフサイクル（詳細手順）

> **概要**: ワークスペースの作成・アーカイブタイミングは SKILL.md §ワークフロー冒頭の「開始/終了フック」を参照。本節はその詳細手順と判断基準を定義する。

| イベント | 操作 | 命名規則 |
|---------|------|---------|
| プラン管理開始時（初回セッション開始） | `workspace --create --name <ws-name> --project <project>` | `plan-YYMMDD-概要`（プランのタイムスタンプを使用） |
| セッション中 | `write --scope workspace --workspace <ws-name>` | -- |
| プラン完了時（最終セッション終了） | `workspace --archive --name <ws-name> --project <project>` | -- |

**命名規則の例**: プラン `260330_2134_コンテキスト管理_実装` → ワークスペース名 `plan-260330-context-manager`

**アーカイブの判断基準**:

- プランの成功基準を全て満たした → アーカイブ
- プランが中止された → アーカイブ（中止理由を insight として project スコープに保存してからアーカイブ）
- プランが長期中断（30日超） → `clean` で検出される。再開予定がなければアーカイブ

**workspace vs project スコープの使い分け**:

- workspace: 今回のプラン実行でのみ参照される一時的な情報（例: 特定タスクの調査結果、環境固有の設定値）
- project: プラン完了後も参照される恒久的な知見（例: 設計判断、ドメイン知識）→ 振り返り時に workspace から project に昇格を検討

## 5. 引き継ぎ情報の粒度ガイドライン

| 粒度 | 例 | 判定 |
|------|-----|------|
| 過剰 | コード差分をそのまま記載 | NG: ソースを読めばわかる |
| 適切 | 「TASK-003 の write 操作: upsert は実装済み。上書き履歴の生成ロジック（source 比較 → 履歴INSERT）が未了。設計メモ tasks/TASK-003.md §3.2 の方針に従って実装する」 | OK |
| 不足 | 「TASK-003 途中」 | NG: 何が完了で何が未了かわからない |
