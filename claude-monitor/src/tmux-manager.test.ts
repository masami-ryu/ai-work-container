import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

import { TmuxManager } from "./tmux-manager.js";

function createExecError(stderr: string): Error & { stderr: string } {
  const err = new Error(stderr) as Error & { stderr: string };
  err.stderr = stderr;
  return err;
}

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
