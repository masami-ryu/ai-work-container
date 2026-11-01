const fs = require('fs');
const http = require('http');
const path = require('path');

function optionValue(args, option) {
  const exactIndex = args.indexOf(option);
  if (exactIndex >= 0) return args[exactIndex + 1] || null;

  const prefixed = args.find(arg => arg.startsWith(`${option}=`));
  return prefixed ? prefixed.slice(option.length + 1) : null;
}

function parseProcCmdline(content) {
  return content.split('\0').filter(Boolean);
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function listChromeProcesses(options = {}) {
  const procRoot = options.procRoot || '/proc';
  const procEntries = fs.readdirSync(procRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name));
  const result = [];

  for (const entry of procEntries) {
    const pid = Number(entry.name);
    let args;
    try {
      args = parseProcCmdline(fs.readFileSync(path.join(procRoot, entry.name, 'cmdline'), 'utf8'));
    } catch {
      continue;
    }
    if (!args.length || !/(chrome|chromium)/.test(path.basename(args[0]))) continue;

    result.push({
      pid,
      executable: args[0],
      userDataDir: optionValue(args, '--user-data-dir'),
      remoteDebuggingPort: optionValue(args, '--remote-debugging-port'),
      remoteDebuggingPipe: args.includes('--remote-debugging-pipe'),
      display: optionValue(args, '--display'),
      urlArgs: args.filter(arg => /^https?:\/\//.test(arg) || arg.startsWith('chrome://')),
    });
  }

  return result.sort((a, b) => a.pid - b.pid);
}

function findDevToolsActivePorts(rootDir, options = {}) {
  const workspaceRoot = options.workspaceRoot || path.dirname(rootDir);
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
            path: path.relative(workspaceRoot, entryPath),
            port: Number.isFinite(port) ? port : null,
            browserPath,
          });
        } catch (error) {
          result.push({
            path: path.relative(workspaceRoot, entryPath),
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

async function collectCdpTargets(options = {}) {
  const sharedProfilePath = options.sharedProfilePath;
  const workspaceRoot = options.workspaceRoot || path.dirname(sharedProfilePath || process.cwd());
  const procRoot = options.procRoot || '/proc';
  const requestJsonImpl = options.requestJson || requestJson;
  const processes = listChromeProcesses({ procRoot });
  const activePorts = sharedProfilePath
    ? findDevToolsActivePorts(sharedProfilePath, { workspaceRoot })
    : [];
  const processPortCandidates = sharedProfilePath
    ? processes.filter(processInfo => sameResolvedPath(processInfo.userDataDir, sharedProfilePath))
    : processes;
  const ports = new Set();

  for (const processInfo of processPortCandidates) {
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
      requestJsonImpl(`${endpoint}/json/version`),
      requestJsonImpl(`${endpoint}/json/list`),
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

function cdpCommand(webSocketDebuggerUrl, method, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const WebSocketCtor = options.WebSocketCtor || globalThis.WebSocket;
    if (!WebSocketCtor) {
      const error = new Error('WebSocket is not available in this Node.js runtime');
      error.cdpMethod = method;
      reject(error);
      return;
    }

    const ws = new WebSocketCtor(webSocketDebuggerUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
      }
      const error = new Error(`CDP command timed out: ${method}`);
      error.cdpMethod = method;
      reject(error);
    }, options.timeoutMs || 5000);

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
        const error = new Error(`${message.error.message || 'CDP error'}${message.error.data ? `: ${message.error.data}` : ''}`);
        error.cdpMethod = method;
        error.cdpError = message.error;
        reject(error);
      } else {
        resolve(message.result);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      const error = new Error(`CDP websocket error: ${webSocketDebuggerUrl}`);
      error.cdpMethod = method;
      reject(error);
    });
  });
}

function createCdpClient(options = {}) {
  const requestTextImpl = options.requestText || requestText;

  return {
    collectCdpTargets: () => collectCdpTargets(options),
    cdpCommand: (webSocketDebuggerUrl, method, params = {}) => cdpCommand(webSocketDebuggerUrl, method, params, {
      timeoutMs: options.cdpCommandTimeoutMs,
      WebSocketCtor: options.WebSocketCtor,
    }),
    requestText: requestTextImpl,
  };
}

module.exports = {
  cdpCommand,
  collectCdpTargets,
  createCdpClient,
  findDevToolsActivePorts,
  listChromeProcesses,
  parseProcCmdline,
  requestJson,
  requestText,
  sameResolvedPath,
};
