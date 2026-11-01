import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSessionId } from "./mcp-handler.js";
import { SessionStore } from "./session-store.js";
import { QuestionStore } from "./question-store.js";
import type { HookEvent } from "./types.js";

afterEach(() => {
  vi.useRealTimers();
});

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

/**
 * mcp-handler.ts の ask_user ツールハンドラを再現するテストヘルパー。
 * resolveSessionId は本体から直接 import して使用する（strict: true）。
 */
function createAskUserHandler() {
  const sessionStore = new SessionStore(vi.fn());
  const questionStore = new QuestionStore({
    onQuestionPending: vi.fn(),
    onQuestionAnswered: vi.fn(),
    onQuestionTimeout: vi.fn(),
  });

  // MCP セッション ID → claude-monitor セッション ID のバインディング
  const sessionBindings = new Map<string, string>();

  // mcp-handler.ts の ask_user ツールハンドラ相当（strict: true）
  async function askUser(params: {
    mcpSessionId?: string;
    session_id?: string;
    questions: Array<{ question: string; header?: string; options?: Array<{ label: string; description: string }>; multiSelect?: boolean }>;
  }): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const { mcpSessionId, session_id, questions } = params;

    const targetSessionId = resolveSessionId(sessionStore, sessionBindings, mcpSessionId, session_id, { strict: true });
    if (!targetSessionId) {
      let msg: string;
      if (session_id) {
        msg = `Session ${session_id} not found or not active. Use AskUserQuestion instead.`;
      } else {
        const allSessions = sessionStore.getAll();
        const activeSessions = allSessions.filter((s) => s.status === "running" || s.status === "idle");
        if (activeSessions.length >= 2) {
          msg = `複数のアクティブセッションが存在するため、自動紐付けできません。session_id を明示的に指定してください。アクティブセッション: ${activeSessions.map((s) => s.session_id).join(", ")}`;
        } else {
          msg = "No active session found. Use AskUserQuestion instead.";
        }
      }
      return {
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }

    const pq = questionStore.register(targetSessionId, questions);
    const result = await questionStore.waitForAnswer(pq.id, 120_000);

    if (result.resolved && result.answers) {
      const answerText = pq.questions
        .map((q, i) => `Q: ${q.question}\nA: ${result.answers?.[String(i)] ?? "(未回答)"}`)
        .join("\n\n");
      return { content: [{ type: "text" as const, text: answerText }] };
    }

    return {
      content: [{ type: "text" as const, text: "質問がタイムアウトしました（120秒）。AskUserQuestion にフォールバックしてください。" }],
      isError: true,
    };
  }

  return { sessionStore, questionStore, sessionBindings, askUser };
}

// ──────────────────────────────────────────────────────────────
// session_id 解決ロジック
// ──────────────────────────────────────────────────────────────

