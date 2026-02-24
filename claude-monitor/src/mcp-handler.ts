import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Request, Response } from "express";
import type { SessionStore } from "./session-store.js";
import type { QuestionStore } from "./question-store.js";

export function createMcpHandler(
  sessionStore: SessionStore,
  questionStore: QuestionStore,
): (req: Request, res: Response) => void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return async (req: Request, res: Response) => {
    // セッション ID ベースのトランスポート管理
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      if (req.method === "DELETE") {
        transports.delete(sessionId);
      }
      return;
    }

    // POST: 新規セッションまたは既存セッション
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    // 新規 MCP セッション
    const server = new McpServer({
      name: "claude-monitor",
      version: "1.0.0",
    });

    // update_status ツール
    server.tool(
      "update_status",
      "現在の作業内容をダッシュボードに表示する",
      { status: z.string().describe("作業内容の説明") },
      async ({ status }) => {
        // session_id は Hook 経由で登録済みのものを探す（最新のアクティブセッションを優先）
        const sessions = sessionStore.getAll();
        const activeSession = sessions
          .filter((s) => s.status === "running" || s.status === "idle")
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (activeSession) {
          sessionStore.updateStatus(activeSession.session_id, status);
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
      },
      async ({ milestone, details }) => {
        const sessions = sessionStore.getAll();
        const activeSession = sessions
          .filter((s) => s.status === "running" || s.status === "idle")
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (activeSession) {
          sessionStore.addMilestone(
            activeSession.session_id,
            milestone,
            details || ""
          );
          return { content: [{ type: "text" as const, text: `Milestone reported: ${milestone}` }] };
        }
        return { content: [{ type: "text" as const, text: "No active session found" }] };
      }
    );

    // ask_user ツール
    server.tool(
      "ask_user",
      "ユーザーに質問する。ブラウザのダッシュボードに質問が表示され、ユーザーが回答する。AskUserQuestionの代わりに使用する。タイムアウト（120秒）した場合はエラーが返るので、AskUserQuestionにフォールバックすること。",
      {
        session_id: z.string().optional().describe("対象セッションID。省略時は最新のアクティブセッションを自動検出"),
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
        // 1. セッション特定
        let targetSessionId: string;
        if (session_id) {
          const session = sessionStore.get(session_id);
          if (!session || (session.status !== "running" && session.status !== "idle")) {
            return {
              content: [{ type: "text" as const, text: `Session ${session_id} not found or not active. Use AskUserQuestion instead.` }],
              isError: true,
            };
          }
          targetSessionId = session_id;
        } else {
          // フォールバック: 最新のアクティブセッションを自動検出
          const sessions = sessionStore.getAll();
          const activeSession = sessions
            .filter((s) => s.status === "running" || s.status === "idle")
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

          if (!activeSession) {
            return {
              content: [{ type: "text" as const, text: "No active session found. Use AskUserQuestion instead." }],
              isError: true,
            };
          }
          targetSessionId = activeSession.session_id;
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
        transports.set(newSessionId, transport);
      },
    });

    transport.onclose = () => {
      const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
      if (sid) transports.delete(sid);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
