import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPaneMonitorTick, COPILOT_DETECT_COMMANDS, type PaneMonitorDeps } from "./server.js";
import { SessionStore } from "./session-store.js";
import type { TmuxManager, PaneInfo } from "./tmux-manager.js";
import type { HookEvent } from "./types.js";

function makeEvent(overrides: Partial<HookEvent>): HookEvent {
  return {
    event_type: "SessionStart",
    session_id: "s1",
    cwd: "/tmp",
    model: "opus",
    title: "",
    notification_type: "",
    message: "",
    tool_name: "",
    file_path: "",
    prompt: "",
    questions: [],
    last_message: "",
    tmux_pane: "",
    reason: "",
    cli_tool: "",
    transcript_path: "",
    progress_text: "",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTmuxManager(panes: PaneInfo[] | null): TmuxManager {
  return {
    listActivePanesDetailed: vi.fn().mockResolvedValue(panes),
  } as unknown as TmuxManager;
}

function createDeps(overrides?: Partial<PaneMonitorDeps>): PaneMonitorDeps {
  const sessionStore = new SessionStore(vi.fn());
  return {
    tmuxManager: createMockTmuxManager([]),
    sessionStore,
    pendingGroupAssignments: new Map(),
    completeSessionWithCleanup: vi.fn(),
    loggedUnknownCommands: new Set(),
    ...overrides,
  };
}

describe("runPaneMonitorTick", () => {
  it("listActivePanesDetailed が null を返す場合は何もしない", async () => {
    const deps = createDeps({
      tmuxManager: createMockTmuxManager(null),
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
  });

  it("pane が空配列の場合は警告のみ", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([]),
    });
    await runPaneMonitorTick(deps);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no active panes"));
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("ペインが消失したセッションを完了にする", async () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({ session_id: "s1", tmux_pane: "%5" }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%0", command: "bash", currentPath: "/tmp" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).toHaveBeenCalledWith("s1", "tmuxペインが終了しました");
    sessionStore.destroy();
  });

  it("ペインが存在するセッションは完了にしない", async () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({ session_id: "s1", tmux_pane: "%5" }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "claude", currentPath: "/tmp" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("completed セッションは消失チェック対象外", async () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({ session_id: "s1", tmux_pane: "%5" }));
    sessionStore.completeSession("s1", "done");
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%0", command: "bash", currentPath: "/tmp" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });
});

describe("runPaneMonitorTick copilot 自動検出", () => {
  it("セッション未登録の copilot ペインを検出してプレセッションを作成する", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%0", command: "bash", currentPath: "/tmp" },
        { paneId: "%5", command: "copilot", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);

    const session = sessionStore.get("copilot-pane-5");
    expect(session).toBeDefined();
    expect(session!.status).toBe("idle");
    expect(session!.cli_tool).toBe("copilot");
    expect(session!.tmux_pane).toBe("%5");
    expect(session!.cwd).toBe("/workspace");
    sessionStore.destroy();
  });

  it("既にセッション登録済みの copilot ペインには重複作成しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    // 既存セッション
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));
    const callCountBefore = onChange.mock.calls.length;

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "copilot", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);

    // processEvent は追加呼び出しされない（onChange の呼び出し回数が増えない）
    expect(onChange.mock.calls.length).toBe(callCountBefore);
    sessionStore.destroy();
  });

  it("bash や claude 等の非 copilot コマンドにはプレセッション作成しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%0", command: "bash", currentPath: "/tmp" },
        { paneId: "%1", command: "claude", currentPath: "/workspace" },
        { paneId: "%2", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);

    expect(sessionStore.getAll().length).toBe(0);
    sessionStore.destroy();
  });

  it("未知コマンドは初回のみデバッグログ出力", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const loggedUnknownCommands = new Set<string>();
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%0", command: "vim", currentPath: "/tmp" },
      ]),
      sessionStore,
      loggedUnknownCommands,
    });

    // 1回目: ログ出力あり
    await runPaneMonitorTick(deps);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("vim"));

    debugSpy.mockClear();

    // 2回目: 同じコマンドはログ出力なし
    await runPaneMonitorTick(deps);
    expect(debugSpy).not.toHaveBeenCalled();

    sessionStore.destroy();
    debugSpy.mockRestore();
  });

  it("copilot プロセスが終了した（pane は存続）プレセッションを完了にする", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    // copilot プレセッションを作成
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        // pane は存在するが copilot ではなく bash を実行中
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).toHaveBeenCalledWith(
      "copilot-pane-5",
      "copilot プロセス終了を検出しました"
    );
    sessionStore.destroy();
  });

  it("copilot がまだ実行中のプレセッションは完了にしない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "copilot", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("COPILOT_DETECT_COMMANDS に copilot が含まれる", () => {
    expect(COPILOT_DETECT_COMMANDS).toContain("copilot");
  });
});
