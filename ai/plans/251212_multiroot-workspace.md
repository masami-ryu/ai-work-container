# マルチルートワークスペース導入プラン

作成日: 2025年12月12日
作成者: Plan Creator エージェント
ステータス: Approved
更新日: 2025年12月12日（第5回レビュー反映）

## 1. 概要

### 目的
devcontainer環境にマルチルートワークスペース機能を導入し、`./repo/`配下に複数のプロジェクトを配置して、共通設定（`.claude/`、`.github/agents/`等）を継承しながら開発できる環境を構築する。

### スコープ
- 対象: devcontainer設定、ワークスペース設定、シンボリックリンク設定
- 対象外: 個別プロジェクトの内部設定、CI/CD設定

### 前提条件
- 現在のdevcontainer環境が正常に動作していること
- Docker/Dev Containersが利用可能であること
- VS Codeを使用した開発を想定
- シンボリックリンクが作成可能な環境（Linux/macOS、またはWindows開発者モード有効）

## 2. 要件と制約

| ID | 種別 | 内容 | 優先度 |
|----|------|------|--------|
| REQ-001 | 要件 | `./repo/`配下に複数プロジェクトを配置できる | 高 |
| REQ-002 | 要件 | `.claude/`等の設定が配下プロジェクトから利用可能 | 高 |
| REQ-003 | 要件 | 各プロジェクトのnode_modulesをシンボリックリンクで外部化 | 高 |
| REQ-004 | 要件 | 任意のプロジェクトをgit cloneで追加可能 | 中 |
| REQ-005 | 要件 | VS Code標準手順でマルチルートワークスペースを開ける | 高 |
| CON-001 | 制約 | 既存のdevcontainer設定との互換性を維持 | - |
| CON-002 | 制約 | パフォーマンス劣化を最小限に抑える | - |
| GUD-001 | ガイドライン | VS Codeマルチルートワークスペースの標準仕様に準拠 | - |

## 3. 技術調査結果

### マルチルートワークスペースの構成方法

1. **`.code-workspace`ファイル**: VS Codeのマルチルートワークスペースを定義
2. **`workspaceFolder`**: devcontainer.jsonでワークスペースフォルダを指定
3. **シンボリックリンク**: node_modulesを外部ディレクトリにリンク（アプローチA採用）

### Claude設定の継承

Claude Codeは以下の優先順位で設定を読み込む：
1. カレントディレクトリの`.claude/`
2. 親ディレクトリの`.claude/`（再帰的に探索）
3. ユーザーレベルの設定

→ 配下プロジェクトからルートの`.claude/`を参照可能

### node_modules除外方式: アプローチA（シンボリックリンク）

**採用理由:**
- devcontainerのマウントは起動時に固定されるため、動的追加に対応できない
- シンボリックリンクは起動後にgit cloneしたプロジェクトにも対応可能
- 設定がシンプルで保守性が高い

**仕組み:**
```
/workspaces/ai-work-container/
├── repo/
│   └── project-a/
│       └── node_modules -> /workspaces/ai-work-container/.node_modules_cache/project-a/
├── .node_modules_cache/     # Dockerボリュームマウント先
│   └── project-a/
└── ...
```

**パス規則:** すべてのシンボリックリンクは `/workspaces/ai-work-container/.node_modules_cache/<project-name>/` を指す

## 4. 実装ステップ

### Phase 1: ディレクトリ構造の準備
**目標**: マルチルートワークスペース用のディレクトリ構造を作成

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-001 | `repo/`ディレクトリを作成 | `repo/.gitkeep` | ディレクトリが存在する | [ ] |
| TASK-002 | `.gitignore`にrepo配下の除外設定を追加 | `.gitignore` | `repo/*/`、`.node_modules_cache/`、`*.backup`が除外されている | [ ] |
| TASK-003 | node_modulesキャッシュディレクトリを作成 | `.node_modules_cache/.gitkeep` | ディレクトリが存在する | [ ] |

