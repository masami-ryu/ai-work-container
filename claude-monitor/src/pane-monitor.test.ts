import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPaneMonitorTick, COPILOT_AUTO_DETECT_COMMANDS, COPILOT_ALIVE_COMMANDS, COPILOT_GRACE_PERIOD_MS, COPILOT_HOOK_TIMEOUT_MS, COPILOT_NO_HOOK_TIMEOUT_MS, COPILOT_NO_HOOK_HARD_TIMEOUT_MS, type PaneMonitorDeps } from "./server.js";
import { SessionStore } from "./session-store.js";
import { DecisionStore } from "./decision-store.js";
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

function createMockDecisionStore(): DecisionStore {
  return new DecisionStore({
    onDecisionPending: vi.fn(),
    onDecisionResolved: vi.fn(),
    onDecisionTimeout: vi.fn(),
  });
}

function createDeps(overrides?: Partial<PaneMonitorDeps>): PaneMonitorDeps {
  const sessionStore = new SessionStore(vi.fn());
  return {
    tmuxManager: createMockTmuxManager([]),
    sessionStore,
    decisionStore: createMockDecisionStore(),
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

  it("copilot プロセスが終了した（pane は存続）+ フックタイムアウト経過でプレセッションを完了にする", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    // copilot プレセッションを作成（古い last_init_at でグレースピリオド超過を模擬）
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // フック通信を設定（古い時刻でタイムアウト超過を模擬）
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 1000).toISOString();

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

  it("pane_current_command が 'node' + フック通信が新鮮 → セッションをアクティブ維持", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // node コマンド + 直近フック通信 → commandAlive && isFreshByHook でアクティブ維持
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - 10000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("pane_current_command が 'node' + running + フック通信タイムアウト → セッションを完了にする", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // running 状態にする（idle + commandAlive はスキップされるため）
    sessionStore.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      prompt: "fix bug",
    }));
    // node コマンドだがフック通信が途絶 → タイムアウト判定で完了
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 1000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
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

  it("グレースピリオド中はコマンド不一致でも完了しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    // 直近に作成（グレースピリオド内）
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("non-Copilot の Node プロセスで自動プレセッション作成しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(sessionStore.getAll().length).toBe(0);
    sessionStore.destroy();
  });

  it("last_hook_at 未設定 + コマンド不一致 + COPILOT_NO_HOOK_TIMEOUT_MS 経過でセッション完了", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_NO_HOOK_TIMEOUT_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // last_hook_at は空文字列のまま
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
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

  it("last_hook_at 未設定 + commandAlive + COPILOT_NO_HOOK_TIMEOUT_MS 経過でもセッションを完了にしない（send-keys フォールバック整合）", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_NO_HOOK_TIMEOUT_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // last_hook_at は未設定、かつ copilot コマンドが生存中
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

  it("last_hook_at 未設定 + commandAlive (node) + COPILOT_NO_HOOK_TIMEOUT_MS 経過でもセッションを維持（hard timeout 未到達）", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_NO_HOOK_TIMEOUT_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("last_hook_at 未設定 + commandAlive (node) + running + COPILOT_NO_HOOK_HARD_TIMEOUT_MS 経過でセッション完了", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_NO_HOOK_HARD_TIMEOUT_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // running 状態にする（idle + commandAlive はスキップされるため）
    sessionStore.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      prompt: "fix bug",
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).toHaveBeenCalledWith("copilot-pane-5", "copilot フック未到達タイムアウト");
    sessionStore.destroy();
  });

  it("last_hook_at 未設定 + コマンド不一致 + COPILOT_NO_HOOK_TIMEOUT_MS 未経過でアクティブ維持", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    // グレースピリオドは超えるが no-hook タイムアウトは未達
    const time = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: time,
    }));
    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("decision pending 中は command 不一致でも完了しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const decisionStore = createMockDecisionStore();
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 1000).toISOString();

    // pending decision を登録
    decisionStore.register({
      correlation_id: "dec-1",
      session_id: "copilot-pane-5",
      decision_type: "permission",
      tool_name: "Bash",
      tool_input: {},
      timestamp: new Date().toISOString(),
    });

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("stale pending decision（waitForDecision 未実行）は cleanup 後にセッション完了を阻害しない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const onTimeout = vi.fn();
    const decisionStore = new DecisionStore({
      onDecisionPending: vi.fn(),
      onDecisionResolved: vi.fn(),
      onDecisionTimeout: onTimeout,
    });
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 1000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 1000).toISOString();

    // stale pending decision を登録（waitForDecision は呼ばない）
    const staleTimestamp = new Date(Date.now() - 301_000).toISOString();
    decisionStore.register({
      correlation_id: "stale-dec",
      session_id: "copilot-pane-5",
      decision_type: "permission",
      tool_name: "Bash",
      tool_input: {},
      timestamp: staleTimestamp,
    });

    // cleanup 前: pending があるので完了しない
    let deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();

    // DecisionStore cleanup を発火（30秒進める）
    vi.advanceTimersByTime(30_000);

    // cleanup 後: stale pending が timeout 化されたので完了する
    expect(decisionStore.getPending().filter(d => d.session_id === "copilot-pane-5")).toHaveLength(0);
    deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).toHaveBeenCalledWith(
      "copilot-pane-5",
      "copilot プロセス終了を検出しました"
    );

    sessionStore.destroy();
    decisionStore.destroy();
    vi.useRealTimers();
  });

  it("COPILOT_AUTO_DETECT_COMMANDS に copilot が含まれる", () => {
    expect(COPILOT_AUTO_DETECT_COMMANDS).toContain("copilot");
  });

  it("COPILOT_ALIVE_COMMANDS に copilot と node が含まれる", () => {
    expect(COPILOT_ALIVE_COMMANDS).toContain("copilot");
    expect(COPILOT_ALIVE_COMMANDS).toContain("node");
  });
});

