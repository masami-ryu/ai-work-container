import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// child_process.execFile をモック（server.ts 内の promisify(execFile) に影響）
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

import request from "supertest";
import { createApp, type ServerDeps, type CreateAppResult } from "./server.js";
import { SessionStore } from "./session-store.js";
import { DecisionStore } from "./decision-store.js";
import { QuestionStore } from "./question-store.js";
import { GroupStore } from "./group-store.js";
import { PromptTemplateStore } from "./prompt-template-store.js";
import { TerminalEventStore, parseCaptureConfig } from "./terminal-event-store.js";
import type { TmuxManager } from "./tmux-manager.js";
import type { PendingAssignment } from "./pending-group-assignments.js";
import type { WSMessage, Session, HookEvent } from "./types.js";

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

function createMockTmuxManager(): TmuxManager {
  return {
    getTools: vi.fn().mockReturnValue([
      { id: "claude", label: "Claude Code", command: "claude", windowIndex: 1, actionStrings: { yes: "y", yes_always: "!", no: "n" } },
      { id: "copilot", label: "Copilot CLI", command: "copilot", windowIndex: 2, actionStrings: { yes: "y", yes_always: "always", no: "n" } },
    ]),
    getToolsWithAvailability: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockReturnValue(true),
    canManagePanes: vi.fn().mockReturnValue(true),
    launchSession: vi.fn().mockResolvedValue({ ok: true, tmux_pane: "%5" }),
    killPane: vi.fn(),
    paneExists: vi.fn(),
    listActivePanes: vi.fn(),
    listActivePanesDetailed: vi.fn(),
    initialize: vi.fn(),
    destroy: vi.fn(),
  } as unknown as TmuxManager;
}

function createTestDeps(overrides?: Partial<ServerDeps>): ServerDeps {
  const broadcast = vi.fn();
  const sessionStore = new SessionStore(broadcast as unknown as (session: Session) => void);
  const groupStore = new GroupStore(vi.fn());
  const decisionStore = new DecisionStore({
    onDecisionPending: vi.fn(),
    onDecisionResolved: vi.fn(),
    onDecisionTimeout: vi.fn(),
  });
  const questionStore = new QuestionStore({
    onQuestionPending: vi.fn(),
    onQuestionAnswered: vi.fn(),
    onQuestionTimeout: vi.fn(),
  });
  const promptTemplateStore = new PromptTemplateStore(vi.fn(), vi.fn());

  return {
    sessionStore,
    decisionStore,
    questionStore,
    groupStore,
    promptTemplateStore,
    terminalEventStore: new TerminalEventStore(parseCaptureConfig({})),
    tmuxManager: createMockTmuxManager(),
    captureConfig: parseCaptureConfig({}),
    pendingGroupAssignments: new Map<string, PendingAssignment>(),
    broadcast,
    hookToken: "",
    allowedOrigins: new Set(["http://localhost:3456"]),
    ...overrides,
  };
}

/** execFile 成功モックを設定 */
function setupExecFileSuccess(): void {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      (cb as (err: null, stdout: string, stderr: string) => void)(null, "", "");
    }
    return { on: vi.fn(), kill: vi.fn() };
  });
}

/** execFile 失敗モックを設定 */
function setupExecFileFailure(): void {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      (cb as (err: Error) => void)(new Error("tmux not found"));
    }
    return { on: vi.fn(), kill: vi.fn() };
  });
}

/** send-keys 呼び出しのみ抽出 */
function getSendKeysCalls(): unknown[][] {
  return mockExecFile.mock.calls.filter(
    (c: unknown[]) => c[0] === "tmux" && Array.isArray(c[1]) && c[1][0] === "send-keys"
  );
}

const savedEnv: Record<string, string | undefined> = {};
const envKeys = ["COPILOT_ENTER_METHOD", "COPILOT_CONFIRM_DELAY_MS", "COPILOT_CONFIRM_RESPONSE"];

