import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCaptureTick, resetCaptureState, isCaptureEnabled, parseHookTimestampMs, getRunStartMs, getHardTimeoutMs, _resetCaptureTickGuard } from "./pane-capture.js";
import type { PaneCaptureDeps } from "./pane-capture.js";
import { TerminalEventStore, parseCaptureConfig } from "./terminal-event-store.js";
import type { CaptureConfig, CliToolType, Session, TerminalEvent } from "./types.js";

function makeConfig(overrides: Partial<CaptureConfig> = {}): CaptureConfig {
  return {
    enableCodex: true,
    enableCopilot: true,
    enableClaude: true,
    maxEventsPerSession: 200,
    eventTtlMinutes: 10,
    maxEventsGlobal: 2000,
    maxEventChars: 4096,
    tombstoneTtlMinutes: 20,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: "codex-pane-5",
    cwd: "/tmp",
    model: "opus",
    status: "running",
    status_text: "",
    cli_tool: "codex",
    milestones: [],
    last_message: "",
    last_activity: "",
    current_progress: "",
    artifacts: [],
    title: "",
    error_info: "",
    tmux_pane: "%5",
    last_hook_at: "",
    last_init_at: new Date().toISOString(),
    last_run_started_at: new Date().toISOString(),
    first_prompt_sent: false,
    prompt_ready: false,
    approvalSupported: false,
    external_session_id: "",
    error_at: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    activities: [],
    questions: [],
    run_id: 1,
    terminal_event_count: 0,
    terminal_event_latest_seq: 0,
    last_capture_detected_at: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PaneCaptureDeps> = {}): PaneCaptureDeps {
  const config = overrides.captureConfig ?? makeConfig();
  return {
    tmux: {
      canManagePanes: vi.fn().mockReturnValue(true),
      capturePane: vi.fn().mockResolvedValue(["line1", "line2", ""]),
      getPanePid: vi.fn().mockResolvedValue("12345"),
    } as unknown as PaneCaptureDeps["tmux"],
    sessionStore: {
      getAll: vi.fn().mockReturnValue([makeSession()]),
      updateTerminalEventSummary: vi.fn(),
    } as unknown as PaneCaptureDeps["sessionStore"],
    terminalEventStore: overrides.terminalEventStore ?? new TerminalEventStore(config),
    captureConfig: config,
    broadcastTerminalEventBatch: overrides.broadcastTerminalEventBatch ?? vi.fn(),
    ...overrides,
  };
}

describe("runCaptureTick", () => {
  beforeEach(() => {
    resetCaptureState("codex-pane-5");
    _resetCaptureTickGuard();
  });

  it("capture ポーリングが正常動作し新規行を TerminalEventStore に追加する", async () => {
    const deps = makeDeps();
    await runCaptureTick(deps);

    const events = deps.terminalEventStore.getEvents("codex-pane-5");
    expect(events.length).toBe(2); // "line1", "line2" (末尾空行は除去)
    expect(events[0].text).toBe("line1");
    expect(events[1].text).toBe("line2");
    expect(events[0].type).toBe("output");
    expect(events[0].source).toBe("capture");
  });

  it("broadcastTerminalEventBatch が呼ばれる", async () => {
    const broadcast = vi.fn();
    const deps = makeDeps({ broadcastTerminalEventBatch: broadcast });
    await runCaptureTick(deps);

    expect(broadcast).toHaveBeenCalledWith("codex-pane-5", expect.any(Array));
    expect(broadcast.mock.calls[0][1]).toHaveLength(2);
  });

  it("SessionStore.updateTerminalEventSummary が呼ばれる", async () => {
    const deps = makeDeps();
    await runCaptureTick(deps);

    expect(deps.sessionStore.updateTerminalEventSummary).toHaveBeenCalledWith(
      "codex-pane-5",
      2, // eventCount
      2, // latestSeq
    );
  });

  it("canManagePanes() === false の場合はスキップ", async () => {
    const deps = makeDeps();
    (deps.tmux.canManagePanes as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await runCaptureTick(deps);

    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(0);
  });

  it("capture 無効の CLI はスキップ", async () => {
    const config = makeConfig({ enableCodex: false });
    const deps = makeDeps({ captureConfig: config });
    await runCaptureTick(deps);

    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(0);
  });

  it("completed セッションはスキップ", async () => {
    const deps = makeDeps();
    (deps.sessionStore.getAll as ReturnType<typeof vi.fn>).mockReturnValue([
      makeSession({ status: "completed" }),
    ]);
    await runCaptureTick(deps);

    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(0);
  });

  it("tmux_pane 未設定のセッションはスキップ", async () => {
    const deps = makeDeps();
    (deps.sessionStore.getAll as ReturnType<typeof vi.fn>).mockReturnValue([
      makeSession({ tmux_pane: "" }),
    ]);
    await runCaptureTick(deps);

    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(0);
  });

  it("pane 不在時（capturePane が null）はスキップ", async () => {
    const deps = makeDeps();
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await runCaptureTick(deps);

    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(0);
  });

  it("重複実行抑止: 前回 tick 実行中は次 tick をスキップする", async () => {
    const deps = makeDeps();
    let resolveCapture: ((v: string[] | null) => void) | null = null;
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise<string[] | null>((resolve) => {
        resolveCapture = resolve;
      });
    });

    // 1回目の tick 開始（capturePane が pending 状態）
    const tick1 = runCaptureTick(deps);

    // 2回目の tick は即座にスキップされる
    const tick2 = runCaptureTick(deps);
    await tick2; // 即座に完了するはず

    // 1回目の tick を完了させる
    resolveCapture!(["line1", ""]);
    await tick1;

    // capturePane は1回しか呼ばれない
    expect(deps.tmux.capturePane).toHaveBeenCalledTimes(1);
  });
});