### Phase 2: ワークスペースファイルの作成
**目標**: VS Codeマルチルートワークスペースファイルを作成

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-004 | `.code-workspace`ファイルを作成 | `ai-work-container.code-workspace` | ファイルが作成され、フォルダ定義が含まれている | [ ] |
| TASK-005 | ワークスペース設定を追加 | `ai-work-container.code-workspace` | 共通設定が定義されている | [ ] |

**ワークスペースファイルの構造:**

初期状態ではルートフォルダのみ定義し、`repo/`配下のプロジェクトは`setup-repo-project.sh`スクリプトで動的に追加する。

```json
{
  "folders": [
    {
      "name": "ai-work-container (root)",
      "path": "."
    }
    // repo/配下のプロジェクトはsetup-repo-project.shで追加
    // 例: { "name": "project-a", "path": "repo/project-a" }
  ],
  "settings": {
    "files.exclude": {
      "**/node_modules": true,
      ".node_modules_cache": true
    }
  },
  "extensions": {
    "recommendations": [
      "anthropic.claude-code",
      "eamodio.gitlens"
    ]
  }
}
```

**注意:** `.code-workspace`ファイルには、ファイルが存在するフォルダまたはそのサブフォルダへの相対パスのみ使用可能（VS Code仕様）

### Phase 3: devcontainer設定の更新
**目標**: マルチルートワークスペース対応のdevcontainer環境を構築

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-006 | `.node_modules_cache`をボリュームマウント | `.devcontainer/devcontainer.json` | マウント設定が追加されている | [ ] |
| TASK-007 | postCreateCommandでワークスペース開き方を案内 | `.devcontainer/devcontainer.json` | 以下の内容を含む案内が表示される: (1)マルチルートワークスペースを開く2つの方法、(2)`ai-work-container.code-workspace`のパス | [ ] |

**devcontainer.jsonの設定例:**
```json
{
  "workspaceFolder": "/workspaces/ai-work-container",
  "workspaceMount": "source=${localWorkspaceFolder},target=/workspaces/ai-work-container,type=bind",
  "mounts": [
    "type=volume,source=ai-work-node-modules-cache,target=/workspaces/ai-work-container/.node_modules_cache"
  ],
  "postCreateCommand": "bash .devcontainer/post-create.sh"
}
```

**マルチルートワークスペースの開き方（VS Code標準手順）:**

VS Codeの仕様上、`devcontainer.json`の`workspaceFolder`に`.code-workspace`ファイルを直接指定することはできない。以下のいずれかの方法を使用する：

1. **コマンドパレットから開く（推奨）**
   - F1 → `Dev Containers: Open Workspace in Container...` を選択
   - `ai-work-container.code-workspace` を選択

2. **コンテナ接続後に開く**
   - 通常どおりdevcontainerを起動
   - `File > Open Workspace from File...` で `.code-workspace` を選択

3. **自動案内（postCreateCommand）**
   - コンテナ起動時にワークスペースファイルの開き方を案内するメッセージを表示

**案内メッセージの例:**
```
================================
マルチルートワークスペースを使用する場合:

方法1: コマンドパレットから開く（推奨）
  1. F1 キーを押す
  2. "Dev Containers: Open Workspace in Container..." を選択
  3. "ai-work-container.code-workspace" を選択

方法2: コンテナ接続後に開く
  1. File > Open Workspace from File...
  2. "/workspaces/ai-work-container/ai-work-container.code-workspace" を選択
================================
```

