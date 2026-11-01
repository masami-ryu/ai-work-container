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
    cli_tool: "",
    transcript_path: "",
    progress_text: "",
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

describe("SessionStore error 自動復帰", () => {
  it("error + PreToolUse → running (status も復帰する)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "MCP失敗" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "PreToolUse", tool_name: "Read" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    expect(session.error_at).toBe("");
    store.destroy();
  });

  it("error + PostToolUse → running (status も復帰する)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "エラー" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "PostToolUse", tool_name: "Read" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    store.destroy();
  });

  it("error + SessionEnd → completed (error 復帰はスキップ)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "エラー" }));

    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", reason: "done" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("error + Notification(idle_prompt) → error のまま (復帰しない)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "MCP失敗" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "Notification", notification_type: "idle_prompt" as any }));
    expect(session.status).toBe("error");
    expect(session.error_info).toBe("MCP失敗");
    store.destroy();
  });

  it("error + Stop → idle (Stop でエラー情報もクリア)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "エラー発生" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "Stop" }));
    expect(session.status).toBe("idle");
    expect(session.error_info).toBe("");
    expect(session.error_at).toBe("");
    store.destroy();
  });

  it("error + UserPromptSubmit → running (復帰する)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "エラー" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "retry" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    store.destroy();
  });

  it("error + SessionStart → idle (復帰する)", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "Notification", notification_type: "error", message: "エラー" }));
    expect(store.get("s1")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "SessionStart" }));
    expect(session.status).toBe("idle");
    expect(session.error_info).toBe("");
    store.destroy();
  });
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

describe("SessionStore progress テキスト", () => {
  it("PreToolUse + progress_text で current_progress が更新される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    const session = store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Read",
      progress_text: "ファイルを確認します。",
    }));
    expect(session.current_progress).toBe("ファイルを確認します。");
    expect(session.activities.some(a => a.type === "progress" && a.summary === "ファイルを確認します。")).toBe(true);
    store.destroy();
  });

  it("同一 progress_text の重複は activity に追加されない", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Read",
      progress_text: "ファイルを確認します。",
    }));
    const session = store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Glob",
      progress_text: "ファイルを確認します。",
    }));
    const progressActivities = session.activities.filter(a => a.type === "progress");
    expect(progressActivities.length).toBe(1);
    store.destroy();
  });

  it("Stop 時に current_progress がクリアされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Read",
      progress_text: "ファイルを確認します。",
    }));
    const session = store.processEvent(makeEvent({ event_type: "Stop" }));
    expect(session.current_progress).toBe("");
    store.destroy();
  });

  it("UserPromptSubmit 時に current_progress がクリアされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Read",
      progress_text: "ファイルを確認します。",
    }));
    const session = store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "次のタスク" }));
    expect(session.current_progress).toBe("");
    store.destroy();
  });

  it("空の progress_text では current_progress が変更されない", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", prompt: "hello" }));
    store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Read",
      progress_text: "ファイルを確認します。",
    }));
    const session = store.processEvent(makeEvent({
      event_type: "PreToolUse",
      tool_name: "Glob",
      progress_text: "",
    }));
    expect(session.current_progress).toBe("ファイルを確認します。");
    store.destroy();
  });
});

