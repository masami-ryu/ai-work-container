const { spawn } = require('child_process');
const path = require('path');

const { createSharedProfileManager } = require('../lib/shared-profile');

const workspaceRootDefault = path.resolve(__dirname, '..');
const commandTimeoutMs = Number(process.env.PLAYWRIGHT_COMMAND_TIMEOUT_MS || 30000);
const maxOutputBytes = 256 * 1024;

function appendLimited(current, chunk) {
  const next = current + chunk;
  return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
}

function runPlaywrightCliClose(options = {}) {
  const workspaceRoot = options.workspaceRoot || workspaceRootDefault;
  const timeoutMs = options.timeoutMs || commandTimeoutMs;

  return new Promise(resolve => {
    const child = spawn('pnpm', ['exec', 'playwright-cli', 'close'], {
      cwd: workspaceRoot,
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
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = appendLimited(stderr, chunk);
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
        stderr: `${stderr}playwright-cli close timed out after ${timeoutMs}ms`,
        timedOut: true,
      });
    }, timeoutMs);
    timer.unref();

    child.on('error', error => finish({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => finish({ code, stdout, stderr }));
  });
}

function writeIfPresent(writer, value) {
  if (!value) return;
  writer(value.endsWith('\n') ? value : `${value}\n`);
}

async function runSharedReset(argv = process.argv.slice(2), options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || workspaceRootDefault);
  const manager = options.manager || createSharedProfileManager({ workspaceRoot });
  const closeSharedBrowser = options.closeSharedBrowser || (() => runPlaywrightCliClose({ workspaceRoot }));
  const writeStdout = options.writeStdout || (text => process.stdout.write(text));
  const writeStderr = options.writeStderr || (text => process.stderr.write(text));
  const result = await manager.resetSharedProfile(argv, { closeSharedBrowser });

  writeIfPresent(writeStdout, result.stdout);
  writeIfPresent(writeStderr, result.stderr);
  if (result.errorCode && result.recoveryHint) {
    writeIfPresent(writeStderr, `${result.errorCode}: ${result.recoveryHint}`);
  }

  return result;
}

if (require.main === module) {
  runSharedReset().then(result => {
    process.exitCode = result.code === 0 ? 0 : result.code || 1;
  }).catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  runPlaywrightCliClose,
  runSharedReset,
};
