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
import { QuestionStore } from "./question-store.js";
import { GroupStore } from "./group-store.js";
import { PromptTemplateStore } from "./prompt-template-store.js";
import { TmuxManager } from "./tmux-manager.js";
import { createMcpHandler } from "./mcp-handler.js";
import { extractLatestProgress } from "./transcript-parser.js";
import { cleanupPendingAssignments } from "./pending-group-assignments.js";
import type { PendingAssignment } from "./pending-group-assignments.js";
import { assignPendingGroupToSession } from "./group-assignment.js";
import type { HookEvent, DecisionRequest, DecisionResponse, LaunchRequest, WSMessage, Decision, PendingQuestion } from "./types.js";
import type { PaneInfo } from "./tmux-manager.js";

// --- ServerDeps: createApp の依存注入インターフェース ---
export interface ServerDeps {
  sessionStore: SessionStore;
  decisionStore: DecisionStore;
  questionStore: QuestionStore;
  groupStore: GroupStore;
  promptTemplateStore: PromptTemplateStore;
  tmuxManager: TmuxManager;
  pendingGroupAssignments: Map<string, PendingAssignment>;
  broadcast: (msg: WSMessage) => void;
  hookToken: string;
  allowedOrigins: Set<string>;
  publicDir?: string;
}

// --- PaneMonitorDeps: runPaneMonitorTick の依存注入インターフェース ---
export interface PaneMonitorDeps {
  tmuxManager: TmuxManager;
  sessionStore: SessionStore;
  decisionStore: DecisionStore;
  pendingGroupAssignments: Map<string, PendingAssignment>;
  completeSessionWithCleanup: (sessionId: string, message: string) => void;
  loggedUnknownCommands: Set<string>;
}

// Copilot Pane Monitor タイムアウト定数
export const COPILOT_HOOK_TIMEOUT_MS = 60_000;     // フック通信途絶時の完了判定（60秒）
export const COPILOT_NO_HOOK_TIMEOUT_MS = 120_000; // hooks 未到達時のフォールバック完了判定（120秒）
export const COPILOT_NO_HOOK_HARD_TIMEOUT_MS = 10 * 60_000; // hooks 未到達時の最終上限（10分、commandAlive でも適用）
export const COPILOT_GRACE_PERIOD_MS = 30_000;     // プレセッション作成後のグレースピリオド（30秒）

// Copilot コマンド検出定数（用途別に分離）
// 自動プレセッション作成用: 確実にCopilotと識別できるコマンドのみ（誤検出防止）
const _parsedCopilotCommands = process.env.COPILOT_COMMANDS?.split(",").map(s => s.trim()).filter(Boolean);
export const COPILOT_AUTO_DETECT_COMMANDS: readonly string[] =
  _parsedCopilotCommands && _parsedCopilotCommands.length > 0 ? _parsedCopilotCommands : ["copilot"];
// 既存Copilotセッションの生存判定用: フック通信ベース判定と併用するため広めの集合を許容
export const COPILOT_ALIVE_COMMANDS: readonly string[] = ["copilot", "node"];

