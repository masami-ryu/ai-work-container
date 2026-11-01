const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createCloseHarness() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = signal => { signals.push(signal); return true; };
  const timers = [];
  const filename = path.resolve(__dirname, '../scripts/shared-reset.js');
  const context = {
    require(name) {
      if (name === 'child_process') return { spawn: () => child };
      if (name === 'path') return path;
      if (name === '../lib/shared-profile') return require('../lib/shared-profile');
      throw new Error(`Unexpected module: ${name}`);
    },
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env: {} },
    setTimeout(callback, delay) {
      const timer = { callback, delay, unref() { return this; } };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { child, signals, timers, run: context.module.exports.runPlaywrightCliClose };
}

test('SIGTERMに応答しない子プロセスにはPromise完了後もSIGKILLを送る', async () => {
  const { run, timers, signals } = createCloseHarness();
  const result = run({ timeoutMs: 100 });
  timers[0].callback();
  expect(await result).toMatchObject({ code: 124, timedOut: true });
  expect(signals).toEqual(['SIGTERM']);
  expect(timers[1].delay).toBe(2000);
  timers[1].callback();
  expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
});

for (const [exitCode, signalCode] of [[0, null], [null, 'SIGTERM']]) {
  test(`子プロセス終了後はSIGKILLを送らない: ${exitCode ?? signalCode}`, async () => {
    const { run, timers, signals, child } = createCloseHarness();
    const result = run({ timeoutMs: 100 });
    timers[0].callback();
    await result;
    child.exitCode = exitCode;
    child.signalCode = signalCode;
    child.emit('close', exitCode, signalCode);
    timers[1].callback();
    expect(signals).toEqual(['SIGTERM']);
  });
}

test('正常終了ではタイムアウトを解除して出力を返す', async () => {
  const { run, timers, signals, child } = createCloseHarness();
  const result = run({ timeoutMs: 100 });
  child.stdout.emit('data', 'closed\n');
  child.exitCode = 0;
  child.emit('close', 0, null);
  expect(await result).toEqual({ code: 0, stdout: 'closed\n', stderr: '' });
  expect(timers[0].cleared).toBe(true);
  expect(signals).toEqual([]);
});