describe("SessionStore SessionStart 再初期化", () => {
  it("Copilot セッションで SessionStart 再受信時にデータがクリアされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // 初回起動
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "copilot-pane-5", cli_tool: "copilot", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "copilot-pane-5", cli_tool: "copilot", tool_name: "Write", file_path: "/tmp/test.ts" }));
    store.processEvent(makeEvent({ event_type: "Stop", session_id: "copilot-pane-5", cli_tool: "copilot", last_message: "完了" }));

    const before = store.get("copilot-pane-5")!;
    expect(before.title).toBe("hello");
    expect(before.artifacts.length).toBe(1);
    expect(before.activities.length).toBeGreaterThan(0);

    // 同一 pane で Copilot 再起動
    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    expect(session.status).toBe("idle");
    expect(session.title).toBe("");
    expect(session.artifacts).toEqual([]);
    expect(session.activities).toEqual([]);
    expect(session.milestones).toEqual([]);
    expect(session.last_message).toBe("");
    store.destroy();
  });

  it("Copilot セッション再初期化時に last_hook_at, last_init_at, first_prompt_sent がリセットされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    const session = store.get("copilot-pane-5")!;
    // 値を手動設定して再初期化でリセットされることを検証
    session.last_hook_at = "2026-01-01T00:00:00Z";
    session.first_prompt_sent = true;
    session.prompt_ready = false;
    const oldInitAt = session.last_init_at;

    // 少し遅延を入れて再初期化
    const laterTimestamp = new Date(Date.now() + 1000).toISOString();
    store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
      timestamp: laterTimestamp,
    }));
    const reinit = store.get("copilot-pane-5")!;
    expect(reinit.last_hook_at).toBe("");
    expect(reinit.first_prompt_sent).toBe(false);
    expect(reinit.prompt_ready).toBe(true);
    expect(reinit.last_init_at).toBe(laterTimestamp);
    expect(reinit.last_init_at).not.toBe(oldInitAt);
    store.destroy();
  });

  it("新規 Copilot セッション作成時に last_hook_at が空文字列で初期化される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-3", cli_tool: "copilot" }));
    const session = store.get("copilot-pane-3")!;
    expect(session.last_hook_at).toBe("");
    expect(session.last_init_at).toBeTruthy();
    expect(session.first_prompt_sent).toBe(false);
    expect(session.prompt_ready).toBe(true);
    store.destroy();
  });

  it("Claude セッションで SessionStart 再受信時にデータが保持される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // セッション開始 → 作業 → 停止
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "s1", tool_name: "Write", file_path: "/tmp/test.ts" }));
    store.processEvent(makeEvent({ event_type: "Stop", session_id: "s1", last_message: "完了" }));

    const before = store.get("s1")!;
    expect(before.title).toBe("hello");
    expect(before.artifacts.length).toBe(1);

    // 同一 session_id で SessionStart 再受信（Claude 経路: cli_tool は空）
    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    expect(session.status).toBe("idle");
    // Claude 経路ではデータが保持される
    expect(session.title).toBe("hello");
    expect(session.artifacts.length).toBe(1);
    expect(session.activities.length).toBeGreaterThan(0);
    store.destroy();
  });
});

describe("Copilot SessionEnd reason ベースステータス遷移", () => {
  it("TEST-001: Copilot SessionEnd reason=complete → idle", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "cp1", cli_tool: "copilot", prompt: "hello" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "complete" }));
    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(false);
    expect(session.current_progress).toBe("");
    expect(session.questions).toEqual([]);
    store.destroy();
  });

  it("TEST-002: Copilot SessionEnd reason=user_exit → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "user_exit" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("TEST-003: Copilot SessionEnd reason='' (空) → completed（保守的デフォルト）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("TEST-006: Claude SessionEnd は従来通り completed に遷移", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "s1", reason: "complete" }));
    // Claude Code では reason に関係なく常に completed
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("TEST-014: Copilot SessionEnd 未知 reason → completed + warning ログ", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "unknown_value" }));
    expect(session.status).toBe("completed");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown reason"));
    warnSpy.mockRestore();
    store.destroy();
  });

  it("TEST-015: Copilot SessionEnd reason=user_quit → user_exit に正規化 → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "user_quit" }));
    expect(session.status).toBe("completed");
    // user_quit は user_exit に正規化されるため、warning は出ない
    store.destroy();
  });

  it("Copilot SessionEnd reason=error → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "error" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("Copilot SessionEnd reason=abort → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "abort" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("Copilot SessionEnd reason=timeout → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp1", cli_tool: "copilot", reason: "timeout" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });
});

