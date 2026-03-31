#!/usr/bin/env node

import { getDatabase, closeDatabase } from './lib/database.mjs';
import { registerProject, addCwd, listProjects, deleteProject } from './lib/project.mjs';
import { formatError } from './lib/formatter.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const operation = args[0];
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = (i + 1 < args.length && !args[i + 1].startsWith('--'))
        ? args[++i] : true;
      if (options[key] !== undefined) {
        options[key] = [].concat(options[key], val);
      } else {
        options[key] = val;
      }
    }
  }
  // nullable フィールドの正規化
  options.source = options.source ?? null;

  // --id / --history-id の配列正規化
  if (options.id !== undefined) {
    options.id = [].concat(options.id);
  }
  if (options['history-id'] !== undefined) {
    options['history-id'] = [].concat(options['history-id']);
  }

  return { operation, options };
}

function showHelp() {
  return `context-db: コンテキスト管理 CLI

使用方法: node context-db.mjs <操作> [オプション...]

操作一覧:
  project   プロジェクト管理
  write     コンテキスト書き込み
  read      コンテキスト読み取り
  index     コンテキスト目次
  search    全文検索・タグ検索
  delete    コンテキスト削除
  verify    コンテキスト検証
  clean     鮮度チェック・クリーン
  workspace ワークスペース管理
  history   上書き履歴管理`;
}

async function main() {
  const { operation, options } = parseArgs(process.argv);

  if (!operation || operation === 'help') {
    console.log(showHelp());
    return;
  }

  const db = getDatabase();
  try {
    let result;
    switch (operation) {
      case 'project':
        result = handleProject(db, options);
        break;
      case 'write':
        result = (await import('./lib/context.mjs')).handleWrite(db, options);
        break;
      case 'read':
        result = (await import('./lib/context.mjs')).handleRead(db, options);
        break;
      case 'index':
        result = (await import('./lib/context.mjs')).handleIndex(db, options);
        break;
      case 'delete':
        result = (await import('./lib/context.mjs')).handleDelete(db, options);
        break;
      case 'verify':
        result = (await import('./lib/context.mjs')).handleVerify(db, options);
        break;
      case 'search':
        result = (await import('./lib/search.mjs')).handleSearch(db, options);
        break;
      case 'workspace':
        result = (await import('./lib/workspace.mjs')).handleWorkspace(db, options);
        break;
      case 'history':
        result = (await import('./lib/history.mjs')).handleHistory(db, options);
        break;
      case 'clean':
        result = (await import('./lib/clean.mjs')).handleClean(db, options);
        break;
      default:
        result = formatError(`不明な操作: ${operation}\n`) + '\n' + showHelp();
    }
    console.log(result);
  } finally {
    closeDatabase(db);
  }
}

function handleProject(db, options) {
  if (options.register) {
    if (!options.name) return formatError('--name は必須です。');
    return registerProject(db, options.name, options.cwd || null);
  }
  if (options['add-cwd']) {
    if (!options.name || !options.cwd) return formatError('--name と --cwd は必須です。');
    return addCwd(db, options.name, options.cwd);
  }
  if (options.list) {
    return listProjects(db);
  }
  if (options.delete) {
    if (!options.name) return formatError('--name は必須です。');
    return deleteProject(db, options.name);
  }
  return formatError('project には --register, --add-cwd, --list, --delete のいずれかを指定してください。');
}

main().catch(e => {
  console.error(formatError(e.message));
  process.exit(1);
});

export { parseArgs };
