import { TMUX_PANE_ID_RE, type Session, type SessionStatus, type HookEvent, type Milestone, type Question, type Activity, type CliToolType } from "./types.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとにチェック
const COMPLETED_TTL_MS = 60 * 60 * 1000; // 完了セッションは1時間後に削除
const STALENESS_TIMEOUT_MS = 10 * 60 * 1000; // running 状態で10分更新なしなら idle に遷移
const MAX_ACTIVITIES = 30;

// error 状態からの自動復帰対象イベント
const ERROR_RECOVERY_EVENTS: ReadonlySet<string> = new Set(["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"]);

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
    // アクティビティにも記録
    const summary = details ? `${milestone} - ${details}` : milestone;
    this.addActivity(session, "milestone", summary, entry.timestamp);
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

  completeSession(sessionId: string, message: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.status = "completed";
    session.last_message = message;
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
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

  recover(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status !== "waiting_permission" && session.status !== "waiting_answer") {
      return undefined;
    }
    session.status = "idle";
    session.questions = [];
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private createSession(event: HookEvent): Session {
    // cli_tool: 省略時（既存 Claude Code 経路）は "claude" をデフォルト補完
    const cliTool: CliToolType = (event.cli_tool === "copilot") ? "copilot" : "claude";
    return {
      session_id: event.session_id,
      cwd: event.cwd || "",
      model: event.model || "",
      status: "idle",
      status_text: "",
      cli_tool: cliTool,
      milestones: [],
      last_message: "",
      last_activity: "",
      current_progress: "",
      artifacts: [],
      title: "",
      activities: [],
      tmux_pane: "",
      error_info: "",
      error_at: "",
      created_at: event.timestamp || new Date().toISOString(),
      updated_at: event.timestamp || new Date().toISOString(),
      questions: [],
    };
  }

  private applyEvent(session: Session, event: HookEvent): void {
    // error 状態からの自動復帰: エージェント動作を示すイベントで error をクリア
    if (session.status === "error" && ERROR_RECOVERY_EVENTS.has(event.event_type)) {
      session.error_info = "";
      session.error_at = "";
      session.status = "running";
    }

    switch (event.event_type) {
      case "SessionStart":
        // 初期状態はidle（プロンプト入力可能）。UserPromptSubmitでrunningに遷移する。
        session.status = "idle";
        if (event.cwd) session.cwd = event.cwd;
        if (event.model) session.model = event.model;
        if (event.tmux_pane && TMUX_PANE_ID_RE.test(event.tmux_pane)) {
          session.tmux_pane = event.tmux_pane;
        } else if (event.tmux_pane) {
          console.warn(`Invalid tmux_pane format (expected %%N): ${event.tmux_pane}`);
        }
        // cli_tool の更新 + Copilot セッション再初期化
        // Copilot は tmux pane ID ベースの固定 session_id を使うため、
        // 同一 pane での連続起動時に前回データをクリアする必要がある。
        // Claude Code は UUID ベースの一意 session_id のため再初期化不要。
        if (event.cli_tool === "copilot") {
          session.cli_tool = "copilot";
          session.activities = [];
          session.milestones = [];
          session.artifacts = [];
          session.title = "";
          session.status_text = "";
          session.last_activity = "";
          session.last_message = "";
          session.current_progress = "";
          session.questions = [];
          session.error_info = "";
          session.error_at = "";
        }
        break;

      case "UserPromptSubmit": {
        // idle → running 復帰
        session.status = "running";
        session.current_progress = "";
        session.questions = [];
        // 初回プロンプトをタイトルとして保存（スラッシュコマンドは除外）
        const normalizedPrompt = event.prompt?.trimStart() ?? "";
        const truncatedPrompt = normalizedPrompt.length > 80
          ? normalizedPrompt.substring(0, 80) + "..." : normalizedPrompt;
        if (!session.title && normalizedPrompt && !normalizedPrompt.startsWith("/")) {
          session.title = truncatedPrompt;
        }
        // アクティビティ蓄積
        if (normalizedPrompt) {
          this.addActivity(session, "prompt", truncatedPrompt, event.timestamp || new Date().toISOString());
        }
        break;
      }

      case "Notification":
        // Notification(idle_prompt) は状態を変更しない（Stop が idle への遷移を担当）
        // elicitation_dialog は質問発生の通知
        if (event.notification_type === "elicitation_dialog") {
          session.status = "waiting_answer";
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        }
        // error 通知: MCP接続失敗等のエラーをセッションに反映
        if (event.notification_type === "error") {
          session.status = "error";
          session.error_info = event.message || "不明なエラー";
          session.error_at = event.timestamp || new Date().toISOString();
        }
        break;

      case "PreToolUse":
        if (event.tool_name === "AskUserQuestion") {
          session.status = "waiting_answer";
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        } else if (session.status === "waiting_answer") {
          // AskUserQuestion 以外のツールが来た場合、質問は終了している
          session.status = "running";
          session.questions = [];
        }
        // 作業工程テキストの更新（デデュプリケーション付き）
        if (event.progress_text && event.progress_text !== session.current_progress) {
          session.current_progress = event.progress_text;
          this.addActivity(session, "progress",
            event.progress_text.length > 200
              ? event.progress_text.substring(0, 200) + "..."
              : event.progress_text,
            event.timestamp || new Date().toISOString()
          );
        }
        break;

      case "PostToolUse":
        // waiting_answer 状態で PostToolUse が来たら running に復帰（質問回答済み）
        if (session.status === "waiting_answer") {
          session.status = "running";
          session.questions = [];
        }
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
        // アクティビティ蓄積
        if (event.tool_name) {
          const summary = event.file_path ? `${event.tool_name}: ${event.file_path}` : event.tool_name;
          this.addActivity(session, "tool_use", summary, event.timestamp || new Date().toISOString());
        }
        break;

      case "Stop":
        session.status = "idle";
        session.current_progress = "";
        session.questions = [];
        session.error_info = "";
        session.error_at = "";
        if (event.tmux_pane && TMUX_PANE_ID_RE.test(event.tmux_pane)) {
          session.tmux_pane = event.tmux_pane;
        } else if (event.tmux_pane) {
          console.warn(`Invalid tmux_pane format (expected %%N): ${event.tmux_pane}`);
        }
        if (event.last_message) {
          session.last_message = event.last_message;
          // アクティビティ蓄積
          const msgSummary = event.last_message.length > 200 ? event.last_message.substring(0, 200) + "..." : event.last_message;
          this.addActivity(session, "message", msgSummary, event.timestamp || new Date().toISOString());
        }
        break;

      case "SessionEnd":
        session.status = "completed";
        session.current_progress = "";
        session.questions = [];
        if (event.reason) {
          session.last_message = event.reason;
        }
        break;
    }
  }

  private addActivity(session: Session, type: Activity["type"], summary: string, timestamp: string): void {
    session.activities.push({ timestamp, type, summary });
    if (session.activities.length > MAX_ACTIVITIES) {
      session.activities.splice(0, session.activities.length - MAX_ACTIVITIES);
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
      } else if (session.status === "running" || session.status === "waiting_answer") {
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
