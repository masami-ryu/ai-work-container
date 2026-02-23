import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { SessionStore } from "./session-store.js";
import { DecisionStore } from "./decision-store.js";
import { GroupStore } from "./group-store.js";
import { PromptTemplateStore } from "./prompt-template-store.js";
import { TmuxManager } from "./tmux-manager.js";
import { createMcpHandler } from "./mcp-handler.js";
import type { HookEvent, DecisionRequest, DecisionResponse, LaunchRequest, WSMessage, Decision } from "./types.js";

const PORT = 3456;
const HOST = "127.0.0.1";
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);
const HOOK_TOKEN = process.env.CLAUDE_MONITOR_HOOK_TOKEN || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- WebSocket broadcast ---
const clients = new Set<WebSocket>();

function broadcast(msg: WSMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// --- Stores ---
const groupStore = new GroupStore((group) => {
  broadcast({
    type: "group_update",
    payload: group,
  });
});

const promptTemplateStore = new PromptTemplateStore(
  (template) => {
    broadcast({ type: "prompt_template_update", payload: template });
  },
  (id) => {
    broadcast({ type: "prompt_template_delete", payload: { id } });
  },
);

const sessionStore = new SessionStore(
  (session) => {
    broadcast({
      type: "session_update",
      payload: session,
    });
  },
  (sessionId) => {
    deletePromptHistory(`session:${sessionId}`);
    groupStore.removeSessionFromAll(sessionId).catch(e => {
      console.error("Failed to clean up group references for deleted session:", e);
    });
  },
);

const decisionStore = new DecisionStore({
  onDecisionPending: (decision: Decision) => {
    // セッション状態を waiting_permission に更新
    const session = sessionStore.get(decision.session_id);
    if (session) {
      session.status = "waiting_permission";
      session.updated_at = new Date().toISOString();
      broadcast({
        type: "session_update",
        payload: session,
      });
    }
    broadcast({
      type: "decision_pending",
      payload: decision,
    });
  },
  onDecisionResolved: (decision: Decision) => {
    // セッション状態を running に戻す
    const session = sessionStore.get(decision.session_id);
    if (session && session.status === "waiting_permission") {
      session.status = "running";
      session.updated_at = new Date().toISOString();
      broadcast({
        type: "session_update",
        payload: session,
      });
    }
    broadcast({
      type: "decision_resolved",
      payload: decision,
    });
  },
  onDecisionTimeout: (decision: Decision) => {
    // セッション状態を error に遷移
    sessionStore.setError(decision.session_id, `Decision timeout: ${decision.tool_name}`);
  },
});

// --- Prompt History (in-memory) ---
const PROMPT_HISTORY_MAX = 50;
const promptHistories = new Map<string, string[]>();

function getPromptHistoryKey(sessionId: string): string {
  for (const g of groupStore.getAll()) {
    if (g.session_ids.includes(sessionId)) {
      return `group:${g.id}`;
    }
  }
  return `session:${sessionId}`;
}

function addPromptHistory(key: string, text: string): void {
  let history = promptHistories.get(key);
  if (!history) {
    history = [];
    promptHistories.set(key, history);
  }
  // 直前と同一テキストはスキップ
  if (history.length > 0 && history[history.length - 1] === text) return;
  history.push(text);
  // 上限管理
  if (history.length > PROMPT_HISTORY_MAX) {
    history.splice(0, history.length - PROMPT_HISTORY_MAX);
  }
}

function getPromptHistory(key: string): string[] {
  return promptHistories.get(key) || [];
}

function deletePromptHistory(key: string): void {
  promptHistories.delete(key);
}

// --- Session completion helpers ---

// pending decisions をキャンセルしてブロードキャスト
function cancelSessionDecisions(sessionId: string): void {
  const cancelled = decisionStore.cancelBySession(sessionId);
  for (const decision of cancelled) {
    broadcast({ type: "decision_resolved", payload: decision });
  }
}

// pending decisions を deny 確定（recover 用）
// onDecisionResolved コールバック経由で broadcast される
function denySessionDecisions(sessionId: string): void {
  decisionStore.denyBySession(sessionId);
}

// decision キャンセル + セッション完了遷移
function completeSessionWithCleanup(sessionId: string, message: string): void {
  cancelSessionDecisions(sessionId);
  sessionStore.completeSession(sessionId, message);
}

// --- Express app ---
const app = express();
app.use(express.json());

// 静的ファイル配信
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// Origin 検証ミドルウェア
function validateOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: "Forbidden: invalid origin" });
    return;
  }
  next();
}

