import { describe, it, expect, vi } from "vitest";
import { SessionStore } from "./session-store.js";
import { DecisionStore } from "./decision-store.js";
import type { HookEvent, DecisionRequest, Decision } from "./types.js";

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
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeDecisionRequest(overrides?: Partial<DecisionRequest>): DecisionRequest {
  return {
    correlation_id: "d1",
    session_id: "s1",
    decision_type: "permission",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * server.ts の recover ハンドラと同等のオーケストレーションを再現する。
 * SessionStore + DecisionStore のコールバック連携を統合テストする。
 */
function createWiredStores() {
  const broadcasts: unknown[] = [];

  const sessionStore = new SessionStore((session) => {
    broadcasts.push({ type: "session_update", payload: { ...session } });
  });

  const decisionStore = new DecisionStore({
    onDecisionPending: (decision: Decision) => {
      const session = sessionStore.get(decision.session_id);
      if (session) {
        session.status = "waiting_permission";
        session.updated_at = new Date().toISOString();
      }
      broadcasts.push({ type: "decision_pending", payload: { ...decision } });
    },
    onDecisionResolved: (decision: Decision) => {
      const session = sessionStore.get(decision.session_id);
      if (session && session.status === "waiting_permission") {
        session.status = "running";
        session.updated_at = new Date().toISOString();
      }
      broadcasts.push({ type: "decision_resolved", payload: { ...decision } });
    },
    onDecisionTimeout: vi.fn(),
  });

  // server.ts:283-302 の recover ハンドラと同等のロジック
  function recoverSession(sessionId: string): { status: number; body: unknown } {
    const session = sessionStore.get(sessionId);
    if (!session) {
      return { status: 404, body: { error: "Session not found" } };
    }
    const wasWaitingPermission = session.status === "waiting_permission";
    const recovered = sessionStore.recover(sessionId);
    if (!recovered) {
      return { status: 400, body: { error: "Session is not in waiting_permission or waiting_answer state" } };
    }
    if (wasWaitingPermission) {
      decisionStore.denyBySession(sessionId);
    }
    return { status: 200, body: { ok: true } };
  }

  return { sessionStore, decisionStore, recoverSession, broadcasts };
}

describe("recover オーケストレーション（SessionStore + DecisionStore 連携）", () => {
  it("waiting_permission → idle に復帰し、pending decisions を deny 確定する", () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    decisionStore.register(makeDecisionRequest({ correlation_id: "d1" }));
    decisionStore.register(makeDecisionRequest({ correlation_id: "d2" }));

    // register の onDecisionPending で waiting_permission に遷移している
    expect(sessionStore.get("s1")!.status).toBe("waiting_permission");
    expect(decisionStore.getPending()).toHaveLength(2);

    const result = recoverSession("s1");
    expect(result.status).toBe(200);

    // セッションが idle に復帰
    expect(sessionStore.get("s1")!.status).toBe("idle");
    // pending decisions が全て deny 確定
    expect(decisionStore.getPending()).toHaveLength(0);
    expect(decisionStore.get("d1")!.status).toBe("resolved");
    expect(decisionStore.get("d1")!.result).toBe("deny");
    expect(decisionStore.get("d2")!.status).toBe("resolved");
    expect(decisionStore.get("d2")!.result).toBe("deny");

    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("waiting_permission の recover で long-poll waiter が解放される", async () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    decisionStore.register(makeDecisionRequest({ correlation_id: "d1" }));

    const waitPromise = decisionStore.waitForDecision("d1");
    recoverSession("s1");

    const waitResult = await waitPromise;
    expect(waitResult.resolved).toBe(true);
    expect(waitResult.decision).toBe("deny");

    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("waiting_answer → idle に復帰し、decisions は deny しない", () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "AskUserQuestion",
      questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }],
    }));

    expect(sessionStore.get("s1")!.status).toBe("waiting_answer");

    const result = recoverSession("s1");
    expect(result.status).toBe(200);
    expect(sessionStore.get("s1")!.status).toBe("idle");
    // denyBySession が呼ばれていないことを間接的に確認（pending は元々 0）
    expect(decisionStore.getPending()).toHaveLength(0);

    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("running 状態では recover できず 400 を返す", () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    expect(sessionStore.get("s1")!.status).toBe("running");

    const result = recoverSession("s1");
    expect(result.status).toBe(400);
    expect(sessionStore.get("s1")!.status).toBe("running");

    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("存在しないセッション ID では 404 を返す", () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    const result = recoverSession("nonexistent");
    expect(result.status).toBe(404);

    sessionStore.destroy();
    decisionStore.destroy();
  });

  it("recover 後に onDecisionResolved がセッション状態を running に戻さない", () => {
    const { sessionStore, decisionStore, recoverSession } = createWiredStores();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    decisionStore.register(makeDecisionRequest({ correlation_id: "d1" }));

    // server.ts のハンドラは先に recover で idle にしてから denyBySession を呼ぶ。
    // onDecisionResolved は session.status === "waiting_permission" のときだけ
    // running に戻すため、idle のままであることを確認する。
    recoverSession("s1");
    expect(sessionStore.get("s1")!.status).toBe("idle");

    sessionStore.destroy();
    decisionStore.destroy();
  });
});