describe("Copilot idle → running 復帰", () => {
  it("TEST-004: Copilot idle + PreToolUse(non-AskUserQuestion) → running", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    expect(store.get("cp1")!.status).toBe("idle");

    const session = store.processEvent(makeEvent({ event_type: "PreToolUse", session_id: "cp1", cli_tool: "copilot", tool_name: "Read" }));
    expect(session.status).toBe("running");
    store.destroy();
  });

  it("TEST-005: Copilot idle + PostToolUse → running", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    expect(store.get("cp1")!.status).toBe("idle");

    const session = store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "cp1", cli_tool: "copilot", tool_name: "Read" }));
    expect(session.status).toBe("running");
    store.destroy();
  });

  it("Claude idle + PreToolUse → idle のまま（Copilot 固有ロジックは適用されない）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    expect(store.get("s1")!.status).toBe("idle");

    // Claude では idle + PreToolUse(non-AskUserQuestion) は状態変更なし
    const session = store.processEvent(makeEvent({ event_type: "PreToolUse", session_id: "s1", tool_name: "Read" }));
    expect(session.status).toBe("idle");
    store.destroy();
  });

  it("Copilot idle + PreToolUse(AskUserQuestion) → waiting_answer（idle→running 復帰はスキップ）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp1", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({
      event_type: "PreToolUse",
      session_id: "cp1",
      cli_tool: "copilot",
      tool_name: "AskUserQuestion",
      questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }],
    }));
    expect(session.status).toBe("waiting_answer");
    store.destroy();
  });
});

describe("Copilot prompt_ready 遷移", () => {
  it("SessionStart は prompt_ready=true で初期化される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp-ready-1", cli_tool: "copilot" }));
    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(true);
    store.destroy();
  });

  it("UserPromptSubmit 後は prompt_ready=false になる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp-ready-2", cli_tool: "copilot" }));
    const session = store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "cp-ready-2", cli_tool: "copilot", prompt: "hello" }));
    expect(session.status).toBe("running");
    expect(session.prompt_ready).toBe(false);
    store.destroy();
  });

  it("問題シーケンス: UserPromptSubmit → SessionEnd(complete) でも prompt_ready は false を維持する", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "cp-ready-3", cli_tool: "copilot" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "cp-ready-3", cli_tool: "copilot", prompt: "hello" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "cp-ready-3", cli_tool: "copilot", reason: "complete" }));
    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(false);
    store.destroy();
  });
});

// ============================================================
// Codex CLI 統合テスト
// ============================================================

describe("Codex createSession with cli_tool", () => {
  it("createSession with cli_tool='codex' sets cli_tool correctly", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }));
    expect(session.cli_tool).toBe("codex");
    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(true);
    expect(session.external_session_id).toBe("");
    expect(session.last_hook_at).toBe("");
    expect(session.first_prompt_sent).toBe(false);
    store.destroy();
  });
});

describe("Codex SessionStart 再初期化", () => {
  it("Codex セッションで SessionStart 再受信時にデータがクリアされる（external_session_id 含む）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // 初回起動
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "fix bug" }));
    store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "codex-pane-7", cli_tool: "codex", tool_name: "Write", file_path: "/tmp/test.ts" }));
    store.processEvent(makeEvent({ event_type: "Stop", session_id: "codex-pane-7", cli_tool: "codex", last_message: "完了" }));

    const before = store.get("codex-pane-7")!;
    expect(before.title).toBe("fix bug");
    expect(before.artifacts.length).toBe(1);
    // external_session_id を手動設定（フック経由で設定される想定）
    before.external_session_id = "thread-abc-123";

    // 同一 pane で Codex 再起動
    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(session.status).toBe("idle");
    expect(session.title).toBe("");
    expect(session.artifacts).toEqual([]);
    expect(session.activities).toEqual([]);
    expect(session.milestones).toEqual([]);
    expect(session.last_message).toBe("");
    expect(session.external_session_id).toBe("");
    store.destroy();
  });
});

