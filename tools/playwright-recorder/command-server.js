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
const sharedCdpSession = 'shared-cdp';
const commandTimeoutMs = Number(process.env.PLAYWRIGHT_COMMAND_TIMEOUT_MS || 30000);

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

function argValue(args, option) {
  const exactIndex = args.indexOf(option);
  if (exactIndex >= 0) return args[exactIndex + 1] || null;

  const prefixed = args.find(arg => arg.startsWith(`${option}=`));
  return prefixed ? prefixed.slice(option.length + 1) : null;
}

function parseProcCmdline(content) {
  return content.split('\0').filter(Boolean);
}

function listChromeProcesses() {
  const procEntries = fs.readdirSync('/proc', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name));
  const result = [];

  for (const entry of procEntries) {
    const pid = Number(entry.name);
    let args;
    try {
      args = parseProcCmdline(fs.readFileSync(path.join('/proc', entry.name, 'cmdline'), 'utf8'));
    } catch {
      continue;
    }
    if (!args.length || !/(chrome|chromium)/.test(path.basename(args[0]))) continue;

    result.push({
      pid,
      executable: args[0],
      userDataDir: argValue(args, '--user-data-dir'),
      remoteDebuggingPort: argValue(args, '--remote-debugging-port'),
      remoteDebuggingPipe: args.includes('--remote-debugging-pipe'),
      display: argValue(args, '--display'),
      urlArgs: args.filter(arg => /^https?:\/\//.test(arg) || arg.startsWith('chrome://')),
    });
  }

  return result.sort((a, b) => a.pid - b.pid);
}

function findDevToolsActivePorts(rootDir) {
  const result = [];
  const stack = [{ dir: rootDir, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'DevToolsActivePort') {
        try {
          const [portLine, browserPath = ''] = fs.readFileSync(entryPath, 'utf8').trim().split('\n');
          const port = Number(portLine);
          result.push({
            path: path.relative(cwd, entryPath),
            port: Number.isFinite(port) ? port : null,
            browserPath,
          });
        } catch (error) {
          result.push({
            path: path.relative(cwd, entryPath),
            error: error.message,
          });
        }
      } else if (entry.isDirectory() && depth < 4) {
        stack.push({ dir: entryPath, depth: depth + 1 });
      }
    }
  }

  return result;
}

function requestJson(url) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: 1500 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) request.destroy(new Error('response too large'));
      });
      response.on('end', () => {
        try {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            body: JSON.parse(body),
          });
        } catch (error) {
          resolve({
            ok: false,
            statusCode: response.statusCode,
            error: error.message,
            raw: body.slice(0, 500),
          });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

function requestText(url) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: 1500 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) request.destroy(new Error('response too large'));
      });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode,
        body,
      }));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

async function collectCdpTargets() {
  const processes = listChromeProcesses();
  const activePorts = findDevToolsActivePorts(sharedProfilePath);
  const ports = new Set();

  for (const processInfo of processes) {
    const port = Number(processInfo.remoteDebuggingPort);
    if (Number.isFinite(port) && port > 0) ports.add(port);
  }
  for (const activePort of activePorts) {
    if (Number.isFinite(activePort.port) && activePort.port > 0) ports.add(activePort.port);
  }

  const cdp = [];
  for (const port of [...ports].sort((a, b) => a - b)) {
    const endpoint = `http://127.0.0.1:${port}`;
    const [version, targets] = await Promise.all([
      requestJson(`${endpoint}/json/version`),
      requestJson(`${endpoint}/json/list`),
    ]);
    cdp.push({
      endpoint,
      version,
      targets: targets.ok && Array.isArray(targets.body)
        ? targets.body.map(target => ({
          id: target.id,
          type: target.type,
          title: target.title,
          url: target.url,
          attached: target.attached,
          webSocketDebuggerUrl: target.webSocketDebuggerUrl,
        }))
        : targets,
    });
  }

  return { processes, activePorts, cdp, ports };
}

