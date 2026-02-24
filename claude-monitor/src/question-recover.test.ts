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

function createWiredStores() {
  const broadcasts: unknown[] = [];

  const sessionStore = new SessionStore((session) => {
    broadcasts.push({ type: "session_update", payload: { ...session } });
  });

  const questionStore = new QuestionStore({
    onQuestionPending: (pq: PendingQuestion) => {
      broadcasts.push({ type: "question_pending", payload: { ...pq } });
    },
    onQuestionAnswered: (pq: PendingQuestion) => {
      broadcasts.push({ type: "question_answered", payload: { ...pq } });
    },
    onQuestionTimeout: (pq: PendingQuestion) => {
      broadcasts.push({ type: "question_answered", payload: { ...pq } });
    },
  });

  function cancelSessionQuestions(sessionId: string): void {
    questionStore.cancelBySession(sessionId);
  }

  return { sessionStore, questionStore, cancelSessionQuestions, broadcasts };
}

describe("Question + Recover オーケストレーション", () => {
  it("MCP質問登録でブロードキャストされる", () => {
    const { sessionStore, questionStore, broadcasts } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    const pq = questionStore.register("s1", [{ question: "Q?" }]);

    const pendingMsg = broadcasts.find(
      (b: any) => b.type === "question_pending" && b.payload.id === pq.id
    );
    expect(pendingMsg).toBeDefined();

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("ブラウザ回答で waiter が解放される", async () => {
    const { sessionStore, questionStore } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    const pq = questionStore.register("s1", [{ question: "Q?" }]);
    const waitPromise = questionStore.waitForAnswer(pq.id);

    questionStore.respond(pq.id, { "0": "answer" });

    const result = await waitPromise;
    expect(result.resolved).toBe(true);
    expect(result.answers).toEqual({ "0": "answer" });

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("タイムアウトで resolved: false が返る", async () => {
    vi.useFakeTimers();
    const { sessionStore, questionStore } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    const pq = questionStore.register("s1", [{ question: "Q?" }]);
    const waitPromise = questionStore.waitForAnswer(pq.id, 120000);

    vi.advanceTimersByTime(120000);

    const result = await waitPromise;
    expect(result.resolved).toBe(false);

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("同一セッション2つ目の質問登録で1つ目がキャンセルされる", () => {
    const { sessionStore, questionStore } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    const pq1 = questionStore.register("s1", [{ question: "Q1?" }]);
    const pq2 = questionStore.register("s1", [{ question: "Q2?" }]);

    expect(questionStore.get(pq1.id)!.status).toBe("timeout");
    expect(questionStore.get(pq2.id)!.status).toBe("pending");
    expect(questionStore.getPending()).toHaveLength(1);

    sessionStore.destroy();
    questionStore.destroy();
  });

  it("recover 時に pending question がキャンセルされる", async () => {
    const { sessionStore, questionStore, cancelSessionQuestions } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "AskUserQuestion",
      questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }],
    }));

    const pq = questionStore.register("s1", [{ question: "MCP Q?" }]);
    const waitPromise = questionStore.waitForAnswer(pq.id);

    // recover と同等の処理
    sessionStore.recover("s1");
    cancelSessionQuestions("s1");

    expect(questionStore.get(pq.id)!.status).toBe("timeout");

    const result = await waitPromise;
    expect(result.resolved).toBe(false);

    sessionStore.destroy();
    questionStore.destroy();
  });
});