// --- REST API ---

// イベント受信（notify.sh から）
app.post("/api/events", (req, res) => {
  if (HOOK_TOKEN && req.header("x-hook-token") !== HOOK_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const event = req.body as HookEvent;
  if (!event.session_id || !event.event_type) {
    res.status(400).json({ error: "session_id and event_type are required" });
    return;
  }

  const session = sessionStore.processEvent(event);

  // SessionEnd 時に pending decisions を自動キャンセル
  if (event.event_type === "SessionEnd") {
    cancelSessionDecisions(event.session_id);
  }

  // Notification イベントは別途 WebSocket 通知
  if (event.event_type === "Notification") {
    broadcast({
      type: "notification",
      payload: {
        session_id: event.session_id,
        message: event.message || event.title || "",
        notification_type: event.notification_type || "",
      },
    });
  }

  res.json({ ok: true, session_id: session.session_id });
});

// セッション一覧
app.get("/api/sessions", (_req, res) => {
  res.json(sessionStore.getAll());
});

// 決定リクエスト登録（decide.sh から）
app.post("/api/decisions", (req, res) => {
  if (HOOK_TOKEN && req.header("x-hook-token") !== HOOK_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const decReq = req.body as DecisionRequest;
  if (!decReq.correlation_id || !decReq.session_id) {
    res.status(400).json({ error: "correlation_id and session_id are required" });
    return;
  }
  const decision = decisionStore.register(decReq);
  res.status(201).json({ ok: true, id: decision.id });
});

// long-poll で応答待ち（decide.sh から）
app.get("/api/decisions/:id/wait", async (req, res) => {
  const id = req.params.id as string;
  const result = await decisionStore.waitForDecision(id);
  res.json(result);
});

// ブラウザから決定結果を送信（Origin 検証付き）
app.post("/api/decisions/:id/respond", validateOrigin, (req, res) => {
  const id = req.params.id as string;
  const { decision } = req.body as DecisionResponse;
  if (!decision || !["allow", "deny"].includes(decision)) {
    res.status(400).json({ error: "decision must be 'allow' or 'deny'" });
    return;
  }
  const updated = decisionStore.respond(id, decision);
  if (!updated) {
    res.status(404).json({ error: "Decision not found or already resolved" });
    return;
  }
  res.json({ ok: true });
});

// 保留中の決定一覧
app.get("/api/decisions/pending", (_req, res) => {
  res.json(decisionStore.getPending());
});

// セッションの error 状態をリセット
app.post("/api/sessions/:id/reset-error", validateOrigin, (req, res) => {
  const id = req.params.id as string;
  const session = sessionStore.resetError(id);
  if (!session) {
    res.status(404).json({ error: "Session not found or not in error state" });
    return;
  }
  res.json({ ok: true });
});

// セッションの waiting_permission / waiting_answer 状態を復帰
app.post("/api/sessions/:id/recover", validateOrigin, (req, res) => {
  const id = req.params.id as string;
  const session = sessionStore.get(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const wasWaitingPermission = session.status === "waiting_permission";
  // 先にセッション状態を idle に復帰（onDecisionResolved での余分な状態遷移を回避）
  const recovered = sessionStore.recover(id);
  if (!recovered) {
    res.status(400).json({ error: "Session is not in waiting_permission or waiting_answer state" });
    return;
  }
  // waiting_permission だった場合、pending decisions を deny として確定
  if (wasWaitingPermission) {
    denySessionDecisions(id);
  }
  res.json({ ok: true });
});

// --- Send Keys API ---
const execFileAsync = promisify(execFile);

app.post("/api/sessions/:id/send-keys", validateOrigin, async (req, res) => {
  const id = req.params.id as string;
  const session = sessionStore.get(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!session.tmux_pane) {
    res.status(400).json({ error: "tmux_pane not registered" });
    return;
  }
  if (session.status !== "idle") {
    res.status(403).json({ error: "Session is not idle" });
    return;
  }
  const { text } = req.body as { text: unknown };
  if (typeof text !== "string" || text.length < 1 || text.length > 4096) {
    res.status(400).json({ error: "text must be a string between 1 and 4096 characters" });
    return;
  }

  // マルチライン入力の改行をスペースに置換
  const sanitizedText = text.replace(/\r?\n/g, " ");

  try {
    // 既存入力行をクリア（残存テキストとの結合防止）
    await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "C-u"]);
    // リテラルモードでテキスト送信
    await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "-l", sanitizedText]);
    // Enterを別途送信
    await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "Enter"]);

    // 履歴に記録
    const historyKey = getPromptHistoryKey(id);
    addPromptHistory(historyKey, text);
    const [historyScope, historyId] = historyKey.split(":", 2) as ["group" | "session", string];
    broadcast({
      type: "prompt_history_update",
      payload: { scope: historyScope, id: historyId, history: getPromptHistory(historyKey) },
    });

    res.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    console.error("tmux send-keys failed:", err.stderr || err.message);
    res.status(500).json({ error: "Failed to send keys" });
  }
});

