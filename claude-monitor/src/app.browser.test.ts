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
