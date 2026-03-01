import { TMUX_PANE_ID_RE, type Session, type SessionStatus, type HookEvent, type Milestone, type Question, type Activity, type CliToolType } from "./types.js";
import { getHardTimeoutMs } from "./pane-capture.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとにチェック
const COMPLETED_TTL_MS = 60 * 60 * 1000; // 完了セッションは1時間後に削除
const STALENESS_TIMEOUT_MS = 10 * 60 * 1000; // running 状態で10分更新なしなら idle に遷移
const MAX_ACTIVITIES = 30;

// error 状態からの自動復帰対象イベント
const ERROR_RECOVERY_EVENTS: ReadonlySet<string> = new Set(["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"]);

// Codex hard timeout — 共通ヘルパーから取得（環境変数 CODEX_HARD_TIMEOUT_MINUTES で上書き可能）
export const CODEX_CLEANUP_HARD_TIMEOUT_MS = getHardTimeoutMs("codex");

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private onChange: (session: Session) => void;
  private onDelete?: (sessionId: string) => void;
  private onDeleteHooks: Array<(sessionId: string) => void> = [];
  onHardTimeout?: (sessionId: string) => void;
  // run_id 世代管理: SessionStart 再初期化時に前 run の pending/failed イベントを無効化
  onInvalidateBySession?: (sessionId: string) => void;

  constructor(onChange: (session: Session) => void, onDelete?: (sessionId: string) => void) {
    this.onChange = onChange;
    this.onDelete = onDelete;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  addOnDeleteHook(hook: (sessionId: string) => void): void {
    this.onDeleteHooks.push(hook);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  setPromptReady(sessionId: string, ready: boolean): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.prompt_ready === ready) return session;
    session.prompt_ready = ready;
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
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
    session.prompt_ready = false;
    session.error_info = errorInfo;
    session.error_at = new Date().toISOString();
    session.updated_at = new Date().toISOString();
    this.onChange(session);
  }

  completeSession(sessionId: string, message: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.status = "completed";
    session.prompt_ready = false;
    session.last_message = message;
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  resetError(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "error") return undefined;
    session.status = "idle";
    session.prompt_ready = true;
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
    session.prompt_ready = true;
    session.questions = [];
    session.updated_at = new Date().toISOString();
    this.onChange(session);
    return session;
  }

  /** ターミナルイベント要約を更新する（onChange 非発火 = silent 更新） */
  updateTerminalEventSummary(sessionId: string, count: number, latestSeq: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.terminal_event_count = count;
    session.terminal_event_latest_seq = latestSeq;
    // 注意: updated_at は更新しない（cleanup の stale 判定に影響させない）
    // 注意: onChange を呼ばない（session_update broadcast を抑制）
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private createSession(event: HookEvent): Session {
    // cli_tool: 省略時（既存 Claude Code 経路）は "claude" をデフォルト補完
    const cliTool: CliToolType = (event.cli_tool === "copilot") ? "copilot"
      : (event.cli_tool === "codex") ? "codex"
      : "claude";
    const now = event.timestamp || new Date().toISOString();
    return {
      session_id: event.session_id,
      cwd: event.cwd || "",
      model: event.model || "",
      status: "idle",
      prompt_ready: true,
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
      last_hook_at: "",
      last_init_at: now,
      last_run_started_at: "",
      first_prompt_sent: false,
      approvalSupported: cliTool !== "codex",
      external_session_id: "",
      error_info: "",
      error_at: "",
      created_at: now,
      updated_at: now,
      questions: [],
      run_id: 1,
      terminal_event_count: 0,
      terminal_event_latest_seq: 0,
      last_capture_detected_at: null,
    };
  }

  private applyEvent(session: Session, event: HookEvent): void {
    // error 状態からの自動復帰: エージェント動作を示すイベントで error をクリア
    if (session.status === "error" && ERROR_RECOVERY_EVENTS.has(event.event_type)) {
      session.error_info = "";
      session.error_at = "";
      session.status = "running";
      session.prompt_ready = false;
    }

    switch (event.event_type) {
      case "SessionStart": {
        // run_id 世代管理: Copilot/Codex で status 変更前にチェック
        // 既存セッションが completed または UserPromptSubmit 受信済みの場合のみ
        // run_id をインクリメントし、前 run の pending/failed イベントを無効化する。
        // プレセッション→実セッションの再初期化（last_run_started_at === ""）では run_id を維持。
        if (event.cli_tool === "copilot" || event.cli_tool === "codex") {
          const shouldIncrementRunId =
            session.status === "completed" || session.last_run_started_at !== "";
          if (shouldIncrementRunId) {
            session.run_id += 1;
            this.onInvalidateBySession?.(session.session_id);
          }
        }

        // status は表示状態、prompt_ready は送信可能状態を表す（Copilot では分離制御）
        // 初期状態は idle + prompt_ready=true（初回プロンプト入力可能）。
        session.status = "idle";
        session.prompt_ready = true;
        if (event.cwd) session.cwd = event.cwd;
        if (event.model) session.model = event.model;
        if (event.tmux_pane && TMUX_PANE_ID_RE.test(event.tmux_pane)) {
          session.tmux_pane = event.tmux_pane;
        } else if (event.tmux_pane) {
          console.warn(`Invalid tmux_pane format (expected %%N): ${event.tmux_pane}`);
        }
        // cli_tool の更新 + Copilot/Codex セッション再初期化
        // Copilot/Codex は tmux pane ID ベースの固定 session_id を使うため、
        // 同一 pane での連続起動時に前回データをクリアする必要がある。
        // Claude Code は UUID ベースの一意 session_id のため再初期化不要。
        if (event.cli_tool === "copilot" || event.cli_tool === "codex") {

          session.cli_tool = event.cli_tool;
          session.approvalSupported = event.cli_tool !== "codex";
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
          session.last_hook_at = "";
          session.last_init_at = event.timestamp || new Date().toISOString();
          session.last_run_started_at = "";
          session.first_prompt_sent = false;
          session.external_session_id = "";
          session.prompt_ready = true;
          session.terminal_event_count = 0;
          session.terminal_event_latest_seq = 0;
          session.last_capture_detected_at = null;
        }
        break;
      }

      case "UserPromptSubmit": {
        // idle → running 復帰
        session.status = "running";
        session.prompt_ready = false;
        session.current_progress = "";
        session.questions = [];
        session.last_run_started_at = event.timestamp || new Date().toISOString();
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
          session.prompt_ready = false;
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        }
        // error 通知: MCP接続失敗等のエラーをセッションに反映
        if (event.notification_type === "error") {
          session.status = "error";
          session.prompt_ready = false;
          session.error_info = event.message || "不明なエラー";
          session.error_at = event.timestamp || new Date().toISOString();
        }
        break;

      case "PreToolUse":
        // Copilot/Codex: idle → running 復帰（sessionEnd(complete)→idle 後のツール使用）
        if ((session.cli_tool === "copilot" || session.cli_tool === "codex") && session.status === "idle" && event.tool_name !== "AskUserQuestion") {
          session.status = "running";
          session.prompt_ready = false;
        }
        if (event.tool_name === "AskUserQuestion") {
          session.status = "waiting_answer";
          session.prompt_ready = false;
          if (event.questions && event.questions.length > 0) {
            session.questions = event.questions;
          }
        } else if (session.status === "waiting_answer") {
          // AskUserQuestion 以外のツールが来た場合、質問は終了している
          session.status = "running";
          session.prompt_ready = false;
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
        // Copilot/Codex: idle → running 復帰（sessionEnd(complete)→idle 後のツール使用）
        if ((session.cli_tool === "copilot" || session.cli_tool === "codex") && session.status === "idle") {
          session.status = "running";
          session.prompt_ready = false;
        }
        // waiting_answer 状態で PostToolUse が来たら running に復帰（質問回答済み）
        if (session.status === "waiting_answer") {
          session.status = "running";
          session.prompt_ready = false;
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
        session.prompt_ready = true;
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

      case "SessionEnd": {
        // Copilot CLI: reason に基づいてステータスを決定
        // - "complete" → idle + prompt_ready=false（次入力は pane monitor の安定判定で再許可）
        // - その他 → completed（セッション終了）
        // Claude Code / Codex: 従来通り常に completed
        if (session.cli_tool === "copilot") {
          const rawReason = event.reason || "";
          const COPILOT_REASON_ALIASES: Record<string, string> = { user_quit: "user_exit" };
          const normalizedReason = COPILOT_REASON_ALIASES[rawReason] || rawReason;
          const COPILOT_KNOWN_REASONS = new Set(["complete", "error", "abort", "timeout", "user_exit", ""]);
          if (!COPILOT_KNOWN_REASONS.has(normalizedReason)) {
            console.warn(`Copilot SessionEnd: unknown reason "${rawReason}", treating as session end`);
          }
          session.status = normalizedReason === "complete" ? "idle" : "completed";
          session.prompt_ready = false;
        } else {
          session.status = "completed";
          session.prompt_ready = false;
        }
        session.current_progress = "";
        session.questions = [];
        if (event.reason) {
          session.last_message = event.reason;
        }
        break;
      }
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
          for (const hook of this.onDeleteHooks) {
            hook(id);
          }
        }
      } else if (session.status === "running" || session.status === "waiting_answer") {
        // Codex セッション: pane monitor に状態管理を委ねるため、
        // 通常の staleness による idle 遷移をスキップする。
        // ただし hard timeout 超過時は onHardTimeout 経由で完了させる（永久残留防止）。
        if (session.cli_tool === "codex") {
          const runStartedAt = session.last_run_started_at || session.last_init_at;
          const sinceRunStarted = now - new Date(runStartedAt).getTime();
          if (sinceRunStarted >= CODEX_CLEANUP_HARD_TIMEOUT_MS && this.onHardTimeout) {
            console.log(`[hard_timeout] cleanup: codex session ${id} hard timeout (${sinceRunStarted}ms), invoking onHardTimeout`);
            this.onHardTimeout(id);
          }
          continue;
        }
        const updatedAt = new Date(session.updated_at).getTime();
        if (now - updatedAt > STALENESS_TIMEOUT_MS) {
          session.status = "idle";
          session.prompt_ready = true;
          session.updated_at = new Date().toISOString();
          this.onChange(session);
        }
      }
    }
  }
}
