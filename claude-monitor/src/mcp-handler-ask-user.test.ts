import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionStore } from "./session-store.js";
import { QuestionStore } from "./question-store.js";
import type { HookEvent, PendingQuestion } from "./types.js";

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
    transcript_path: "",
    progress_text: "",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * mcp-handler.ts の ask_user ツールにおける session_id 解決ロジックを再現。
 * MCP SDK のトランスポート層はモックし、コアロジックのみを検証する。
 */
function createAskUserHandler() {
  const sessionStore = new SessionStore(vi.fn());
  const questionStore = new QuestionStore({
    onQuestionPending: vi.fn(),
    onQuestionAnswered: vi.fn(),
    onQuestionTimeout: vi.fn(),
  });

  // mcp-handler.ts の ask_user ツールハンドラを再現
  async function askUser(params: {
    session_id?: string;
    questions: Array<{ question: string; header?: string; options?: Array<{ label: string; description: string }>; multiSelect?: boolean }>;
  }): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const { session_id, questions } = params;

    let targetSessionId: string;
    if (session_id) {
      const session = sessionStore.get(session_id);
      if (!session || (session.status !== "running" && session.status !== "idle")) {
        return {
          content: [{ type: "text" as const, text: `Session ${session_id} not found or not active. Use AskUserQuestion instead.` }],
          isError: true,
        };
      }
      targetSessionId = session_id;
    } else {
      const sessions = sessionStore.getAll();
      const activeSession = sessions
        .filter((s) => s.status === "running" || s.status === "idle")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

      if (!activeSession) {
        return {
          content: [{ type: "text" as const, text: "No active session found. Use AskUserQuestion instead." }],
          isError: true,
        };
      }
      targetSessionId = activeSession.session_id;
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

  return { sessionStore, questionStore, askUser };
}

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

  it("session_id 省略時にヒューリスティック検出が動作する", async () => {
    const { sessionStore, questionStore, askUser } = createAskUserHandler();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));

    // session_id なしで呼び出し
    const askPromise = askUser({
      questions: [{ question: "Q?" }],
    });

    const pending = questionStore.getPending();
    expect(pending).toHaveLength(1);
    // ヒューリスティックで最新 running セッションが選ばれる
    expect(pending[0].session_id).toBe("s1");

    questionStore.respond(pending[0].id, { "0": "answer" });
    const result = await askPromise;
    expect(result.isError).toBeUndefined();

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
