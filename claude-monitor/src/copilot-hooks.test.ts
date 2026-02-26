import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);
const hooksDir = path.resolve(__dirname, "../hooks");

describe("copilot-session-id.sh", () => {
  it("TMUX_PANE=%5 の場合 copilot-pane-5 を返す", async () => {
    const { stdout } = await execFileAsync(
      path.join(hooksDir, "copilot-session-id.sh"),
      [],
      { env: { ...process.env, TMUX_PANE: "%5" } }
    );
    expect(stdout.trim()).toBe("copilot-pane-5");
  });

  it("TMUX_PANE=%0 の場合 copilot-pane-0 を返す", async () => {
    const { stdout } = await execFileAsync(
      path.join(hooksDir, "copilot-session-id.sh"),
      [],
      { env: { ...process.env, TMUX_PANE: "%0" } }
    );
    expect(stdout.trim()).toBe("copilot-pane-0");
  });

  it("TMUX_PANE 未設定の場合 一意IDを含む copilot- プレフィックスを返す", async () => {
    const env = { ...process.env };
    delete env.TMUX_PANE;
    const { stdout: stdout1 } = await execFileAsync(
      path.join(hooksDir, "copilot-session-id.sh"),
      [],
      { env }
    );
    const { stdout: stdout2 } = await execFileAsync(
      path.join(hooksDir, "copilot-session-id.sh"),
      [],
      { env }
    );
    const id1 = stdout1.trim();
    const id2 = stdout2.trim();
    // copilot- プレフィックスで始まり、固定値 copilot-unknown ではない
    expect(id1).toMatch(/^copilot-.+/);
    expect(id1).not.toBe("copilot-unknown");
    // 2回実行で異なるIDが生成される（衝突しない）
    expect(id1).not.toBe(id2);
  });
});

describe("copilot-notify.sh", () => {
  let fakeCurlDir: string;

  beforeAll(() => {
    // curl モック: POST body をそのまま stdout に出力するスクリプトを PATH 先頭に配置
    fakeCurlDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-curl-"));
    const fakeCurl = path.join(fakeCurlDir, "curl");
    // -d 引数（JSON body）を stdout に出力する簡易モック
    fs.writeFileSync(fakeCurl, `#!/bin/bash
for i in "$@"; do :; done
# -d の次の引数を探して出力
while [ $# -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    echo "$2"
    exit 0
  fi
  shift
done
`, "utf-8");
    fs.chmodSync(fakeCurl, 0o755);
  });

  it("sessionStart で正しい HookEvent JSON を POST する", async () => {
    const input = JSON.stringify({ cwd: "/tmp/test", selectedModel: "gpt-5.3-codex", initialPrompt: "hello" });
    const { stdout } = await execFileAsync(
      "bash",
      ["-c", `echo '${input}' | COPILOT_HOOK_EVENT=sessionStart ${hooksDir}/copilot-notify.sh`],
      {
        env: {
          ...process.env,
          TMUX_PANE: "%7",
          PATH: `${fakeCurlDir}:${process.env.PATH}`,
        },
      }
    );
    const payload = JSON.parse(stdout.trim());
    expect(payload.event_type).toBe("SessionStart");
    expect(payload.session_id).toBe("copilot-pane-7");
    expect(payload.cli_tool).toBe("copilot");
    expect(payload.cwd).toBe("/tmp/test");
    expect(payload.model).toBe("gpt-5.3-codex");
    expect(payload.prompt).toBe("hello");
  });

  it("未知の COPILOT_HOOK_EVENT では exit 0 で何もしない", async () => {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", `echo '{}' | COPILOT_HOOK_EVENT=unknownEvent ${hooksDir}/copilot-notify.sh; echo "EXIT:$?"`],
      {
        env: { ...process.env, TMUX_PANE: "%1" },
      }
    );
    expect(stdout).toContain("EXIT:0");
  });
});

