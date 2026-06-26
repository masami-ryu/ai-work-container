const http = require('http');
const { spawn } = require('child_process');
const {
  buildObservedBrowserStatus,
  findPageTarget,
  pageTargets,
  summarizeTarget,
} = require('./lib/cdp-targets');
const {
  buildLastCommand,
  classifyCdpSnapshotError,
  extractJsonObjectsFromText,
  extractResultDiagnostics,
} = require('./lib/command-diagnostics');
const { createCdpClient } = require('./lib/cdp-client');
const { createCdpSnapshotRunner } = require('./lib/cdp-snapshot-runner');
const { InvalidOutputPathError, sanitizeCommandOutputArgs } = require('./lib/output-path-policy');
const { createSharedProfileManager } = require('./lib/shared-profile');

const host = process.env.PLAYWRIGHT_COMMAND_HOST || '0.0.0.0';
const port = Number(process.env.PLAYWRIGHT_COMMAND_PORT || 6090);
const cwd = __dirname;
const sharedProfile = '.pw-profile-shared';
const sharedCdpSession = 'shared-cdp';
const commandTimeoutMs = Number(process.env.PLAYWRIGHT_COMMAND_TIMEOUT_MS || 30000);
const sharedProfileManager = createSharedProfileManager({
  workspaceRoot: cwd,
  profile: sharedProfile,
});
const sharedProfilePath = sharedProfileManager.profilePath;
const {
  collectCdpTargets,
  cdpCommand,
  requestText,
} = createCdpClient({
  sharedProfilePath,
  workspaceRoot: cwd,
});

const allowedCommands = new Set([
  'open',
  'shared-open',
  'shared-pages',
  'shared-reset',
  'shared-attach-target',
  'shared-guard',
  'shared-cdp-snapshot',
  'shared-snapshot',
  'shared-targets',
  'goto',
  'snapshot',
  'screenshot',
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'hover',
  'select',
  'check',
  'uncheck',
  'tab-list',
  'tab-new',
  'tab-close',
  'tab-select',
  'go-back',
  'go-forward',
  'reload',
  'close',
  'list',
  'show',
  'console',
  'requests',
]);

let runningCommand = false;
let lastCommand = null;
let sharedBrowser = emptySharedBrowserState();