function pageTargets(cdpInfo) {
  const result = [];
  for (const endpointInfo of cdpInfo.cdp) {
    if (!Array.isArray(endpointInfo.targets)) continue;
    for (const target of endpointInfo.targets) {
      if (target.type === 'page') {
        result.push({
          endpoint: endpointInfo.endpoint,
          ...target,
        });
      }
    }
  }
  return result;
}

function findPageTarget(cdpInfo, urlHint = 'salonboard.com') {
  const pages = pageTargets(cdpInfo);
  const hint = urlHint.toLowerCase();
  return pages.find(target => target.url.toLowerCase().includes(hint))
    || pages.find(target => target.url !== 'about:blank')
    || pages[0]
    || null;
}

function cdpCommand(webSocketDebuggerUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
      }
      reject(new Error(`CDP command timed out: ${method}`));
    }, 5000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) {
        reject(new Error(`${message.error.message || 'CDP error'}${message.error.data ? `: ${message.error.data}` : ''}`));
      } else {
        resolve(message.result);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`CDP websocket error: ${webSocketDebuggerUrl}`));
    });
  });
}

function safeOutputPath(filename) {
  const resolved = path.resolve(cwd, filename);
  if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`)) {
    throw new Error(`output path is outside recorder workspace: ${filename}`);
  }
  return resolved;
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
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

async function runSharedCdpSnapshot(args) {
  const filename = args[0] || 'snapshots/current.md';
  const urlHint = args[1] || 'salonboard.com';
  const cdpInfo = await collectCdpTargets();
  const target = findPageTarget(cdpInfo, urlHint);
  if (!target?.webSocketDebuggerUrl) {
    return {
      code: 1,
      stdout: `${JSON.stringify({ ok: false, error: `No CDP page target found for ${urlHint}`, cdpPageTargets: pageTargets(cdpInfo) }, null, 2)}\n`,
      stderr: '',
      errorCode: 'NO_CDP_TARGET',
    };
  }

  const expression = `(() => {
    const fieldInfo = element => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type'),
      id: element.getAttribute('id'),
      name: element.getAttribute('name'),
      placeholder: element.getAttribute('placeholder'),
      autocomplete: element.getAttribute('autocomplete'),
      visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    });
    return {
      url: location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 30).map(fieldInfo),
      frameCount: window.frames.length
    };
  })()`;
  const result = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const pageInfo = result.result?.value || {};
  const outputPath = safeOutputPath(filename);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const lines = [
    '# CDP Page Snapshot',
    '',
    `- Page URL: ${pageInfo.url || target.url}`,
    `- Page Title: ${pageInfo.title || target.title || ''}`,
    `- Target ID: ${target.id}`,
    `- Frame Count: ${pageInfo.frameCount ?? ''}`,
    '',
    '## Input Fields',
    '',
    '| index | tag | type | id | name | placeholder | autocomplete | visible |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [index, input] of (pageInfo.inputs || []).entries()) {
    lines.push(`| ${index} | ${markdownEscape(input.tag)} | ${markdownEscape(input.type)} | ${markdownEscape(input.id)} | ${markdownEscape(input.name)} | ${markdownEscape(input.placeholder)} | ${markdownEscape(input.autocomplete)} | ${markdownEscape(input.visible)} |`);
  }
  if (!pageInfo.inputs?.length) lines.push('| | | | | | | | |');
  lines.push('', '<!-- Input values are intentionally not captured. -->', '');
  await fs.promises.writeFile(outputPath, lines.join('\n'), 'utf8');

  return {
    code: 0,
    stdout: `${JSON.stringify({
      ok: true,
      mode: 'cdp',
      selectedTarget: target,
      output: path.relative(cwd, outputPath),
      page: pageInfo,
    }, null, 2)}\n`,
    stderr: '',
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
    enhanced.profileLock = getProfileLockStatus();
  }
  if (command === 'open' && result.code !== 0) {
    enhanced.profileLock = enhanced.profileLock || getProfileLockStatus();
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