// --- Close Session API ---
app.post("/api/sessions/:id/close", validateOrigin, async (req, res) => {
  if (!tmuxManager.canManagePanes()) {
    res.status(503).json({ error: "tmux is not available" });
    return;
  }

  const id = req.params.id as string;
  const session = sessionStore.get(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!session.tmux_pane) {
    res.status(400).json({ error: "tmux_pane not registered" });
    return;
  }
  if (session.status === "completed") {
    res.status(400).json({ error: "Session already completed" });
    return;
  }

  // killPane実行前にペイン存在確認
  let panePresent: boolean;
  try {
    panePresent = await tmuxManager.paneExists(session.tmux_pane);
  } catch (checkErr) {
    console.error("tmux communication error:", (checkErr as Error).message);
    res.status(502).json({ error: "tmux communication error" });
    return;
  }

  if (panePresent) {
    try {
      await tmuxManager.killPane(session.tmux_pane);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "ERR_SELFPANE_UNKNOWN") {
        console.error("killPane refused (selfPaneId unknown):", (e as Error).message);
        res.status(503).json({ error: "Server self-pane ID is not resolved" });
        return;
      }
      if (code === "ERR_REFUSE_SERVER_PANE") {
        console.error("killPane refused (self-pane protection):", (e as Error).message);
        res.status(409).json({ error: "Refusing to kill server pane" });
        return;
      }
      // その他のkillPaneエラー: ペインがまだ存在するか確認
      let stillExists: boolean;
      try {
        stillExists = await tmuxManager.paneExists(session.tmux_pane);
      } catch (recheckErr) {
        console.error("tmux communication error:", (recheckErr as Error).message);
        res.status(502).json({ error: "tmux communication error" });
        return;
      }
      if (stillExists) {
        console.error("killPane failed:", (e as Error).message);
        res.status(502).json({ error: "Failed to close tmux pane" });
        return;
      }
      console.warn("killPane: pane already closed");
    }
  } else {
    console.warn("killPane skipped: pane already absent");
  }

  completeSessionWithCleanup(id, "セッションを手動で終了しました");
  res.json({ ok: true });
});

// --- Group API ---

// グループ一覧
app.get("/api/groups", (_req, res) => {
  res.json(groupStore.getAll());
});

// グループ作成
app.post("/api/groups", validateOrigin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) {
    res.status(400).json({ error: "name is required and must be <= 100 characters" });
    return;
  }
  try {
    const group = await groupStore.create(name);
    res.status(201).json(group);
  } catch (e) {
    console.error("Failed to create group:", e);
    res.status(500).json({ error: "Failed to persist group" });
  }
});

// グループ更新
app.put("/api/groups/:id", validateOrigin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) {
    res.status(400).json({ error: "name is required and must be <= 100 characters" });
    return;
  }
  try {
    const group = await groupStore.update(req.params.id as string, name);
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json(group);
  } catch (e) {
    console.error("Failed to update group:", e);
    res.status(500).json({ error: "Failed to persist group" });
  }
});