### Phase 4: シンボリックリンク管理スクリプトの作成
**目標**: git clone後に自動でnode_modulesをシンボリックリンク化する仕組みを構築

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-008 | シンボリックリンク作成ヘルパースクリプトを作成 | `.devcontainer/setup-repo-project.sh` | スクリプトが作成され、以下の機能を含む: (1)既存node_modules削除、(2)シンボリックリンク作成、(3)ワークスペースへのフォルダ追加（重複チェック付き）、(4)JSON整形保証、(5).code-workspaceの事前バックアップ作成 | [ ] |
| TASK-009 | 使用方法をスクリプトに記載 | `.devcontainer/setup-repo-project.sh` | ヘルプが表示され、バックアップ復旧手順（`cp .code-workspace.backup ai-work-container.code-workspace`）を含む | [ ] |
| TASK-010 | プロジェクト削除ヘルパースクリプトを作成 | `.devcontainer/remove-repo-project.sh` | スクリプトが作成され、以下を実行: (1).code-workspaceの事前バックアップ作成、(2)ワークスペースからフォルダ定義を削除、(3)キャッシュディレクトリを削除、(4)JSON整形保証 | [ ] |

**setup-repo-project.shの機能:**
```bash
#!/bin/bash
# 使用方法: setup-repo-project.sh <project-name>
# 1. .code-workspace の事前バックアップを作成（.code-workspace.backup）
# 2. 既存の repo/<project-name>/node_modules を削除（存在する場合）
# 3. repo/<project-name>/node_modules をシンボリックリンクに置換
# 4. .node_modules_cache/<project-name>/ を実体として作成
# 5. .code-workspace に新プロジェクトを追加（重複チェック実施）
# 6. JSON整形を保証（jqまたはpythonを使用）
```

**remove-repo-project.shの機能:**
```bash
#!/bin/bash
# 使用方法: remove-repo-project.sh <project-name>
# 1. .code-workspace の事前バックアップを作成（.code-workspace.backup）
# 2. .code-workspace から指定プロジェクトのフォルダ定義を削除
# 3. .node_modules_cache/<project-name>/ を削除
# 4. JSON整形を保証（jqまたはpythonを使用）
# 注: repo/<project-name>/ 自体は削除しない（ユーザーが手動で削除）
```

**重複防止の仕様:**
- `setup-repo-project.sh`実行時、`.code-workspace`の`folders`配列に同じ`path`が既に存在する場合はスキップ
- 同じ`name`で異なる`path`の場合は警告を表示し、ユーザーに確認を求める

**JSON整形の仕様:**
- `jq`コマンドが利用可能な場合は`jq`を使用
- `jq`が利用できない場合は`python -m json.tool`を使用
- 整形失敗時は元のファイルをバックアップし、エラーメッセージを表示

### Phase 5: Claude設定の継承確認
**目標**: 配下プロジェクトからルートの.claude/設定が利用できることを確認

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-011 | CLAUDE.mdの継承パスを文書化 | `docs/multiroot-workspace-usage.md` | ドキュメントが作成されている | [ ] |
| TASK-012 | テストプロジェクトで動作確認 | - | `.claude/`のコマンドが配下から実行可能 | [ ] |

### Phase 6: ドキュメント整備
**目標**: マルチルートワークスペースの使用方法を文書化

| タスクID | 内容 | 対象ファイル | 完了条件 | 状態 |
|----------|------|-------------|---------|------|
| TASK-013 | 使用方法ガイドを作成 | `docs/multiroot-workspace-usage.md` | ガイドが作成され、以下を含む: (1)基本的な使用方法、(2)Windows開発者モード有効化手順、(3)トラブルシューティング、(4)バックアップ復旧・運用方針（復旧コマンド、古いバックアップの整理方法を含む） | [ ] |
| TASK-014 | CLAUDE.mdを更新 | `CLAUDE.md` | マルチルートワークスペースの説明が追加されている | [ ] |

## 5. テスト計画