// --- Pane Monitor Tick ロジック（テスト可能な独立関数） ---
export async function runPaneMonitorTick(deps: PaneMonitorDeps): Promise<void> {
  const { tmuxManager, sessionStore, decisionStore, pendingGroupAssignments, completeSessionWithCleanup, loggedUnknownCommands } = deps;
  const panes = await tmuxManager.listActivePanesDetailed();
  if (!panes) return;
  if (panes.length === 0) {
    console.warn("Pane monitor: no active panes detected, skipping check");
    return;
  }

  const activePaneIds = new Set(panes.map((p) => p.paneId));

  // pending group assignments のクリーンアップ
  cleanupPendingAssignments(pendingGroupAssignments, activePaneIds);

  // pane 消失によるセッション完了
  for (const session of sessionStore.getAll()) {
    if (!session.tmux_pane) continue;
    if (session.status === "completed") continue;
    if (activePaneIds.has(session.tmux_pane)) continue;
    completeSessionWithCleanup(session.session_id, "tmuxペインが終了しました");
  }

  // copilot プロセス終了検出（pane は存続しているがコマンドが変わった場合）
  // フック通信ベース + DecisionStore pending ベースの判定
  const paneCommandMap = new Map(panes.map((p) => [p.paneId, p.command]));
  for (const session of sessionStore.getAll()) {
    if (session.cli_tool !== "copilot") continue;
    if (session.status === "completed") continue;
    if (!session.tmux_pane) continue;
    if (!activePaneIds.has(session.tmux_pane)) continue; // pane消失は上のループで処理済み

    const paneCommand = paneCommandMap.get(session.tmux_pane) || "";
    const commandAlive = COPILOT_ALIVE_COMMANDS.includes(paneCommand);
    const sessionId = session.session_id;

    // グレースピリオド: last_init_at から一定時間はスキップ
    const sinceInit = Date.now() - new Date(session.last_init_at).getTime();
    if (sinceInit < COPILOT_GRACE_PERIOD_MS) {
      console.debug(`Copilot session ${sessionId}: grace period (${sinceInit}ms < ${COPILOT_GRACE_PERIOD_MS}ms), skipping`);
      continue;
    }

    // 条件 0: DecisionStore に pending decision → 承認待ち中のため完了抑止
    const pendingDecisions = decisionStore.getPending().filter(d => d.session_id === sessionId);
    if (pendingDecisions.length > 0) {
      console.debug(`Copilot session ${sessionId}: ${pendingDecisions.length} pending decision(s), keeping active`);
      continue;
    }

    // 条件 0.5: idle 状態 + コマンド生存 → 次のプロンプト入力待ちのためフックタイムアウトをスキップ
    // SessionEnd(reason=complete) 後の idle セッションはフック通信が発生しないため、
    // コマンド生存中はタイムアウト対象外とする（プロセス終了は commandAlive で検出）
    if (session.status === "idle" && commandAlive) {
      console.debug(`Copilot session ${sessionId}: idle with alive command ('${paneCommand}'), skipping hook timeout`);
      continue;
    }

    // 条件 1: コマンドが COPILOT_ALIVE_COMMANDS に含まれる
    // フック通信ベース判定と併用: 直近フック通信がある場合のみアクティブ維持
    const now = Date.now();
    if (commandAlive) {
      const isFreshByHook = session.last_hook_at
        ? (now - new Date(session.last_hook_at).getTime()) < COPILOT_HOOK_TIMEOUT_MS
        : false;
      if (isFreshByHook) {
        continue;
      }
      // フック通信途絶/未到達 → 条件2のタイムアウト判定に移行
    }

    // 条件 2: コマンドがalive commandでない、またはフック通信が途絶している場合
    if (session.last_hook_at) {
      // 2a: last_hook_at 設定済み → フックタイムアウト判定
      const sinceLastHook = now - new Date(session.last_hook_at).getTime();
      if (sinceLastHook >= COPILOT_HOOK_TIMEOUT_MS) {
        console.debug(`Copilot session ${sessionId}: hook timeout (${sinceLastHook}ms >= ${COPILOT_HOOK_TIMEOUT_MS}ms), command='${paneCommand}', completing`);
        completeSessionWithCleanup(sessionId, "copilot プロセス終了を検出しました");
        continue;
      }
    } else {
      // 2b: last_hook_at 未設定 → no-hook フォールバック
      // hard timeout: commandAlive に関係なく最終上限で完了
      if (sinceInit >= COPILOT_NO_HOOK_HARD_TIMEOUT_MS) {
        console.warn(`Copilot session ${sessionId}: no hooks received after ${sinceInit}ms (hard timeout), completing`);
        completeSessionWithCleanup(sessionId, "copilot フック未到達タイムアウト");
        continue;
      }
      // soft timeout: commandAlive でないプロセスは早期に完了
      if (!commandAlive && sinceInit >= COPILOT_NO_HOOK_TIMEOUT_MS) {
        console.warn(`Copilot session ${sessionId}: no hooks received after ${sinceInit}ms, completing`);
        completeSessionWithCleanup(sessionId, "copilot プロセス終了を検出しました");
        continue;
      }
    }
    // 条件 3: タイムアウト未到達 → アクティブ維持
    console.debug(`Copilot session ${sessionId}: command='${paneCommand}', commandAlive=${commandAlive}, waiting for timeout`);
  }

  // copilot 手動起動の自動検出
  const registeredPanes = new Set(
    sessionStore.getAll()
      .filter((s) => s.status !== "completed")
      .map((s) => s.tmux_pane)
      .filter(Boolean)
  );

  for (const pane of panes) {
    if (!COPILOT_AUTO_DETECT_COMMANDS.includes(pane.command)) {
      // 検出対象外のコマンドはスキップ（デバッグ用: 未知のコマンドを初回のみログ出力）
      if (pane.command && !["bash", "zsh", "fish", "claude", "node"].includes(pane.command)) {
        if (!loggedUnknownCommands.has(pane.command)) {
          loggedUnknownCommands.add(pane.command);
          console.debug(`Pane monitor: unknown command "${pane.command}" on ${pane.paneId}`);
        }
      }
      continue;
    }
    if (registeredPanes.has(pane.paneId)) continue;

    // セッション未登録の copilot ペインを検出 → プレセッション作成
    const paneNum = pane.paneId.replace("%", "");
    const preSessionId = `copilot-pane-${paneNum}`;
    const syntheticEvent: HookEvent = {
      event_type: "SessionStart",
      session_id: preSessionId,
      cwd: pane.currentPath || process.env.CLAUDE_MONITOR_WORK_DIR || "",
      model: "",
      title: "",
      notification_type: "",
      message: "",
      tool_name: "",
      file_path: "",
      prompt: "",
      questions: [],
      last_message: "",
      tmux_pane: pane.paneId,
      reason: "",
      transcript_path: "",
      progress_text: "",
      cli_tool: "copilot",
      timestamp: new Date().toISOString(),
    };
    sessionStore.processEvent(syntheticEvent);
  }
}

