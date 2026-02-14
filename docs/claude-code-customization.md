# Claude Code カスタマイズガイド

> **最終更新日:** 2025-12-04

## 概要
Hooks、コマンド、エージェントのカスタマイズ方法を説明します。

## ディレクトリ構造

```
.claude/
├── agents/        # カスタムエージェント
│   ├── doc-writer.md
│   ├── plan-creator.md
│   └── pr-reviewer.md
├── commands/      # スラッシュコマンド
│   ├── doc.md
│   ├── plan.md
│   ├── review.md
│   └── suggest-claude-md.md
├── hooks/         # フックスクリプト
│   ├── session-start.sh
│   ├── auto-approve-docs.sh
│   ├── PreCompact.md
│   └── SessionEnd.md
└── settings.json  # 権限設定
```

## カスタムコマンドの作成

### フロントマター

```yaml
---
name: my-command
description: コマンドの説明
allowed-tools: Read, Grep, Write, mcp__context7
---
```

### コンテキスト定義

`@` プレフィックスでファイルを参照:

```markdown
## コンテキスト
- プロジェクト: @CLAUDE.md
- テンプレート: @ai/templates/plan-template.md
```

### タスク定義

```markdown
## タスク
1. ステップ1の説明
2. ステップ2の説明
3. ステップ3の説明
```

### 例: /plan コマンド

```markdown
---
name: plan
description: 実行可能なプランを作成する
allowed-tools: Read, Grep, Glob, Write, mcp__context7, mcp__msdocs
model: opus
---

## コンテキスト
- プロジェクト: @CLAUDE.md
- テンプレート: @ai/templates/plan-template.md

## タスク
タスク規模を評価し、適切なワークフローを選択してプランを作成。
保存先: `ai/plans/YYMMDD_HHmm_[概要].md`（HHmmはJST/UTC+9）
```

## カスタムエージェントの作成

### 役割定義

```yaml
---
name: my-agent
description: エージェントの説明
tools: Read, Grep, Glob, Write
model: sonnet  # または opus, haiku
---
```

### ツール制限

| ツール名 | 説明 |
|---------|-----|
| `Read` | ファイル読み取り |
| `Write` | ファイル書き込み |
| `Grep` | テキスト検索 |
| `Glob` | パターンマッチング |
| `Bash` | シェルコマンド実行 |
| `mcp__context7` | Context7 MCP |
| `mcp__msdocs` | Microsoft Learn MCP |

### ワークフロー定義

```markdown
## ワークフロー

### Step 1: 情報収集
- 必要な情報を収集
- 既存コンテンツを確認

### Step 2: 分析
- 情報を分析
- 問題点を特定

### Step 3: 実行
- タスクを実行
- 結果を確認
```

## Hooksの設定

### settings.jsonでの設定

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/session-start.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/auto-approve-docs.sh"
          }
        ]
      }
    ]
  }
}
```

### フックタイプ

| フック名 | 実行タイミング |
|---------|--------------|
| `SessionStart` | セッション開始時 |
| `SessionEnd` | セッション終了時 |
| `PreToolUse` | ツール実行前 |
| `PostToolUse` | ツール実行後 |
| `PreCompact` | コンパクト実行前 |
| `NotificationReceived` | 通知受信時 |

### 例: 自動承認フック

```bash
#!/bin/bash
# auto-approve-docs.sh
# .md, .txt, .json ファイルの読み取りを自動承認

FILE_PATH="$1"

if [[ "$FILE_PATH" =~ \.(md|txt|json)$ ]]; then
    echo "approve"
    exit 0
fi

exit 0
```

### 例: セッション開始フック

```bash
#!/bin/bash
# session-start.sh

set +e  # エラーでも続行

export PROJECT_ROOT="/workspaces/ai-work-container"

echo "🚀 Claude Code セッション開始"
echo "📁 プロジェクト: $PROJECT_ROOT"

# MCP確認
if command -v claude &> /dev/null; then
    echo "📡 MCPサーバー状態:"
    claude mcp list 2>/dev/null | head -5
fi

exit 0  # 必ず成功で終了
```

## 権限設定

### permissions の構造

```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Read(**)",
      "Write"
    ],
    "deny": [
      "Read(./.env)",
      "Bash(rm -rf:*)"
    ],
    "ask": [
      "Bash(git push:*)"
    ]
  }
}
```

### ルールの優先順位

1. `deny` - 最優先で拒否
2. `ask` - ユーザーに確認
3. `allow` - 自動承認

## ベストプラクティス

### 単一責任の原則
- 1つのコマンド/エージェントは1つの責任のみ
- 複雑なタスクは複数のコマンドに分割

### テスト可能な設計
- フックはエラー時も続行するよう `set +e`
- 必ず `exit 0` で終了

### ドキュメント化
- 各コマンド/エージェントに description を設定
- 複雑なワークフローはコメントを追加

## 参考資料

- [Claude Code 公式ドキュメント](https://docs.anthropic.com/claude-code)
- [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code)
- [Claude Log - Best Practices](https://claudelog.com/mechanics/claude-md-supremacy)
- [使い方ガイド](./claude-code-usage.md)
