import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  maskSensitiveData,
  loadMaskPatterns,
  _resetMaskPatterns,
  detectCodexApprovalPrompt,
  dismissTrigger,
  _resetTriggerStores,
  resetCaptureState,
  runCaptureTick,
  type PaneCaptureDeps,
  _resetCaptureTickGuard,
} from "./pane-capture.js";
import { TerminalEventStore, parseCaptureConfig } from "./terminal-event-store.js";
import { SessionStore } from "./session-store.js";
import type { TmuxManager } from "./tmux-manager.js";
import type { Session, TerminalEvent } from "./types.js";

// ============================================================================
// TASK-007c: 機密情報マスク処理テスト
// ============================================================================

describe("maskSensitiveData", () => {
  const builtinPatterns = loadMaskPatterns("/nonexistent");

  it("API_KEY=value をマスクする", () => {
    const result = maskSensitiveData("API_KEY=sk-1234abcd", builtinPatterns);
    expect(result).toBe("API_KEY=***MASKED***");
  });

  it("SECRET_KEY: value をマスクする", () => {
    const result = maskSensitiveData("SECRET_KEY: mysecret123", builtinPatterns);
    // lookbehind は [=:]\s* を含むので、区切り以降全体がマスクされる
    expect(result).toContain("***MASKED***");
    expect(result).not.toContain("mysecret123");
  });

  it("Bearer トークンをマスクする", () => {
    const result = maskSensitiveData("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxx", builtinPatterns);
    expect(result).toBe("Authorization: Bearer ***MASKED***");
  });

  it("AWS アクセスキーをマスクする", () => {
    const result = maskSensitiveData("key=AKIAIOSFODNN7EXAMPLE", builtinPatterns);
    expect(result).toBe("key=***MASKED***");
  });

  it("TOKEN=value をマスクする", () => {
    const result = maskSensitiveData("TOKEN=abc123xyz", builtinPatterns);
    expect(result).toBe("TOKEN=***MASKED***");
  });

  it("PASSWORD: value をマスクする", () => {
    const result = maskSensitiveData("PASSWORD: hunter2", builtinPatterns);
    expect(result).toContain("***MASKED***");
    expect(result).not.toContain("hunter2");
  });

  it("通常テキストはマスクしない", () => {
    const text = "Hello, this is a normal log line";
    const result = maskSensitiveData(text, builtinPatterns);
    expect(result).toBe(text);
  });

  it("SSH 秘密鍵をマスクする", () => {
    const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    const result = maskSensitiveData(text, builtinPatterns);
    expect(result).toBe("***MASKED***");
  });

  it("複数パターンが同時にマスクされる", () => {
    const text = "API_KEY=secret123 Bearer mytoken";
    const result = maskSensitiveData(text, builtinPatterns);
    expect(result).toContain("***MASKED***");
    expect(result).not.toContain("secret123");
    expect(result).not.toContain("mytoken");
  });
});