// --- Express App Factory ---
export interface CreateAppResult {
  app: express.Express;
  completeSessionWithCleanup: (sessionId: string, message: string) => void;
}

export function createApp(deps: ServerDeps): CreateAppResult {
  const {
    sessionStore, decisionStore, questionStore, groupStore,
    promptTemplateStore, tmuxManager, pendingGroupAssignments,
    broadcast, hookToken, allowedOrigins, publicDir,
  } = deps;

  const execFileAsync = promisify(execFile);

  // --- tmux Enter 送信共通ヘルパー ---
  async function sendEnterKey(pane: string, enterMethod: string): Promise<void> {
    switch (enterMethod) {
      case "c-m":
        await execFileAsync("tmux", ["send-keys", "-t", pane, "C-m"]);
        break;
      case "enter-delay":
        await new Promise(r => setTimeout(r, 100));
        await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
        break;
      case "double-enter":
        await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
        await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
        break;
      default:
        await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
    }
  }

  // --- Prompt History (in-memory, app 単位) ---
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
    if (history.length > 0 && history[history.length - 1] === text) return;
    history.push(text);
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

  function cancelSessionDecisions(sessionId: string): void {
    const cancelled = decisionStore.cancelBySession(sessionId);
    for (const decision of cancelled) {
      broadcast({ type: "decision_resolved", payload: decision });
    }
  }

  function denySessionDecisions(sessionId: string): void {
    decisionStore.denyBySession(sessionId);
  }

  function cancelSessionQuestions(sessionId: string): void {
    questionStore.cancelBySession(sessionId);
  }

  function completeSessionWithCleanup(sessionId: string, message: string): void {
    const pendingDecisions = decisionStore.getPending().filter(d => d.session_id === sessionId);
    if (pendingDecisions.length > 0) {
      console.warn(`Completing session ${sessionId} with ${pendingDecisions.length} pending decision(s): ${message}`);
    }
    cancelSessionDecisions(sessionId);
    cancelSessionQuestions(sessionId);
    sessionStore.completeSession(sessionId, message);
  }

  // --- Express app ---
  const app = express();
  app.use(express.json());

  if (publicDir) {
    app.use(express.static(publicDir));
  }

  // Origin 検証ミドルウェア
  function validateOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Forbidden: invalid origin" });
      return;
    }
    next();
  }

  // --- REST API ---

  // イベント受信（notify.sh から）
  app.post("/api/events", async (req, res) => {
    if (hookToken && req.header("x-hook-token") !== hookToken) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const event = req.body as HookEvent;
    if (!event.session_id || !event.event_type) {
      res.status(400).json({ error: "session_id and event_type are required" });
      return;
    }

    // PreToolUse 時にトランスクリプトから作業工程テキストを抽出
    if (event.event_type === "PreToolUse" && event.transcript_path) {
      event.progress_text = await extractLatestProgress(event.transcript_path);
    }

    const session = sessionStore.processEvent(event);

    // Copilot セッション: フック通信時刻を更新（Pane Monitor の生存判定で使用）
    if (session.cli_tool === "copilot") {
      session.last_hook_at = event.timestamp || new Date().toISOString();
    }

    // 新規セッションのグループ自動割り当て（SessionStart 時のみ実行）
    if (event.event_type === "SessionStart" && session.tmux_pane) {
      await assignPendingGroupToSession(session.session_id, session.tmux_pane, {
        groupStore, pendingGroupAssignments, broadcast,
      });
    }

    // SessionEnd 時に pending decisions / questions を自動キャンセル
    if (event.event_type === "SessionEnd") {
      cancelSessionDecisions(event.session_id);
      cancelSessionQuestions(event.session_id);
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
    if (hookToken && req.header("x-hook-token") !== hookToken) {
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

  // Copilot 自動承認: tmux send-keys で Copilot ネイティブプロンプトに応答
  async function copilotAutoApprove(session: import("./types.js").Session): Promise<void> {
    const delayMs = parseInt(process.env.COPILOT_CONFIRM_DELAY_MS || "500", 10);
    const response = process.env.COPILOT_CONFIRM_RESPONSE || "y";
    const maxRetries = 3;
    const retryIntervalMs = 500;
    const enterMethod = process.env.COPILOT_ENTER_METHOD || "c-m";

    await new Promise(r => setTimeout(r, delayMs));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "-l", response]);
        await sendEnterKey(session.tmux_pane, enterMethod);
        console.log(`Copilot auto-approve: sent '${response}' + ${enterMethod} to ${session.tmux_pane}`);
        return;
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        console.error(`Copilot auto-approve attempt ${attempt}/${maxRetries} failed:`, err.stderr || err.message);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryIntervalMs));
        }
      }
    }

    // 全リトライ失敗: waiting_permission 状態を維持
    console.error(`Copilot auto-approve: all ${maxRetries} attempts failed for ${session.tmux_pane}`);
    if (session.status === "running") {
      session.status = "waiting_permission";
      session.updated_at = new Date().toISOString();
      broadcast({ type: "session_update", payload: session });
    }
  }

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

    // Copilot auto-approve: allow 決定時に tmux send-keys で自動承認
    if (decision === "allow") {
      const session = sessionStore.get(updated.session_id);
      if (session && session.cli_tool === "copilot" && session.tmux_pane) {
        copilotAutoApprove(session).catch(e =>
          console.error("Copilot auto-approve error:", e)
        );
      }
    }

    res.json({ ok: true });
  });

  // 保留中の決定一覧
  app.get("/api/decisions/pending", (_req, res) => {
    res.json(decisionStore.getPending());
  });

  // --- Question API ---

  // 保留中の質問一覧（フロントエンド初期取得用）
  app.get("/api/questions/pending", (_req, res) => {
    res.json(questionStore.getPending());
  });

  // ブラウザから回答送信
  app.post("/api/questions/:id/respond", validateOrigin, (req, res) => {
    const id = req.params.id as string;
    const { answers } = req.body as { answers: unknown };
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      res.status(400).json({ error: "answers must be a non-null object" });
      return;
    }
    const entries = Object.entries(answers as Record<string, unknown>);
    if (entries.length === 0 || entries.some(([, v]) => typeof v !== "string")) {
      res.status(400).json({ error: "answers must be a non-empty Record<string, string>" });
      return;
    }
    const pq = questionStore.get(id);
    if (!pq) {
      res.status(404).json({ error: "Question not found or already answered" });
      return;
    }
    const keys = Object.keys(answers as Record<string, unknown>);
    const expected = Array.from({ length: pq.questions.length }, (_, i) => String(i));
    const isCanonical = keys.every((k) => /^(0|[1-9]\d*)$/.test(k));
    if (!isCanonical || keys.length !== expected.length || expected.some((k) => !(k in (answers as Record<string, unknown>)))) {
      res.status(400).json({ error: `answer keys must be exact strings: 0..${pq.questions.length - 1}` });
      return;
    }
    const updated = questionStore.respond(id, answers as Record<string, string>);
    if (!updated) {
      res.status(404).json({ error: "Question not found or already answered" });
      return;
    }
    res.json({ ok: true });
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
    const recovered = sessionStore.recover(id);
    if (!recovered) {
      res.status(400).json({ error: "Session is not in waiting_permission or waiting_answer state" });
      return;
    }
    if (wasWaitingPermission) {
      denySessionDecisions(id);
    }
    cancelSessionQuestions(id);
    res.json({ ok: true });
  });

  // --- Send Keys API ---
  const COPILOT_HOOKS_TIMEOUT_MS = 120_000;

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

    // Copilot 固有チェック: 起動状態に応じた制御
    if (session.cli_tool === "copilot") {
      if (!session.first_prompt_sent) {
        // 初回送信は許可（Copilot CLI 起動トリガー）
      } else if (!session.last_hook_at) {
        // 2回目以降: Copilot がまだ起動中（フック通信なし）
        const elapsed = Date.now() - new Date(session.last_init_at).getTime();
        if (elapsed < COPILOT_HOOKS_TIMEOUT_MS) {
          res.status(409).json({ error: "Copilot CLI is still starting up. Please wait." });
          return;
        }
        // hooks 不成立のフォールバック: 一定時間経過後は送信を許可
        console.warn(`Copilot session ${session.session_id}: hooks timeout (${elapsed}ms), allowing send-keys as fallback`);
      }
    }

    const { text } = req.body as { text: unknown };
    if (typeof text !== "string" || text.length < 1 || text.length > 4096) {
      res.status(400).json({ error: "text must be a string between 1 and 4096 characters" });
      return;
    }

    const sanitizedText = text.replace(/\r?\n/g, " ");

    try {
      console.log(`send-keys [${session.session_id}]: clearing line (C-u)`);
      await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "C-u"]);

      console.log(`send-keys [${session.session_id}]: sending text (${sanitizedText.length} chars)`);
      await execFileAsync("tmux", ["send-keys", "-t", session.tmux_pane, "-l", sanitizedText]);

      // Enter 送信方式: Copilot はデフォルト C-m、Claude は Enter
      const enterMethod = process.env.COPILOT_ENTER_METHOD
        || (session.cli_tool === "copilot" ? "c-m" : "enter");
      console.log(`send-keys [${session.session_id}]: sending Enter (method: ${enterMethod})`);
      await sendEnterKey(session.tmux_pane, enterMethod);

      // tmux send-keys 一連成功後に first_prompt_sent を更新
      if (session.cli_tool === "copilot" && !session.first_prompt_sent) {
        session.first_prompt_sent = true;
      }

      const historyKey = getPromptHistoryKey(id);
      addPromptHistory(historyKey, text);
      const [historyScope, historyId] = historyKey.split(":", 2) as ["group" | "session", string];
      broadcast({
        type: "prompt_history_update",
        payload: { scope: historyScope, id: historyId, history: getPromptHistory(historyKey) },
      });

      console.log(`send-keys [${session.session_id}]: completed successfully`);
      res.json({ ok: true });
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string };
      console.error(`send-keys [${session.session_id}] failed:`, err.stderr || err.message);
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

  app.get("/api/groups", (_req, res) => {
    res.json(groupStore.getAll());
  });

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

  app.delete("/api/groups/:id", validateOrigin, async (req, res) => {
    const id = req.params.id as string;
    try {
      const group = groupStore.get(id);
      const deleted = await groupStore.delete(id);
      if (!deleted) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
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

  // --- Tools API ---
  app.get("/api/tools", (_req, res) => {
    res.json(tmuxManager.getToolsWithAvailability());
  });

  // --- Launch API ---
  const fsStatAsync = promisify(fs.stat);
  const fsRealpathAsync = promisify(fs.realpath);

  app.post("/api/sessions/launch", validateOrigin, async (req, res) => {
    const { tool_id, cwd, group_id } = req.body as LaunchRequest;

    if (!tool_id || typeof tool_id !== "string") {
      res.status(400).json({ error: "tool_id is required" });
      return;
    }

    const knownIds = new Set(tmuxManager.getTools().map(t => t.id));
    if (!knownIds.has(tool_id)) {
      res.status(400).json({ error: `Unknown tool_id: ${tool_id}` });
      return;
    }

    if (group_id) {
      if (typeof group_id !== "string" || !groupStore.get(group_id)) {
        res.status(400).json({ error: "Invalid group_id" });
        return;
      }
    }

    if (!tmuxManager.isAvailable()) {
      res.status(503).json({ error: "tmux is not available" });
      return;
    }

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
      // stale entryの除去を常に先に行い、pane再利用時の誤割り当てを防止
      pendingGroupAssignments.delete(result.tmux_pane);
      if (group_id) {
        pendingGroupAssignments.set(result.tmux_pane, { groupId: group_id, createdAt: Date.now() });
      }

      // Copilot プレセッション: 合成 SessionStart イベントでセッションを先行作成
      // Copilot CLI は最初のプロンプト実行まで sessionStart フックを発火しないため、
      // Launch API 側で即座にセッションを作成し、ブラウザUIにカードを表示する。
      // copilot の実際の sessionStart 到達時は session-store が Copilot セッションの
      // データを再初期化するため、重複 SessionStart は問題なく処理される。
      if (tool_id === "copilot" && result.tmux_pane) {
        const paneNum = result.tmux_pane.replace("%", "");
        const preSessionId = `copilot-pane-${paneNum}`;
        const syntheticEvent: HookEvent = {
          event_type: "SessionStart",
          session_id: preSessionId,
          cwd: resolvedCwd || process.env.CLAUDE_MONITOR_WORK_DIR || "",
          model: "",
          title: "",
          notification_type: "",
          message: "",
          tool_name: "",
          file_path: "",
          prompt: "",
          questions: [],
          last_message: "",
          tmux_pane: result.tmux_pane,
          reason: "",
          transcript_path: "",
          progress_text: "",
          cli_tool: "copilot",
          timestamp: new Date().toISOString(),
        };
        const preSession = sessionStore.processEvent(syntheticEvent);

        // グループ自動割り当て（共通ヘルパー経由）
        if (preSession.tmux_pane) {
          await assignPendingGroupToSession(
            preSession.session_id,
            preSession.tmux_pane,
            { groupStore, pendingGroupAssignments, broadcast },
          );
        }
      }

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
  const mcpHandler = createMcpHandler(sessionStore, questionStore);
  app.post("/mcp", mcpHandler);
  app.get("/mcp", mcpHandler);
  app.delete("/mcp", mcpHandler);

  // セッション削除時に prompt history をクリーンアップ
  sessionStore.addOnDeleteHook((sessionId) => {
    deletePromptHistory(`session:${sessionId}`);
  });

  return { app, completeSessionWithCleanup };
}

// ==========================================================================
// Production startup（テスト時はスキップ）
// ==========================================================================

if (!process.env.VITEST) {
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
      // onDelete: prompt history は createApp 内の addOnDeleteHook で管理。
      // ここではグループ参照のクリーンアップのみ実施
      groupStore.removeSessionFromAll(sessionId).catch(e => {
        console.error("Failed to clean up group references for deleted session:", e);
      });
    },
  );

  const decisionStore = new DecisionStore({
    onDecisionPending: (decision: Decision) => {
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
      sessionStore.setError(decision.session_id, `Decision timeout: ${decision.tool_name}`);
    },
  });

  const questionStore = new QuestionStore({
    onQuestionPending: (pq: PendingQuestion) => {
      broadcast({
        type: "question_pending",
        payload: pq,
      });
    },
    onQuestionAnswered: (pq: PendingQuestion) => {
      broadcast({
        type: "question_answered",
        payload: pq,
      });
    },
    onQuestionTimeout: (pq: PendingQuestion) => {
      broadcast({
        type: "question_answered",
        payload: pq,
      });
    },
  });

  // --- Pending Group Assignments ---
  const pendingGroupAssignments = new Map<string, PendingAssignment>();

  // --- TmuxManager ---
  const tmuxManager = new TmuxManager();

  // --- Create Express app via factory ---
  const publicDir = path.resolve(__dirname, "../public");
  const { app, completeSessionWithCleanup } = createApp({
    sessionStore,
    decisionStore,
    questionStore,
    groupStore,
    promptTemplateStore,
    tmuxManager,
    pendingGroupAssignments,
    broadcast,
    hookToken: HOOK_TOKEN,
    allowedOrigins: ALLOWED_ORIGINS,
    publicDir,
  });

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

  const loggedUnknownCommands = new Set<string>();

  function startPaneMonitor(): void {
    if (!tmuxManager.canManagePanes()) return;

    paneCheckTimer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await runPaneMonitorTick({
          tmuxManager,
          sessionStore,
          decisionStore,
          pendingGroupAssignments,
          completeSessionWithCleanup,
          loggedUnknownCommands,
        });
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
    questionStore.destroy();
    wss.close();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
