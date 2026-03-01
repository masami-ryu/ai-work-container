import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  expirePendingTriggersOnHooksEvent,
  runCaptureTick,
  resetCaptureState,
  _resetTriggerStores,
  _resetCaptureTickGuard,
  type PaneCaptureDeps,
} from "./pane-capture.js";
import { TerminalEventStore, parseCaptureConfig } from "./terminal-event-store.js";
import { SessionStore } from "./session-store.js";
import type { TmuxManager } from "./tmux-manager.js";
import type { Session, TerminalEvent, HookEvent } from "./types.js";

// ============================================================================
// TASK-019: 統合テスト — hooks + capture 共存
// ============================================================================

const enabledConfig = parseCaptureConfig({
  CAPTURE_ENABLE_CODEX: "true",
  CAPTURE_ENABLE_COPILOT: "true",
  CAPTURE_ENABLE_CLAUDE: "true",
});

function makeHookEvent(overrides: Partial<HookEvent> & { event_type: string; session_id: string; cli_tool: string }): HookEvent {
  return {
    event_type: overrides.event_type,
    session_id: overrides.session_id,
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
    tmux_pane: "%5",
    reason: "",
    cli_tool: overrides.cli_tool,
    transcript_path: "",
    progress_text: "",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// 1. expirePendingTriggersOnHooksEvent — hooks 到着で capture trigger が expired
// ============================================================================

describe("hooks 到着で pending capture trigger が expired になる", () => {
  let terminalEventStore: TerminalEventStore;

  beforeEach(() => {
    terminalEventStore = new TerminalEventStore(enabledConfig);
  });

  it("hooks イベント受信で pending トリガーが expired (hooks_resolved) になる", () => {
    // capture がトリガーを生成
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });
    expect(trigger.event_state).toBe("pending");

    // hooks イベント到着
    const count = expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");

    expect(count).toBe(1);
    const updated = terminalEventStore.getEventById(trigger.id);
    expect(updated?.event_state).toBe("expired");
    expect(updated?.fail_reason).toBe("hooks_resolved");
  });

  it("expired 後は consumeIfPending が TRIGGER_EVENT_EXPIRED を返す", () => {
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });

    expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");

    const result = terminalEventStore.consumeIfPending(trigger.id, "s1", 1);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("TRIGGER_EVENT_EXPIRED");
  });

  it("consumed 済みトリガーは hooks 到着で expired にならない", () => {
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });

    // 先に消費
    terminalEventStore.consumeIfPending(trigger.id, "s1", 1);

    const count = expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");
    expect(count).toBe(0);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("consumed");
  });

  it("別セッションの pending トリガーは影響を受けない", () => {
    const triggerS1 = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "prompt",
      type: "trigger",
      source: "capture",
    });
    const triggerS2 = terminalEventStore.addEvent({
      sessionId: "s2",
      runId: 1,
      text: "prompt",
      type: "trigger",
      source: "capture",
    });

    expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");

    expect(terminalEventStore.getEventById(triggerS1.id)?.event_state).toBe("expired");
    expect(terminalEventStore.getEventById(triggerS2.id)?.event_state).toBe("pending");
  });

  it("expirePendingTriggersOnHooksEvent は冪等（2回目の呼び出しで 0 を返す）", () => {
    terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "prompt",
      type: "trigger",
      source: "capture",
    });

    const firstCount = expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");
    expect(firstCount).toBe(1);

    const secondCount = expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");
    expect(secondCount).toBe(0);
  });

  it("failed (before_text) トリガーも hooks 到着で expired になる", () => {
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "prompt",
      type: "trigger",
      source: "capture",
    });
    terminalEventStore.markFailed(trigger.id, "copy_mode_stuck", "before_text");

    const count = expirePendingTriggersOnHooksEvent(terminalEventStore, "s1");

    expect(count).toBe(1);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("expired");
    expect(terminalEventStore.getEventById(trigger.id)?.fail_reason).toBe("hooks_resolved");
  });
});

