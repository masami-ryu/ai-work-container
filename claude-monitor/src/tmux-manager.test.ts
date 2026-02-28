import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

const { mockFsReadFile, mockFsWriteFile, mockFsMkdir, mockFsCopyFile } = vi.hoisted(() => ({
  mockFsReadFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsCopyFile: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const defaultFs = actual["default"] as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...defaultFs,
      readFile: mockFsReadFile,
      writeFile: mockFsWriteFile,
      mkdir: mockFsMkdir,
      copyFile: mockFsCopyFile,
    },
  };
});

import { TmuxManager } from "./tmux-manager.js";

function createExecError(stderr: string): Error & { stderr: string } {
  const err = new Error(stderr) as Error & { stderr: string };
  err.stderr = stderr;
  return err;
}

// ──────────────────────────────────────────────────────────────
// 既存テスト: cancelCopyMode
// ──────────────────────────────────────────────────────────────

describe("TmuxManager cancelCopyMode", () => {
  const originalCwd = process.env.CLAUDE_MONITOR_WORK_DIR;

  beforeEach(() => {
    process.env.CLAUDE_MONITOR_WORK_DIR = "/tmp";
  });

  afterEach(() => {
    mockExecFile.mockReset();
    if (originalCwd === undefined) {
      delete process.env.CLAUDE_MONITOR_WORK_DIR;
    } else {
      process.env.CLAUDE_MONITOR_WORK_DIR = originalCwd;
    }
  });

  it("tmux が 'not in a mode' を返しても再判定で通常モードなら true", async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;

      if (argv[0] === "send-keys") {
        cb(createExecError("not in a mode"));
        return { on: vi.fn(), kill: vi.fn() };
      }
      if (argv[0] === "display-message") {
        cb(null, { stdout: "0\n", stderr: "" });
        return { on: vi.fn(), kill: vi.fn() };
      }
      cb(null, { stdout: "", stderr: "" });
      return { on: vi.fn(), kill: vi.fn() };
    });

    const manager = new TmuxManager();
    const ok = await manager.cancelCopyMode("%5");

    expect(ok).toBe(true);
    const displayCalls = mockExecFile.mock.calls.filter(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[])[0] === "display-message"
    );
    expect(displayCalls.length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────
// ヘルパー: launchSession 用モック
// ──────────────────────────────────────────────────────────────

/**
 * tmux + which コマンドの標準モックを構築し、
 * tmux new-window / split-window に渡されたコマンド文字列をキャプチャする。
 */
function setupLaunchMocks(opts: { availableTools?: string[] } = {}) {
  const availableTools = opts.availableTools || ["claude", "copilot", "codex"];
  let capturedCommand: string | null = null;

  mockExecFile.mockImplementation((...args: unknown[]) => {
    const bin = args[0] as string;
    const argv = args[1] as string[];
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;

    if (bin === "tmux") {
      if (argv[0] === "display-message") {
        cb(null, { stdout: "test-session\n", stderr: "" });
      } else if (argv[0] === "list-panes") {
        // windowExists → false
        cb(createExecError("can't find window"));
      } else if (argv[0] === "new-window" || argv[0] === "split-window") {
        capturedCommand = argv[argv.length - 1];
        cb(null, { stdout: "%10\n", stderr: "" });
      } else if (argv[0] === "select-layout") {
        cb(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    } else if (bin === "which") {
      if (availableTools.includes(argv[0])) {
        cb(null, { stdout: `/usr/bin/${argv[0]}\n`, stderr: "" });
      } else {
        cb(createExecError(`${argv[0]} not found`));
      }
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
    return { on: vi.fn(), kill: vi.fn() };
  });

  return { getCapturedCommand: () => capturedCommand };
}

/** fs モックを成功応答に設定する（Copilot テスト用） */
function setupFsMocks() {
  mockFsMkdir.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null);
  });
  mockFsWriteFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null);
  });
  mockFsReadFile.mockImplementation((...args: unknown[]) => {
    const filePath = String(args[0]);
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    if (filePath.includes("copilot-hooks.json") && !filePath.includes(".github")) {
      // hooks テンプレート（ソース）
      cb(null, JSON.stringify({
        hooks: {
          prompt_submitted: [{ _source: "claude-monitor", command: "__HOOKS_DIR__/test.sh" }],
        },
      }));
    } else {
      // ターゲットファイル（未存在）
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      cb(err);
    }
  });
  mockFsCopyFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
    cb(null);
  });
}

