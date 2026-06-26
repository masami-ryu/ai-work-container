const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildObservedBrowserStatus,
  findPageTarget,
} = require('../lib/cdp-targets');
const {
  collectCdpTargets,
  parseProcCmdline,
} = require('../lib/cdp-client');
const {
  buildLastCommand,
  classifyCdpSnapshotError,
  extractJsonObjectsFromText,
  extractResultDiagnostics,
} = require('../lib/command-diagnostics');
const { createCdpSnapshotRunner } = require('../lib/cdp-snapshot-runner');
const { InvalidOutputPathError, resolveAllowedOutputPath, sanitizeCommandOutputArgs } = require('../lib/output-path-policy');
const { buildPageSnapshotExpression } = require('../lib/page-snapshot-expression');
const { createSharedProfileManager, jstTimestamp } = require('../lib/shared-profile');
const { runSharedReset } = require('../scripts/shared-reset');

test.describe('command-server diagnostics', () => {
  test('parses proc cmdline nul-separated arguments', () => {
    expect(parseProcCmdline('/opt/google/chrome\0--remote-debugging-port=9222\0\0')).toEqual([
      '/opt/google/chrome',
      '--remote-debugging-port=9222',
    ]);
  });

  test('classifies a Runtime.evaluate timeout as a possible JavaScript dialog block', () => {
    const error = new Error('CDP command timed out: Runtime.evaluate');
    error.cdpMethod = 'Runtime.evaluate';

    const failure = classifyCdpSnapshotError(error);

    expect(failure.errorCode).toBe('CDP_RUNTIME_EVALUATE_TIMEOUT');
    expect(failure.hint).toContain('browser JavaScript dialog may be blocking');
  });

  test('classifies explicit JavaScript dialog errors separately', () => {
    const failure = classifyCdpSnapshotError(new Error('JavaScript dialog is showing'));

    expect(failure.errorCode).toBe('JAVASCRIPT_DIALOG_OPEN');
    expect(failure.hint).toContain('Resolve the dialog in noVNC');
  });

  test('extracts multiple JSON objects from mixed command stdout', () => {
    const first = { fallback: 'cdp' };
    const second = {
      output: 'snapshots/failure.md',
      hint: 'Resolve the dialog in noVNC, then retry the snapshot.',
      message: 'text with a } brace',
    };

    const objects = extractJsonObjectsFromText(`prefix\n${JSON.stringify(first, null, 2)}\nnoise\n${JSON.stringify(second, null, 2)}\n`);

    expect(objects).toEqual([first, second]);
  });

  test('summarizes cdp failure diagnostics for status without retaining full stdout', () => {
    const stdout = [
      JSON.stringify({ attachSession: 'shared-cdp', fallback: 'cdp' }, null, 2),
      JSON.stringify({
        ok: false,
        mode: 'cdp',
        output: 'snapshots/260626_222431_salonboard_confirm_check_cdp.md',
        errorCode: 'CDP_RUNTIME_EVALUATE_TIMEOUT',
        hint: 'Runtime.evaluate timed out. A browser JavaScript dialog may be blocking page execution; check noVNC and retry.',
        selectedTarget: {
          id: 'B8C7357E0BE3D5900EC0FC89338A0C88',
          type: 'page',
          title: 'SALON BOARD : シフト設定',
          url: 'https://salonboard.com/KLP/set/shiftSetup/?date=202608',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target',
        },
        error: 'long stack trace',
      }, null, 2),
    ].join('\n');
    const result = {
      code: 1,
      stdout,
      stderr: '',
      errorCode: 'CDP_RUNTIME_EVALUATE_TIMEOUT',
    };

    const diagnostics = extractResultDiagnostics(result);
    const lastCommand = buildLastCommand({
      requestedCommand: 'shared-cdp-snapshot',
      command: 'shared-cdp-snapshot',
      args: ['snapshots/failure.md', 'salonboard.com'],
      result,
      now: new Date('2026-06-26T13:24:36.000Z'),
    });

    expect(diagnostics.output).toBe('snapshots/260626_222431_salonboard_confirm_check_cdp.md');
    expect(diagnostics.hint).toContain('browser JavaScript dialog may be blocking');
    expect(diagnostics.target).toEqual({
      id: 'B8C7357E0BE3D5900EC0FC89338A0C88',
      type: 'page',
      title: 'SALON BOARD : シフト設定',
      url: 'https://salonboard.com/KLP/set/shiftSetup/?date=202608',
    });
    expect(lastCommand).toMatchObject({
      requestedCommand: 'shared-cdp-snapshot',
      command: 'shared-cdp-snapshot',
      code: 1,
      ok: false,
      timedOut: false,
      finishedAt: '2026-06-26T13:24:36.000Z',
      errorCode: 'CDP_RUNTIME_EVALUATE_TIMEOUT',
      output: 'snapshots/260626_222431_salonboard_confirm_check_cdp.md',
    });
    expect(lastCommand.hint).toContain('browser JavaScript dialog may be blocking');
    expect(lastCommand.target.url).toBe('https://salonboard.com/KLP/set/shiftSetup/?date=202608');
    expect(lastCommand.stdout).toBeUndefined();
  });

  test('builds observed browser status from CDP targets separately from expected state', () => {
    const sharedProfilePath = path.resolve(__dirname, '..', '.pw-profile-shared');
    const observed = buildObservedBrowserStatus(
      {
        processes: [
          {
            pid: 70,
            userDataDir: sharedProfilePath,
            remoteDebuggingPort: '9222',
          },
          {
            pid: 71,
            userDataDir: '/tmp/other-profile',
            remoteDebuggingPort: '9333',
          },
        ],
        activePorts: [{ path: '.pw-profile-shared/DevToolsActivePort', port: 9222, browserPath: '/devtools/browser/id' }],
        ports: new Set([9222]),
        cdp: [
          {
            endpoint: 'http://127.0.0.1:9222',
            targets: [
              {
                id: 'example',
                type: 'page',
                title: 'Example Domain',
                url: 'https://example.com/',
                attached: false,
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/example',
              },
              {
                id: 'salonboard',
                type: 'page',
                title: 'SALON BOARD : TOP',
                url: 'https://salonboard.com/KLP/top/',
                attached: true,
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/salonboard',
              },
            ],
          },
        ],
      },
      { sharedProfilePath },
    );

    expect(observed).toMatchObject({
      ok: true,
      source: 'cdp',
      selectionHint: 'salonboard.com',
      running: true,
      processIds: [70],
      remoteDebuggingPorts: [9222],
      targetCount: 2,
      currentUrl: 'https://salonboard.com/KLP/top/',
      currentTitle: 'SALON BOARD : TOP',
      currentTarget: {
        endpoint: 'http://127.0.0.1:9222',
        id: 'salonboard',
        type: 'page',
        title: 'SALON BOARD : TOP',
        url: 'https://salonboard.com/KLP/top/',
        attached: true,
      },
    });
    expect(observed.targets.map(target => target.url)).toEqual([
      'https://example.com/',
      'https://salonboard.com/KLP/top/',
    ]);
    expect(observed.targets[0].webSocketDebuggerUrl).toBeUndefined();
  });

  test('finds a page target when some CDP targets do not have URLs', () => {
    const cdpInfo = {
      cdp: [{
        endpoint: 'http://127.0.0.1:9222',
        targets: [
          { id: 'missing-url', type: 'page', title: 'Missing URL' },
          { id: 'blank', type: 'page', title: 'Blank', url: 'about:blank' },
          { id: 'example', type: 'page', title: 'Example', url: 'https://example.com/' },
        ],
      }],
    };

    expect(findPageTarget(cdpInfo, 'salonboard.com')).toMatchObject({
      id: 'example',
      url: 'https://example.com/',
    });
    expect(findPageTarget({ cdp: [{ targets: [{ id: 'fallback', type: 'page' }] }] })).toMatchObject({
      id: 'fallback',
    });
  });

  test('collects CDP targets from chrome processes and DevToolsActivePort files', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-client-'));
    const procRoot = path.join(workspaceRoot, 'proc');
    const sharedProfilePath = path.join(workspaceRoot, '.pw-profile-shared');

    try {
      fs.mkdirSync(path.join(procRoot, '111'), { recursive: true });
      fs.mkdirSync(path.join(procRoot, '222'), { recursive: true });
      fs.mkdirSync(path.join(sharedProfilePath, 'Default'), { recursive: true });
      fs.writeFileSync(
        path.join(procRoot, '111', 'cmdline'),
        [
          '/opt/google/chrome',
          `--user-data-dir=${sharedProfilePath}`,
          '--remote-debugging-port=9222',
          '--display=:99',
          'https://salonboard.com/KLP/top/',
        ].join('\0'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(procRoot, '222', 'cmdline'),
        ['/usr/bin/node', 'server.js'].join('\0'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(sharedProfilePath, 'Default', 'DevToolsActivePort'),
        '9333\n/devtools/browser/profile\n',
        'utf8',
      );

      const calls = [];
      const result = await collectCdpTargets({
        sharedProfilePath,
        workspaceRoot,
        procRoot,
        requestJson: async url => {
          calls.push(url);
          if (url.endsWith('/json/version')) {
            return { ok: true, statusCode: 200, body: { Browser: 'Chrome/Test' } };
          }
          return {
            ok: true,
            statusCode: 200,
            body: [{
              id: `target-${url.includes('9222') ? '9222' : '9333'}`,
              type: 'page',
              title: 'SALON BOARD : TOP',
              url: 'https://salonboard.com/KLP/top/',
              attached: false,
              webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/test',
              browserContextId: 'should-not-leak',
            }],
          };
        },
      });

      expect(result.processes).toMatchObject([{
        pid: 111,
        executable: '/opt/google/chrome',
        userDataDir: sharedProfilePath,
        remoteDebuggingPort: '9222',
        display: ':99',
        urlArgs: ['https://salonboard.com/KLP/top/'],
      }]);
      expect(result.activePorts).toEqual([{
        path: '.pw-profile-shared/Default/DevToolsActivePort',
        port: 9333,
        browserPath: '/devtools/browser/profile',
      }]);
      expect([...result.ports]).toEqual([9222, 9333]);
      expect(calls).toEqual([
        'http://127.0.0.1:9222/json/version',
        'http://127.0.0.1:9222/json/list',
        'http://127.0.0.1:9333/json/version',
        'http://127.0.0.1:9333/json/list',
      ]);
      expect(result.cdp[0].targets[0]).toEqual({
        id: 'target-9222',
        type: 'page',
        title: 'SALON BOARD : TOP',
        url: 'https://salonboard.com/KLP/top/',
        attached: false,
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/test',
      });
      expect(result.cdp[0].targets[0].browserContextId).toBeUndefined();
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('collects CDP targets only from the shared profile chrome process when configured', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-client-shared-only-'));
    const procRoot = path.join(workspaceRoot, 'proc');
    const sharedProfilePath = path.join(workspaceRoot, '.pw-profile-shared');
    const otherProfilePath = path.join(workspaceRoot, '.pw-profile-other');

    try {
      fs.mkdirSync(path.join(procRoot, '111'), { recursive: true });
      fs.mkdirSync(path.join(procRoot, '222'), { recursive: true });
      fs.mkdirSync(sharedProfilePath, { recursive: true });
      fs.writeFileSync(
        path.join(procRoot, '111', 'cmdline'),
        ['/opt/google/chrome', `--user-data-dir=${sharedProfilePath}`, '--remote-debugging-port=9222'].join('\0'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(procRoot, '222', 'cmdline'),
        ['/opt/google/chrome', `--user-data-dir=${otherProfilePath}`, '--remote-debugging-port=9444'].join('\0'),
        'utf8',
      );

      const calls = [];
      const result = await collectCdpTargets({
        sharedProfilePath,
        workspaceRoot,
        procRoot,
        requestJson: async url => {
          calls.push(url);
          return url.endsWith('/json/version')
            ? { ok: true, statusCode: 200, body: { Browser: 'Chrome/Test' } }
            : {
              ok: true,
              statusCode: 200,
              body: [{ id: 'shared', type: 'page', title: 'Shared', url: 'https://salonboard.com/' }],
            };
        },
      });

      expect([...result.ports]).toEqual([9222]);
      expect(calls).toEqual([
        'http://127.0.0.1:9222/json/version',
        'http://127.0.0.1:9222/json/list',
      ]);
      expect(result.processes.map(processInfo => processInfo.pid)).toEqual([111, 222]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('restricts command output paths to expected output directories', () => {
    const workspaceRoot = path.resolve(__dirname, '..');

    expect(resolveAllowedOutputPath({
      workspaceRoot,
      filename: 'snapshots/current.md',
      baseDir: 'snapshots',
      extensions: ['.md'],
    }).relativePath).toBe('snapshots/current.md');
    expect(sanitizeCommandOutputArgs('snapshot', ['--filename=snapshots/current.md'], { workspaceRoot })).toEqual([
      '--filename=snapshots/current.md',
    ]);
    expect(sanitizeCommandOutputArgs('screenshot', ['--filename', 'screenshots/current.png'], { workspaceRoot })).toEqual([
      '--filename',
      'screenshots/current.png',
    ]);

    expect(() => resolveAllowedOutputPath({
      workspaceRoot,
      filename: 'package.json',
      baseDir: 'snapshots',
      extensions: ['.md'],
    })).toThrow(InvalidOutputPathError);
    expect(() => resolveAllowedOutputPath({
      workspaceRoot,
      filename: 'snapshots/../package.json',
      baseDir: 'snapshots',
      extensions: ['.md'],
    })).toThrow(InvalidOutputPathError);
    expect(() => sanitizeCommandOutputArgs('screenshot', ['--filename=snapshots/current.md'], { workspaceRoot }))
      .toThrow(InvalidOutputPathError);
  });

  test('writes a cdp snapshot markdown file through the injectable runner', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-snapshot-'));
    const target = {
      endpoint: 'http://127.0.0.1:9222',
      id: 'salonboard',
      type: 'page',
      title: 'SALON BOARD : シフト設定',
      url: 'https://salonboard.com/KLP/set/shiftSetup/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/salonboard',
    };
    const pageInfo = {
      url: target.url,
      title: target.title,
      frameCount: 1,
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 120 },
      activeElement: {
        index: 0,
        tag: 'button',
        type: '',
        role: '',
        id: 'submit',
        name: '',
        label: '設定',
        text: '設定',
        inModal: true,
        rect: { x: 10, y: 20, width: 80, height: 32 },
      },
      dialogs: [{ index: 0, tag: 'div', role: 'dialog', id: 'modal', className: 'modal', headings: ['予定追加'], text: '入力する', rect: { x: 1, y: 2, width: 300, height: 200 } }],
      controls: [{ index: 1, tag: 'button', type: '', role: '', id: 'add', name: '', label: '予定を追加する', text: '予定を追加する', href: '', placeholder: '', optionsPreview: '', inModal: false, rect: { x: 3, y: 4, width: 120, height: 30 } }],
      fields: [{ index: 2, tag: 'input', type: 'text', id: 'start', name: 'start', label: '開始', placeholder: '', autocomplete: '', optionsPreview: '', visible: true, inModal: true, rect: { x: 5, y: 6, width: 100, height: 22 }, value: '10:00' }],
      headings: [{ index: 3, tag: 'h1', text: 'シフト設定', inModal: false, rect: { x: 0, y: 0, width: 200, height: 40 } }],
      tables: [{ index: 4, id: 'shift', className: 'calendar', caption: '', headers: ['日付'], rows: [{ rowIndex: 0, cells: ['8/1', '出'] }] }],
    };
    const calls = [];
    const runSharedCdpSnapshot = createCdpSnapshotRunner({
      workspaceRoot,
      collectCdpTargets: async () => ({
        cdp: [{ endpoint: target.endpoint, targets: [target] }],
      }),
      cdpCommand: async (webSocketDebuggerUrl, method, params) => {
        calls.push({ webSocketDebuggerUrl, method, params });
        return { result: { value: pageInfo } };
      },
    });

    try {
      const result = await runSharedCdpSnapshot(['snapshots/current.md', 'salonboard.com']);
      const response = JSON.parse(result.stdout);
      const outputPath = path.join(workspaceRoot, response.output);
      const markdown = fs.readFileSync(outputPath, 'utf8');

      expect(result.code).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('Runtime.evaluate');
      expect(response.output).toBe('snapshots/current.md');
      expect(response.page.counts).toMatchObject({ dialogs: 1, controls: 1, fields: 1, tables: 1, headings: 1 });
      expect(markdown).toContain('# CDP Page Snapshot');
      expect(markdown).toContain('## Visible Actionable Elements');
      expect(markdown).toContain('| 2 | input | text | start | start | 開始 |');
      expect(markdown).not.toContain('10:00');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('rejects cdp snapshot output paths outside snapshots before page evaluation', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-snapshot-invalid-path-'));
    let collectCount = 0;
    const runSharedCdpSnapshot = createCdpSnapshotRunner({
      workspaceRoot,
      collectCdpTargets: async () => {
        collectCount += 1;
        return { cdp: [] };
      },
      cdpCommand: async () => ({ result: { value: {} } }),
    });

    try {
      await expect(runSharedCdpSnapshot(['package.json', 'salonboard.com'])).rejects.toThrow(InvalidOutputPathError);
      expect(collectCount).toBe(0);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('writes a cdp failure markdown file when page evaluation fails', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-snapshot-failure-'));
    const target = {
      endpoint: 'http://127.0.0.1:9222',
      id: 'salonboard',
      type: 'page',
      title: 'SALON BOARD : シフト設定',
      url: 'https://salonboard.com/KLP/set/shiftSetup/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/salonboard',
    };
    const error = new Error('CDP command timed out: Runtime.evaluate');
    error.cdpMethod = 'Runtime.evaluate';
    const runSharedCdpSnapshot = createCdpSnapshotRunner({
      workspaceRoot,
      collectCdpTargets: async () => ({
        cdp: [{ endpoint: target.endpoint, targets: [target] }],
      }),
      cdpCommand: async () => {
        throw error;
      },
    });

    try {
      const result = await runSharedCdpSnapshot(['snapshots/failure.md', 'salonboard.com']);
      const response = JSON.parse(result.stdout);
      const markdown = fs.readFileSync(path.join(workspaceRoot, response.output), 'utf8');

      expect(result.code).toBe(1);
      expect(result.errorCode).toBe('CDP_RUNTIME_EVALUATE_TIMEOUT');
      expect(response.output).toBe('snapshots/failure.md');
      expect(response.hint).toContain('browser JavaScript dialog may be blocking');
      expect(markdown).toContain('# CDP Page Snapshot Failed');
      expect(markdown).toContain('- Error Code: CDP_RUNTIME_EVALUATE_TIMEOUT');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('builds a syntactically valid page snapshot expression without input value access', () => {
    const expression = buildPageSnapshotExpression();

    expect(() => new Function(`return ${expression}`)).not.toThrow();
    expect(expression).toContain('MODAL_SELECTOR');
    expect(expression).toContain("document.querySelectorAll('a,button,input,textarea,select,[role]')");
    expect(expression).toContain("document.querySelectorAll('input, textarea, select')");
    expect(expression).toContain("document.querySelectorAll('table')");
    expect(expression).not.toMatch(/\.value\b/);
    expect(expression).not.toMatch(/getAttribute\(['"]value['"]\)/);
  });

  test('shared reset wrapper requires confirmation before closing or deleting the profile', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-reset-wrapper-'));
    const bookmarksPath = path.join(workspaceRoot, '.pw-profile-shared', 'Default', 'Bookmarks');
    const stderr = [];
    let closeCount = 0;

    try {
      fs.mkdirSync(path.dirname(bookmarksPath), { recursive: true });
      fs.writeFileSync(bookmarksPath, '{"roots":{}}', 'utf8');

      const result = await runSharedReset([], {
        workspaceRoot,
        closeSharedBrowser: async () => {
          closeCount += 1;
          return { code: 0, stdout: 'closed\n', stderr: '' };
        },
        writeStdout: () => {},
        writeStderr: text => stderr.push(text),
      });

      expect(result.code).toBe(1);
      expect(result.errorCode).toBe('CONFIRMATION_REQUIRED');
      expect(closeCount).toBe(0);
      expect(stderr.join('')).toContain('shared-reset requires --confirm');
      expect(fs.existsSync(bookmarksPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('cleans up stale shared profile lock files', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-profile-stale-'));
    const profilePath = path.join(workspaceRoot, '.pw-profile-shared');

    try {
      fs.mkdirSync(profilePath, { recursive: true });
      fs.writeFileSync(path.join(profilePath, 'SingletonCookie'), 'cookie', 'utf8');
      fs.symlinkSync('host-12345', path.join(profilePath, 'SingletonLock'));
      const manager = createSharedProfileManager({
        workspaceRoot,
        isProcessRunning: () => false,
      });

      const before = manager.getProfileLockStatus();
      const cleanup = manager.cleanupStaleProfileLock();

      expect(before).toMatchObject({
        locked: true,
        stale: true,
        lockTarget: 'host-12345',
        lockPid: 12345,
        lockPidRunning: false,
      });
      expect(before.files).toEqual(['SingletonCookie', 'SingletonLock']);
      expect(cleanup.cleaned).toBe(true);
      expect(cleanup.lockStatus).toMatchObject({ locked: false, stale: false });
      expect(fs.existsSync(path.join(profilePath, 'SingletonCookie'))).toBe(false);
      expect(fs.existsSync(path.join(profilePath, 'SingletonLock'))).toBe(false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('blocks confirmed shared profile reset while an active lock remains', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-profile-locked-'));
    const profilePath = path.join(workspaceRoot, '.pw-profile-shared');
    let closeCount = 0;

    try {
      fs.mkdirSync(profilePath, { recursive: true });
      fs.symlinkSync('host-24680', path.join(profilePath, 'SingletonLock'));
      const manager = createSharedProfileManager({
        workspaceRoot,
        isProcessRunning: pid => pid === 24680,
      });

      const result = await manager.resetSharedProfile(['--confirm'], {
        closeSharedBrowser: async () => {
          closeCount += 1;
          return { stdout: 'closed\n', stderr: '' };
        },
      });

      expect(closeCount).toBe(1);
      expect(result).toMatchObject({
        code: 1,
        errorCode: 'PROFILE_LOCKED',
        recoveryHint: 'Close Chrome from noVNC before running shared-reset.',
        profileLock: {
          locked: true,
          stale: false,
          lockPid: 24680,
          lockPidRunning: true,
        },
      });
      expect(fs.existsSync(profilePath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('backs up and removes a shared profile on confirmed reset', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-profile-reset-'));
    const profilePath = path.join(workspaceRoot, '.pw-profile-shared');
    const bookmarksPath = path.join(profilePath, 'Default', 'Bookmarks');

    try {
      fs.mkdirSync(path.dirname(bookmarksPath), { recursive: true });
      fs.writeFileSync(bookmarksPath, '{"roots":{}}', 'utf8');
      const manager = createSharedProfileManager({
        workspaceRoot,
        now: () => Date.parse('2026-06-26T13:45:00.000Z'),
      });

      const result = await manager.resetSharedProfile(['--confirm'], {
        closeSharedBrowser: async () => ({ stdout: 'closed\n', stderr: '' }),
      });

      expect(jstTimestamp(Date.parse('2026-06-26T13:45:00.000Z'))).toBe('260626_224500');
      expect(result).toMatchObject({
        code: 0,
        backup: {
          path: '.pw-profile-shared.backup-260626_224500',
          files: ['Default/Bookmarks'],
        },
        profileLock: {
          exists: false,
          locked: false,
        },
      });
      expect(result.stdout).toContain('closed\nShared profile backup: .pw-profile-shared.backup-260626_224500');
      expect(fs.existsSync(profilePath)).toBe(false);
      expect(fs.existsSync(path.join(workspaceRoot, '.pw-profile-shared.backup-260626_224500', 'Default', 'Bookmarks'))).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