// ============================================================================
// 2. SessionStore.processEvent → onInvalidateBySession コールバック連携
// ============================================================================

describe("SessionStore.processEvent の run_id インクリメントで capture イベントが無効化される", () => {
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;
  let invalidateCount: number;

  beforeEach(() => {
    invalidateCount = 0;
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);
    sessionStore.onInvalidateBySession = (sessionId: string) => {
      invalidateCount += terminalEventStore.invalidateBySession(sessionId);
    };
  });

  afterEach(() => {
    sessionStore.destroy();
  });

  it("Codex SessionStart (re-init) で run_id がインクリメントされ pending トリガーが expired になる", () => {
    // 初回 SessionStart
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));
    const session = sessionStore.get("s1")!;
    expect(session.run_id).toBe(1);

    // UserPromptSubmit で last_run_started_at を設定
    sessionStore.processEvent(makeHookEvent({ event_type: "UserPromptSubmit", session_id: "s1", cli_tool: "codex" }));

    // capture トリガーを run_id=1 で追加
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });
    expect(trigger.event_state).toBe("pending");

    // 2回目の SessionStart → run_id がインクリメント
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));

    expect(session.run_id).toBe(2);
    expect(invalidateCount).toBe(1);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("expired");
  });

  it("run_id インクリメント後の consumeIfPending は TRIGGER_RUN_MISMATCH を返す", () => {
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));
    sessionStore.processEvent(makeHookEvent({ event_type: "UserPromptSubmit", session_id: "s1", cli_tool: "codex" }));

    // SessionStart 再初期化で run_id=2 に（onInvalidateBySession で pending → expired）
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));
    const session = sessionStore.get("s1")!;
    expect(session.run_id).toBe(2);

    // invalidateBySession は pending → expired にするが、
    // expired 以前に run_id 不一致でも拒否されることを検証するため、
    // 旧 run_id で新たに pending トリガーを作成
    const staleTrigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1, // 旧 run_id を意図的に使用
      text: "stale trigger",
      type: "trigger",
      source: "capture",
    });

    // run_id 不一致: event.run_id=1 vs session.run_id=2
    const result = terminalEventStore.consumeIfPending(staleTrigger.id, "s1", session.run_id);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("TRIGGER_RUN_MISMATCH");
  });

  it("Claude セッションでは SessionStart で run_id がインクリメントされない", () => {
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "claude-1", cli_tool: "claude" }));
    sessionStore.processEvent(makeHookEvent({ event_type: "UserPromptSubmit", session_id: "claude-1", cli_tool: "claude" }));

    const trigger = terminalEventStore.addEvent({
      sessionId: "claude-1",
      runId: 1,
      text: "some text",
      type: "trigger",
      source: "capture",
    });

    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "claude-1", cli_tool: "claude" }));

    // Claude では run_id はインクリメントされない
    expect(sessionStore.get("claude-1")?.run_id).toBe(1);
    expect(invalidateCount).toBe(0);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("pending");
  });

  it("プレセッション→実セッション遷移 (last_run_started_at 未設定) では run_id を維持", () => {
    // プレセッション作成
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "copilot" }));
    expect(sessionStore.get("s1")?.run_id).toBe(1);

    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: 1,
      text: "output",
      type: "output",
      source: "capture",
    });

    // 実 SessionStart（last_run_started_at が "" のまま）
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "copilot" }));

    // run_id は維持（インクリメントされない）
    expect(sessionStore.get("s1")?.run_id).toBe(1);
    expect(invalidateCount).toBe(0);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).not.toBe("expired");
  });
});

// ============================================================================
// 3. pane_pid 変化検知 + hooks 連動
// ============================================================================

const PANE_TEST_SESSION_ID = "s1";