describe("差分抽出ロジック", () => {
  beforeEach(() => {
    resetCaptureState("codex-pane-5");
    _resetCaptureTickGuard();
  });

  it("2回目の tick では新規行のみが追加される（重複抑止）", async () => {
    const deps = makeDeps();
    // 1回目: line1, line2
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["line1", "line2", ""]);
    await runCaptureTick(deps);
    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(2);

    // 2回目: line1, line2, line3（line3 が新規）
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["line1", "line2", "line3", ""]);
    await runCaptureTick(deps);
    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(3);
    const events = deps.terminalEventStore.getEvents("codex-pane-5");
    expect(events[2].text).toBe("line3");
  });

  it("cursor > 現在行数 時に再同期し gap イベントを記録する", async () => {
    const deps = makeDeps();

    // 1回目: 5行
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["a", "b", "c", "d", "e", ""]);
    await runCaptureTick(deps);
    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(5);

    // 2回目: 2行（clear で縮小）
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["x", "y", ""]);
    await runCaptureTick(deps);

    const allEvents = deps.terminalEventStore.getEvents("codex-pane-5");
    // gap イベントが追加されている
    const gapEvents = allEvents.filter(e => e.type === "gap");
    expect(gapEvents.length).toBe(1);
    expect(gapEvents[0].reason).toBe("cursor_exceeded");

    // 新規行 x, y も追加されている
    const outputEvents = allEvents.filter(e => e.type === "output");
    expect(outputEvents.length).toBe(7); // 5 + 2
  });

  it("先頭アンカー行不一致時に再同期する", async () => {
    const deps = makeDeps();

    // 1回目: "anchor" で始まる
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["anchor", "b", ""]);
    await runCaptureTick(deps);

    // 2回目: 先頭が変わった（アンカー不一致）
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["different_anchor", "c", ""]);
    await runCaptureTick(deps);

    const allEvents = deps.terminalEventStore.getEvents("codex-pane-5");
    const gapEvents = allEvents.filter(e => e.type === "gap");
    expect(gapEvents.length).toBe(1);
    expect(gapEvents[0].reason).toBe("anchor_mismatch");
  });

  it("空行のみの差分は無視される", async () => {
    const deps = makeDeps();

    // 1回目: 空行なし
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["line1", ""]);
    await runCaptureTick(deps);

    // 2回目: 空行が追加（実質コンテンツなし）
    (deps.tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValue(["line1", "   ", ""]);
    await runCaptureTick(deps);

    // 空白のみ行は追加されない
    expect(deps.terminalEventStore.getEvents("codex-pane-5")).toHaveLength(1);
  });
});

