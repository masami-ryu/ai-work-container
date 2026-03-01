// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// app.js から公開されたテスト用 API
let appApi: {
  renderCard: (session: Record<string, unknown>) => string;
  setPendingDecisions: (v: Record<string, unknown>) => void;
  setPendingQuestions: (v: Record<string, unknown>) => void;
  setGroups: (v: Record<string, unknown>) => void;
  setPromptTemplates: (v: Record<string, unknown>) => void;
  stripAnsi: (str: string) => string;
  setTerminalLogs: (v: Record<string, unknown[]>) => void;
  setTerminalLogVisible: (v: Record<string, boolean>) => void;
  getTerminalLogs: () => Record<string, unknown[]>;
  handleMessage: (msg: Record<string, unknown>) => void;
  renderCaptureActionPanel: (session: Record<string, unknown>) => string;
};

beforeAll(() => {
  // app.js が依存する DOM 要素を作成
  [
    "sessions-container", "empty-message", "connection-status",
    "active-count", "mute-btn", "notification-btn", "event-log",
    "log-count", "sidebar", "group-content-header", "group-artifacts-panel",
  ].forEach((id) => {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  });

  // ブラウザ API をモック
  (globalThis as any).WebSocket = class MockWebSocket {
    onopen: any = null;
    onclose: any = null;
    onerror: any = null;
    onmessage: any = null;
    close = vi.fn();
    send = vi.fn();
  };
  (globalThis as any).Notification = Object.assign(vi.fn(), {
    permission: "denied",
    requestPermission: vi.fn().mockResolvedValue("denied"),
  });
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve([]),
  });

  // app.js を読み込んで IIFE で実行し、テスト用 API を公開
  const appJsPath = path.resolve(__dirname, "../public/app.js");
  const code = fs.readFileSync(appJsPath, "utf-8");
  const wrapped = `(function() {
    ${code}
    globalThis.__appTestApi = {
      renderCard: renderCard,
      setPendingDecisions: function(v) { pendingDecisions = v; },
      setPendingQuestions: function(v) { pendingQuestions = v; },
      setGroups: function(v) { groups = v; },
      setPromptTemplates: function(v) { promptTemplates = v; },
      stripAnsi: stripAnsi,
      setTerminalLogs: function(v) { terminalLogs = v; },
      setTerminalLogVisible: function(v) { terminalLogVisible = v; },
      getTerminalLogs: function() { return terminalLogs; },
      handleMessage: handleMessage,
      renderCaptureActionPanel: renderCaptureActionPanel,
    };
  })();`;

  // eslint-disable-next-line no-eval
  (0, eval)(wrapped);
  appApi = (globalThis as any).__appTestApi;
});

beforeEach(() => {
  appApi.setPendingDecisions({});
  appApi.setPendingQuestions({});
  appApi.setGroups({});
  appApi.setPromptTemplates({});
});

function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "test-session-1",
    cwd: "/tmp",
    model: "opus",
    status: "running",
    status_text: "",
    cli_tool: "claude",
    milestones: [],
    last_message: "",
    last_activity: "",
    current_progress: "",
    artifacts: [],
    title: "テストセッション",
    error_info: "",
    tmux_pane: "%1",
    last_hook_at: "",
    last_init_at: new Date().toISOString(),
    last_run_started_at: "",
    first_prompt_sent: false,
    prompt_ready: false,
    approvalSupported: true,
    external_session_id: "",
    error_at: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    activities: [],
    questions: [],
    ...overrides,
  };
}

describe("Codex 承認非対応バナー表示", () => {
  it("cli_tool=codex かつ approvalSupported=false でバナーが表示される", () => {
    const session = createMockSession({
      cli_tool: "codex",
      approvalSupported: false,
    });

    const html = appApi.renderCard(session);
    expect(html).toContain("approval-unsupported-banner");
    expect(html).toContain("Codex の承認操作はブラウザから行えません");
  });

  it("cli_tool=claude ではバナーが表示されない", () => {
    const session = createMockSession({
      cli_tool: "claude",
      approvalSupported: true,
    });

    const html = appApi.renderCard(session);
    expect(html).not.toContain("approval-unsupported-banner");
  });

  it("cli_tool=copilot ではバナーが表示されない", () => {
    const session = createMockSession({
      cli_tool: "copilot",
      approvalSupported: true,
    });

    const html = appApi.renderCard(session);
    expect(html).not.toContain("approval-unsupported-banner");
  });

  it("cli_tool=codex でも approvalSupported=true ならバナーが表示されない", () => {
    const session = createMockSession({
      cli_tool: "codex",
      approvalSupported: true,
    });

    const html = appApi.renderCard(session);
    expect(html).not.toContain("approval-unsupported-banner");
  });

  it("pending decision がなくてもバナーが表示される", () => {
    const session = createMockSession({
      cli_tool: "codex",
      approvalSupported: false,
      status: "idle",
    });

    const html = appApi.renderCard(session);
    expect(html).toContain("approval-unsupported-banner");
  });
});

// ============================================================
// TASK-011: ターミナルログパネル テスト
// ============================================================