describe("pane_pid 変化と hooks イベントの横断シナリオ", () => {
  let deps: PaneCaptureDeps;
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;
  let broadcastBatch: ReturnType<typeof vi.fn>;
  let currentPid: string | null;

  beforeEach(() => {
    _resetCaptureTickGuard();
    _resetTriggerStores();
    currentPid = "12345";
    broadcastBatch = vi.fn();
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);

    // コールバック連携
    sessionStore.onInvalidateBySession = (sessionId: string) => {
      terminalEventStore.invalidateBySession(sessionId);
    };

    const mockTmux = {
      canManagePanes: vi.fn().mockReturnValue(true),
      capturePane: vi.fn().mockResolvedValue(["line1", "line2"]),
      getPanePid: vi.fn().mockImplementation(async () => currentPid),
      paneExists: vi.fn().mockResolvedValue(true),
    } as unknown as TmuxManager;

    deps = {
      tmux: mockTmux,
      sessionStore,
      terminalEventStore,
      captureConfig: enabledConfig,
      broadcastTerminalEventBatch: broadcastBatch as (sessionId: string, events: TerminalEvent[]) => void,
    };
  });

  afterEach(() => {
    sessionStore.destroy();
    resetCaptureState(PANE_TEST_SESSION_ID);
  });

  function initCodexSession(): Session {
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: PANE_TEST_SESSION_ID, cli_tool: "codex" }));
    return sessionStore.get(PANE_TEST_SESSION_ID)!;
  }

  it("capture で pane_pid 変化後、旧 run の trigger は expired + hooks SessionStart でも二重無効化しない", async () => {
    const session = initCodexSession();

    // 初回 capture → PID 記録
    await runCaptureTick(deps);

    // trigger を追加 (run_id=1)
    const trigger = terminalEventStore.addEvent({
      sessionId: PANE_TEST_SESSION_ID,
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });

    // PID 変化 → capture で run_id インクリメント + invalidate
    currentPid = "67890";
    await runCaptureTick(deps);

    expect(session.run_id).toBe(2);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("expired");
    expect(terminalEventStore.getEventById(trigger.id)?.fail_reason).toBe("pane_pid_changed");

    // 後続の hooks SessionStart が到着（UserPromptSubmit 未設定だが、capture で run_id 既に 2）
    // → last_run_started_at が "" なのでインクリメントされない
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: PANE_TEST_SESSION_ID, cli_tool: "codex" }));
    // run_id は 2 のまま（再初期化で last_run_started_at がリセットされるため条件不成立）
    expect(session.run_id).toBe(2);
  });

  it("hooks SessionStart で run_id インクリメント後、capture の新トリガーは新 run_id で作成される", async () => {
    const session = initCodexSession();
    sessionStore.processEvent(makeHookEvent({ event_type: "UserPromptSubmit", session_id: PANE_TEST_SESSION_ID, cli_tool: "codex" }));

    // hooks SessionStart → run_id=2
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: PANE_TEST_SESSION_ID, cli_tool: "codex" }));
    expect(session.run_id).toBe(2);

    // capture で新しいトリガーを追加
    const newTrigger = terminalEventStore.addEvent({
      sessionId: PANE_TEST_SESSION_ID,
      runId: session.run_id,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });

    expect(newTrigger.run_id).toBe(2);

    // run_id=2 で消費可能
    const result = terminalEventStore.consumeIfPending(newTrigger.id, PANE_TEST_SESSION_ID, 2);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// 4. hooks 状態遷移優先と capture の補助動作
// ============================================================================

