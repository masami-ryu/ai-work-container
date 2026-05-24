const http = require('http');
const { spawn } = require('child_process');

const host = process.env.PLAYWRIGHT_COMMAND_HOST || '0.0.0.0';
const port = Number(process.env.PLAYWRIGHT_COMMAND_PORT || 6090);
const cwd = __dirname;

const allowedCommands = new Set([
  'open',
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
  'console',
  'requests',
]);

let runningCommand = false;

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
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => resolve({ code, stdout, stderr }));
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

  const command = payload.command;
  const args = Array.isArray(payload.args) ? payload.args : [];
  if (!allowedCommands.has(command)) {
    sendJson(res, 400, { ok: false, error: `command is not allowed: ${command}` });
    return;
  }
  if (!args.every(validateArg)) {
    sendJson(res, 400, { ok: false, error: 'invalid args' });
    return;
  }
  if (runningCommand) {
    sendJson(res, 409, { ok: false, error: 'another command is already running' });
    return;
  }

  runningCommand = true;
  try {
    // If callers need burst execution later, replace this guard with a FIFO queue.
    const result = await runPlaywrightCli(command, args);
    sendJson(res, result.code === 0 ? 200 : 500, {
      ok: result.code === 0,
      command,
      args,
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
  if (req.method === 'POST' && req.url === '/run') {
    await handleRun(req, res);
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(port, host, () => {
  console.log(`Playwright command server listening on http://${host}:${port}`);
});