describe("idle Copilot セッションの pane monitor フックタイムアウトスキップ", () => {
  it("idle + commandAlive (copilot) + フックタイムアウト超過 → 完了しない（次のプロンプト待ち）", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    // SessionEnd(reason=complete) 後の idle 状態を再現
    sessionStore.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      prompt: "fix bug",
    }));
    sessionStore.processEvent(makeEvent({
      event_type: "SessionEnd",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      reason: "complete",
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(false);
    // フック通信は SessionEnd 時点で止まっている（タイムアウト超過を模擬）
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "copilot", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    expect(session.prompt_ready).toBe(true);
    sessionStore.destroy();
  });

  it("idle + commandAlive (node) + フックタイムアウト超過 → 完了しない", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    sessionStore.processEvent(makeEvent({
      event_type: "SessionEnd",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      reason: "complete",
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    expect(session.prompt_ready).toBe(false);
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "node", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    expect(session.prompt_ready).toBe(true);
    sessionStore.destroy();
  });

  it("idle + コマンド不一致 (bash) + フックタイムアウト超過 → 完了する（プロセス終了検出）", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    sessionStore.processEvent(makeEvent({
      event_type: "SessionEnd",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      reason: "complete",
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
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

  it("running + commandAlive + フックタイムアウト超過 → 完了する（idle スキップは適用されない）", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    sessionStore.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      prompt: "fix bug",
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("running");
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "copilot", currentPath: "/workspace" },
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
});

describe("Phase 4 統合回帰テスト（Pane Monitor）", () => {
  it("フック通信ベース判定: last_hook_at 60秒超過 + コマンド不一致 → 完了", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
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

  it("フック通信ベース判定: last_hook_at 60秒未満 + コマンド不一致 → アクティブ維持", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const oldTime = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
      timestamp: oldTime,
    }));
    const session = sessionStore.get("copilot-pane-5")!;
    // 最近のフック通信
    session.last_hook_at = new Date(Date.now() - 10000).toISOString();

    const deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
    });

    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();
    sessionStore.destroy();
  });

  it("グレースピリオド + フック通信 + decision pending の複合条件テスト", async () => {
    const onChange = vi.fn();
    const sessionStore = new SessionStore(onChange);
    const decisionStore = createMockDecisionStore();

    // ケース1: グレースピリオド内 → 完了しない
    sessionStore.processEvent(makeEvent({
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));
    let deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();

    // ケース2: グレースピリオド超過 + decision pending → 完了しない
    const session = sessionStore.get("copilot-pane-5")!;
    session.last_init_at = new Date(Date.now() - COPILOT_GRACE_PERIOD_MS - 5000).toISOString();
    session.last_hook_at = new Date(Date.now() - COPILOT_HOOK_TIMEOUT_MS - 5000).toISOString();
    decisionStore.register({
      correlation_id: "dec-1",
      session_id: "copilot-pane-5",
      decision_type: "permission",
      tool_name: "Bash",
      tool_input: {},
      timestamp: new Date().toISOString(),
    });
    deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).not.toHaveBeenCalled();

    // ケース3: decision を解決 → フックタイムアウト超過 → 完了する
    decisionStore.respond("dec-1", "allow");
    deps = createDeps({
      tmuxManager: createMockTmuxManager([
        { paneId: "%5", command: "bash", currentPath: "/workspace" },
      ]),
      sessionStore,
      decisionStore,
    });
    await runPaneMonitorTick(deps);
    expect(deps.completeSessionWithCleanup).toHaveBeenCalledWith(
      "copilot-pane-5",
      "copilot プロセス終了を検出しました"
    );

    sessionStore.destroy();
    decisionStore.destroy();
  });
});
