import { describe, it, expect, vi } from "vitest";
import { SessionStore } from "./session-store.js";
import type { HookEvent, SessionStatus } from "./types.js";

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

describe("SessionStore 状態遷移", () => {
  const transitionTests: {
    name: string;
    setup: Partial<HookEvent>[];
    expected: SessionStatus;
  }[] = [
    {
      name: "SessionStart → idle",
      setup: [{ event_type: "SessionStart" }],
      expected: "idle",
    },
    {
      name: "UserPromptSubmit → running",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
      ],
      expected: "running",
    },
    {
      name: "Stop → idle",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
        { event_type: "Stop" },
      ],
      expected: "idle",
    },
    {
      name: "SessionEnd → completed",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "SessionEnd", reason: "done" },
      ],
      expected: "completed",
    },
    {
      name: "PreToolUse(AskUserQuestion) → waiting_answer",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
        { event_type: "PreToolUse", tool_name: "AskUserQuestion", questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }] },
      ],
      expected: "waiting_answer",
    },
    {
      name: "waiting_answer + PreToolUse(other) → running",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
        { event_type: "PreToolUse", tool_name: "AskUserQuestion" },
        { event_type: "PreToolUse", tool_name: "Read" },
      ],
      expected: "running",
    },
    {
      name: "waiting_answer + PostToolUse → running",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
        { event_type: "PreToolUse", tool_name: "AskUserQuestion" },
        { event_type: "PostToolUse", tool_name: "AskUserQuestion" },
      ],
      expected: "running",
    },
    {
      name: "Notification(elicitation_dialog) → waiting_answer",
      setup: [
        { event_type: "SessionStart" },
        { event_type: "UserPromptSubmit", prompt: "hello" },
        { event_type: "Notification", notification_type: "elicitation_dialog" },
      ],
      expected: "waiting_answer",
    },
  ];

  for (const tc of transitionTests) {
    it(tc.name, () => {
      const onChange = vi.fn();
      const store = new SessionStore(onChange);
      let session;
      for (const ev of tc.setup) {
        session = store.processEvent(makeEvent(ev));
      }
      expect(session!.status).toBe(tc.expected);
      store.destroy();
    });
  }
});

describe("SessionStore.recover", () => {
  it("waiting_permission → idle", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    // 内部で直接 waiting_permission に設定（DecisionStore 連携を模擬）
    const session = store.get("s1")!;
    session.status = "waiting_permission";

    const recovered = store.recover("s1");
    expect(recovered).toBeDefined();
    expect(recovered!.status).toBe("idle");
    expect(recovered!.questions).toEqual([]);
    store.destroy();
  });

  it("waiting_answer → idle", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "AskUserQuestion",
      questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }],
    }));

    const recovered = store.recover("s1");
    expect(recovered).toBeDefined();
    expect(recovered!.status).toBe("idle");
    store.destroy();
  });

  it("running 状態では recover 不可", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));

    const recovered = store.recover("s1");
    expect(recovered).toBeUndefined();
    store.destroy();
  });
});
