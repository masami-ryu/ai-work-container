# 一時ディレクトリの /workspaces/tmp 集約とシンボリックリンク自動化プラン

作成日: 2025年12月13日
作成者: Plan Creator エージェント
ステータス: Draft (v4)

## 1. 概要

### 目的
プロジェクトの一時ディレクトリ（node_modules, dist, .next等）を `/workspaces/tmp` に集約し、シンボリックリンクで自動管理することで、ディスクI/Oを最適化し、クリーンな作業環境を維持する。

### スコープ
- 対象:
  - Docker Compose volumeの権限設定
  - works/ ディレクトリ配下の一時ディレクトリ自動検出とシンボリックリンク作成
  - DevContainer統合（post-create, update-content）

- 対象外:
  - 既存プロジェクトのリポジトリルート直下の一時ディレクトリ（手動管理）
  - ビルド成果物の永続化（一時ファイルのみ対象）
  - Windows環境でのシンボリックリンク対応

### 前提条件
- Docker Compose環境が正常に動作していること
- `/workspaces/tmp` volumeが既に定義されていること（ai-work-container-tmp）
- vscode ユーザーのUID/GIDが1000:1000であること
- works/ ディレクトリがgit管理対象外であること

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | /workspaces/tmp の所有者を vscode:vscode (1000:1000) に設定 | 高 |
| REQ-002 | 要件 | works/**/node_modules を自動的にシンボリックリンクに変換 | 高 |
| REQ-003 | 要件 | works/**/.pnpm-store を自動的にシンボリックリンクに変換 | 高 |
| REQ-004 | 要件 | works/**/dist, works/**/.next, works/**/out も対象に含める | 中 |
| REQ-005 | 要件 | works/**/.cache, works/**/build, works/**/.turbo も対象に含める（任意・後回し可） | 低 |
| REQ-006 | 要件 | /workspaces/tmp 配下の格納先は works/ のディレクトリ構造をミラーする（衝突回避） | 高 |
| REQ-007 | 要件 | 競合検出機能（既にシンボリックリンクの場合はスキップ） | 高 |
| REQ-008 | 要件 | 壊れたシンボリックリンクや想定外のリンク先を検出し、警告を表示。想定リンク先は `/workspaces/tmp/works/<相対パス>/<dirName>` のパターンに従い、元パスのミラー規約を満たすもの | 中 |
| REQ-009 | 要件 | 既存の実ディレクトリはデフォルトで退避（`.bak-<timestamp>`）、`--delete-existing` オプション指定時のみ削除 | 中 |
| REQ-010 | 要件 | ドライランモードでの動作確認機能 | 中 |
| REQ-011 | 要件 | sudo -n の事前チェックと失敗時の明確なメッセージ表示 | 高 |
| REQ-012 | 要件 | find コマンドで node_modules 配下を探索しないよう -prune で最適化 | 中 |
| CON-001 | 制約 | Docker volumeのパフォーマンス特性を考慮（bind mountより遅い場合がある） | - |
| CON-002 | 制約 | シンボリックリンクはLinux環境でのみ完全動作保証 | - |
| CON-003 | 制約 | 既存のpost-createスクリプトとの互換性を維持 | - |
| GUD-001 | ガイドライン | スクリプトは冪等性を保つこと | - |
| GUD-002 | ガイドライン | ログ出力は詳細かつ明確に | - |

## 3. 実装ステップ

### Phase 1: Docker Volume権限設定
**目標**: /workspaces/tmp の所有者を vscode:vscode に設定し、書き込み可能にする

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-101 | 権限設定スクリプトの作成 | .devcontainer/init-tmp-volume.sh | スクリプトが作成され、sudo -n で実行可能 | [ ] |

**実装の詳細（TASK-101）:**
```bash
#!/usr/bin/env bash
# .devcontainer/init-tmp-volume.sh
set -euo pipefail

TMP_DIR="/workspaces/tmp"
TARGET_UID=1000
TARGET_GID=1000

# sudo -n の事前チェック（REQ-011）
if ! sudo -n true 2>/dev/null; then
  echo "[$(date)] ✗ ERROR: パスワード不要のsudoが必要です" >&2
  echo "  必要な対応:" >&2
  echo "  - devcontainer.jsonで 'remoteUser': 'vscode' が設定されていることを確認" >&2
  echo "  - または、sudoersにNOPASSWD設定を追加" >&2
  exit 1
fi

echo "[$(date)] Initializing $TMP_DIR permissions..."

# ディレクトリが存在しない場合は作成（初回のみ）
# mode 0755: 所有者は rwx、グループとその他は rx（セキュリティと利便性のバランス）
if [ ! -d "$TMP_DIR" ]; then
  sudo -n install -d -o ${TARGET_UID} -g ${TARGET_GID} -m 0755 "$TMP_DIR"
  echo "[$(date)] ✓ Created $TMP_DIR with ownership ${TARGET_UID}:${TARGET_GID}"
else
  # 既存の場合は、トップレベルの権限のみ確認・修正（chown -R は使用しない）
  CURRENT_OWNER=$(stat -c "%u:%g" "$TMP_DIR")
  if [ "$CURRENT_OWNER" != "${TARGET_UID}:${TARGET_GID}" ]; then
    sudo -n chown ${TARGET_UID}:${TARGET_GID} "$TMP_DIR"
    echo "[$(date)] ✓ Updated $TMP_DIR ownership to ${TARGET_UID}:${TARGET_GID}"
  else
    echo "[$(date)] ✓ $TMP_DIR ownership already correct (${TARGET_UID}:${TARGET_GID})"
  fi
fi
```