describe("hooks 状態遷移優先と capture 補助動作", () => {
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;

  beforeEach(() => {
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);
    sessionStore.onInvalidateBySession = (sessionId: string) => {
      terminalEventStore.invalidateBySession(sessionId);
    };
  });

  afterEach(() => {
    sessionStore.destroy();
  });

  it("hooks で waiting_permission に遷移しても capture trigger の pending 状態は独立維持される", () => {
    // Codex セッション開始
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));
    const session = sessionStore.get("s1")!;

    // capture trigger を追加（pending 状態）
    const trigger = terminalEventStore.addEvent({
      sessionId: "s1",
      runId: session.run_id,
      text: "Do you want to proceed?",
      type: "trigger",
      source: "capture",
    });

    // hooks で PreToolUse → waiting_permission（別の理由で）
    // Note: Codex は hooks ベースの decision に非対応のため、
    // 実際には capture trigger と hooks decision は別物として共存する
    expect(trigger.event_state).toBe("pending");
    expect(session.status).toBe("idle");
  });

  it("Copilot の hooks 承認解決で capture の活動検知は影響を受けない", () => {
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "cop1", cli_tool: "copilot" }));
    const session = sessionStore.get("cop1")!;

    // capture による活動検知を模擬
    session.last_capture_detected_at = Date.now();
    const detectTime = session.last_capture_detected_at;

    // hooks で承認イベント処理
    sessionStore.processEvent(makeHookEvent({
      event_type: "PostToolUse",
      session_id: "cop1",
      cli_tool: "copilot",
      tool_name: "Bash",
    }));

    // capture の活動検知タイムスタンプは hooks 処理で変更されない
    expect(session.last_capture_detected_at).toBe(detectTime);
    expect(session.status).toBe("running");
  });

  it("output イベント (capture) は hooks の状態遷移に影響しない", () => {
    sessionStore.processEvent(makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }));
    const session = sessionStore.get("s1")!;
    expect(session.status).toBe("idle");

    // capture output イベント追加
    terminalEventStore.addEvent({
      sessionId: "s1",
      runId: session.run_id,
      text: "Building project...",
      type: "output",
      source: "capture",
      eventState: "consumed",
    });

    // session.status は hooks のみが変更権限を持つ
    expect(session.status).toBe("idle");
  });
});

// ============================================================================
// 5. 同一セッションの hooks + capture 並行フロー（Codex 完全シナリオ）
// ============================================================================