// グループ削除
app.delete("/api/groups/:id", validateOrigin, async (req, res) => {
  const id = req.params.id as string;
  try {
    const group = groupStore.get(id);
    const deleted = await groupStore.delete(id);
    if (!deleted) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    // グループ履歴を所属セッションにコピーしてから削除
    const groupKey = `group:${id}`;
    const groupHistory = getPromptHistory(groupKey);
    if (group && groupHistory.length > 0) {
      for (const sessionId of group.session_ids) {
        const sessionKey = `session:${sessionId}`;
        for (const text of groupHistory) {
          addPromptHistory(sessionKey, text);
        }
        broadcast({
          type: "prompt_history_update",
          payload: { scope: "session" as const, id: sessionId, history: getPromptHistory(sessionKey) },
        });
      }
    }
    deletePromptHistory(groupKey);
    broadcast({ type: "group_delete", payload: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("Failed to delete group:", e);
    res.status(500).json({ error: "Failed to persist group deletion" });
  }
});

// セッション追加/削除
app.post("/api/groups/:id/sessions", validateOrigin, async (req, res) => {
  const { session_id, action } = req.body as { session_id: string; action: "add" | "remove" };
  if (!session_id || !action || !["add", "remove"].includes(action)) {
    res.status(400).json({ error: "session_id and action ('add' or 'remove') are required" });
    return;
  }
  try {
    if (action === "add") {
      if (!sessionStore.get(session_id)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const group = await groupStore.addSession(req.params.id as string, session_id);
      if (!group) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      // セッション単体の履歴をグループ履歴に統合
      const sessionKey = `session:${session_id}`;
      const groupKey = `group:${group.id}`;
      const sessionHistory = getPromptHistory(sessionKey);
      if (sessionHistory.length > 0) {
        for (const text of sessionHistory) {
          addPromptHistory(groupKey, text);
        }
        deletePromptHistory(sessionKey);
        const [historyScope, historyId] = groupKey.split(":", 2) as ["group", string];
        broadcast({
          type: "prompt_history_update",
          payload: { scope: historyScope, id: historyId, history: getPromptHistory(groupKey) },
        });
      }
      res.json(group);
    } else {
      const groupId = req.params.id as string;
      const group = await groupStore.removeSession(groupId, session_id);
      if (!group) {
        res.status(404).json({ error: "Group not found or session not in group" });
        return;
      }
      // グループ履歴をセッション側にコピー
      const groupKey = `group:${groupId}`;
      const sessionKey = `session:${session_id}`;
      for (const text of getPromptHistory(groupKey)) {
        addPromptHistory(sessionKey, text);
      }
      broadcast({
        type: "prompt_history_update",
        payload: { scope: "session" as const, id: session_id, history: getPromptHistory(sessionKey) },
      });
      res.json(group);
    }
  } catch (e) {
    console.error("Failed to update group sessions:", e);
    res.status(500).json({ error: "Failed to persist group session change" });
  }
});

// --- Prompt Template API ---

app.get("/api/prompt-templates", (_req, res) => {
  res.json(promptTemplateStore.getAll());
});

app.post("/api/prompt-templates", validateOrigin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!name || name.length > 100) {
    res.status(400).json({ error: "name is required and must be <= 100 characters" });
    return;
  }
  if (!body || body.length > 4096) {
    res.status(400).json({ error: "body is required and must be <= 4096 characters" });
    return;
  }
  try {
    const template = await promptTemplateStore.create(name, body);
    res.status(201).json(template);
  } catch (e) {
    console.error("Failed to create prompt template:", e);
    res.status(500).json({ error: "Failed to persist prompt template" });
  }
});

app.put("/api/prompt-templates/:id", validateOrigin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!name || name.length > 100) {
    res.status(400).json({ error: "name is required and must be <= 100 characters" });
    return;
  }
  if (!body || body.length > 4096) {
    res.status(400).json({ error: "body is required and must be <= 4096 characters" });
    return;
  }
  try {
    const template = await promptTemplateStore.update(req.params.id as string, name, body);
    if (!template) {
      res.status(404).json({ error: "Prompt template not found" });
      return;
    }
    res.json(template);
  } catch (e) {
    console.error("Failed to update prompt template:", e);
    res.status(500).json({ error: "Failed to persist prompt template" });
  }
});