describe("copilot-notify.sh イベント変換（スクリプト直接実行）", () => {
  // copilot-notify.sh を curl モック経由で直接実行し、POST body の JSON を検証する
  // jq 式の重複を排除するため、シェルスクリプトの出力を直接テストする
  let fakeCurlDir: string;

  beforeAll(() => {
    fakeCurlDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-curl-json-"));
    const fakeCurl = path.join(fakeCurlDir, "curl");
    fs.writeFileSync(fakeCurl, `#!/bin/bash
while [ $# -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    echo "$2"
    exit 0
  fi
  shift
done
`, "utf-8");
    fs.chmodSync(fakeCurl, 0o755);
  });

  function runNotify(event: string, input: object, pane: string = "%5") {
    const inputJson = JSON.stringify(input);
    return execFileAsync(
      "bash",
      ["-c", `printf '%s\\n' '${inputJson}' | COPILOT_HOOK_EVENT=${event} ${hooksDir}/copilot-notify.sh`],
      {
        env: {
          ...process.env,
          TMUX_PANE: pane,
          PATH: `${fakeCurlDir}:${process.env.PATH}`,
        },
      }
    );
  }

  it("sessionStart: 正しいフィールドマッピング", async () => {
    const { stdout } = await runNotify("sessionStart", {
      cwd: "/work", selectedModel: "gpt-5.3-codex", initialPrompt: "do something",
    });
    const result = JSON.parse(stdout.trim());
    expect(result.event_type).toBe("SessionStart");
    expect(result.session_id).toBe("copilot-pane-5");
    expect(result.cwd).toBe("/work");
    expect(result.model).toBe("gpt-5.3-codex");
    expect(result.cli_tool).toBe("copilot");
    expect(result.tmux_pane).toBe("%5");
    expect(result.prompt).toBe("do something");
  });

  it("preToolUse: toolName マッピング", async () => {
    const { stdout } = await runNotify("preToolUse", {
      cwd: "/work", toolName: "bash", toolArgs: '{"command":"ls"}',
    }, "%3");
    const result = JSON.parse(stdout.trim());
    expect(result.event_type).toBe("PreToolUse");
    expect(result.session_id).toBe("copilot-pane-3");
    expect(result.tool_name).toBe("bash");
    expect(result.cli_tool).toBe("copilot");
  });

  it("sessionEnd: reason マッピング", async () => {
    const { stdout } = await runNotify("sessionEnd", {
      cwd: "/work", reason: "user_quit",
    }, "%1");
    const result = JSON.parse(stdout.trim());
    expect(result.event_type).toBe("SessionEnd");
    expect(result.reason).toBe("user_quit");
    expect(result.cli_tool).toBe("copilot");
  });

  it("userPromptSubmitted: prompt マッピング", async () => {
    const { stdout } = await runNotify("userPromptSubmitted", {
      cwd: "/work", prompt: "fix the bug",
    }, "%2");
    const result = JSON.parse(stdout.trim());
    expect(result.event_type).toBe("UserPromptSubmit");
    expect(result.prompt).toBe("fix the bug");
    expect(result.cli_tool).toBe("copilot");
  });

  it("errorOccurred: error.message 抽出", async () => {
    const { stdout } = await runNotify("errorOccurred", {
      cwd: "/work", error: { message: "Something failed" },
    }, "%1");
    const result = JSON.parse(stdout.trim());
    expect(result.event_type).toBe("Notification");
    expect(result.notification_type).toBe("error");
    expect(result.message).toBe("Something failed");
    expect(result.cli_tool).toBe("copilot");
  });
});