function emptySharedBrowserState() {
  return {
    expected: false,
    headed: false,
    persistent: false,
    profile: null,
    url: null,
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function validateArg(arg) {
  return typeof arg === 'string' && arg.length <= 4096 && !/[\0\r\n]/.test(arg);
}

function hasOption(args, option) {
  return args.some(arg => arg === option || arg.startsWith(`${option}=`));
}

function optionValue(args, option) {
  const exactIndex = args.indexOf(option);
  if (exactIndex >= 0) return args[exactIndex + 1] || null;

  const prefixed = args.find(arg => arg.startsWith(`${option}=`));
  return prefixed ? prefixed.slice(option.length + 1) : null;
}

function firstUrl(args) {
  return args.find(arg => /^https?:\/\//.test(arg)) || null;
}

const runSharedCdpSnapshot = createCdpSnapshotRunner({
  workspaceRoot: cwd,
  collectCdpTargets,
  cdpCommand,
});

async function getObservedBrowserStatus() {
  try {
    return buildObservedBrowserStatus(await collectCdpTargets(), { sharedProfilePath });
  } catch (error) {
    return {
      ok: false,
      source: 'cdp',
      error: error.stack || error.message || String(error),
    };
  }
}

function normalizeCommand(command, args) {
  if (command === 'shared-reset') {
    return {
      command,
      args,
      requestedCommand: command,
    };
  }

  if (command === 'shared-open') {
    return {
      command: 'open',
      args: ['--headed', '--persistent', '--profile', sharedProfile, ...args],
      requestedCommand: command,
    };
  }

  if (command !== 'open') {
    return { command, args, requestedCommand: command };
  }

  const normalizedArgs = [...args];
  if (!hasOption(normalizedArgs, '--headed')) normalizedArgs.unshift('--headed');
  if (!hasOption(normalizedArgs, '--persistent')) normalizedArgs.unshift('--persistent');
  if (!hasOption(normalizedArgs, '--profile')) normalizedArgs.unshift('--profile', sharedProfile);

  return { command, args: normalizedArgs, requestedCommand: command };
}

function updateSharedBrowserState(command, args, result) {
  if (result.code !== 0) return;

  if (command === 'open') {
    sharedBrowser = {
      expected: true,
      headed: hasOption(args, '--headed'),
      persistent: hasOption(args, '--persistent'),
      profile: optionValue(args, '--profile'),
      url: firstUrl(args),
    };
    return;
  }

  if (command === 'goto') {
    sharedBrowser.url = firstUrl(args) || sharedBrowser.url;
    return;
  }

  if (command === 'close') {
    sharedBrowser = emptySharedBrowserState();
  }

  if (command === 'shared-reset') {
    sharedBrowser = emptySharedBrowserState();
  }
}

async function runSharedPagesDiagnostic() {
  return await runPlaywrightCli('run-code', ['--filename=scripts/shared-pages-diagnostic.js']);
}

async function runSharedTargetsDiagnostic() {
  const { processes, activePorts, cdp, ports } = await collectCdpTargets();

  return {
    code: 0,
    stdout: `${JSON.stringify({
      processes,
      activePorts,
      cdp,
      note: ports.size
        ? 'CDP targets were collected from detected remote debugging ports.'
        : 'No CDP port was detected. Restart the shared browser after enabling --remote-debugging-port.',
    }, null, 2)}\n`,
    stderr: '',
  };
}

async function runSharedGuard() {
  const [pagesResult, cdpInfo] = await Promise.all([
    runSharedPagesDiagnostic(),
    collectCdpTargets(),
  ]);
  const cliSeesFout = /https:\/\/js\.fout\.jp\/beacon\.html/.test(pagesResult.stdout || '');
  const target = findPageTarget(cdpInfo, 'salonboard.com');
  const warning = Boolean(cliSeesFout && target?.url?.includes('salonboard.com'));

  return {
    code: 0,
    stdout: `${JSON.stringify({
      ok: true,
      warning,
      message: warning
        ? 'Playwright CLI current target is js.fout.jp, but CDP sees a Salonboard page target. Use shared-attach-target before snapshot/actions.'
        : 'No CLI/CDP target mismatch detected.',
      recommendedCommand: warning ? 'shared-attach-target' : null,
      cdpPageTargets: pageTargets(cdpInfo),
      cliPagesRaw: pagesResult.stdout,
    }, null, 2)}\n`,
    stderr: pagesResult.stderr || '',
  };
}

async function runSharedAttachTarget(args) {
  const urlHint = args[0] || 'salonboard.com';
  const cdpInfo = await collectCdpTargets();
  const target = findPageTarget(cdpInfo, urlHint);
  if (!target) {
    return {
      code: 1,
      stdout: `${JSON.stringify({ ok: false, error: `No page target found for ${urlHint}`, cdpPageTargets: pageTargets(cdpInfo) }, null, 2)}\n`,
      stderr: '',
    };
  }

  const activateResult = await requestText(`${target.endpoint}/json/activate/${encodeURIComponent(target.id)}`);
  const attachResult = await runPlaywrightCli('attach', ['--cdp', target.endpoint, '--session', sharedCdpSession]);
  return {
    ...attachResult,
    stdout: `${JSON.stringify({
      selectedTarget: target,
      activateResult,
      attachSession: sharedCdpSession,
    }, null, 2)}\n${attachResult.stdout}`,
  };
}

async function runSharedSnapshot(args) {
  const filename = args[0] || 'snapshots/current.md';
  const guardResult = await runSharedGuard();
  let guard;
  try {
    guard = JSON.parse(guardResult.stdout);
  } catch {
    guard = null;
  }
  if (guard?.warning) {
    const attachResult = await runSharedAttachTarget(['salonboard.com']);
    if (attachResult.code !== 0) {
      return await runSharedCdpSnapshot([filename, 'salonboard.com']);
    }
    const snapshotResult = await runPlaywrightCliInSession(sharedCdpSession, 'snapshot', [`--filename=${filename}`]);
    if (snapshotResult.code !== 0) {
      const cdpSnapshotResult = await runSharedCdpSnapshot([filename, 'salonboard.com']);
      return {
        ...cdpSnapshotResult,
        stdout: `${JSON.stringify({
          attachSession: sharedCdpSession,
          fallback: 'cdp',
          failedSnapshot: {
            code: snapshotResult.code,
            timedOut: Boolean(snapshotResult.timedOut),
            stderr: snapshotResult.stderr,
          },
        }, null, 2)}\n${cdpSnapshotResult.stdout}`,
      };
    }
    return {
      ...snapshotResult,
      stdout: `${JSON.stringify({
        guard: JSON.parse(guardResult.stdout),
        attachSession: sharedCdpSession,
      }, null, 2)}\n${attachResult.stdout}${snapshotResult.stdout}`,
    };
  }
  return await runPlaywrightCli('snapshot', [`--filename=${filename}`]);
}

function enhanceResult(command, result) {
  const enhanced = { ...result };
  if (/Browser is already in use for \.pw-profile-shared/.test(result.stderr || '')) {
    enhanced.errorCode = 'PROFILE_LOCKED';
    enhanced.recoveryHint = 'The shared Chrome profile is locked. If Chrome is not visible in noVNC, run shared-reset or retry after stale lock cleanup.';
    enhanced.profileLock = sharedProfileManager.getProfileLockStatus();
  }
  if (command === 'open' && result.code !== 0) {
    enhanced.profileLock = enhanced.profileLock || sharedProfileManager.getProfileLockStatus();
  }
  return enhanced;
}

function runPlaywrightCli(command, args) {
  return runPlaywrightCliArgs([command, ...args]);
}

function runPlaywrightCliInSession(sessionName, command, args) {
  return runPlaywrightCliArgs([`-s=${sessionName}`, command, ...args]);
}

function runPlaywrightCliArgs(cliArgs) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright-cli', ...cliArgs], {
      cwd,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 256 * 1024) stdout = stdout.slice(-256 * 1024);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024);
    });

    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2000).unref();
      finish({
        code: 124,
        stdout,
        stderr: `${stderr}command timed out after ${commandTimeoutMs}ms`,
        timedOut: true,
      });
    }, commandTimeoutMs);
    timer.unref();

    child.on('error', error => finish({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => finish({ code, stdout, stderr }));
  });
}