describe("Codex SessionEnd は常に completed に遷移", () => {
  it("Codex SessionEnd reason=complete → completed（Copilot のように idle にはならない）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "hello" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "codex-pane-7", cli_tool: "codex", reason: "complete" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("Codex SessionEnd reason=user_exit → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "codex-pane-7", cli_tool: "codex", reason: "user_exit" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });

  it("Codex SessionEnd reason='' → completed", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    const session = store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "codex-pane-7", cli_tool: "codex", reason: "" }));
    expect(session.status).toBe("completed");
    store.destroy();
  });
});

describe("Codex idle → running 復帰", () => {
  it("Codex idle + PreToolUse(non-AskUserQuestion) → running", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(store.get("codex-pane-7")!.status).toBe("idle");

    const session = store.processEvent(makeEvent({ event_type: "PreToolUse", session_id: "codex-pane-7", cli_tool: "codex", tool_name: "Read" }));
    expect(session.status).toBe("running");
    store.destroy();
  });

  it("Codex idle + PostToolUse → running", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(store.get("codex-pane-7")!.status).toBe("idle");

    const session = store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "codex-pane-7", cli_tool: "codex", tool_name: "Read" }));
    expect(session.status).toBe("running");
    store.destroy();
  });

  it("Codex idle + PreToolUse(AskUserQuestion) → waiting_answer（idle→running 復帰はスキップ）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    const session = store.processEvent(makeEvent({
      event_type: "PreToolUse",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      tool_name: "AskUserQuestion",
      questions: [{ question: "Q?", header: "h", options: [], multiSelect: false }],
    }));
    expect(session.status).toBe("waiting_answer");
    store.destroy();
  });
});

describe("Codex error → recovery via ERROR_RECOVERY_EVENTS", () => {
  it("Codex error + PreToolUse → running（自動復帰）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", session_id: "codex-pane-7", notification_type: "error", message: "MCP接続失敗" }));
    expect(store.get("codex-pane-7")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "PreToolUse", session_id: "codex-pane-7", cli_tool: "codex", tool_name: "Read" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    expect(session.error_at).toBe("");
    store.destroy();
  });

  it("Codex error + PostToolUse → running（自動復帰）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "Notification", session_id: "codex-pane-7", notification_type: "error", message: "エラー" }));
    expect(store.get("codex-pane-7")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "PostToolUse", session_id: "codex-pane-7", cli_tool: "codex", tool_name: "Read" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    store.destroy();
  });

  it("Codex error + UserPromptSubmit → running（復帰する）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "Notification", session_id: "codex-pane-7", notification_type: "error", message: "エラー" }));
    expect(store.get("codex-pane-7")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "retry" }));
    expect(session.status).toBe("running");
    expect(session.error_info).toBe("");
    store.destroy();
  });

  it("Codex error + SessionStart → idle（復帰する）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "Notification", session_id: "codex-pane-7", notification_type: "error", message: "エラー" }));
    expect(store.get("codex-pane-7")!.status).toBe("error");

    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(session.status).toBe("idle");
    expect(session.error_info).toBe("");
    store.destroy();
  });
});

describe("Codex 同一 pane 再起動で external_session_id がリセットされる", () => {
  it("same pane re-launch resets external_session_id", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // 初回セッション作成
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    const session = store.get("codex-pane-7")!;
    // フック経由で external_session_id が設定される想定
    session.external_session_id = "thread-xyz-456";
    expect(session.external_session_id).toBe("thread-xyz-456");

    // 同一 pane で再起動（SessionStart 再受信）
    const reInitSession = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(reInitSession.external_session_id).toBe("");
    expect(reInitSession.status).toBe("idle");
    expect(reInitSession.first_prompt_sent).toBe(false);
    store.destroy();
  });
});

// ============================================================
// TASK-011: SessionStore.cleanup Codex staleness 対策テスト
// ============================================================