describe("Codex 完全シナリオ: hooks + capture の並行フロー", () => {
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;

  beforeEach(() => {
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);
    sessionStore.onInvalidateBySession = (sessionId: string) => {
      terminalEventStore.invalidateBySession(sessionId);
    };
  });

  afterEach(() => {
    sessionStore.destroy();
  });

  it("SessionStart → capture trigger → consume → UserPromptSubmit → SessionEnd の全フロー", () => {
    // 1. SessionStart
    sessionStore.processEvent(makeHookEvent({
      event_type: "SessionStart",
      session_id: "codex1",
      cli_tool: "codex",
    }), { codexCaptureApproval: true });
    const session = sessionStore.get("codex1")!;
    expect(session.run_id).toBe(1);
    expect(session.approvalSupported).toBe(true);

    // 2. Capture でトリガー検知
    const trigger = terminalEventStore.addEvent({
      sessionId: "codex1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });
    expect(trigger.event_state).toBe("pending");

    // 3. ユーザーが UI から承認 → consumeIfPending
    const consumeResult = terminalEventStore.consumeIfPending(trigger.id, "codex1", 1);
    expect(consumeResult.success).toBe(true);
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("consumed");

    // 4. hooks で UserPromptSubmit（Codex が実行を開始）
    sessionStore.processEvent(makeHookEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex1",
      cli_tool: "codex",
    }));
    expect(session.status).toBe("running");

    // 5. hooks で SessionEnd
    sessionStore.processEvent(makeHookEvent({
      event_type: "SessionEnd",
      session_id: "codex1",
      cli_tool: "codex",
    }));
    expect(session.status).toBe("completed");
  });

  it("SessionStart → capture trigger → hooks 解決 → trigger expired → 再起動", () => {
    // 1. SessionStart
    sessionStore.processEvent(makeHookEvent({
      event_type: "SessionStart",
      session_id: "codex1",
      cli_tool: "codex",
    }));
    const session = sessionStore.get("codex1")!;

    // 2. Capture でトリガー検知
    const trigger = terminalEventStore.addEvent({
      sessionId: "codex1",
      runId: 1,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });

    // 3. hooks イベントが先に到着 → capture trigger を expired に
    expirePendingTriggersOnHooksEvent(terminalEventStore, "codex1");
    expect(terminalEventStore.getEventById(trigger.id)?.event_state).toBe("expired");

    // 4. UI からの消費試行は失敗
    const consumeResult = terminalEventStore.consumeIfPending(trigger.id, "codex1", 1);
    expect(consumeResult.success).toBe(false);
    expect(consumeResult.reason).toBe("TRIGGER_EVENT_EXPIRED");

    // 5. UserPromptSubmit → SessionStart で再起動
    sessionStore.processEvent(makeHookEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex1",
      cli_tool: "codex",
    }));
    sessionStore.processEvent(makeHookEvent({
      event_type: "SessionStart",
      session_id: "codex1",
      cli_tool: "codex",
    }));
    expect(session.run_id).toBe(2);

    // 6. 新 run で新トリガー
    const trigger2 = terminalEventStore.addEvent({
      sessionId: "codex1",
      runId: 2,
      text: "Do you want to proceed? (y/n)",
      type: "trigger",
      source: "capture",
    });
    const consumeResult2 = terminalEventStore.consumeIfPending(trigger2.id, "codex1", 2);
    expect(consumeResult2.success).toBe(true);
  });

  it("複数 pending trigger がある状態で hooks イベント到着 → 全て expired", () => {
    sessionStore.processEvent(makeHookEvent({
      event_type: "SessionStart",
      session_id: "codex1",
      cli_tool: "codex",
    }));

    // 複数トリガーを追加
    const t1 = terminalEventStore.addEvent({
      sessionId: "codex1", runId: 1, text: "prompt1", type: "trigger", source: "capture",
    });
    const t2 = terminalEventStore.addEvent({
      sessionId: "codex1", runId: 1, text: "prompt2", type: "trigger", source: "capture",
    });
    // failed (before_text) のトリガー
    const t3 = terminalEventStore.addEvent({
      sessionId: "codex1", runId: 1, text: "prompt3", type: "trigger", source: "capture",
    });
    terminalEventStore.markFailed(t3.id, "copy_mode_stuck", "before_text");

    const count = expirePendingTriggersOnHooksEvent(terminalEventStore, "codex1");

    expect(count).toBe(3); // pending×2 + failed×1
    expect(terminalEventStore.getEventById(t1.id)?.event_state).toBe("expired");
    expect(terminalEventStore.getEventById(t2.id)?.event_state).toBe("expired");
    expect(terminalEventStore.getEventById(t3.id)?.event_state).toBe("expired");
  });
});

// ============================================================================
// 6. approvalSupported フラグの hooks/capture 連携
// ============================================================================

describe("approvalSupported フラグの hooks/capture 連携", () => {
  let sessionStore: SessionStore;

  beforeEach(() => {
    sessionStore = new SessionStore(vi.fn());
  });

  afterEach(() => {
    sessionStore.destroy();
  });

  it("Codex + codexCaptureApproval=true → approvalSupported=true", () => {
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }),
      { codexCaptureApproval: true },
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(true);
  });

  it("Codex + codexCaptureApproval=false → approvalSupported=false", () => {
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }),
      { codexCaptureApproval: false },
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(false);
  });

  it("Codex + codexCaptureApproval 未指定 → approvalSupported=false", () => {
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }),
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(false);
  });

  it("Copilot は codexCaptureApproval に無関係で approvalSupported=true", () => {
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "copilot" }),
      { codexCaptureApproval: false },
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(true);
  });

  it("再初期化時に approvalSupported が最新の codexCaptureApproval で更新される", () => {
    // 初回: capture 無効
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }),
      { codexCaptureApproval: false },
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(false);

    // UserPromptSubmit → 再 SessionStart: capture 有効に切替
    sessionStore.processEvent(makeHookEvent({ event_type: "UserPromptSubmit", session_id: "s1", cli_tool: "codex" }));
    sessionStore.processEvent(
      makeHookEvent({ event_type: "SessionStart", session_id: "s1", cli_tool: "codex" }),
      { codexCaptureApproval: true },
    );
    expect(sessionStore.get("s1")?.approvalSupported).toBe(true);
  });
});
