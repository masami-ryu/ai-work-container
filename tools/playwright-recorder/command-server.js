const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const host = process.env.PLAYWRIGHT_COMMAND_HOST || '0.0.0.0';
const port = Number(process.env.PLAYWRIGHT_COMMAND_PORT || 6090);
const cwd = __dirname;
const sharedProfile = '.pw-profile-shared';
const sharedProfilePath = path.join(cwd, sharedProfile);
const sharedProfileBackupPrefix = `${sharedProfile}.backup`;
const commandTimeoutMs = Number(process.env.PLAYWRIGHT_COMMAND_TIMEOUT_MS || 30000);

const allowedCommands = new Set([
  'open',
  'shared-open',
  'shared-reset',
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
let sharedBrowser = {
  expected: false,
  headed: false,
  persistent: false,
  profile: null,
  url: null,
};

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

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function pathExistsOrBrokenSymlink(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function getProfileLockStatus() {
  const lockPaths = ['SingletonCookie', 'SingletonLock', 'SingletonSocket']
    .map(name => path.join(sharedProfilePath, name));
  const existing = lockPaths.filter(lockPath => pathExistsOrBrokenSymlink(lockPath));
  const lockPath = path.join(sharedProfilePath, 'SingletonLock');
  let lockTarget = null;
  let lockPid = null;
  let lockPidRunning = false;

  if (pathExistsOrBrokenSymlink(lockPath)) {
    try {
      lockTarget = fs.readlinkSync(lockPath);
      const match = lockTarget.match(/-(\d+)$/);
      lockPid = match ? Number(match[1]) : null;
      lockPidRunning = isProcessRunning(lockPid);
    } catch (error) {
      lockTarget = `unreadable: ${error.message}`;
    }
  }

  return {
    profile: sharedProfile,
    exists: fs.existsSync(sharedProfilePath),
    locked: existing.length > 0,
    stale: existing.length > 0 && !lockPidRunning,
    lockTarget,
    lockPid,
    lockPidRunning,
    files: existing.map(lockPath => path.basename(lockPath)),
  };
}

function cleanupStaleProfileLock() {
  const lockStatus = getProfileLockStatus();
  if (!lockStatus.stale) return { cleaned: false, lockStatus };

  for (const name of ['SingletonCookie', 'SingletonLock', 'SingletonSocket']) {
    fs.rmSync(path.join(sharedProfilePath, name), { force: true });
  }

  return {
    cleaned: true,
    lockStatus: getProfileLockStatus(),
  };
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

function jstTimestamp() {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const value = date.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(2, 15);
  return value;
}

function profileBackupPath() {
  const base = path.join(cwd, `${sharedProfileBackupPrefix}-${jstTimestamp()}`);
  let candidate = base;
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
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
    sharedBrowser = {
      expected: false,
      headed: false,
      persistent: false,
      profile: null,
      url: null,
    };
  }
}

function backupSharedProfile() {
  if (!fs.existsSync(sharedProfilePath)) return null;

  const backupPath = profileBackupPath();
  fs.cpSync(sharedProfilePath, backupPath, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
  });

  return {
    path: path.relative(cwd, backupPath),
    absolutePath: backupPath,
    files: ['Default/Bookmarks', 'Default/Bookmarks.bak']
      .filter(file => fs.existsSync(path.join(backupPath, file))),
  };
}

async function resetSharedProfile(args) {
  if (!args.includes('--confirm')) {
    return {
      code: 1,
      stdout: '',
      stderr: 'shared-reset requires --confirm because it deletes the shared Chrome profile after creating a backup',
      errorCode: 'CONFIRMATION_REQUIRED',
      recoveryHint: 'Use shared-open first. Run shared-reset --confirm only as a last resort.',
      profileLock: getProfileLockStatus(),
    };
  }

  const closeResult = await runPlaywrightCli('close', []);
  const lockStatus = getProfileLockStatus();
  if (lockStatus.locked && !lockStatus.stale) {
    return {
      code: 1,
      stdout: closeResult.stdout,
      stderr: closeResult.stderr,
      errorCode: 'PROFILE_LOCKED',
      recoveryHint: 'Close Chrome from noVNC before running shared-reset.',
      profileLock: lockStatus,
    };
  }

  const backup = backupSharedProfile();
  fs.rmSync(sharedProfilePath, { recursive: true, force: true });
  sharedBrowser = {
    expected: false,
    headed: false,
    persistent: false,
    profile: null,
    url: null,
  };

  return {
    code: 0,
    stdout: `${closeResult.stdout}Shared profile backup: ${backup ? backup.path : '(profile did not exist)'}\nShared profile reset: ${sharedProfile}\n`,
    stderr: closeResult.stderr,
    backup,
    profileLock: getProfileLockStatus(),
  };
}

function enhanceResult(command, result) {
  const enhanced = { ...result };
  if (/Browser is already in use for \.pw-profile-shared/.test(result.stderr || '')) {
    enhanced.errorCode = 'PROFILE_LOCKED';
    enhanced.recoveryHint = 'The shared Chrome profile is locked. If Chrome is not visible in noVNC, run shared-reset or retry after stale lock cleanup.';
    enhanced.profileLock = getProfileLockStatus();
  }
  if (command === 'open' && result.code !== 0) {
    enhanced.profileLock = enhanced.profileLock || getProfileLockStatus();
  }
  return enhanced;
}

function runPlaywrightCli(command, args) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright-cli', command, ...args], {
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

  runningCommand = true;
  try {
    const { command, args } = normalizeCommand(requestedCommand, requestedArgs);
    let staleLockCleanup = null;
    if (command === 'open' && optionValue(args, '--profile') === sharedProfile) {
      staleLockCleanup = cleanupStaleProfileLock();
    }
    // If callers need burst execution later, replace this guard with a FIFO queue.
    const rawResult = command === 'shared-reset'
      ? await resetSharedProfile(args)
      : await runPlaywrightCli(command, args);
    const result = enhanceResult(command, rawResult);
    updateSharedBrowserState(command, args, result);
    lastCommand = {
      requestedCommand,
      command,
      args,
      code: result.code,
      ok: result.code === 0,
      timedOut: Boolean(result.timedOut),
      finishedAt: new Date().toISOString(),
      errorCode: result.errorCode || null,
    };
    sendJson(res, result.code === 0 ? 200 : 500, {
      ok: result.code === 0,
      command: requestedCommand,
      executedCommand: command,
      args,
      staleLockCleanup,
      ...result,
    });
  } finally {
    runningCommand = false;
  }
}

const server = http.createServer(async (req, res) => {
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
      profileLock: getProfileLockStatus(),
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

server.listen(port, host, () => {
  console.log(`Playwright command server listening on http://${host}:${port}`);
});