async function handleRun(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  const requestedCommand = payload.command;
  const requestedArgs = Array.isArray(payload.args) ? payload.args : [];
  if (!allowedCommands.has(requestedCommand)) {
    sendJson(res, 400, { ok: false, error: `command is not allowed: ${requestedCommand}` });
    return;
  }
  if (!requestedArgs.every(validateArg)) {
    sendJson(res, 400, { ok: false, error: 'invalid args' });
    return;
  }
  if (runningCommand) {
    sendJson(res, 409, { ok: false, error: 'another command is already running' });
    return;
  }

  let command = requestedCommand;
  let args = requestedArgs;
  try {
    ({ command, args } = normalizeCommand(requestedCommand, requestedArgs));
    args = sanitizeCommandOutputArgs(command, args, { workspaceRoot: cwd });
  } catch (error) {
    const status = error instanceof InvalidOutputPathError ? 400 : 500;
    sendJson(res, status, {
      ok: false,
      command: requestedCommand,
      executedCommand: command,
      args,
      error: error.message,
      errorCode: error.errorCode || 'COMMAND_FAILED',
    });
    return;
  }

  runningCommand = true;
  try {
    let staleLockCleanup = null;
    if (command === 'open' && optionValue(args, '--profile') === sharedProfile) {
      staleLockCleanup = sharedProfileManager.cleanupStaleProfileLock();
    }
    // If callers need burst execution later, replace this guard with a FIFO queue.
    const rawResult = command === 'shared-reset'
      ? await sharedProfileManager.resetSharedProfile(args, {
        closeSharedBrowser: () => runPlaywrightCli('close', []),
      })
      : command === 'shared-pages'
        ? await runSharedPagesDiagnostic()
        : command === 'shared-attach-target'
          ? await runSharedAttachTarget(args)
        : command === 'shared-guard'
          ? await runSharedGuard()
        : command === 'shared-cdp-snapshot'
          ? await runSharedCdpSnapshot(args)
        : command === 'shared-snapshot'
          ? await runSharedSnapshot(args)
        : command === 'shared-targets'
          ? await runSharedTargetsDiagnostic()
        : await runPlaywrightCli(command, args);
    const result = enhanceResult(command, rawResult);
    updateSharedBrowserState(command, args, result);
    lastCommand = buildLastCommand({
      requestedCommand,
      command,
      args,
      result,
    });
    sendJson(res, result.code === 0 ? 200 : 500, {
      ok: result.code === 0,
      command: requestedCommand,
      executedCommand: command,
      args,
      staleLockCleanup,
      ...result,
    });
  } catch (error) {
    lastCommand = {
      requestedCommand,
      command,
      args,
      code: 1,
      ok: false,
      timedOut: false,
      finishedAt: new Date().toISOString(),
      errorCode: 'COMMAND_FAILED',
    };
    sendJson(res, 500, {
      ok: false,
      command: requestedCommand,
      executedCommand: command,
      args,
      error: error.stack || error.message || String(error),
      errorCode: 'COMMAND_FAILED',
    });
  } finally {
    runningCommand = false;
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      sendJson(res, 200, {
        ok: true,
        runningCommand,
        commandTimeoutMs,
        sharedBrowser,
        sharedBrowserExpected: sharedBrowser,
        observedBrowser: await getObservedBrowserStatus(),
        profileLock: sharedProfileManager.getProfileLockStatus(),
        lastCommand,
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/run') {
      await handleRun(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  });
}

if (require.main === module) {
  createServer().listen(port, host, () => {
    console.log(`Playwright command server listening on http://${host}:${port}`);
  });
}

module.exports = {
  createServer,
  __test: {
    buildObservedBrowserStatus,
    buildLastCommand,
    classifyCdpSnapshotError,
    extractJsonObjectsFromText,
    extractResultDiagnostics,
    summarizeTarget,
  },
};
