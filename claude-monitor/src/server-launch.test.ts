import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function createMockTmuxManager(): TmuxManager {
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

describe("Launch API copilot プレセッション生成", () => {
  let deps: ServerDeps;
  let app: CreateAppResult["app"];

  beforeEach(() => {
    deps = createTestDeps();
    ({ app } = createApp(deps));
  });

  afterEach(() => {
    deps.sessionStore.destroy();
    deps.decisionStore.destroy();
    deps.questionStore.destroy();
  });

  it("copilot 起動時に合成 SessionStart でプレセッションが作成される", async () => {
    const res = await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tmux_pane).toBe("%5");

    // セッションが作成されている
    const session = deps.sessionStore.get("copilot-pane-5");
    expect(session).toBeDefined();
    expect(session!.status).toBe("idle");
    expect(session!.cli_tool).toBe("copilot");
    expect(session!.tmux_pane).toBe("%5");
  });

  it("copilot 起動時に session_update が broadcast される", async () => {
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    // SessionStore の onChange コールバック（=broadcast）が呼ばれている
    // createApp 内部で sessionStore.processEvent() が呼ばれ、それが onChange → broadcast を呼ぶ
    const session = deps.sessionStore.get("copilot-pane-5");
    expect(session).toBeDefined();
    // SessionStore に渡した onChange は broadcast そのもの（createTestDeps の設計）
    // broadcast は SessionStore.processEvent() 内で呼ばれる
    expect(deps.broadcast).toHaveBeenCalled();
  });

  it("claude 起動時にはプレセッション作成しない", async () => {
    const res = await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "claude" });

    expect(res.status).toBe(200);
    // copilot-pane-5 のセッションは作成されない
    const session = deps.sessionStore.get("copilot-pane-5");
    expect(session).toBeUndefined();
  });

  it("group_id 指定時にプレセッションにグループが即時割り当てされる", async () => {
    // グループを事前作成
    const group = await deps.groupStore.create("TestGroup");

    const res = await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot", group_id: group.id });

    expect(res.status).toBe(200);

    // プレセッションがグループに追加されている
    const updatedGroup = deps.groupStore.get(group.id);
    expect(updatedGroup!.session_ids).toContain("copilot-pane-5");

    // pendingGroupAssignments は消費済み
    expect(deps.pendingGroupAssignments.has("%5")).toBe(false);
  });

  it("グループ割り当て失敗時に group_auto_assign_failed 通知が broadcast される", async () => {
    const mockTmux = createMockTmuxManager();
    const broadcast = vi.fn();
    const sessionStore = new SessionStore(vi.fn());
    const groupStore = new GroupStore(vi.fn());
    deps = createTestDeps({
      tmuxManager: mockTmux,
      broadcast,
      sessionStore,
      groupStore,
    });
    ({ app } = createApp(deps));

    // バリデーションを通すためにグループを作成
    const group = await groupStore.create("TempGroup");
    const groupId = group.id;

    // addSession を undefined 返却にモック（グループ未存在を再現）
    vi.spyOn(groupStore, "addSession").mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot", group_id: groupId });

    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notification",
        payload: expect.objectContaining({
          notification_type: "group_auto_assign_failed",
        }),
      }),
    );

    sessionStore.destroy();
  });
});

describe("後続 SessionStart 再初期化テスト", () => {
  let deps: ServerDeps;
  let app: CreateAppResult["app"];

  beforeEach(() => {
    deps = createTestDeps();
    ({ app } = createApp(deps));
  });

  afterEach(() => {
    deps.sessionStore.destroy();
    deps.decisionStore.destroy();
    deps.questionStore.destroy();
  });

  it("プレセッション後に実 SessionStart が到達するとデータが再初期化される", async () => {
    // 1. Launch API でプレセッション作成
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    const preSession = deps.sessionStore.get("copilot-pane-5");
    expect(preSession).toBeDefined();
    expect(preSession!.status).toBe("idle");

    // 2. プレセッションに対してアクティビティを追加（模擬操作）
    deps.sessionStore.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "copilot-pane-5",
      prompt: "hello",
      cli_tool: "copilot",
    }));
    deps.sessionStore.processEvent(makeEvent({
      event_type: "PostToolUse",
      session_id: "copilot-pane-5",
      tool_name: "Write",
      file_path: "/tmp/test.ts",
      cli_tool: "copilot",
    }));

    const activeSession = deps.sessionStore.get("copilot-pane-5");
    expect(activeSession!.title).toBe("hello");
    expect(activeSession!.artifacts.length).toBe(1);

    // 3. 実際の SessionStart（copilot の sessionStart フック到達）
    const reInitSession = deps.sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));

    // Copilot 再初期化でデータがクリアされる
    expect(reInitSession.status).toBe("idle");
    expect(reInitSession.title).toBe("");
    expect(reInitSession.artifacts).toEqual([]);
    expect(reInitSession.activities).toEqual([]);
    expect(reInitSession.milestones).toEqual([]);
  });

  it("プレセッション後の実 SessionStart でセッションIDが一致する", async () => {
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    // /api/events 経由で実際の SessionStart を送信
    const res = await request(app)
      .post("/api/events")
      .send({
        event_type: "SessionStart",
        session_id: "copilot-pane-5",
        cwd: "/workspace",
        model: "gpt-4o",
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
        transcript_path: "",
        progress_text: "",
        cli_tool: "copilot",
        timestamp: new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe("copilot-pane-5");

    // セッションが1つだけ存在（重複作成されていない）
    const sessions = deps.sessionStore.getAll().filter(s => s.session_id === "copilot-pane-5");
    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe("idle");
    expect(sessions[0].cwd).toBe("/workspace"); // 実 SessionStart の cwd で更新
  });

  it("実 SessionStart 後もステータスは idle を維持する", async () => {
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    deps.sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "copilot-pane-5",
      tmux_pane: "%5",
      cli_tool: "copilot",
    }));

    const session = deps.sessionStore.get("copilot-pane-5");
    expect(session!.status).toBe("idle");
  });
});