/** TmuxManager を initialize 済みの状態で返す */
async function createInitializedManager(): Promise<TmuxManager> {
  const manager = new TmuxManager();
  await manager.initialize();
  return manager;
}

// ──────────────────────────────────────────────────────────────
// TASK-004: Codex コマンド生成テスト
// ──────────────────────────────────────────────────────────────

describe("TmuxManager Codex コマンド生成", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.TMUX = process.env.TMUX;
    savedEnv.TMUX_PANE = process.env.TMUX_PANE;
    savedEnv.CLAUDE_MONITOR_WORK_DIR = process.env.CLAUDE_MONITOR_WORK_DIR;

    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.TMUX_PANE = "%0";
    process.env.CLAUDE_MONITOR_WORK_DIR = "/workspace";
  });

  afterEach(() => {
    mockExecFile.mockReset();
    mockFsReadFile.mockReset();
    mockFsWriteFile.mockReset();
    mockFsMkdir.mockReset();
    mockFsCopyFile.mockReset();

    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("new モード: notify と mcp_servers の両 -c 設定が含まれる", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace");

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("codex --no-alt-screen");
    expect(cmd).toContain("-c 'notify=[");
    expect(cmd).toContain(`-c 'mcp_servers={"claude-monitor"={url="http://localhost:3456/mcp"}}'`);
    // new モードではサブコマンドなし
    expect(cmd).not.toContain("resume");
    expect(cmd).not.toContain("fork");

    manager.destroy();
  });

  it("resume モード（--last）: notify + mcp_servers + resume --last が含まれる", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace", { mode: "resume" });

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("-c 'notify=[");
    expect(cmd).toContain(`-c 'mcp_servers={"claude-monitor"={url="http://localhost:3456/mcp"}}'`);
    expect(cmd).toContain("resume --last");

    manager.destroy();
  });

  it("resume モード（target 指定）: target が正しく挿入される", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace", { mode: "resume", target: "thread-abc" });

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("-c 'mcp_servers=");
    expect(cmd).toContain("resume 'thread-abc'");
    expect(cmd).not.toContain("--last");

    manager.destroy();
  });

  it("resume モード（--all 付き）: --all が末尾に含まれる", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace", { mode: "resume", all: true });

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("resume --last --all");

    manager.destroy();
  });

  it("fork モード（--last）: notify + mcp_servers + fork --last が含まれる", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace", { mode: "fork" });

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("-c 'notify=[");
    expect(cmd).toContain(`-c 'mcp_servers={"claude-monitor"={url="http://localhost:3456/mcp"}}'`);
    expect(cmd).toContain("fork --last");

    manager.destroy();
  });

  it("fork モード（target + --all）: target と --all が正しく挿入される", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("codex", "/workspace", { mode: "fork", target: "thread-xyz", all: true });

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("-c 'mcp_servers=");
    expect(cmd).toContain("fork 'thread-xyz' --all");

    manager.destroy();
  });
});

// ──────────────────────────────────────────────────────────────
// TASK-005: Copilot コマンド生成回帰テスト
// ──────────────────────────────────────────────────────────────

describe("TmuxManager Copilot コマンド生成", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.TMUX = process.env.TMUX;
    savedEnv.TMUX_PANE = process.env.TMUX_PANE;
    savedEnv.CLAUDE_MONITOR_WORK_DIR = process.env.CLAUDE_MONITOR_WORK_DIR;

    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.TMUX_PANE = "%0";
    process.env.CLAUDE_MONITOR_WORK_DIR = "/workspace";
  });

  afterEach(() => {
    mockExecFile.mockReset();
    mockFsReadFile.mockReset();
    mockFsWriteFile.mockReset();
    mockFsMkdir.mockReset();
    mockFsCopyFile.mockReset();

    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("Copilot 起動コマンドに --additional-mcp-config が含まれる", async () => {
    const { getCapturedCommand } = setupLaunchMocks();
    setupFsMocks();
    const manager = await createInitializedManager();

    await manager.launchSession("copilot", "/workspace");

    const cmd = getCapturedCommand()!;
    expect(cmd).toContain("copilot --additional-mcp-config");
    expect(cmd).toContain("claude-monitor-mcp.json");

    manager.destroy();
  });
});
