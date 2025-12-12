# マルチルートワークスペース 使用方法ガイド

> **作成日:** 2025-12-12
> **対象:** ai-work-container プロジェクト

## 目次
- [概要](#概要)
- [基本的な使用方法](#基本的な使用方法)
- [プロジェクトの追加](#プロジェクトの追加)
- [プロジェクトの削除](#プロジェクトの削除)
- [Claude設定の継承](#claude設定の継承)
- [Windows開発者モード有効化手順](#windows開発者モード有効化手順)
- [トラブルシューティング](#トラブルシューティング)
- [バックアップ復旧・運用方針](#バックアップ復旧運用方針)

---

## 概要

マルチルートワークスペース機能により、`./repo/` 配下に複数のプロジェクトを配置して、共通設定（`.claude/`、`.github/agents/` 等）を継承しながら開発できます。

### 主な特徴
- 複数プロジェクトを1つのワークスペースで管理
- `.claude/` の設定（コマンド、エージェント、hooks）を全プロジェクトで共有
- node_modules をシンボリックリンクで外部化し、パフォーマンスを向上
- VS Code標準のマルチルートワークスペース機能を使用

---

## 基本的な使用方法

### ワークスペースを開く

**方法1: コマンドパレットから開く（推奨）**
1. F1 キーを押す
2. "Dev Containers: Open Workspace in Container..." を選択
3. "ai-work-container.code-workspace" を選択

**方法2: コンテナ接続後に開く**
1. 通常どおりdevcontainerを起動
2. `File > Open Workspace from File...` を選択
3. `/workspaces/ai-work-container/ai-work-container.code-workspace` を選択

### ディレクトリ構造

```
ai-work-container/
├── .claude/                    # Claude設定（共有）
│   ├── commands/               # カスタムコマンド
│   ├── agents/                 # サブエージェント
│   └── hooks/                  # フック
├── .devcontainer/
│   ├── setup-repo-project.sh   # プロジェクト追加スクリプト
│   └── remove-repo-project.sh  # プロジェクト削除スクリプト
├── .node_modules_cache/        # node_modules実体（ボリュームマウント）
├── repo/                       # プロジェクト配置ディレクトリ
│   └── project-a/              # git cloneしたプロジェクト
│       └── node_modules -> /workspaces/ai-work-container/.node_modules_cache/project-a/
└── ai-work-container.code-workspace  # ワークスペースファイル
```

---

## プロジェクトの追加

### 手順

1. **プロジェクトをクローン**
   ```bash
   cd /workspaces/ai-work-container/repo
   git clone https://github.com/your-org/your-project.git
   ```

2. **セットアップスクリプトを実行**
   ```bash
   cd /workspaces/ai-work-container
   bash .devcontainer/setup-repo-project.sh your-project
   ```

   このスクリプトは以下を実行します：
   - `.code-workspace` のバックアップ作成
   - 既存の `node_modules` を削除
   - `node_modules` をシンボリックリンクに置換
   - `.node_modules_cache/<project-name>/` を作成
   - `.code-workspace` にプロジェクトを追加

3. **依存関係をインストール**
   ```bash
   cd repo/your-project
   npm install
   ```

4. **ワークスペースを再読み込み**
   - VS Code で `File > Open Workspace from File...` を選択
   - `ai-work-container.code-workspace` を再度開く

---

## プロジェクトの削除

### 手順

1. **削除スクリプトを実行**
   ```bash
   cd /workspaces/ai-work-container
   bash .devcontainer/remove-repo-project.sh your-project
   ```

   このスクリプトは以下を実行します：
   - `.code-workspace` のバックアップ作成
   - `.code-workspace` からプロジェクトのフォルダ定義を削除
   - `.node_modules_cache/<project-name>/` を削除

2. **プロジェクトディレクトリを削除（必要に応じて）**
   ```bash
   rm -rf /workspaces/ai-work-container/repo/your-project
   ```

---

## Claude設定の継承

### 継承の仕組み

Claude Codeは以下の優先順位で設定を読み込みます：
1. カレントディレクトリの `.claude/`
2. 親ディレクトリの `.claude/`（再帰的に探索）
3. ユーザーレベルの設定

### 継承パス

```
ai-work-container/
├── .claude/                    # ← ルートの設定（共有）
│   ├── commands/
│   │   ├── plan.md            # /plan コマンド
│   │   ├── review.md          # /review コマンド
│   │   └── doc.md             # /doc コマンド
│   ├── agents/
│   │   ├── plan-creator.md    # プラン作成エージェント
│   │   └── doc-writer.md      # ドキュメント作成エージェント
│   └── hooks/
└── repo/
    └── project-a/              # ← 配下プロジェクトから参照可能
```

### 利用可能な共通設定

- **カスタムコマンド**: `/plan`, `/review`, `/doc`, `/suggest-claude-md`
- **サブエージェント**: `plan-creator`, `doc-writer`, `pr-reviewer`
- **Hooks**: `session-start.sh`, `auto-approve-docs.sh`
- **MCP設定**: `.vscode/mcp.json` で定義されたMCPサーバー

### 確認方法

配下プロジェクトで Claude Code を起動し、コマンドが利用可能か確認：
```bash
cd /workspaces/ai-work-container/repo/your-project
claude
# /plan コマンドなどを試す
```

---

## Windows開発者モード有効化手順

Windows環境でシンボリックリンクを作成するには、開発者モードを有効化する必要があります。

### Windows 10/11の場合

1. **設定を開く**
   - `スタート` → `設定`

2. **開発者向け設定にアクセス**
   - `更新とセキュリティ` → `開発者向け`
   - または、設定で「開発者モード」を検索

3. **開発者モードをオンにする**
   - `開発者モード` をオンに切り替え
   - 確認ダイアログが表示されたら `はい` をクリック

4. **再起動**
   - システムの再起動が必要な場合があります

### 確認方法

PowerShellまたはコマンドプロンプトで以下を実行：
```powershell
mklink /?
```

正常に動作すれば、シンボリックリンク作成の説明が表示されます。

---

## トラブルシューティング

### 1. シンボリックリンク作成に失敗する

**症状:**
```
ln: failed to create symbolic link: Operation not permitted
```

**解決方法:**
- **Windows**: 開発者モードを有効化（上記参照）
- **macOS/Linux**: 通常は権限不要。エラーが出る場合はディレクトリのパーミッションを確認

### 2. npm install が失敗する

**症状:**
```
npm ERR! code ENOENT
npm ERR! syscall open
```

**解決方法:**
1. シンボリックリンクが正しく作成されているか確認：
   ```bash
   ls -la /workspaces/ai-work-container/repo/your-project/node_modules
   ```

2. キャッシュディレクトリが存在するか確認：
   ```bash
   ls -la /workspaces/ai-work-container/.node_modules_cache/your-project
   ```

3. セットアップスクリプトを再実行：
   ```bash
   bash .devcontainer/setup-repo-project.sh your-project
   ```

### 3. プロジェクトがワークスペースに表示されない

**症状:**
VS Codeエクスプローラーに追加したプロジェクトが表示されない

**解決方法:**
1. `.code-workspace` ファイルを確認：
   ```bash
   cat /workspaces/ai-work-container/ai-work-container.code-workspace
   ```

2. プロジェクトのエントリが含まれているか確認

3. ワークスペースを再読み込み：
   - `File > Open Workspace from File...` で再度開く

### 4. Claude設定が継承されない

**症状:**
配下プロジェクトから `/plan` などのコマンドが利用できない

**解決方法:**
1. ルートの `.claude/` ディレクトリが存在するか確認：
   ```bash
   ls -la /workspaces/ai-work-container/.claude
   ```

2. カレントディレクトリを確認：
   ```bash
   pwd
   # /workspaces/ai-work-container/repo/your-project であることを確認
   ```

3. Claude Code を再起動

### 5. `.code-workspace` が破損した

**症状:**
ワークスペースファイルを開けない、またはJSON構文エラー

**解決方法:**
バックアップから復旧（次のセクション参照）

---

## バックアップ復旧・運用方針

### バックアップの仕組み

`setup-repo-project.sh` および `remove-repo-project.sh` は、実行時に自動的に `.code-workspace` のバックアップを作成します。

```bash
ai-work-container.code-workspace         # 現在のファイル
ai-work-container.code-workspace.backup  # 最新のバックアップ
```

### 復旧手順

1. **バックアップファイルの確認**
   ```bash
   ls -la /workspaces/ai-work-container/*.backup
   ```

2. **バックアップから復旧**
   ```bash
   cp ai-work-container.code-workspace.backup ai-work-container.code-workspace
   ```

3. **ワークスペースを再読み込み**
   - VS Code で `File > Open Workspace from File...` を選択
   - `ai-work-container.code-workspace` を再度開く

### 運用方針

#### バックアップの保持期間
- **最新のバックアップのみ保持**: スクリプト実行時に上書きされます
- **長期保存が必要な場合**: 手動でバックアップをコピーしてください
  ```bash
  cp ai-work-container.code-workspace ai-work-container.code-workspace.$(date +%Y%m%d)
  ```

#### 古いバックアップの整理
バックアップファイルが蓄積した場合、以下のコマンドで整理できます：

```bash
# 7日以上前のバックアップを削除
find /workspaces/ai-work-container -name "*.backup.*" -mtime +7 -delete

# または、特定の日付形式のバックアップを削除
rm -f ai-work-container.code-workspace.20241201
```

#### 推奨プラクティス
1. **重要な変更前に手動バックアップ**
   ```bash
   cp ai-work-container.code-workspace ai-work-container.code-workspace.before-major-change
   ```

2. **定期的なgitコミット**
   - `.gitignore` により `*.backup` は除外されますが、`.code-workspace` 本体はコミット対象です
   - 重要な変更があれば、gitでバージョン管理してください

3. **スクリプト実行前の確認**
   - 複数のプロジェクトを一度に追加/削除する場合は、1つずつ実行し、都度確認してください

---

## よくある質問（FAQ）

### Q: 既存のプロジェクトをマルチルートワークスペースに移行できますか？
**A:** はい。既存プロジェクトを `repo/` に移動し、`setup-repo-project.sh` を実行してください。

### Q: プロジェクトごとに異なるNode.jsバージョンを使えますか？
**A:** はい。各プロジェクトに `.node-version` ファイルを配置すると、nodenvが自動的に切り替えます。

### Q: node_modulesキャッシュのサイズが大きくなった場合は？
**A:** 不要なプロジェクトのキャッシュを手動で削除できます：
```bash
rm -rf /workspaces/ai-work-container/.node_modules_cache/old-project
```

### Q: ワークスペースに追加せずにプロジェクトを配置できますか？
**A:** はい。`repo/` に配置するだけで問題ありません。ワークスペースに追加しなくても、通常のディレクトリとして利用できます。

---

## 関連ドキュメント

- [プラン: マルチルートワークスペース導入](/workspaces/ai-work-container/ai/plans/251212_multiroot-workspace.md)
- [Claude Code 使用方法ガイド](/workspaces/ai-work-container/docs/claude-code-usage.md)
- [CLAUDE.md](/workspaces/ai-work-container/CLAUDE.md)

---

**更新履歴:**
- 2025-12-12: 初版作成