| テストID | 種別 | 内容 | 期待結果 | 対応要件 |
|----------|------|------|---------|---------|
| TEST-001 | 統合 | devcontainerの起動確認 | コンテナが正常に起動する | - |
| TEST-002 | 統合 | `Open Workspace in Container...`でワークスペース起動 | `.code-workspace`が開き、マルチルート表示される | REQ-005 |
| TEST-003 | 統合 | コンテナ接続後に`File > Open Workspace`で開く | `.code-workspace`が開き、マルチルート表示される | REQ-005 |
| TEST-004 | 統合 | git cloneでプロジェクト追加 | `repo/`配下にプロジェクトが追加される | REQ-001, REQ-004 |
| TEST-005 | 統合 | `setup-repo-project.sh`実行後の表示確認 | 追加されたプロジェクトがエクスプローラーに表示される | REQ-005 |
| TEST-006 | 統合 | シンボリックリンクが正しく作成される | node_modulesがリンクになり、npm installが成功する | REQ-003 |
| TEST-007 | 統合 | 配下プロジェクトから/planコマンド実行 | プランが正常に作成される | REQ-002 |
| TEST-008 | 統合 | 配下プロジェクトからClaude Codeエージェント利用 | `.claude/agents/`が参照可能 | REQ-002 |
| TEST-009 | 統合 | `remove-repo-project.sh`でプロジェクト削除 | ワークスペースから定義が削除され、キャッシュが削除される | REQ-003 |
| TEST-010 | 統合 | 同じプロジェクトを2回追加 | 重複が防止され、スキップまたは警告が表示される | - |
| TEST-011 | 統合 | スクリプト実行後のJSON整形確認 | `.code-workspace`が正しいJSON形式を維持している | - |
| TEST-012 | 統合 | 既存MCP/hooksの回帰確認 | マルチルートワークスペース導入後もMCPサーバー、hooksが正常に動作する | REQ-002 |
| TEST-013 | 統合 | postCreate案内メッセージの表示確認 | コンテナ起動時に案内メッセージが正常に表示される | - |
| TEST-014 | 統合 | バックアップ復旧手順の動作確認 | `.code-workspace.backup`から復旧できることを確認 | - |

## 6. 成功基準

- [ ] `repo/`配下に任意のプロジェクトをgit cloneできる（REQ-001, REQ-004）
- [ ] 配下プロジェクトから`.claude/`のコマンド・エージェントが利用できる（REQ-002）
- [ ] 配下プロジェクトのnode_modulesがシンボリックリンクで外部化される（REQ-003）
- [ ] VS Code標準手順（`Open Workspace in Container...`または`File > Open Workspace`）でマルチルートワークスペースを開ける（REQ-005）
- [ ] `setup-repo-project.sh`で追加したプロジェクトがワークスペースに表示される（REQ-005）
- [ ] `remove-repo-project.sh`でプロジェクトを削除すると、ワークスペース定義とキャッシュが削除される
- [ ] 同じプロジェクトを2回追加しようとすると、重複が防止される
- [ ] スクリプト実行後も`.code-workspace`が正しいJSON形式を維持している
- [ ] スクリプト実行時に`.code-workspace`のバックアップが作成される
- [ ] 既存の機能（MCPサーバー、hooks等）が引き続き動作する
- [ ] `.gitignore`に`.node_modules_cache/`と`*.backup`が除外されている
- [ ] バックアップ復旧手順がドキュメント化され、実際に復旧可能である
- [ ] postCreate案内メッセージが正常に表示される

## 7. リスクと対策

| ID | リスク | 影響度 | 発生確率 | 対策 |
|----|--------|--------|---------|------|
| RISK-001 | Windowsでシンボリックリンク作成に管理者権限が必要 | 中 | 中 | 開発者モードの有効化手順をドキュメントに記載 |
| RISK-002 | Claude設定の継承が期待通りに動作しない | 中 | 低 | 明示的なCLAUDE.mdへの参照パスを設定 |
| RISK-003 | npm installがシンボリックリンク先で失敗 | 中 | 低 | スクリプトで事前にディレクトリを作成 |
| RISK-004 | git操作の複雑化 | 低 | 中 | 使用方法ドキュメントの充実 |

## 8. 依存関係

