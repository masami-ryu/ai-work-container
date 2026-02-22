import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Request, Response } from "express";
import type { SessionStore } from "./session-store.js";

export function createMcpHandler(sessionStore: SessionStore): (req: Request, res: Response) => void {
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
