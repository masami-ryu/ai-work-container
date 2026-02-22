import type { Session, SessionStatus, HookEvent, Milestone, Question } from "./types.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとにチェック
const COMPLETED_TTL_MS = 60 * 60 * 1000; // 完了セッションは1時間後に削除
const STALENESS_TIMEOUT_MS = 10 * 60 * 1000; // running 状態で10分更新なしなら idle に遷移

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private onChange: (session: Session) => void;
  private onDelete?: (sessionId: string) => void;

  constructor(onChange: (session: Session) => void, onDelete?: (sessionId: string) => void) {
    this.onChange = onChange;
    this.onDelete = onDelete;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  processEvent(event: HookEvent): Session {
    let session = this.sessions.get(event.session_id);

    if (!session) {
      session = this.createSession(event);
      this.sessions.set(event.session_id, session);
    }

    this.applyEvent(session, event);
    session.updated_at = event.timestamp || new Date().toISOString();
    this.onChange(session);
    return session;
  }

  updateStatus(sessionId: string, statusText: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.status_text = statusText;
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  addMilestone(sessionId: string, milestone: string, details: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const entry: Milestone = {
      milestone,
      details,
      timestamp: new Date().toISOString(),
    };
    session.milestones.push(entry);
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  setError(sessionId: string, errorInfo: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "error";
    session.error_info = errorInfo;
    session.error_at = new Date().toISOString();
    session.updated_at = new Date().toISOString();
    this.onChange(session);
  }

  resetError(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "error") return undefined;
    session.status = "idle";
    session.error_info = "";
    session.error_at = "";
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private createSession(event: HookEvent): Session {
    return {
      session_id: event.session_id,
      cwd: event.cwd || "",
      model: event.model || "",
      status: "running",
      status_text: "",
      milestones: [],
      last_message: "",
      last_activity: "",
      artifacts: [],
      title: "",
      error_info: "",
      error_at: "",
      created_at: event.timestamp || new Date().toISOString(),
      updated_at: event.timestamp || new Date().toISOString(),
      questions: [],
    };
  }

  private applyEvent(session: Session, event: HookEvent): void {
    // error 状態からの自動復帰: 新しいイベントが来たら error をクリア
    if (session.status === "error" && event.event_type !== "SessionEnd") {
      session.error_info = "";
      session.error_at = "";
    }

    switch (event.event_type) {
      case "SessionStart":
        session.status = "running";
        if (event.cwd) session.cwd = event.cwd;
        if (event.model) session.model = event.model;
        break;

      case "UserPromptSubmit":
        // idle → running 復帰
        session.status = "running";
        session.questions = [];
        // 初回プロンプトをタイトルとして保存
        if (!session.title && event.prompt) {
          session.title = event.prompt.length > 80 ? event.prompt.substring(0, 80) + "..." : event.prompt;
        }
        break;

      case "Notification":
        // Notification(idle_prompt) は状態を変更しない（Stop が idle への遷移を担当）
        // elicitation_dialog は質問発生の通知
        if (event.notification_type === "elicitation_dialog") {
          session.status = "waiting_answer";
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        }
        break;

      case "PreToolUse":
        if (event.tool_name === "AskUserQuestion") {
          session.status = "waiting_answer";
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        }
        break;

      case "PostToolUse":
        // Write/Edit 時にファイルパスを成果物として記録 + last_activity を更新
        if (event.tool_name && (event.tool_name === "Write" || event.tool_name === "Edit")) {
          if (event.file_path) {
            if (!session.artifacts.includes(event.file_path)) {
              session.artifacts.push(event.file_path);
            }
            session.last_activity = `${event.tool_name}: ${event.file_path}`;
          }
        } else if (event.tool_name) {
          session.last_activity = event.tool_name + (event.file_path ? `: ${event.file_path}` : "");
        }
        break;

      case "Stop":
        session.status = "idle";
        session.questions = [];
        if (event.last_message) {
          session.last_message = event.last_message;
        }
        break;

      case "SessionEnd":
        session.status = "completed";
        session.questions = [];
        if (event.reason) {
          session.last_message = event.reason;
        }
        break;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status === "completed") {
        const updatedAt = new Date(session.updated_at).getTime();
        if (now - updatedAt > COMPLETED_TTL_MS) {
          this.sessions.delete(id);
          this.onDelete?.(id);
        }
      } else if (session.status === "running") {
        const updatedAt = new Date(session.updated_at).getTime();
        if (now - updatedAt > STALENESS_TIMEOUT_MS) {
          session.status = "idle";
          session.updated_at = new Date().toISOString();
          this.onChange(session);
        }
      }
    }
  }
}
