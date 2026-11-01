import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Request, Response } from "express";
import type { SessionStore } from "./session-store.js";
import type { QuestionStore } from "./question-store.js";

// MCP セッション ID からバインド済みのセッション ID を返す。
// バインド未済の場合は最新のアクティブセッションを検出してバインドする。
// strict: true の場合、アクティブセッションが2つ以上あり session_id 未指定時はエラー（null）を返す。
// strict: false（デフォルト）の場合、従来どおり最新アクティブセッションに自動紐付けする。
export function resolveSessionId(
  sessionStore: SessionStore,
  sessionBindings: Map<string, string>,
  mcpSessionId: string | undefined,
  explicitSessionId?: string,
  options?: { strict?: boolean },
): string | null {
  const strict = options?.strict ?? false;

  // 1. 明示的 session_id が指定されている場合はそれを使用
  if (explicitSessionId) {
    const session = sessionStore.get(explicitSessionId);
    if (session && (session.status === "running" || session.status === "idle")) {
      if (mcpSessionId) sessionBindings.set(mcpSessionId, explicitSessionId);
      return explicitSessionId;
    }
    return null; // 指定されたが見つからない
  }

  // 2. バインド済みの session があり、まだアクティブならそれを使用
  if (mcpSessionId && sessionBindings.has(mcpSessionId)) {
    const boundId = sessionBindings.get(mcpSessionId)!;
    const session = sessionStore.get(boundId);
    if (session && (session.status === "running" || session.status === "idle")) {
      return boundId;
    }
    // セッションが非アクティブになった場合はバインド解除して再検出
    sessionBindings.delete(mcpSessionId);
  }

  // 3. 最新のアクティブセッションを自動検出
  const sessions = sessionStore.getAll();
  const activeSessions = sessions
    .filter((s) => s.status === "running" || s.status === "idle")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // strict モード: アクティブセッションが2つ以上あり session_id 未指定の場合はエラー
  if (strict && activeSessions.length >= 2) {
    return null;
  }

  if (activeSessions.length > 0) {
    if (mcpSessionId) sessionBindings.set(mcpSessionId, activeSessions[0].session_id);
    return activeSessions[0].session_id;
  }
  return null;
}

export function createMcpHandler(
  sessionStore: SessionStore,
  questionStore: QuestionStore,
): (req: Request, res: Response) => void {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  // MCP セッション ID → claude-monitor セッション ID のバインディング
  const sessionBindings = new Map<string, string>();

  return async (req: Request, res: Response) => {
    // セッション ID ベースのトランスポート管理
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      if (req.method === "DELETE") {
        transports.delete(sessionId);
      }
      return;
    }

    // POST: 新規セッションまたは既存セッション
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // 新規 MCP セッション
    const server = new McpServer({
      name: "claude-monitor",
      version: "1.0.0",
    });

    // MCP トランスポートの session ID を取得するためのクロージャ変数
    let mcpTransportSessionId: string | undefined;

    // update_status ツール
    server.tool(
      "update_status",
      "現在の作業内容をダッシュボードに表示する",
      {
        status: z.string().describe("作業内容の説明"),
        session_id: z.string().optional().describe("対象セッションID。省略時は自動検出"),
      },
      async ({ status, session_id }) => {
        const targetId = resolveSessionId(sessionStore, sessionBindings, mcpTransportSessionId, session_id);
        if (targetId) {
          sessionStore.updateStatus(targetId, status);
          return { content: [{ type: "text" as const, text: `Status updated: ${status}` }] };
        }
        return { content: [{ type: "text" as const, text: "No active session found" }] };
      }
    );

    // report_milestone ツール
    server.tool(
      "report_milestone",
      "マイルストーン到達をダッシュボードに報告する",
      {
        milestone: z.string().describe("マイルストーンの名前"),
        details: z.string().optional().describe("詳細説明"),
        session_id: z.string().optional().describe("対象セッションID。省略時は自動検出"),
      },
      async ({ milestone, details, session_id }) => {
        const targetId = resolveSessionId(sessionStore, sessionBindings, mcpTransportSessionId, session_id);
        if (targetId) {
          sessionStore.addMilestone(targetId, milestone, details || "");
          return { content: [{ type: "text" as const, text: `Milestone reported: ${milestone}` }] };
        }
        return { content: [{ type: "text" as const, text: "No active session found" }] };
      }
    );

    // ask_user ツール
    server.tool(
      "ask_user",
      "ユーザーに質問する。ブラウザのダッシュボードに質問が表示され、ユーザーが回答する。AskUserQuestionの代わりに使用する。タイムアウト（120秒）した場合はエラーが返るので、AskUserQuestionにフォールバックすること。注意: 複数のアクティブセッションが存在する場合、session_id を省略するとエラーになる。その場合は session_id を明示的に指定すること。",
      {
        session_id: z.string().optional().describe("対象セッションID。省略時はアクティブセッションが1つの場合のみ自動検出。複数アクティブ時は必須"),
        questions: z.array(z.object({
          question: z.string().describe("質問文"),
          header: z.string().max(12).optional().describe("短いラベル（最大12文字）"),
          options: z.array(z.object({
            label: z.string(),
            description: z.string(),
          })).optional().describe("選択肢"),
          multiSelect: z.boolean().optional().describe("複数選択可否"),
        })).min(1).max(4).describe("質問の配列（1-4個）"),
      },
      async ({ session_id, questions }) => {
        // 1. セッション特定（strict モードで曖昧ケースを防止）
        const targetSessionId = resolveSessionId(sessionStore, sessionBindings, mcpTransportSessionId, session_id, { strict: true });
        if (!targetSessionId) {
          let msg: string;
          if (session_id) {
            msg = `Session ${session_id} not found or not active. Use AskUserQuestion instead.`;
          } else {
            // strict モードでの曖昧ケース判定
            const allSessions = sessionStore.getAll();
            const activeSessions = allSessions.filter((s) => s.status === "running" || s.status === "idle");
            if (activeSessions.length >= 2) {
              msg = `複数のアクティブセッションが存在するため、自動紐付けできません。session_id を明示的に指定してください。アクティブセッション: ${activeSessions.map((s) => s.session_id).join(", ")}`;
            } else {
              msg = "No active session found. Use AskUserQuestion instead.";
            }
          }
          return {
            content: [{ type: "text" as const, text: msg }],
            isError: true,
          };
        }

        // 2. QuestionStore に登録
        const pq = questionStore.register(targetSessionId, questions);

        // 3. 回答待ち（最大120秒）
        const result = await questionStore.waitForAnswer(pq.id, 120_000);

        // 4. 結果返却
        if (result.resolved && result.answers) {
          const answerText = pq.questions
            .map((q, i) => `Q: ${q.question}\nA: ${result.answers?.[String(i)] ?? "(未回答)"}`)
            .join("\n\n");
          return {
            content: [{ type: "text" as const, text: answerText }],
          };
        }

        // 5. タイムアウト
        return {
          content: [{ type: "text" as const, text: "質問がタイムアウトしました（120秒）。AskUserQuestion にフォールバックしてください。" }],
          isError: true,
        };
      }
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId) => {
        mcpTransportSessionId = newSessionId;
        transports.set(newSessionId, transport);
      },
    });

    transport.onclose = () => {
      const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
      if (sid) {
        transports.delete(sid);
        sessionBindings.delete(sid);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
