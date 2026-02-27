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
