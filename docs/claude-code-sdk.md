# Claude Code SDK 使い方ガイド

> **最終更新日:** 2025-12-04

## 概要
Claude Code SDKを使用したプログラマティックな操作方法を説明します。

## 前提条件
- Claude Code CLIがインストール済み
- Node.js v22以降 または Python 3.10以降

## インストール

### TypeScript/JavaScript
```bash
npm install @anthropic-ai/claude-code
```

### Python
```bash
pip install claude-code-sdk
```

## 基本的な使い方

### TypeScript/JavaScript

```typescript
import { Claude } from '@anthropic-ai/claude-code';

const claude = new Claude();

// セッションの開始
const session = await claude.startSession({
  projectPath: '/path/to/project'
});

// プロンプトの送信
const response = await session.send('ファイル構造を確認して');

console.log(response.text);
```

### Python

```python
from claude_code import Claude

claude = Claude()

# セッションの開始
with claude.session(project_path="/path/to/project") as session:
    # プロンプトの送信
    response = session.send("ファイル構造を確認して")
    print(response.text)
```

## 高度な使い方

### カスタムツールの定義

```typescript
const customTool = {
  name: 'check_tests',
  description: 'テストを実行する',
  execute: async () => {
    // テスト実行ロジック
    return { passed: true, count: 10 };
  }
};

const session = await claude.startSession({
  tools: [customTool]
});
```

### MCPサーバーの利用

```typescript
const session = await claude.startSession({
  mcpServers: ['context7', 'msdocs']
});

// MCPツールを使用したプロンプト
const response = await session.send(
  'Reactのhooksについて最新のドキュメントを確認して'
);
```

### ストリーミングレスポンス

```typescript
for await (const chunk of session.stream('長い処理を実行して')) {
  process.stdout.write(chunk.text);
}
```

## CLI連携

### CLIからSDKを呼び出す

```bash
# ワンショット実行
claude -p "質問内容" --format json
```

### SDKからCLIを呼び出す

```typescript
import { exec } from 'child_process';

exec('claude -p "質問" --format json', (err, stdout) => {
  const response = JSON.parse(stdout);
  console.log(response);
});
```

## エラーハンドリング

```typescript
try {
  const response = await session.send('プロンプト');
} catch (error) {
  if (error.code === 'RATE_LIMIT') {
    // レート制限対応
    await sleep(60000);
    retry();
  } else if (error.code === 'AUTH_ERROR') {
    // 認証エラー対応
    console.error('認証が必要です: claude whoami');
  }
}
```

## 参考資料
- [Claude Code 公式ドキュメント](https://docs.anthropic.com/claude-code)
- [SDK リポジトリ](https://github.com/anthropics/claude-code-sdk-python)
- [Context7 MCP](https://context7.com)