describe("SessionStore.cleanup Codex staleness 対策", () => {
  it("TASK-011: running Codex セッションが10分経過後も idle に誤遷移しない", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // Codex セッション作成
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "fix bug" }));
    const session = store.get("codex-pane-7")!;
    expect(session.status).toBe("running");

    // 10分 + cleanup interval を超える時間を進める（staleness timeout を超過させる）
    vi.advanceTimersByTime(15 * 60 * 1000);

    // cleanup が実行されても Codex セッションは idle に遷移しない
    expect(session.status).toBe("running");
    expect(session.prompt_ready).toBe(false);
    store.destroy();
    vi.useRealTimers();
  });

  it("TASK-011: 非 Codex (Claude) セッションは従来通り10分で idle に遷移する", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // Claude セッション作成
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    const session = store.get("s1")!;
    expect(session.status).toBe("running");

    // 10分 + cleanup interval を超える時間を進める
    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(session.status).toBe("idle");
    expect(session.prompt_ready).toBe(true);
    store.destroy();
    vi.useRealTimers();
  });

  it("TASK-011: Codex セッションの hard timeout 超過で onHardTimeout が呼ばれる", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onHardTimeout = vi.fn();
    store.onHardTimeout = onHardTimeout;

    // Codex セッション作成（古い last_run_started_at で hard timeout 超過を模擬）
    const oldTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex", timestamp: oldTime }));
    store.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      prompt: "fix bug",
      timestamp: oldTime,
    }));
    const session = store.get("codex-pane-7")!;
    expect(session.status).toBe("running");

    // hard timeout (10分) 超過分 + cleanup interval 分を進める
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(onHardTimeout).toHaveBeenCalledWith("codex-pane-7");
    // onHardTimeout が呼ばれても store 側では idle 遷移しない（コールバック側で処理）
    expect(session.status).toBe("running");
    store.destroy();
    vi.useRealTimers();
  });

  it("TASK-011: onHardTimeout 未設定時は hard timeout 超過でもエラーにならない", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // onHardTimeout は設定しない

    const oldTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex", timestamp: oldTime }));
    store.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      prompt: "fix bug",
      timestamp: oldTime,
    }));

    // hard timeout 超過分を進めてもエラーにならない
    expect(() => vi.advanceTimersByTime(10 * 60 * 1000)).not.toThrow();
    const session = store.get("codex-pane-7")!;
    expect(session.status).toBe("running");
    store.destroy();
    vi.useRealTimers();
  });
});

// ============================================================
// TASK-012: last_run_started_at の UserPromptSubmit 更新テスト
// ============================================================

describe("last_run_started_at の更新", () => {
  it("TASK-012: UserPromptSubmit で last_run_started_at が現在時刻で設定される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    const session = store.get("s1")!;
    expect(session.last_run_started_at).toBe("");

    const timestamp = new Date().toISOString();
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello", timestamp }));
    expect(session.last_run_started_at).toBe(timestamp);
    store.destroy();
  });

  it("TASK-012: Codex UserPromptSubmit で last_run_started_at が更新される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    const session = store.get("codex-pane-7")!;
    expect(session.last_run_started_at).toBe("");

    const timestamp = new Date().toISOString();
    store.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      prompt: "fix bug",
      timestamp,
    }));
    expect(session.last_run_started_at).toBe(timestamp);
    store.destroy();
  });

  it("TASK-012: Codex SessionStart 再初期化で last_run_started_at がリセットされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      prompt: "fix bug",
    }));
    const session = store.get("codex-pane-7")!;
    expect(session.last_run_started_at).toBeTruthy();

    // 再初期化
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(session.last_run_started_at).toBe("");
    store.destroy();
  });
});

// ============================================================
// run_id 世代管理テスト
// ============================================================

