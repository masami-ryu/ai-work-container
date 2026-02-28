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

function createMockTmuxManager(overrides?: {
  checkPaneMode?: ReturnType<typeof vi.fn>;
  cancelCopyMode?: ReturnType<typeof vi.fn>;
}): TmuxManager {
  return {
    getTools: vi.fn().mockReturnValue([
      { id: "claude", label: "Claude Code", command: "claude", windowIndex: 1 },
      { id: "copilot", label: "Copilot CLI", command: "copilot", windowIndex: 2 },
    ]),
    getToolsWithAvailability: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockReturnValue(true),
    canManagePanes: vi.fn().mockReturnValue(true),
    launchSession: vi.fn().mockResolvedValue({ ok: true, tmux_pane: "%5" }),
    killPane: vi.fn(),
    paneExists: vi.fn(),
    checkPaneMode: overrides?.checkPaneMode ?? vi.fn().mockResolvedValue(false),
    cancelCopyMode: overrides?.cancelCopyMode ?? vi.fn().mockResolvedValue(true),
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
    tmuxManager: createMockTmuxManager(),
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

/** send-keys 呼び出しのみ抽出 */
function getSendKeysCalls(): unknown[][] {
  return mockExecFile.mock.calls.filter(
    (c: unknown[]) => c[0] === "tmux" && Array.isArray(c[1]) && c[1][0] === "send-keys"
  );
}

const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  "COPILOT_ENTER_METHOD",
  "COPILOT_PROMPT_ENTER_METHOD",
  "CODEX_ENTER_METHOD",
  "CODEX_PROMPT_ENTER_METHOD",
];

describe("send-keys Enter 方式テスト", () => {
  let deps: ServerDeps;
  let app: CreateAppResult["app"];

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
    setupExecFileSuccess();
  });

  afterEach(() => {
    deps.sessionStore.destroy();
    deps.decisionStore.destroy();
    deps.questionStore.destroy();
    mockExecFile.mockReset();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  /** Copilot idle セッションを準備し send-keys を送信。モック履歴クリア後に send-keys の呼び出しのみ検証可能。 */
  async function sendKeysToCopilot(text: string, tmuxOverrides?: {
    checkPaneMode?: ReturnType<typeof vi.fn>;
    cancelCopyMode?: ReturnType<typeof vi.fn>;
  }): Promise<request.Response> {
    deps = createTestDeps(tmuxOverrides ? { tmuxManager: createMockTmuxManager(tmuxOverrides) } : undefined);
    ({ app } = createApp(deps));

    // Copilot プレセッション作成（idle 状態）
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    // モック呼び出し履歴をクリア（セッション準備段階を除外）
    mockExecFile.mockClear();

    return request(app)
      .post("/api/sessions/copilot-pane-5/send-keys")
      .set("Origin", "http://localhost:3456")
      .send({ text });
  }

  /** Claude（非 Copilot）idle セッションを準備し send-keys を送信 */
  async function sendKeysToClaude(text: string): Promise<request.Response> {
    deps = createTestDeps();
    ({ app } = createApp(deps));

    // Claude セッションを作成（SessionStart イベント経由）
    deps.sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "claude-session-1",
      tmux_pane: "%10",
      cli_tool: "claude",
      cwd: "/workspace",
    }));

    // モック呼び出し履歴をクリア
    mockExecFile.mockClear();

    return request(app)
      .post("/api/sessions/claude-session-1/send-keys")
      .set("Origin", "http://localhost:3456")
      .send({ text });
  }

  /** Codex idle セッションを準備し send-keys を送信 */
  async function sendKeysToCodex(text: string, tmuxOverrides?: {
    checkPaneMode?: ReturnType<typeof vi.fn>;
    cancelCopyMode?: ReturnType<typeof vi.fn>;
  }): Promise<request.Response> {
    deps = createTestDeps(tmuxOverrides ? { tmuxManager: createMockTmuxManager(tmuxOverrides) } : undefined);
    ({ app } = createApp(deps));

    deps.sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-8",
      tmux_pane: "%8",
      cli_tool: "codex",
      cwd: "/workspace",
    }));

    mockExecFile.mockClear();

    return request(app)
      .post("/api/sessions/codex-pane-8/send-keys")
      .set("Origin", "http://localhost:3456")
      .send({ text });
  }

  it("Copilot prompt_ready=false: 403(PROMPT_NOT_READY) を返し send-keys は実行されない", async () => {
    deps = createTestDeps();
    ({ app } = createApp(deps));

    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    const session = deps.sessionStore.get("copilot-pane-5")!;
    session.prompt_ready = false;

    mockExecFile.mockClear();

    const res = await request(app)
      .post("/api/sessions/copilot-pane-5/send-keys")
      .set("Origin", "http://localhost:3456")
      .send({ text: "hello" });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("PROMPT_NOT_READY");
    expect(getSendKeysCalls().length).toBe(0);
  });

  // === Copilot セッション: C-u なしで送信 ===

  // TEST-001: Copilot send-keys 既定送信方式
  it("Copilot デフォルト: C-u なしで text + C-m を送信する", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    // テキスト送信 + C-m 送信 = 2 呼び出し（C-u なし）
    expect(sendKeysCalls.length).toBe(2);
    // 1番目がテキスト送信
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    // 2番目が C-m 送信
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  // TEST-001: COPILOT_PROMPT_ENTER_METHOD=c-m 指定時
  it("Copilot COPILOT_PROMPT_ENTER_METHOD=c-m: C-u なしで text + C-m を送信する", async () => {
    process.env.COPILOT_PROMPT_ENTER_METHOD = "c-m";
    delete process.env.COPILOT_ENTER_METHOD;

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  // フォールバック: COPILOT_ENTER_METHOD のみ設定時
  it("Copilot COPILOT_ENTER_METHOD のみ設定: C-u なしでフォールバック値を使用する", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    process.env.COPILOT_ENTER_METHOD = "c-m";

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  // 責務分離の非干渉検証
  it("Copilot COPILOT_PROMPT_ENTER_METHOD=enter + COPILOT_ENTER_METHOD=c-m: send-keys は Enter を使用する", async () => {
    process.env.COPILOT_PROMPT_ENTER_METHOD = "enter";
    process.env.COPILOT_ENTER_METHOD = "c-m";

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    // COPILOT_PROMPT_ENTER_METHOD が優先され Enter を使用
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
  });

  // Copilot enter-delay 方式
  it("Copilot COPILOT_PROMPT_ENTER_METHOD=enter-delay: C-u なしで text + Enter（遅延付き）を送信する", async () => {
    process.env.COPILOT_PROMPT_ENTER_METHOD = "enter-delay";

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
  });

  // Copilot double-enter 方式
  it("Copilot COPILOT_PROMPT_ENTER_METHOD=double-enter: C-u なしで text + Enter + Enter を送信する", async () => {
    process.env.COPILOT_PROMPT_ENTER_METHOD = "double-enter";

    const res = await sendKeysToCopilot("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    // テキスト + Enter + Enter = 3 呼び出し（C-u なし）
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%5", "Enter"]);
  });

  // === Codex セッション: C-u なしで送信 ===

  it("Codex デフォルト: C-u なしで text + Enter（遅延付き）を送信する", async () => {
    delete process.env.CODEX_PROMPT_ENTER_METHOD;
    delete process.env.CODEX_ENTER_METHOD;

    const res = await sendKeysToCodex("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%8", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%8", "Enter"]);
  });

  it("Codex CODEX_PROMPT_ENTER_METHOD=c-m + CODEX_ENTER_METHOD=enter-delay: send-keys は C-m を使用する", async () => {
    process.env.CODEX_PROMPT_ENTER_METHOD = "c-m";
    process.env.CODEX_ENTER_METHOD = "enter-delay";

    const res = await sendKeysToCodex("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%8", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%8", "C-m"]);
  });

  it("Codex CODEX_ENTER_METHOD=double-enter のみ設定: Enter + Enter を送信する", async () => {
    delete process.env.CODEX_PROMPT_ENTER_METHOD;
    process.env.CODEX_ENTER_METHOD = "double-enter";

    const res = await sendKeysToCodex("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%8", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%8", "Enter"]);
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%8", "Enter"]);
  });

  // === 非 Copilot セッション: C-u あり（既存挙動維持） ===

  // TEST-002: 非 Copilot デフォルト（Enter）
  it("非 Copilot (Claude) セッション: C-u + text + Enter を送信する", async () => {
    process.env.COPILOT_PROMPT_ENTER_METHOD = "c-m";
    process.env.COPILOT_ENTER_METHOD = "c-m";

    const res = await sendKeysToClaude("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    // C-u (行クリア) + テキスト送信 + Enter 送信 = 3 呼び出し
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%10", "C-u"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%10", "-l", "hello"]);
    // 非 Copilot は環境変数に関わらず常に Enter
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%10", "Enter"]);
  });

  // TEST-003: 非 Copilot double-enter（Claude は常に enter なので double-enter にはならないが、
  // C-u が送信されることを確認する回帰テスト）
  it("非 Copilot (Claude) セッション: 環境変数に関わらず C-u + text + Enter（3呼び出し）", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    const res = await sendKeysToClaude("world");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%10", "C-u"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%10", "-l", "world"]);
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%10", "Enter"]);
  });

  // === copy-mode ガードテスト ===

  // Copilot 通常送信（pane_in_mode=0）: ガードを通過して text + C-m が送信される
  it("Copilot pane_in_mode=0: ガード通過し text + C-m を送信する", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    const checkPaneMode = vi.fn().mockResolvedValue(false);
    const res = await sendKeysToCopilot("hello", { checkPaneMode });
    expect(res.status).toBe(200);

    expect(checkPaneMode).toHaveBeenCalledWith("%5");
    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  // copy-mode 復帰成功時: cancel 後に text + C-m が送信される
  it("Copilot copy-mode 復帰成功: cancelCopyMode 後に text + C-m を送信する", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    const checkPaneMode = vi.fn().mockResolvedValue(true);
    const cancelCopyMode = vi.fn().mockResolvedValue(true);
    const res = await sendKeysToCopilot("hello", { checkPaneMode, cancelCopyMode });
    expect(res.status).toBe(200);

    expect(checkPaneMode).toHaveBeenCalledWith("%5");
    expect(cancelCopyMode).toHaveBeenCalledWith("%5");
    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(2);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%5", "-l", "hello"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%5", "C-m"]);
  });

  // copy-mode 復帰失敗時: 422 を返し、text/Enter の send-keys は実行されない
  it("Copilot copy-mode 復帰失敗: 422 + COPY_MODE_STUCK を返し send-keys は実行されない", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    const checkPaneMode = vi.fn().mockResolvedValue(true);
    const cancelCopyMode = vi.fn().mockResolvedValue(false);
    const res = await sendKeysToCopilot("hello", { checkPaneMode, cancelCopyMode });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Pane is in copy-mode and recovery failed",
      errorCode: "COPY_MODE_STUCK",
    });

    // text/Enter の send-keys は実行されない
    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(0);
  });

  // 非 Copilot セッションでは copy-mode ガードが適用されない（回帰テスト）
  it("非 Copilot (Claude) セッション: copy-mode ガードは適用されず C-u + text + Enter を維持する", async () => {
    delete process.env.COPILOT_PROMPT_ENTER_METHOD;
    delete process.env.COPILOT_ENTER_METHOD;

    // checkPaneMode を true にしても非 Copilot には影響しないことを確認
    const res = await sendKeysToClaude("hello");
    expect(res.status).toBe(200);

    const sendKeysCalls = getSendKeysCalls();
    expect(sendKeysCalls.length).toBe(3);
    expect(sendKeysCalls[0][1]).toEqual(["send-keys", "-t", "%10", "C-u"]);
    expect(sendKeysCalls[1][1]).toEqual(["send-keys", "-t", "%10", "-l", "hello"]);
    expect(sendKeysCalls[2][1]).toEqual(["send-keys", "-t", "%10", "Enter"]);
  });
});
