import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "url";
import path from "path";
import { SessionStore } from "./session-store.js";
import { DecisionStore } from "./decision-store.js";
import { GroupStore } from "./group-store.js";
import { createMcpHandler } from "./mcp-handler.js";
import type { HookEvent, DecisionRequest, DecisionResponse, WSMessage, Decision } from "./types.js";

const PORT = 3456;
const HOST = "127.0.0.1";
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);

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

const sessionStore = new SessionStore(
  (session) => {
    broadcast({
      type: "session_update",
      payload: session,
    });
  },
  (sessionId) => {
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
  const event = req.body as HookEvent;
  if (!event.session_id || !event.event_type) {
    res.status(400).json({ error: "session_id and event_type are required" });
    return;
  }

  const session = sessionStore.processEvent(event);

  // SessionEnd 時に pending decisions を自動キャンセル
  if (event.event_type === "SessionEnd") {
    const cancelled = decisionStore.cancelBySession(event.session_id);
    for (const decision of cancelled) {
      broadcast({
        type: "decision_resolved",
        payload: decision,
      });
    }
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
    const deleted = await groupStore.delete(id);
    if (!deleted) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
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
      res.json(group);
    } else {
      const group = await groupStore.removeSession(req.params.id as string, session_id);
      if (!group) {
        res.status(404).json({ error: "Group not found or session not in group" });
        return;
      }
      res.json(group);
    }
  } catch (e) {
    console.error("Failed to update group sessions:", e);
    res.status(500).json({ error: "Failed to persist group session change" });
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

// グループデータをロードしてからサーバー起動
groupStore.load().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Claude Monitor dashboard: http://${HOST}:${PORT}`);
    console.log(`Listening on ${HOST}:${PORT}`);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  sessionStore.destroy();
  decisionStore.destroy();
  wss.close();
  server.close();
});

process.on("SIGINT", () => {
  sessionStore.destroy();
  decisionStore.destroy();
  wss.close();
  server.close();
});