describe("run_id 世代管理", () => {
  it("新規セッション作成時に run_id=1 で初期化される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(session.run_id).toBe(1);
    store.destroy();
  });

  it("プレセッション→実セッション遷移（last_run_started_at=''）では run_id を維持", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    // プレセッション（SessionStart のみ、UserPromptSubmit なし）
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    const session = store.get("copilot-pane-5")!;
    expect(session.run_id).toBe(1);
    expect(session.last_run_started_at).toBe("");

    // 再初期化（実セッション化）→ run_id は維持
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    expect(session.run_id).toBe(1);
    expect(onInvalidate).not.toHaveBeenCalled();
    store.destroy();
  });

  it("UserPromptSubmit 受信済みセッションの SessionStart で run_id がインクリメントされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "copilot-pane-5", cli_tool: "copilot", prompt: "hello" }));

    expect(store.get("copilot-pane-5")!.run_id).toBe(1);

    // 再初期化（last_run_started_at !== "" のためインクリメント）
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    expect(store.get("copilot-pane-5")!.run_id).toBe(2);
    expect(onInvalidate).toHaveBeenCalledWith("copilot-pane-5");
    store.destroy();
  });

  it("completed セッションの SessionStart で run_id がインクリメントされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "codex-pane-7", cli_tool: "codex", reason: "done" }));
    expect(store.get("codex-pane-7")!.status).toBe("completed");

    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    expect(store.get("codex-pane-7")!.run_id).toBe(2);
    expect(onInvalidate).toHaveBeenCalledWith("codex-pane-7");
    store.destroy();
  });

  it("手入力中心 Copilot run（UserPromptSubmit 設定済み）後の SessionStart で run_id がインクリメント", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    // first_prompt_sent=false だが UserPromptSubmit で last_run_started_at は設定される
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "copilot-pane-5", cli_tool: "copilot", prompt: "hi" }));
    // SessionEnd(complete) → idle
    store.processEvent(makeEvent({ event_type: "SessionEnd", session_id: "copilot-pane-5", cli_tool: "copilot", reason: "complete" }));

    // 再初期化: last_run_started_at !== "" のためインクリメント
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    expect(store.get("copilot-pane-5")!.run_id).toBe(2);
    expect(onInvalidate).toHaveBeenCalledWith("copilot-pane-5");
    store.destroy();
  });

  it("Claude セッションでは run_id がインクリメントされない（再初期化ロジック非適用）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));

    // Claude は Copilot/Codex 再初期化ブロックを通らないので run_id は 1 のまま
    expect(store.get("s1")!.run_id).toBe(1);
    expect(onInvalidate).not.toHaveBeenCalled();
    store.destroy();
  });

  // Known limitation: Codex 同一 pane 短時間再起動シナリオ
  // pane_pid 検知未実装のため Phase 3 TASK-024 で対応予定
  it("Known limitation: Codex 同一 pane 短時間再起動（前セッション未 completed、合成 SessionStart 非発火）で run_id が進まない", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const onInvalidate = vi.fn();
    store.onInvalidateBySession = onInvalidate;

    // Codex セッション開始、running 状態のまま（未 completed）
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "codex-pane-7", cli_tool: "codex" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "codex-pane-7", cli_tool: "codex", prompt: "fix" }));
    expect(store.get("codex-pane-7")!.status).toBe("running");
    expect(store.get("codex-pane-7")!.run_id).toBe(1);

    // 同一 pane で Codex プロセスが短時間で再起動した場合、
    // notify.sh の SessionStart が発火しない（Codex は Stop のみ送信）ため
    // 合成 SessionStart も非 completed セッション存在時は生成されない。
    // → run_id は進まない（pane_pid 変化検知は Phase 3 TASK-024 のスコープ）
    // Known limitation: pane_pid 検知未実装のため Phase 3 TASK-024 で対応予定
    expect(store.get("codex-pane-7")!.run_id).toBe(1);
    expect(onInvalidate).not.toHaveBeenCalled();
    store.destroy();
  });
});

// ============================================================
// updateTerminalEventSummary テスト
// ============================================================