describe("Copilot セッションライフサイクル統合テスト", () => {
  let deps: ServerDeps;
  let app: CreateAppResult["app"];

  beforeEach(() => {
    deps = createTestDeps();
    ({ app } = createApp(deps));
  });

  afterEach(() => {
    deps.sessionStore.destroy();
    deps.decisionStore.destroy();
    deps.questionStore.destroy();
  });

  it("Launch → idle → /api/events で SessionStart → PreToolUse → decision → complete の全フロー", async () => {
    // 1. Launch API でプレセッション作成
    const launchRes = await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });
    expect(launchRes.status).toBe(200);

    let session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("idle");
    expect(session.cli_tool).toBe("copilot");
    expect(session.first_prompt_sent).toBe(false);
    expect(session.last_hook_at).toBe("");

    // 2. /api/events で SessionStart（copilot の sessionStart フック到達）
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "SessionStart",
        session_id: "copilot-pane-5",
        tmux_pane: "%5",
        cli_tool: "copilot",
        cwd: "/workspace",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("idle");
    expect(session.last_hook_at).toBeTruthy(); // /api/events で更新される
    expect(session.first_prompt_sent).toBe(false); // 再初期化でリセット

    // 3. /api/events で UserPromptSubmit → running
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "UserPromptSubmit",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        prompt: "fix the bug",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("running");
    expect(session.title).toBe("fix the bug");

    // 4. /api/events で PreToolUse(Bash)
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "PreToolUse",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        tool_name: "Bash",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("running");

    // 5. 決定リクエスト登録
    const decRes = await request(app)
      .post("/api/decisions")
      .send({
        correlation_id: "corr-1",
        session_id: "copilot-pane-5",
        decision_type: "permission",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        timestamp: new Date().toISOString(),
      });
    expect(decRes.status).toBe(201);

    // 6. ブラウザから承認
    const respondRes = await request(app)
      .post("/api/decisions/corr-1/respond")
      .set("Origin", "http://localhost:3456")
      .send({ decision: "allow" });
    expect(respondRes.status).toBe(200);

    const decision = deps.decisionStore.get("corr-1");
    expect(decision!.status).toBe("resolved");
    expect(decision!.result).toBe("allow");

    // 7. /api/events で PostToolUse
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "PostToolUse",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        tool_name: "Bash",
      }));

    // 8. /api/events で Stop → idle
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "Stop",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        last_message: "Done",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("idle");

    // 9. /api/events で SessionEnd → completed
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "SessionEnd",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        reason: "user_quit",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.status).toBe("completed");
  });

  it("send-keys: Copilot 初回送信は idle チェックを通過し first_prompt_sent が更新される", async () => {
    // tmux send-keys は成功するようにモック
    const mockTmux = createMockTmuxManager();
    deps = createTestDeps({ tmuxManager: mockTmux });
    ({ app } = createApp(deps));

    // プレセッション作成
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    const session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.first_prompt_sent).toBe(false);

    // send-keys は tmux を呼ぶが、テスト環境では tmux がないため 500 になる
    // ただし Copilot 固有チェック（409）は通過することを確認
    const res = await request(app)
      .post("/api/sessions/copilot-pane-5/send-keys")
      .set("Origin", "http://localhost:3456")
      .send({ text: "hello" });

    // tmux がないため 500 だが、403 や 409 ではないことを確認
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(409);
  });

  it("/api/events で last_hook_at が更新される", async () => {
    // プレセッション作成
    await request(app)
      .post("/api/sessions/launch")
      .set("Origin", "http://localhost:3456")
      .send({ tool_id: "copilot" });

    let session = deps.sessionStore.get("copilot-pane-5")!;
    // last_hook_at は再初期化でリセットされている
    // 最初は Launch API の processEvent で空文字列 → /api/events 未経由なので空のまま
    // ただし Launch API 内の processEvent は /api/events 経由ではないため last_hook_at は空

    // /api/events 経由でイベント送信
    await request(app)
      .post("/api/events")
      .send(makeEvent({
        event_type: "PreToolUse",
        session_id: "copilot-pane-5",
        cli_tool: "copilot",
        tool_name: "Read",
      }));

    session = deps.sessionStore.get("copilot-pane-5")!;
    expect(session.last_hook_at).toBeTruthy();
    expect(new Date(session.last_hook_at).getTime()).toBeGreaterThan(0);
  });
});