app.delete("/api/prompt-templates/:id", validateOrigin, async (req, res) => {
  const id = req.params.id as string;
  try {
    const deleted = await promptTemplateStore.delete(id);
    if (!deleted) {
      res.status(404).json({ error: "Prompt template not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("Failed to delete prompt template:", e);
    res.status(500).json({ error: "Failed to persist prompt template deletion" });
  }
});

// --- Prompt History API ---

app.get("/api/prompt-history/:type/:id", (req, res) => {
  const type = req.params.type as string;
  const id = req.params.id as string;
  if (type !== "group" && type !== "session") {
    res.status(400).json({ error: "type must be 'group' or 'session'" });
    return;
  }
  res.json(getPromptHistory(`${type}:${id}`));
});

// --- TmuxManager ---
const tmuxManager = new TmuxManager();

// --- Tools API ---
app.get("/api/tools", (_req, res) => {
  const available = tmuxManager.isAvailable();
  const tools = tmuxManager.getTools().map(t => ({
    id: t.id,
    label: t.label,
    available,
  }));
  res.json(tools);
});

// --- Launch API ---
const fsStatAsync = promisify(fs.stat);
const fsRealpathAsync = promisify(fs.realpath);

app.post("/api/sessions/launch", validateOrigin, async (req, res) => {
  const { tool_id, cwd } = req.body as LaunchRequest;

  if (!tool_id || typeof tool_id !== "string") {
    res.status(400).json({ error: "tool_id is required" });
    return;
  }

  // ツールIDのホワイトリスト検証
  const knownIds = new Set(tmuxManager.getTools().map(t => t.id));
  if (!knownIds.has(tool_id)) {
    res.status(400).json({ error: `Unknown tool_id: ${tool_id}` });
    return;
  }

  if (!tmuxManager.isAvailable()) {
    res.status(503).json({ error: "tmux is not available" });
    return;
  }

  // cwdバリデーション
  let resolvedCwd: string | undefined;
  if (cwd && typeof cwd === "string") {
    const workDir = process.env.CLAUDE_MONITOR_WORK_DIR;
    if (!workDir) {
      res.status(400).json({ error: "CLAUDE_MONITOR_WORK_DIR is not set" });
      return;
    }

    const normalized = path.resolve(cwd);
    try {
      const stat = await fsStatAsync(normalized);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "cwd is not a directory" });
        return;
      }
    } catch {
      res.status(400).json({ error: "cwd does not exist" });
      return;
    }

    try {
      const realCwd = await fsRealpathAsync(normalized);
      const realWorkDir = await fsRealpathAsync(workDir);
      if (realCwd !== realWorkDir && !realCwd.startsWith(realWorkDir + "/")) {
        res.status(400).json({ error: "cwd is outside of CLAUDE_MONITOR_WORK_DIR" });
        return;
      }
      resolvedCwd = normalized;
    } catch {
      res.status(400).json({ error: "Failed to resolve cwd path" });
      return;
    }
  }

  try {
    const result = await tmuxManager.launchSession(tool_id, resolvedCwd);
    res.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("Pane limit reached")) {
      res.status(409).json({ error: msg });
    } else {
      console.error("Launch session failed:", msg);
      res.status(500).json({ error: "Failed to launch session" });
    }
  }
});

// --- MCP handler ---
const mcpHandler = createMcpHandler(sessionStore);
app.post("/mcp", mcpHandler);
app.get("/mcp", mcpHandler);
app.delete("/mcp", mcpHandler);

// --- HTTP Server + WebSocket ---
const server = createServer(app);

const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const origin = info.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      callback(false, 403, "Forbidden: invalid origin");
      return;
    }
    callback(true);
  },
});

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => {
    clients.delete(ws);
  });
});

// --- Pane Monitor ---
const PANE_CHECK_INTERVAL_MS = 5000;
let paneCheckTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function startPaneMonitor(): void {
  if (!tmuxManager.canManagePanes()) return;

  paneCheckTimer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const activePanes = await tmuxManager.listActivePanes();
      if (!activePanes) {
        return;
      }
      // null（エラー/管理不可）は上で除外済み。
      // サーバー自身のペインが最低1つ存在するため、size===0は想定外の状態として警告する
      if (activePanes.size === 0) {
        console.warn("Pane monitor: no active panes detected, skipping check");
        return;
      }

      for (const session of sessionStore.getAll()) {
        if (!session.tmux_pane) continue;
        if (session.status === "completed") continue;
        if (activePanes.has(session.tmux_pane)) continue;

        // ペインが消失 → completedに遷移
        completeSessionWithCleanup(session.session_id, "tmuxペインが終了しました");
      }
    } finally {
      inFlight = false;
    }
  }, PANE_CHECK_INTERVAL_MS);
}

// データストアとTmuxManagerを並列初期化してからサーバー起動
Promise.all([
  groupStore.load(),
  promptTemplateStore.load(),
  tmuxManager.initialize(),
]).then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Claude Monitor dashboard: http://${HOST}:${PORT}`);
    console.log(`Listening on ${HOST}:${PORT}`);
    startPaneMonitor();
  });
});

// Graceful shutdown
function shutdown(): void {
  if (paneCheckTimer) clearInterval(paneCheckTimer);
  tmuxManager.destroy();
  sessionStore.destroy();
  decisionStore.destroy();
  wss.close();
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