### Phase 2: シンボリックリンク自動化スクリプト作成
**目標**: works/ 配下の一時ディレクトリを検出し、自動的にシンボリックリンクに変換

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-201 | シンボリックリンク作成スクリプトの実装 | .devcontainer/setup-tmp-symlinks.sh | スクリプトが一時ディレクトリを検出し、シンボリックリンクを作成する | [ ] |
| TASK-202 | 検出対象パターンの定義と find 最適化 | .devcontainer/setup-tmp-symlinks.sh | 優先度高・中: node_modules, .pnpm-store, dist, out, .next が検出される。優先度低（任意）: .cache, build, .turbo。find で -prune を使用して node_modules 配下を探索しない（REQ-012） | [ ] |
| TASK-203 | /workspaces/tmp配下の格納先ルール実装 | .devcontainer/setup-tmp-symlinks.sh | works/ のディレクトリ構造をミラーして格納（例: works/foo/node_modules → /workspaces/tmp/works/foo/node_modules） | [ ] |
| TASK-204 | 競合検出機能の実装 | .devcontainer/setup-tmp-symlinks.sh | 既存のシンボリックリンク、壊れたリンク、想定外のリンク先（REQ-008の判定ルールに従う）を検出し、適切に処理・警告 | [ ] |
| TASK-205 | 既存ディレクトリ退避機能の実装 | .devcontainer/setup-tmp-symlinks.sh | デフォルトで `.bak-<timestamp>` へ退避、`--delete-existing` オプションで削除（REQ-009） | [ ] |
| TASK-206 | ドライランモード実装 | .devcontainer/setup-tmp-symlinks.sh | `--dry-run` オプションで実際の変更なしに動作確認できる | [ ] |

**実装の詳細:** スクリプトの完全な実装コードは文字数制限のため省略しますが、以下の機能を含みます:
- 検出対象パターン配列
  - 優先度高・中（必須）: node_modules, .pnpm-store, dist, out, .next
  - 優先度低（任意）: .cache, build, .turbo
- ドライランモード（--dry-run）とverboseモード（--verbose）
- 競合検出とスキップ機能
  - 既存シンボリックリンク: リンク先が想定通りならスキップ、想定外なら警告+スキップ
  - 壊れたリンク: 警告+スキップ（または `--fix-broken` で修復）
  - 想定リンク先判定: `/workspaces/tmp/works/<相対パス>/<dirName>` のパターンに従うもの（REQ-008）
- /workspaces/tmp 配下の格納先は works/ のディレクトリ構造をミラー
- 既存の実ディレクトリの扱い（REQ-009）
  - デフォルト: `.bak-<timestamp>` へリネーム退避
  - `--delete-existing` オプション指定時: 削除（危険操作のため明示的に指定が必要）
- 詳細なログ出力

### Phase 3: DevContainer統合（方針B: 最小変更アプローチ）
**目標**: 既存の post-create.sh に統合し、コンテナ起動・更新時に自動的にシンボリックリンクを作成

**方針**: レビュー結果を踏まえ、devcontainer.json の postCreateCommand は現状維持し、既存の `.devcontainer/post-create.sh`（実体: `/usr/local/bin/devcontainer-post-create.sh`）に両スクリプトの呼び出しを組み込む。これにより既存構成との整合性を保ち、保守性を向上させる。

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-301 | post-create.sh に init-tmp-volume.sh の呼び出しを追加 | .devcontainer/post-create.sh | anyenv/nodenv セットアップの前に init-tmp-volume.sh が実行される | [ ] |
| TASK-302 | post-create.sh に setup-tmp-symlinks.sh の呼び出しを追加 | .devcontainer/post-create.sh | anyenv/nodenv セットアップの後に setup-tmp-symlinks.sh が実行される | [ ] |
| TASK-303 | fix-workspaces-permission.sh に setup-tmp-symlinks.sh の呼び出しを追加 | .devcontainer/fix-workspaces-permission.sh | コンテナ更新時（updateContentCommand）に自動実行される | [ ] |