- Docker Desktop / Docker Engine
- VS Code Dev Containers拡張機能
- Claude Code CLI
- **シンボリックリンク作成可能な環境**
  - Linux/macOS: 標準で対応
  - Windows: 開発者モードの有効化が必要

## 9. 次のアクション

1. [ ] このプランのレビューと承認
2. [ ] Phase 1: ディレクトリ構造の準備を開始
3. [ ] Phase 2-3: ワークスペースとdevcontainer設定を実装
4. [ ] Phase 4: シンボリックリンク管理スクリプトを実装
5. [ ] Phase 5-6: テストとドキュメント整備

## 10. 補足: 推奨ディレクトリ構造

```
ai-work-container/
├── .claude/                    # Claude設定（共有）
│   ├── commands/
│   ├── agents/
│   └── hooks/
├── .github/                    # GitHub設定（共有）
│   └── agents/
├── .devcontainer/              # devcontainer設定
│   ├── devcontainer.json       # 更新
│   ├── Dockerfile
│   ├── setup-repo-project.sh   # 新規作成
│   └── remove-repo-project.sh  # 新規作成
├── .node_modules_cache/        # node_modules実体（新規・ボリュームマウント）
│   ├── .gitkeep
│   └── project-a/
├── repo/                       # プロジェクト配置ディレクトリ（新規）
│   ├── .gitkeep
│   └── project-a/              # git cloneしたプロジェクト（.code-workspaceに追加）
│       └── node_modules -> /workspaces/ai-work-container/.node_modules_cache/project-a/
├── ai/
│   └── plans/
├── docs/
├── CLAUDE.md
└── ai-work-container.code-workspace  # 新規作成
```

## 11. 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-12 | 初版作成 |
| 2025-12-12 | 第1回レビュー反映: node_modules除外方式をアプローチA（シンボリックリンク）に統一、devcontainer設定タスク追加、マウント設定例修正、依存関係にシンボリックリンク要件追加 |
| 2025-12-12 | 第2回レビュー反映: (1) .code-workspaceの動的追加方式を明記、(2) REQ-005をVS Code標準手順に修正（devcontainer.jsonでの自動起動は非対応のため）、(3) node_modulesキャッシュパスを`/workspaces/ai-work-container/.node_modules_cache`に統一、(4) テスト計画にREQ-005対応ケースを追加（TEST-002,003,005） |
| 2025-12-12 | 第3回レビュー反映: (1) TASK-010追加: プロジェクト削除スクリプト（`remove-repo-project.sh`）を新設、(2) TASK-007具体化: postCreateの案内メッセージ内容を明記、(3) TASK-008拡充: 重複防止・JSON整形の仕様を追加、(4) テスト計画にTEST-009/010/011追加: 削除フロー、重複防止、JSON整形の検証、(5) 成功基準に3項目追加: 削除フロー、重複防止、JSON整形の保証 |
| 2025-12-12 | 第4回レビュー反映: (1) TASK-008/010拡充: .code-workspaceの事前バックアップ作成を追加、(2) スクリプト仕様詳細化: 既存node_modules削除ロジックを明記、(3) TEST-012追加: 既存MCP/hooksの回帰確認テストケース、(4) TASK-013拡充: Windows開発者モード手順を完了条件に明示、(5) 成功基準追加: バックアップ作成の検証、(6) ステータスをReviewに更新 |
| 2025-12-12 | 第5回レビュー反映: (1) TASK-002拡充: .gitignoreに`.node_modules_cache/`と`*.backup`の除外を追加、(2) TASK-009拡充: バックアップ復旧手順をヘルプに含める、(3) TASK-013拡充: バックアップ運用方針をドキュメントに含める、(4) TEST-013/014追加: postCreateメッセージとバックアップ復旧の検証、(5) 成功基準に3項目追加: .gitignore除外設定、バックアップ復旧手順、postCreateメッセージ表示の検証、(6) ステータスをApprovedに更新 |

---
*このプランは Plan Creator エージェントによって作成されました*
