import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSessionId } from "./mcp-handler.js";
import { SessionStore } from "./session-store.js";
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

// ──────────────────────────────────────────────────────────────
// TEST-005: ask_user セッションバインディング（strict: true）
// ──────────────────────────────────────────────────────────────

describe("resolveSessionId strict モード (ask_user 用)", () => {
  it("アクティブセッション1つ + session_id 未指定 → 自動紐付け成功", () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined, { strict: true });
    expect(result).toBe("s1");

    sessionStore.destroy();
  });

  it("アクティブセッション2つ以上 + session_id 未指定 → null（エラー）", async () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined, { strict: true });
    expect(result).toBeNull();

    sessionStore.destroy();
  });

  it("アクティブセッション0 + session_id 未指定 → null（エラー）", () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined, { strict: true });
    expect(result).toBeNull();

    sessionStore.destroy();
  });

  it("session_id 指定時 → 指定セッションへ紐付け（strict でも動作）", () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", "s1", { strict: true });
    expect(result).toBe("s1");

    sessionStore.destroy();
  });

  it("バインド済みセッションがアクティブなら strict でもそのまま返す", async () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    // s1 にバインド
    sessionBindings.set("mcp-1", "s1");

    // strict でもバインド済みならそのまま s1 を返す
    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined, { strict: true });
    expect(result).toBe("s1");

    sessionStore.destroy();
  });
});

// ──────────────────────────────────────────────────────────────
// TEST-005b: resolveSessionId の update_status / report_milestone 回帰テスト（strict: false）
// ──────────────────────────────────────────────────────────────

describe("resolveSessionId 非strict モード (update_status / report_milestone 用)", () => {
  it("アクティブセッション2つ以上 + session_id 未指定 → 最新セッションへ自動紐付け成功", async () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));
    await new Promise(r => setTimeout(r, 10));
    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s2" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s2", prompt: "world" }));

    // strict: false（デフォルト）
    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined);
    // 最新の s2 に紐付く
    expect(result).toBe("s2");

    sessionStore.destroy();
  });

  it("アクティブセッション1つ + session_id 未指定 → 自動紐付け成功", () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    sessionStore.processEvent(makeEvent({ event_type: "SessionStart", session_id: "s1" }));
    sessionStore.processEvent(makeEvent({ event_type: "UserPromptSubmit", session_id: "s1", prompt: "hello" }));

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined);
    expect(result).toBe("s1");

    sessionStore.destroy();
  });

  it("アクティブセッション0 + session_id 未指定 → null", () => {
    const sessionStore = new SessionStore(vi.fn());
    const sessionBindings = new Map<string, string>();

    const result = resolveSessionId(sessionStore, sessionBindings, "mcp-1", undefined);
    expect(result).toBeNull();

    sessionStore.destroy();
  });
});

// ──────────────────────────────────────────────────────────────
// 追加: approvalSupported フィールドの検証
// ──────────────────────────────────────────────────────────────

describe("Session approvalSupported フィールド", () => {
  it("Claude セッションは approvalSupported=true", () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "claude-1",
      cli_tool: "",
    }));

    const session = sessionStore.get("claude-1");
    expect(session?.approvalSupported).toBe(true);
    expect(session?.cli_tool).toBe("claude");

    sessionStore.destroy();
  });

  it("Copilot セッションは approvalSupported=true", () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "copilot-1",
      cli_tool: "copilot",
    }));

    const session = sessionStore.get("copilot-1");
    expect(session?.approvalSupported).toBe(true);
    expect(session?.cli_tool).toBe("copilot");

    sessionStore.destroy();
  });

  it("Codex セッションは approvalSupported=false", () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-1",
      cli_tool: "codex",
    }));

    const session = sessionStore.get("codex-1");
    expect(session?.approvalSupported).toBe(false);
    expect(session?.cli_tool).toBe("codex");

    sessionStore.destroy();
  });

  it("同一 session_id の再初期化で cli_tool 変更時に approvalSupported が同期される", () => {
    const sessionStore = new SessionStore(vi.fn());

    // 1. cli_tool="" (claude) で初期化 → approvalSupported=true
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "pane-1",
      cli_tool: "",
    }));
    expect(sessionStore.get("pane-1")?.approvalSupported).toBe(true);
    expect(sessionStore.get("pane-1")?.cli_tool).toBe("claude");

    // 2. 同一 session_id で cli_tool="codex" に再初期化 → approvalSupported=false
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "pane-1",
      cli_tool: "codex",
    }));
    expect(sessionStore.get("pane-1")?.cli_tool).toBe("codex");
    expect(sessionStore.get("pane-1")?.approvalSupported).toBe(false);

    // 3. 同一 session_id で cli_tool="copilot" に再初期化 → approvalSupported=true
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "pane-1",
      cli_tool: "copilot",
    }));
    expect(sessionStore.get("pane-1")?.cli_tool).toBe("copilot");
    expect(sessionStore.get("pane-1")?.approvalSupported).toBe(true);

    sessionStore.destroy();
  });

  it("approvalSupported は /api/sessions レスポンスに含まれる（Session 型に存在）", () => {
    const sessionStore = new SessionStore(vi.fn());
    sessionStore.processEvent(makeEvent({
      event_type: "SessionStart",
      session_id: "codex-2",
      cli_tool: "codex",
    }));

    const allSessions = sessionStore.getAll();
    const codexSession = allSessions.find(s => s.session_id === "codex-2");
    expect(codexSession).toBeDefined();
    expect(codexSession!.approvalSupported).toBe(false);
    // JSON シリアライズ時に approvalSupported が含まれることを確認
    const json = JSON.parse(JSON.stringify(codexSession));
    expect(json.approvalSupported).toBe(false);

    sessionStore.destroy();
  });
});