**実装の詳細（TASK-301, 302）:**
`.devcontainer/post-create.sh` に以下を追加：
```bash
# /workspaces/tmp の権限設定（anyenv セットアップの前）
if [ -f "/workspaces/ai-work-container/.devcontainer/init-tmp-volume.sh" ]; then
  bash /workspaces/ai-work-container/.devcontainer/init-tmp-volume.sh
fi

# （既存の anyenv/nodenv セットアップ処理）

# works/ 配下のシンボリックリンク自動化（anyenv セットアップの後）
if [ -f "/workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh" ]; then
  bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh
fi
```

**実装の詳細（TASK-303）:**
`.devcontainer/fix-workspaces-permission.sh` の最後に以下を追加：
```bash
# works/ 配下のシンボリックリンク自動化
if [ -f "/workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh" ]; then
  bash /workspaces/ai-work-container/.devcontainer/setup-tmp-symlinks.sh
fi
```

### Phase 4: テストと検証
**目標**: 実装した機能が正常に動作することを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-401 | ドライランモードでの動作確認 | - | エラーなく実行され、正しい変更内容が表示される | [ ] |
| TASK-402 | テストプロジェクトでの動作確認 | works/test-project | node_modulesがシンボリックリンクに変換される | [ ] |
| TASK-403 | 権限確認 | /workspaces/tmp | vscode:vscode で書き込み可能 | [ ] |
| TASK-404 | 競合テスト | - | 既存シンボリックリンクが適切にスキップされる | [ ] |
| TASK-405 | コンテナ再ビルドテスト | - | Rebuild Containerで設定が維持される | [ ] |

## 4. テスト計画

| テストID | 種別 | 内容 | 期待結果 |
|----------|------|------|---------|
| TEST-001 | 単体 | init-tmp-volume.sh の実行 | /workspaces/tmp の所有者が vscode:vscode になる（chown -R は使用しない） |
| TEST-002 | 単体 | setup-tmp-symlinks.sh --dry-run | エラーなく実行され、変更内容が表示される |
| TEST-003 | 単体 | setup-tmp-symlinks.sh の実行 | node_modules がシンボリックリンクに変換される |
| TEST-004 | 統合 | コンテナ起動時の自動実行 | postCreateCommand で両スクリプトが実行される |
| TEST-005 | 統合 | works/配下での npm install | シンボリックリンク先にnode_modulesが作成される |
| TEST-006 | 回帰 | 既存のpost-createスクリプト | anyenv/nodenvが正常にセットアップされる |
| TEST-007 | 境界 | 空の works/ ディレクトリ | エラーなく正常終了する |
| TEST-008 | 境界 | 既にシンボリックリンクが存在 | スキップされ、既存リンクが維持される |

## 5. 成功基準

- [ ] /workspaces/tmp の所有者が vscode:vscode (1000:1000) に設定されている（chown -R は使用しない）
- [ ] works/**/node_modules が自動的にシンボリックリンクに変換される
- [ ] works/**/.pnpm-store が自動的にシンボリックリンクに変換される
- [ ] /workspaces/tmp 配下の格納先が works/ のディレクトリ構造をミラーしている
- [ ] コンテナ再ビルド後も設定が維持される
- [ ] 既存プロジェクトとの互換性が維持される（post-createスクリプトが正常動作）
- [ ] ドライランモードで事前確認が可能
- [ ] 競合検出が正常に動作し、既存シンボリックリンクをスキップする
- [ ] 壊れたシンボリックリンクや想定外のリンク先が検出され、警告が表示される
- [ ] ログが詳細かつ明確に出力される

## 6. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | Docker volumeのパフォーマンス特性により、パフォーマンスが低下する可能性 | 中 | 中 | ベンチマークテストを実施し、bind mountとの比較を行う。必要に応じてtmpfsマウントに変更 |
| RISK-002 | 既存の一時ディレクトリが巨大で、退避/削除に時間がかかる | 低 | 中 | ドライランモードで事前に確認。デフォルトは退避なのでデータ損失リスクは低い。削除は明示オプションが必要（REQ-009） |
| RISK-003 | シンボリックリンクの競合によるビルド失敗 | 中 | 低 | 競合検出機能を実装し、既存リンクはスキップ。詳細ログで状況を可視化 |
| RISK-004 | パーミッション設定の失敗により書き込み不可 | 高 | 低 | init-tmp-volume.sh で sudo -n の事前チェックを実施（REQ-011）。失敗時は必要な対処方法を明確に表示して終了 |
| RISK-005 | works/ 配下の深い階層の一時ディレクトリが検出されない | 低 | 中 | find の maxdepth を調整可能にする。または再帰的に検索するオプションを追加 |
| RISK-006 | /workspaces/tmp 配下でのディレクトリ名衝突 | 中 | 低 | works/ のディレクトリ構造をミラーする配置ルールで衝突を回避 |
| RISK-007 | /workspaces/tmp 配下に過去の実行で root 所有のファイル/ディレクトリが残っている場合、その後の処理が詰まる | 低 | 低 | 原則は空のvolume前提。問題が起きた場合は `/workspaces/tmp/works` 直下のみを限定的に修復する運用とする。トラブルシューティングガイドに手順を記載 |