describe("loadMaskPatterns", () => {
  it("設定ファイルが存在しない場合はビルトインのみ返す", () => {
    const patterns = loadMaskPatterns("/nonexistent");
    expect(patterns.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// TASK-008: Codex 承認プロンプト検知テスト
// ============================================================================

describe("detectCodexApprovalPrompt", () => {
  // 正例: 検知されるべきパターン
  describe("正例（検知されるべき）", () => {
    const positiveExamples = [
      "Do you want to proceed? (y/n)",
      "Do you want to proceed? (yes/no)",
      "Do you want to proceed? (y/n/yes_always)",
      "Apply this patch? (y/n)",
      "Apply patch? (y/n)",
      "Apply this change? (y/n)",
      "Apply this diff? (y/n)",
      "Allow Bash? (y/n)",
      "Allow Write? (y/n)",
      "Allow Edit? (y/n)",
      "Allow Read? (y/n)",
      "Allow execute command? (y/n)",
      "Some context here? (y/n)",
      "Run this command? (yes/no)",
    ];

    for (const example of positiveExamples) {
      it(`検知: "${example}"`, () => {
        const lines = ["some context", "tool info", example];
        const result = detectCodexApprovalPrompt(lines);
        expect(result).not.toBeNull();
      });
    }
  });

  // 負例: 検知されるべきでないパターン
  describe("負例（検知されるべきでない）", () => {
    const negativeExamples = [
      "Hello, how are you?",
      "Running tests...",
      "All tests passed",
      "Error: connection refused",
      "Build completed successfully",
      "npm install finished",
      "git status",
      "Compiling TypeScript...",
      "Function executed successfully",
      "Deployment complete",
    ];

    for (const example of negativeExamples) {
      it(`非検知: "${example}"`, () => {
        const lines = ["some context", example];
        const result = detectCodexApprovalPrompt(lines);
        expect(result).toBeNull();
      });
    }
  });

  it("末尾10行以内にマッチがある場合のみ検知する", () => {
    const lines = Array(20).fill("normal line");
    lines[5] = "Do you want to proceed? (y/n)"; // 先頭寄り
    expect(detectCodexApprovalPrompt(lines)).toBeNull(); // 末尾10行外

    lines[15] = "Do you want to proceed? (y/n)"; // 末尾寄り
    expect(detectCodexApprovalPrompt(lines)).not.toBeNull();
  });

  it("空配列ではnullを返す", () => {
    expect(detectCodexApprovalPrompt([])).toBeNull();
  });
});

// ============================================================================
// TASK-024: pane_pid 変化検知テスト
// ============================================================================

describe("pane_pid 変化検知", () => {
  let deps: PaneCaptureDeps;
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;
  let mockTmux: TmuxManager;
  let broadcastBatch: ReturnType<typeof vi.fn>;
  let currentPid: string | null;

  const enabledConfig = parseCaptureConfig({
    CAPTURE_ENABLE_CODEX: "true",
    CAPTURE_ENABLE_COPILOT: "true",
    CAPTURE_ENABLE_CLAUDE: "true",
  });

  beforeEach(() => {
    _resetCaptureTickGuard();
    _resetTriggerStores();

    currentPid = "12345";
    broadcastBatch = vi.fn();
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);

    mockTmux = {
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
    resetCaptureState("s1");
  });

  function makeSession(): Session {
    sessionStore.processEvent({
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
      tmux_pane: "%5",
      reason: "",
      cli_tool: "codex",
      transcript_path: "",
      progress_text: "",
      timestamp: new Date().toISOString(),
    });
    return sessionStore.get("s1")!;
  }

  it("PID 変化時に run_id がインクリメントされる", async () => {
    const session = makeSession();
    const initialRunId = session.run_id;

    // 1回目のキャプチャ: PID 記録
    await runCaptureTick(deps);

    // PID を変更
    currentPid = "67890";

    // 2回目のキャプチャ: PID 変化検知
    await runCaptureTick(deps);

    expect(session.run_id).toBe(initialRunId + 1);
  });

  it("PID 変化なしでは run_id は変わらない", async () => {
    const session = makeSession();
    const initialRunId = session.run_id;

    await runCaptureTick(deps);
    await runCaptureTick(deps);

    expect(session.run_id).toBe(initialRunId);
  });

  it("PID が null の場合は変化検知をスキップする", async () => {
    const session = makeSession();
    const initialRunId = session.run_id;

    currentPid = null;
    await runCaptureTick(deps);
    await runCaptureTick(deps);

    expect(session.run_id).toBe(initialRunId);
  });
});

// ============================================================================
// TASK-010: 誤検知保護テスト
// ============================================================================

describe("誤検知保護", () => {
  let deps: PaneCaptureDeps;
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;
  let mockTmux: TmuxManager;
  let broadcastBatch: ReturnType<typeof vi.fn>;

  const enabledConfig = parseCaptureConfig({
    CAPTURE_ENABLE_CODEX: "true",
    CAPTURE_ENABLE_COPILOT: "true",
    CAPTURE_ENABLE_CLAUDE: "true",
  });

  beforeEach(() => {
    _resetCaptureTickGuard();
    _resetTriggerStores();

    broadcastBatch = vi.fn();
    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(enabledConfig);

    mockTmux = {
      canManagePanes: vi.fn().mockReturnValue(true),
      capturePane: vi.fn().mockResolvedValue([
        "Running command...",
        "Do you want to proceed? (y/n)",
      ]),
      getPanePid: vi.fn().mockResolvedValue("12345"),
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
    resetCaptureState("codex-s1");
  });

  function makeCodexSession(): Session {
    sessionStore.processEvent({
      event_type: "SessionStart",
      session_id: "codex-s1",
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
      cli_tool: "codex",
      transcript_path: "",
      progress_text: "",
      timestamp: new Date().toISOString(),
    });
    return sessionStore.get("codex-s1")!;
  }

  it("cooldown 中は同じセッションでトリガーが再発火しない", async () => {
    makeCodexSession();

    // 1回目: トリガー発火
    await runCaptureTick(deps);
    const firstCallCount = broadcastBatch.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // 2回目: cooldown 中なので追加トリガーなし（output イベントのみ）
    resetCaptureState("codex-s1"); // カーソルリセットで再度行取得させる
    await runCaptureTick(deps);

    // トリガーイベント（type: "trigger"）の配信回数を確認
    // cooldown 中は trigger タイプのイベントが追加されない
    const triggerBroadcasts = broadcastBatch.mock.calls.filter((call: unknown[]) => {
      const events = call[1] as TerminalEvent[];
      return events.some(e => e.type === "trigger");
    });
    // 最初の1回のみ
    expect(triggerBroadcasts.length).toBe(1);
  });

  it("dismiss されたパターンはトリガーが発火しない", async () => {
    // 先に dismiss 登録
    dismissTrigger("codex-s1", "Do you want to proceed? (y/n)");
    makeCodexSession();

    await runCaptureTick(deps);

    // trigger タイプのイベントは配信されない
    const triggerBroadcasts = broadcastBatch.mock.calls.filter((call: unknown[]) => {
      const events = call[1] as TerminalEvent[];
      return events.some(e => e.type === "trigger");
    });
    expect(triggerBroadcasts.length).toBe(0);
  });
});

// ============================================================================
// TASK-007b: REST GET /terminal-events API テスト
// ============================================================================

describe("GET /api/sessions/:id/terminal-events", () => {
  // child_process.execFile をモック
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

  let app: import("express").Express;
  let sessionStore: SessionStore;
  let terminalEventStore: TerminalEventStore;

  beforeEach(async () => {
    const serverModule = await import("./server.js");
    const { DecisionStore } = await import("./decision-store.js");
    const { QuestionStore } = await import("./question-store.js");
    const { GroupStore } = await import("./group-store.js");
    const { PromptTemplateStore } = await import("./prompt-template-store.js");

    sessionStore = new SessionStore(vi.fn());
    terminalEventStore = new TerminalEventStore(parseCaptureConfig({}));

    const deps: import("./server.js").ServerDeps = {
      sessionStore,
      decisionStore: new DecisionStore({
        onDecisionPending: vi.fn(),
        onDecisionResolved: vi.fn(),
        onDecisionTimeout: vi.fn(),
      }),
      questionStore: new QuestionStore({
        onQuestionPending: vi.fn(),
        onQuestionAnswered: vi.fn(),
        onQuestionTimeout: vi.fn(),
      }),
      groupStore: new GroupStore(vi.fn()),
      promptTemplateStore: new PromptTemplateStore(vi.fn(), vi.fn()),
      terminalEventStore,
      tmuxManager: {
        getTools: vi.fn().mockReturnValue([]),
        getToolsWithAvailability: vi.fn().mockReturnValue([]),
        isAvailable: vi.fn().mockReturnValue(false),
        canManagePanes: vi.fn().mockReturnValue(false),
        launchSession: vi.fn(),
        killPane: vi.fn(),
        paneExists: vi.fn(),
        listActivePanes: vi.fn(),
        listActivePanesDetailed: vi.fn(),
        initialize: vi.fn(),
        destroy: vi.fn(),
      } as unknown as TmuxManager,
      captureConfig: parseCaptureConfig({}),
      pendingGroupAssignments: new Map(),
      broadcast: vi.fn(),
      hookToken: "",
      allowedOrigins: new Set(["http://localhost:3456"]),
    };

    ({ app } = serverModule.createApp(deps));

    // セッションを作成
    sessionStore.processEvent({
      event_type: "SessionStart",
      session_id: "test-session",
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
      cli_tool: "claude",
      transcript_path: "",
      progress_text: "",
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(() => {
    sessionStore.destroy();
  });

  it("存在しないセッションに対して 404 を返す", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/nonexistent/terminal-events")
      .set("Referer", "http://localhost:3456/");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Session not found");
  });

  it("Origin ヘッダーが正しい場合 200 を返す", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events")
      .set("Origin", "http://localhost:3456");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("events");
    expect(res.body).toHaveProperty("next_cursor");
    expect(res.body).toHaveProperty("has_more");
    expect(res.body).toHaveProperty("latest_seq");
  });

  it("Referer ヘッダーで Origin フォールバックが機能する", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events")
      .set("Referer", "http://localhost:3456/some/path");

    expect(res.status).toBe(200);
  });

  it("Origin も Referer もない場合 403 を返す", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events");

    expect(res.status).toBe(403);
  });

  it("不正な Origin では 403 を返す", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events")
      .set("Origin", "http://evil.com");

    expect(res.status).toBe(403);
  });

  it("イベントが存在する場合 cursor + limit でページネーションできる", async () => {
    // イベントを追加
    for (let i = 0; i < 5; i++) {
      terminalEventStore.addEvent({
        sessionId: "test-session",
        runId: 1,
        text: `line ${i}`,
        type: "output",
        source: "capture",
      });
    }

    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events?cursor=0&limit=2")
      .set("Origin", "http://localhost:3456");

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
    expect(res.body.has_more).toBe(true);
    expect(res.body.next_cursor).toBeGreaterThan(0);

    // 次ページ取得
    const res2 = await request(app)
      .get(`/api/sessions/test-session/terminal-events?cursor=${res.body.next_cursor}&limit=2`)
      .set("Origin", "http://localhost:3456");

    expect(res2.status).toBe(200);
    expect(res2.body.events.length).toBe(2);
  });

  it("イベントなしでは空配列を返す", async () => {
    const request = (await import("supertest")).default;
    const res = await request(app)
      .get("/api/sessions/test-session/terminal-events")
      .set("Origin", "http://localhost:3456");

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });
});