describe("MCP ask_user session_id 解決ロジック", () => {
  it("session_id 指定時に正しいセッションに紐付く", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "hello" }));

    // askUser を呼び出し（回答はすぐに行う）
    const askPromise = askUser({
      session_id: "s1",
      questions: [{ question: "Q?" }],
    });

    // pending question の session_id を確認
    const pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("s1");

    // 回答して終了
    questionStore.respond(pending[0].id, { "0": "answer" });
    const result = await askPromise;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Q?");
    expect(result.content[0].text).toContain("answer");

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("session_id 省略時にアクティブセッションが1つなら自動検出される", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));

    // session_id なしで呼び出し（アクティブ1つなら strict でも成功）
    const askPromise = askUser({
      questions: [{ question: "Q?" }],
    });

    const pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("s1");

    questionStore.respond(pending[0].id, { "0": "answer" });
    const result = await askPromise;
    expect(result.isError).toBeUndefined();

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("session_id 省略時にアクティブセッションが2つ以上あるとエラーになる", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    // session_id なしで呼び出し → strict モードで 2 セッション → エラー
    const result = await askUser({
      questions: [{ question: "Q?" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("複数のアクティブセッション");

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("存在しない session_id 指定でエラーが返る", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();

    const result = await askUser({
      session_id: "nonexistent",
      questions: [{ question: "Q?" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found or not active");

    sessionStore.destroy();
    questionStore.destroy();
  });
});

// ──────────────────────────────────────────────────────────────
// セッションバインディング挙動テスト
// ──────────────────────────────────────────────────────────────

describe("MCP ask_user セッションバインディング", () => {
  it("同一 MCP セッション ID で継続紐付けされる", async () => {
    const { sessionStore, questionStore, sessionBindings, askUser } = createAskUserHandler();
    const mcpSessionId = "mcp-session-1";

    // セッション s1, s2 を作成（s2 が最新）
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    // 1回目: 明示的 session_id で s2 にバインド（strict モードで 2 セッション時は明示必須）
    const ask1 = askUser({
      mcpSessionId,
      session_id: "s2",
      questions: [{ question: "Q1?" }],
    });
    let pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("s2");
    questionStore.respond(pending[0].id, { "0": "a1" });
    await ask1;

    // バインディングが記録されていることを確認
    expect(sessionBindings.get(mcpSessionId)).toBe("s2");

    // 2回目: 同じ mcpSessionId で session_id 省略 → バインド済み s2 に継続紐付け
    const ask2 = askUser({
      mcpSessionId,
      questions: [{ question: "Q2?" }],
    });
    pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("s2");
    questionStore.respond(pending[0].id, { "0": "a2" });
    await ask2;

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("バインド先が非アクティブになった場合に再検出される", async () => {
    const { sessionStore, questionStore, sessionBindings, askUser } = createAskUserHandler();
    const mcpSessionId = "mcp-session-2";

    // セッション s1 を作成
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));

    // 1回目: s1 にバインド（アクティブ 1 つなので自動検出）
    const ask1 = askUser({
      mcpSessionId,
      questions: [{ question: "Q1?" }],
    });
    let pending = questionStore.getPending();
    expect(pending[0].session_id).toBe("s1");
    questionStore.respond(pending[0].id, { "0": "a1" });
    await ask1;
    expect(sessionBindings.get(mcpSessionId)).toBe("s1");

    // s1 を完了にする
    sessionStore.processEvent(makeEvent({ event_type: "Stop", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "s1", reason: "user_quit" }));

    // s3 を新規作成
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s3" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s3", prompt: "new" }));

    // 2回目: s1 は completed なのでバインド解除 → s3 に再検出（アクティブ 1 つ）
    const ask2 = askUser({
      mcpSessionId,
      questions: [{ question: "Q2?" }],
    });
    pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe("s3");
    questionStore.respond(pending[0].id, { "0": "a2" });
    await ask2;

    // バインディングが s3 に更新
    expect(sessionBindings.get(mcpSessionId)).toBe("s3");

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("異なる MCP セッション ID は独立してバインドされる", async () => {
    const { sessionStore, questionStore, sessionBindings, askUser } = createAskUserHandler();

    // セッション s1, s2 を作成
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    // mcp-a: session_id 明示で s1 にバインド
    const askA = askUser({
      mcpSessionId: "mcp-a",
      session_id: "s1",
      questions: [{ question: "QA?" }],
    });
    let pending = questionStore.getPending();
    expect(pending[0].session_id).toBe("s1");
    questionStore.respond(pending[0].id, { "0": "aA" });
    await askA;
    expect(sessionBindings.get("mcp-a")).toBe("s1");

    // mcp-b: session_id 明示で s2 にバインド
    const askB = askUser({
      mcpSessionId: "mcp-b",
      session_id: "s2",
      questions: [{ question: "QB?" }],
    });
    pending = questionStore.getPending();
    expect(pending[0].session_id).toBe("s2");
    questionStore.respond(pending[0].id, { "0": "aB" });
    await askB;
    expect(sessionBindings.get("mcp-b")).toBe("s2");

    // mcp-a は引き続き s1、mcp-b は引き続き s2（バインド済みで継続）
    const askA2 = askUser({
      mcpSessionId: "mcp-a",
      questions: [{ question: "QA2?" }],
    });
    pending = questionStore.getPending();
    expect(pending[0].session_id).toBe("s1");
    questionStore.respond(pending[0].id, { "0": "aA2" });
    await askA2;

    const askB2 = askUser({
      mcpSessionId: "mcp-b",
      questions: [{ question: "QB2?" }],
    });
    pending = questionStore.getPending();
    expect(pending[0].session_id).toBe("s2");
    questionStore.respond(pending[0].id, { "0": "aB2" });
    await askB2;

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("全セッション非アクティブ時にエラーが返る", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();
    const mcpSessionId = "mcp-session-orphan";

    // セッションなし
    const result = await askUser({
      mcpSessionId,
      questions: [{ question: "Q?" }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No active session found");

    sessionStore.destroy();
    questionStore.destroy();
  });
});