describe("stripAnsi ユーティリティ", () => {
  it("ANSI エスケープシーケンスを除去する", () => {
    expect(appApi.stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("複数の ANSI コードを除去する", () => {
    expect(appApi.stripAnsi("\x1b[1m\x1b[32mbold green\x1b[0m")).toBe("bold green");
  });

  it("ANSI なしの文字列はそのまま返す", () => {
    expect(appApi.stripAnsi("plain text")).toBe("plain text");
  });
});

describe("ターミナルログパネル XSS 対策", () => {
  it("<script>alert(1)</script> を含むログイベントが無害に表示される", () => {
    const session = createMockSession({ session_id: "xss-test" });
    appApi.setTerminalLogs({
      "xss-test": [
        { id: "e1", text: '<script>alert(1)</script>', type: "output", event_state: "pending" },
      ],
    });

    const html = appApi.renderCard(session);
    // renderCard の HTML 内にログパネルのコンテナがある
    expect(html).toContain("terminal-log-panel");
    // <script> タグがそのまま innerHTML に注入されていないことを確認
    expect(html).not.toContain("<script>alert(1)</script>");
    appApi.setTerminalLogs({});
  });

  it("ANSI エスケープシーケンスが除去されて表示される", () => {
    // stripAnsi のテストで十分だが、統合テストとして確認
    const result = appApi.stripAnsi("\x1b[31mred\x1b[0m text");
    expect(result).toBe("red text");
    expect(result).not.toContain("\x1b");
  });
});

describe("ターミナルログ ON/OFF トグル", () => {
  it("デフォルトではログパネルが表示される", () => {
    const session = createMockSession({ session_id: "toggle-test" });
    appApi.setTerminalLogs({
      "toggle-test": [
        { id: "e1", text: "test output", type: "output", event_state: "pending" },
      ],
    });

    const html = appApi.renderCard(session);
    expect(html).toContain("terminal-log-panel");
    appApi.setTerminalLogs({});
  });
});

describe("terminal_event_batch WebSocket ハンドラ", () => {
  it("terminal_event_batch メッセージでログが蓄積される", () => {
    appApi.setTerminalLogs({});
    appApi.handleMessage({
      type: "terminal_event_batch",
      payload: {
        session_id: "ws-test",
        events: [
          { id: "e1", text: "line 1", type: "output", event_state: "pending" },
          { id: "e2", text: "line 2", type: "output", event_state: "pending" },
        ],
      },
    });

    const logs = appApi.getTerminalLogs();
    expect(logs["ws-test"]).toHaveLength(2);
    expect((logs["ws-test"][0] as any).text).toBe("line 1");
    appApi.setTerminalLogs({});
  });
});

// ============================================================
// TASK-013: 操作ボタン UI テスト
// ============================================================

describe("capture アクションパネル", () => {
  it("pending trigger イベントがある場合にアクションパネルが描画される", () => {
    const session = createMockSession({
      session_id: "capture-test",
      status: "running",
      cli_tool: "codex",
    });
    appApi.setTerminalLogs({
      "capture-test": [
        { id: "t1", text: "Do you want to proceed? (y/n)", type: "trigger", event_state: "pending" },
      ],
    });

    const html = appApi.renderCaptureActionPanel(session);
    expect(html).toContain("capture-action-panel");
    expect(html).toContain("btn-capture-yes");
    expect(html).toContain("btn-capture-no");
    expect(html).toContain("btn-capture-yes-always");
    appApi.setTerminalLogs({});
  });

  it("trigger イベントがない場合はアクションパネルが空", () => {
    const session = createMockSession({
      session_id: "no-trigger",
      status: "running",
    });
    appApi.setTerminalLogs({ "no-trigger": [] });

    const html = appApi.renderCaptureActionPanel(session);
    expect(html).toBe("");
    appApi.setTerminalLogs({});
  });

  it("running ステータスでも capture 起点のアクション UI が表示される", () => {
    const session = createMockSession({
      session_id: "status-test",
      status: "running",
    });
    appApi.setTerminalLogs({
      "status-test": [
        { id: "t1", text: "Apply? (y/n)", type: "trigger", event_state: "pending" },
      ],
    });

    const html = appApi.renderCaptureActionPanel(session);
    expect(html).toContain("capture-action-panel");
    appApi.setTerminalLogs({});
  });

  it("waiting_permission ステータスでも capture 起点のアクション UI が表示される", () => {
    const session = createMockSession({
      session_id: "wp-test",
      status: "waiting_permission",
    });
    appApi.setTerminalLogs({
      "wp-test": [
        { id: "t1", text: "Apply? (y/n)", type: "trigger", event_state: "pending" },
      ],
    });

    const html = appApi.renderCaptureActionPanel(session);
    expect(html).toContain("capture-action-panel");
    appApi.setTerminalLogs({});
  });

  it("consumed trigger イベントではアクションパネルが表示されない", () => {
    const session = createMockSession({
      session_id: "consumed-test",
      status: "running",
    });
    appApi.setTerminalLogs({
      "consumed-test": [
        { id: "t1", text: "Apply? (y/n)", type: "trigger", event_state: "consumed" },
      ],
    });

    const html = appApi.renderCaptureActionPanel(session);
    expect(html).toBe("");
    appApi.setTerminalLogs({});
  });
});

describe("CLI ツールバッジ表示", () => {
  it("Claude セッションには Claude バッジが表示される", () => {
    const html = appApi.renderCard(createMockSession({ cli_tool: "claude" }));
    expect(html).toContain("badge-claude");
    expect(html).toContain(">Claude<");
  });

  it("Codex セッションには Codex バッジが表示される", () => {
    const html = appApi.renderCard(createMockSession({ cli_tool: "codex" }));
    expect(html).toContain("badge-codex");
    expect(html).toContain(">Codex<");
  });

  it("Copilot セッションには Copilot バッジが表示される", () => {
    const html = appApi.renderCard(createMockSession({ cli_tool: "copilot" }));
    expect(html).toContain("badge-copilot");
    expect(html).toContain(">Copilot<");
  });
});
