import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe.each(["decide.sh", "notify.sh"])("%s の認証ヘッダー", (script) => {
  it.each(["", "test-token", "test token * [value]"])("トークン %j を正しい引数で渡す", async (token) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-auth-"));
    temporaryDirs.push(dir);
    const capturePath = path.join(dir, "requests.jsonl");
    // 実通信を行わず、認証ヘッダーを確認して登録・承認の応答を返す。
    fs.writeFileSync(path.join(dir, "curl"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HOOK_TEST_CAPTURE, JSON.stringify(args) + '\\n');
const url = args.find(arg => arg.startsWith('http://'));
if (url.endsWith('/wait')) {
  process.stdout.write(JSON.stringify({resolved: true, decision: 'allow'}));
} else if (args.includes('-w')) {
  const token = process.env.CLAUDE_MONITOR_HOOK_TOKEN;
  const authenticated = !token || args.some((arg, i) => arg === '-H' && args[i + 1] === 'X-Hook-Token: ' + token);
  process.stdout.write(authenticated ? '201' : '403');
}
`, { mode: 0o700 });

    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      CLAUDE_MONITOR_HOOK_TOKEN: token,
      HOOK_TEST_CAPTURE: capturePath,
    };
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile("bash", [path.resolve(__dirname, "../hooks", script)], { env, timeout: 5000 }, (error, output) => {
        if (error) reject(error);
        else resolve(output);
      });
      child.stdin!.end(JSON.stringify({
        hook_event_name: "PermissionRequest", session_id: "auth-test", cwd: "/test", tool_name: "Read", tool_input: {},
      }));
    });
    const calls: string[][] = fs.readFileSync(capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const headers = calls[0].flatMap((arg, i, args) => arg === "-H" ? [args[i + 1]] : []);
    expect(headers).toEqual([
      "Content-Type: application/json",
      ...(token ? [`X-Hook-Token: ${token}`] : []),
    ]);
    if (token) expect(calls[0]).not.toContain(token);
    if (script === "decide.sh") {
      expect(calls).toHaveLength(2);
      expect(JSON.parse(stdout).hookSpecificOutput.decision.behavior).toBe("allow");
    } else {
      expect(calls).toHaveLength(1);
      expect(stdout).toBe("");
    }
  });
});