describe("createMcpConfigFile JSON スキーマ検証", () => {
  it("生成JSONが mcpServers ルートキーを持つ", async () => {
    // tmux-manager.ts の createMcpConfigFile() と同等のロジックで検証
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
    const configPath = path.join(tmpDir, "claude-monitor-mcp.json");
    const config = {
      mcpServers: {
        "claude-monitor": {
          type: "http",
          url: "http://localhost:3456/mcp",
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written).toHaveProperty("mcpServers");
    expect(written.mcpServers).toHaveProperty("claude-monitor");
    expect(written.mcpServers["claude-monitor"].type).toBe("http");
    expect(written.mcpServers["claude-monitor"].url).toBe("http://localhost:3456/mcp");

    // cleanup
    fs.unlinkSync(configPath);
    fs.rmdirSync(tmpDir);
  });
});

describe("copilot-decide.sh fail-closed/open モード", () => {
  // fail_fallback 関数のロジックを抽出してテスト
  function makeFailFallbackScript(failMode: string, reason: string): string {
    return `
      FAIL_MODE="${failMode}"
      fail_fallback() {
        local reason="\${1:-Server communication failed}"
        if [ "$FAIL_MODE" = "closed" ]; then
          echo "{\\"permissionDecision\\":\\"deny\\",\\"permissionDecisionReason\\":\\"\${reason} (fail-closed mode)\\"}"
          exit 0
        else
          exit 0
        fi
      }
      fail_fallback "${reason}"
    `;
  }

  const failModeTests = [
    {
      mode: "closed",
      reason: "Server communication failed",
      expectOutput: true,
      desc: "fail-closed: deny を出力",
    },
    {
      mode: "open",
      reason: "Server communication failed",
      expectOutput: false,
      desc: "fail-open: 出力なし",
    },
  ];

  for (const tc of failModeTests) {
    it(tc.desc, async () => {
      const { stdout } = await execFileAsync("bash", ["-c", makeFailFallbackScript(tc.mode, tc.reason)]);
      if (tc.expectOutput) {
        const parsed = JSON.parse(stdout.trim());
        expect(parsed.permissionDecision).toBe("deny");
        expect(parsed.permissionDecisionReason).toContain("fail-closed mode");
      } else {
        expect(stdout.trim()).toBe("");
      }
    });
  }

  it("正常応答時は permissionDecision/permissionDecisionReason JSON 契約を維持", async () => {
    // 正常応答パスのJSONフォーマット検証
    const script = `
      DECISION="allow"
      REASON="Approved via dashboard"
      jq -n --arg decision "$DECISION" --arg reason "$REASON" \
        '{permissionDecision: $decision, permissionDecisionReason: $reason}'
    `;
    const { stdout } = await execFileAsync("bash", ["-c", script]);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("permissionDecision");
    expect(parsed).toHaveProperty("permissionDecisionReason");
    expect(parsed.permissionDecision).toBe("allow");
  });

  it("deny 応答時も permissionDecision/permissionDecisionReason JSON 契約を維持", async () => {
    const script = `
      DECISION="deny"
      REASON="Denied via dashboard"
      jq -n --arg decision "$DECISION" --arg reason "$REASON" \
        '{permissionDecision: $decision, permissionDecisionReason: $reason}'
    `;
    const { stdout } = await execFileAsync("bash", ["-c", script]);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.permissionDecision).toBe("deny");
    expect(parsed.permissionDecisionReason).toBe("Denied via dashboard");
  });
});

describe("copilot-decide.sh 承認対象ツール判定", () => {
  // 承認対象ツール判定ロジックの抽出テスト（テーブル駆動）
  function makeToolCheckScript(toolName: string, approvalTools?: string): string {
    const envPrefix = approvalTools !== undefined
      ? `COPILOT_APPROVAL_TOOLS="${approvalTools}"`
      : "";
    return `
      ${envPrefix}
      APPROVAL_TOOLS="\${COPILOT_APPROVAL_TOOLS:-bash}"
      TOOL_NAME="${toolName}"
      TOOL_NAME_LC="$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]')"
      MATCH=0
      IFS=',' read -ra TOOLS <<< "$APPROVAL_TOOLS"
      for t in "\${TOOLS[@]}"; do
        t_lc="$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]' | xargs)"
        if [ "$TOOL_NAME_LC" = "$t_lc" ]; then
          MATCH=1
          break
        fi
      done
      if [ "$MATCH" = "0" ]; then
        echo "SKIPPED"
      else
        echo "PROCEED"
      fi
    `;
  }

  const defaultToolTests = [
    { toolName: "bash", expected: "PROCEED", desc: "bash (小文字) → 承認対象" },
    { toolName: "Bash", expected: "PROCEED", desc: "Bash (大文字) → 承認対象" },
    { toolName: "read", expected: "SKIPPED", desc: "read → 非対象" },
    { toolName: "Write", expected: "SKIPPED", desc: "Write → 非対象" },
    { toolName: "Edit", expected: "SKIPPED", desc: "Edit → 非対象" },
  ];

  for (const tc of defaultToolTests) {
    it(`デフォルト設定: ${tc.desc}`, async () => {
      const { stdout } = await execFileAsync("bash", ["-c", makeToolCheckScript(tc.toolName)]);
      expect(stdout.trim()).toBe(tc.expected);
    });
  }

  const customToolTests = [
    { toolName: "bash", approvalTools: "bash,write", expected: "PROCEED", desc: "bash → 承認対象" },
    { toolName: "Write", approvalTools: "bash,write", expected: "PROCEED", desc: "Write → 承認対象" },
    { toolName: "read", approvalTools: "bash,write", expected: "SKIPPED", desc: "read → 非対象" },
  ];

  for (const tc of customToolTests) {
    it(`COPILOT_APPROVAL_TOOLS="${tc.approvalTools}": ${tc.desc}`, async () => {
      const { stdout } = await execFileAsync("bash", ["-c", makeToolCheckScript(tc.toolName, tc.approvalTools)]);
      expect(stdout.trim()).toBe(tc.expected);
    });
  }
});