describe("isCaptureEnabled", () => {
  it("各 CLI の有効/無効が正しく判定される", () => {
    const config = makeConfig({ enableCodex: true, enableCopilot: false, enableClaude: true });
    expect(isCaptureEnabled(config, "codex")).toBe(true);
    expect(isCaptureEnabled(config, "copilot")).toBe(false);
    expect(isCaptureEnabled(config, "claude")).toBe(true);
  });
});

describe("parseHookTimestampMs", () => {
  it("空文字列 → 0", () => {
    expect(parseHookTimestampMs("")).toBe(0);
  });

  it("有効な ISO 8601 → epoch ms", () => {
    const ts = "2026-03-01T00:00:00.000Z";
    expect(parseHookTimestampMs(ts)).toBe(new Date(ts).getTime());
  });

  it("不正文字列 → 0", () => {
    expect(parseHookTimestampMs("invalid")).toBe(0);
    expect(parseHookTimestampMs("abc123")).toBe(0);
  });
});

describe("getRunStartMs", () => {
  it("last_run_started_at が有効な場合 → epoch ms", () => {
    const ts = "2026-03-01T00:00:00.000Z";
    expect(getRunStartMs({ last_run_started_at: ts, last_init_at: "" })).toBe(new Date(ts).getTime());
  });

  it("last_run_started_at が空文字列 → last_init_at にフォールバック", () => {
    const ts = "2026-03-01T01:00:00.000Z";
    expect(getRunStartMs({ last_run_started_at: "", last_init_at: ts })).toBe(new Date(ts).getTime());
  });

  it("両方不正 → 0", () => {
    expect(getRunStartMs({ last_run_started_at: "", last_init_at: "" })).toBe(0);
    expect(getRunStartMs({ last_run_started_at: "invalid", last_init_at: "invalid" })).toBe(0);
  });
});

describe("getHardTimeoutMs", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.COPILOT_HARD_TIMEOUT_MINUTES = process.env.COPILOT_HARD_TIMEOUT_MINUTES;
    savedEnv.CODEX_HARD_TIMEOUT_MINUTES = process.env.CODEX_HARD_TIMEOUT_MINUTES;
    delete process.env.COPILOT_HARD_TIMEOUT_MINUTES;
    delete process.env.CODEX_HARD_TIMEOUT_MINUTES;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("デフォルト: 10分", () => {
    expect(getHardTimeoutMs("copilot")).toBe(10 * 60 * 1000);
    expect(getHardTimeoutMs("codex")).toBe(10 * 60 * 1000);
  });

  it("環境変数で上書き可能", () => {
    process.env.COPILOT_HARD_TIMEOUT_MINUTES = "20";
    expect(getHardTimeoutMs("copilot")).toBe(20 * 60 * 1000);

    process.env.CODEX_HARD_TIMEOUT_MINUTES = "5";
    expect(getHardTimeoutMs("codex")).toBe(5 * 60 * 1000);
  });

  it("不正値はデフォルトにフォールバック", () => {
    process.env.COPILOT_HARD_TIMEOUT_MINUTES = "abc";
    expect(getHardTimeoutMs("copilot")).toBe(10 * 60 * 1000);

    process.env.CODEX_HARD_TIMEOUT_MINUTES = "0";
    expect(getHardTimeoutMs("codex")).toBe(10 * 60 * 1000);
  });
});

describe("parseCaptureConfig feature flags", () => {
  it("フラグ解析: true/TRUE/True/false/FALSE/False/未設定/不正値", () => {
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "true" }).enableCodex).toBe(true);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "TRUE" }).enableCodex).toBe(true);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "True" }).enableCodex).toBe(true);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "false" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "FALSE" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "False" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: undefined }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "yes" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "1" }).enableCodex).toBe(false);
  });
});