## 7. 依存関係

- Docker Compose 環境（既存）
- `/workspaces/tmp` volume（既存）
- vscode ユーザー（UID:1000, GID:1000）（既存）
- 既存のpost-createスクリプト（競合しないよう統合が必要）

## 8. 次のアクション

### 即座に実行可能なアクション
1. [ ] **Phase 1実施**: init-tmp-volume.sh を作成し、devcontainer.json を更新
2. [ ] **Phase 2実施**: setup-tmp-symlinks.sh を作成（配置ルールと競合検出を含む）
3. [ ] **Phase 3実施**: devcontainer.json のライフサイクルコマンドを更新
4. [ ] **Phase 4実施**: テスト計画に従って検証

### 検討・調査が必要なアクション
5. [ ] **パフォーマンス評価**: Docker volume vs bind mount vs tmpfs のベンチマーク
6. [ ] **代替案検討**: volumeではなくtmpfsマウントの検討（揮発性は許容可能なため）
7. [ ] **拡張機能検討**: .gitignore からパターンを自動検出する機能

### レビュー後のアクション
8. [ ] **本実装**: レビュー承認後、Phase 1〜4を順次実施
9. [ ] **ドキュメント更新**: README.md に使用方法を追記
10. [ ] **トラブルシューティングガイド作成**: 問題発生時の対処方法をドキュメント化

---

## 補足: 代替案の検討

### 代替案1: tmpfs マウント
**メリット:**
- メモリベースで非常に高速
- ディスクI/Oが発生しない

**デメリット:**
- コンテナ再起動でデータが消失（一時ファイルには問題なし）
- メモリ使用量が増加

**実装例:**
```yaml
services:
  devcontainer:
    tmpfs:
      - /workspaces/tmp:uid=1000,gid=1000,size=2G
```

### 代替案2: bind mount
**メリット:**
- 最も高速（ホストファイルシステムを直接使用）
- データが永続化される

**デメリット:**
- ホストのディレクトリ構造に依存
- Windows/Macでのパフォーマンス問題

**実装例:**
```yaml
services:
  devcontainer:
    volumes:
      - ~/docker-volumes/ai-work-tmp:/workspaces/tmp:cached
```

### 推奨
現在の要件では **named volume（現状）** が最もバランスが良い。パフォーマンス問題が発生した場合は **tmpfs** への移行を検討。

---

## 変更履歴

| 日付 | バージョン | 変更内容 | 変更者 |
|------|-----------|---------|--------|
| 2025-12-13 | v1.0 | 初版作成 | Plan Creator エージェント |
| 2025-12-13 | v2.0 | レビュー反映: (1) Phase 1を docker-compose 改変から devcontainer lifecycle + sudo に変更、(2) REQ-003 を .pnpm-store に修正、(3) REQ-005（バックアップ）削除、(4) 配置ルール明文化、(5) 既存シンボリックリンク扱いの追加、(6) chown -R 回避 | Plan Creator エージェント |
| 2025-12-13 | v3.0 | v2レビュー反映: (1) devcontainer.json の例を Phase 3 に統一、(2) 要件表に .cache/build/.turbo を優先度低で追加（REQ-005）、(3) 既存ディレクトリはデフォルトで退避、削除は明示オプション（REQ-009）、(4) sudo -n の事前チェック追加（REQ-011）、(5) 想定リンク先の判定ルール明文化（REQ-008）、(6) Phase 2 にTASK-205追加、(7) リスクと対策を更新 | Plan Creator エージェント |
| 2025-12-13 | v4.0 | v3レビュー反映: (1) Phase 3を方針B（最小変更アプローチ）に変更し、post-create.sh に統合、(2) REQ-012追加（find -prune 最適化）、(3) TASK-202更新（検出ロジック最適化）、(4) mode 0755 の理由を明記、(5) RISK-007追加（/workspaces/tmp が汚れているケースの運用メモ） | Plan Creator エージェント |

---
*このプランは Plan Creator エージェントによって作成されました*