describe("updateTerminalEventSummary", () => {
  it("terminal_event_count と terminal_event_latest_seq を更新する", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    onChange.mockClear();

    store.updateTerminalEventSummary("s1", 10, 15);
    const session = store.get("s1")!;
    expect(session.terminal_event_count).toBe(10);
    expect(session.terminal_event_latest_seq).toBe(15);
  });

  it("onChange を発火しない（silent 更新）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    onChange.mockClear();

    store.updateTerminalEventSummary("s1", 10, 15);
    expect(onChange).not.toHaveBeenCalled();
    store.destroy();
  });

  it("updated_at を変更しない（cleanup の stale 判定に影響しない）", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    const updatedAtBefore = store.get("s1")!.updated_at;

    store.updateTerminalEventSummary("s1", 10, 15);
    expect(store.get("s1")!.updated_at).toBe(updatedAtBefore);
    store.destroy();
  });

  it("terminal event 連続更新中でも cleanup の stale 判定が従来どおり動作する", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    const session = store.get("s1")!;
    expect(session.status).toBe("running");

    // terminal event の summary を頻繁に更新
    for (let i = 0; i < 100; i++) {
      store.updateTerminalEventSummary("s1", i, i);
    }

    // 15分進める（staleness timeout 超過）
    vi.advanceTimersByTime(15 * 60 * 1000);

    // updated_at は summary 更新で変わらないため、stale 判定で idle に遷移する
    expect(session.status).toBe("idle");
    store.destroy();
    vi.useRealTimers();
  });

  it("存在しないセッションでは何もしない", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // エラーにならないことを確認
    expect(() => store.updateTerminalEventSummary("nonexistent", 10, 15)).not.toThrow();
    store.destroy();
  });

  it("SessionStart 再初期化で terminal_event_count/latest_seq がリセットされる", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    store.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "copilot-pane-5", cli_tool: "copilot", prompt: "hello" }));
    store.updateTerminalEventSummary("copilot-pane-5", 50, 100);
    expect(store.get("copilot-pane-5")!.terminal_event_count).toBe(50);

    // 再初期化
    store.processEvent(makeEvent({ event_type: "SessionStart", session_id: "copilot-pane-5", cli_tool: "copilot" }));
    expect(store.get("copilot-pane-5")!.terminal_event_count).toBe(0);
    expect(store.get("copilot-pane-5")!.terminal_event_latest_seq).toBe(0);
    store.destroy();
  });
});

// ============================================================
// TASK-022: approvalSupported 条件分岐テスト
// ============================================================

describe("Codex approvalSupported の条件分岐", () => {
  it("デフォルト（options なし）: Codex は approvalSupported=false", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }));
    expect(session.approvalSupported).toBe(false);
    store.destroy();
  });

  it("codexCaptureApproval=true: Codex は approvalSupported=true", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }), { codexCaptureApproval: true });
    expect(session.approvalSupported).toBe(true);
    store.destroy();
  });

  it("codexCaptureApproval=false: Codex は approvalSupported=false", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }), { codexCaptureApproval: false });
    expect(session.approvalSupported).toBe(false);
    store.destroy();
  });

  it("Copilot は options に関係なく常に approvalSupported=true", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "copilot-pane-5",
      cli_tool: "copilot",
    }), { codexCaptureApproval: false });
    expect(session.approvalSupported).toBe(true);
    store.destroy();
  });

  it("Claude は options に関係なく常に approvalSupported=true", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "s1",
    }));
    expect(session.approvalSupported).toBe(true);
    store.destroy();
  });

  it("Codex 再初期化時に codexCaptureApproval が反映される", () => {
    const onChange = vi.fn();
    const store = new SessionStore(onChange);
    // 初回: capture 無効
    store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }));
    expect(store.get("codex-pane-7")!.approvalSupported).toBe(false);

    // UserPromptSubmit + 再初期化: capture 有効
    store.processEvent(makeEvent({
      event_type: "UserPromptSubmit",
      session_id: "codex-pane-7",
      cli_tool: "codex",
      prompt: "fix",
    }));
    const session = store.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-pane-7",
      cli_tool: "codex",
    }), { codexCaptureApproval: true });
    expect(session.approvalSupported).toBe(true);
    store.destroy();
  });
});