describe("copilotAutoApprove Enter 方式別テスト", () => {
  let deps: ServerDeps;
  let app: CreateAppResult["app"];

  beforeEach(() => {
    // 環境変数を保存
    for (const key of envKeys) savedEnv[key] = process.env[key];

    setupExecFileSuccess();
    process.env.COPILOT_CONFIRM_DELAY_MS = "0";
  });

  afterEach(async () => {
    // 前テストの fire-and-forget auto-approve の完了を待つ
    await new Promise(r => setTimeout(r, 300));
    deps.sessionStore.destroy();
    deps.decisionStore.destroy();
    deps.questionStore.destroy();
    mockExecFile.mockReset();
    // 環境変数を復元
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  /**
   * Copilot セッション + decision を準備し、allow 応答を送信。
   * mockExecFile.mockClear() してから allow を送るので、
   * 以降のモック呼び出しは auto-approve 由来のみになる。
   */
  async function triggerAutoApprove(opts?: { waitMs?: number }): Promise<void> {
    deps = createTestDeps();
    ({ app } = createApp(deps));

    // 1. Copilot プレセッション作成
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    // 2. SessionStart
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "SessionStart",
        session_id: "copilot-pane-5",
        tmux_pane: "%5",
        cli_tool: "copilot",
      }));

    // 3. decision 登録（decide.sh 経由相当）
    const decRes = await request(app)
      .post("/api/decisions")
      .send({
        correlation_id: "corr-1",
        session_id: "copilot-pane-5",
        decision_type: "PreToolUse",
        tool_name: "Write",
        tool_input: { path: "/tmp/test.txt" },
        timestamp: new Date().toISOString(),
      });
    expect(decRes.status).toBe(201);
    const decisionId = decRes.body.id;

    // モック呼び出し履歴をクリア（セッション準備段階の呼び出しを除外）
    mockExecFile.mockClear();

    // 4. allow で応答 → copilotAutoApprove が非同期で発火
    await request(app)
      .post(`/api/decisions/${decisionId}/respond`)
      .set("Origin", "http://localhost:3456")
      .send({ decision: "allow" });

    // auto-approve は非同期なので完了を待つ
    await new Promise(r => setTimeout(r, opts?.waitMs ?? 200));
  }

  it("デフォルト (c-m): C-m を送信する", async () => {
    delete process.env.COPILOT_ENTER_METHOD;

    await triggerAutoApprove();

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "y"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  it("c-m 明示指定: C-m を送信する", async () => {
    process.env.COPILOT_ENTER_METHOD = "c-m";

    await triggerAutoApprove();

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "y"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  it("enter-delay: 遅延後に Enter を送信する", async () => {
    process.env.COPILOT_ENTER_METHOD = "enter-delay";

    // enter-delay は 100ms 遅延があるため余裕を持って待つ
    await triggerAutoApprove({ waitMs: 300 });

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "y"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
  });

  it("double-enter: Enter を2回送信する", async () => {
    process.env.COPILOT_ENTER_METHOD = "double-enter";

    await triggerAutoApprove();

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "y"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
  });

  it("全リトライ失敗時に waiting_permission 状態になる", async () => {
    delete process.env.COPILOT_ENTER_METHOD;
    setupExecFileFailure();

    deps = createTestDeps();
    ({ app } = createApp(deps));

    // セッション作成
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    // SessionStart → idle
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "SessionStart",
        session_id: "copilot-pane-5",
        tmux_pane: "%5",
        cli_tool: "copilot",
      }));

    // UserPromptSubmit → running にする（waiting_permission フォールバックの条件）
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "UserPromptSubmit",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        prompt: "test prompt",
      }));

    const sessionBefore = deps.sessionStore.get("copilot-pane-5")!;
    expect(sessionBefore.status).toBe("running");

    // decision 登録
    const decRes = await request(app)
      .post("/api/decisions")
      .send({
        correlation_id: "corr-fail",
        session_id: "copilot-pane-5",
        decision_type: "PreToolUse",
        tool_name: "Write",
        tool_input: { path: "/tmp/test.txt" },
        timestamp: new Date().toISOString(),
      });
    expect(decRes.status).toBe(201);

    // allow → auto-approve 発火（全リトライ失敗）
    await request(app)
      .post(`/api/decisions/${decRes.body.id}/respond`)
      .set("Origin", "http://localhost:3456")
      .send({ decision: "allow" });

    // リトライ間隔 500ms × 2回 = 1000ms + バッファ
    await new Promise(r => setTimeout(r, 1500));

    const session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("waiting_permission");
  }, 5000);
});
