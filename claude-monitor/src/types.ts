// セッション状態
export type SessionStatus =
  | "running"
  | "waiting_permission"
  | "waiting_answer"
  | "idle"
  | "error"
  | "completed";

// CLIツール種別
export type CliToolType = "claude" | "copilot" | "codex";

// ターミナルイベント状態（ライフサイクル管理）
export type TerminalEventState = "pending" | "consumed" | "failed" | "expired";

// ターミナルイベント種別
export type TerminalEventType = "output" | "gap" | "trigger";

// ターミナルイベント（capture-pane / hooks 由来の端末ログ）
export interface TerminalEvent {
  id: string;                          // 一意識別子
  sequence: number;                    // セッション内 seq 番号（単調増加）
  timestamp: string;                   // ISO 8601
  source: "capture" | "hooks";        // イベント発生元
  session_id: string;                  // セッション紐付け
  run_id: number;                      // run 世代（Session.run_id と対応）
  text: string;                        // イベントテキスト
  type: TerminalEventType;             // イベント種別
  // ライフサイクル管理（TASK-002b）
  event_state: TerminalEventState;     // 状態
  expires_at: string;                  // ISO 8601（TTL ベース有効期限）
  consumed_at: string;                 // ISO 8601（消費日時、空文字で初期化）
  failed_at: string;                   // ISO 8601（失敗日時、空文字で初期化）
  fail_reason: string;                 // 失敗理由
  fail_phase: "" | "before_text" | "after_text"; // 失敗フェーズ
  retry_count: number;                 // 再試行回数（初期値0）
  // メタデータ
  truncated: boolean;                  // テキスト切り詰め済みフラグ
  reason?: string;                     // gap イベント時の理由等
}

// capture-pane 設定
export interface CaptureConfig {
  enableCodex: boolean;
  enableCopilot: boolean;
  enableClaude: boolean;
  maxEventsPerSession: number;
  eventTtlMinutes: number;
  maxEventsGlobal: number;
  maxEventChars: number;
  tombstoneTtlMinutes: number;
}

// セッション
export interface Session {
  session_id: string;
  cwd: string;
  model: string;
  status: SessionStatus;
  status_text: string; // MCP update_status で更新される作業内容
  cli_tool: CliToolType; // セッション起動元のCLIツール種別
  milestones: Milestone[];
  last_message: string;
  last_activity: string; // 直近のツール操作情報（PostToolUse: tool_name + file_path）
  current_progress: string; // 直近の作業工程テキスト（トランスクリプト解析で付与）
  artifacts: string[]; // Write/Edit で検出された成果物ファイルパス
  title: string; // ユーザーの初回指示内容
  error_info: string;
  tmux_pane: string; // tmux pane識別子（例: "%5"）
  last_hook_at: string; // ISO 8601 — 最終フック通信時刻（空文字列で初期化）
  last_init_at: string; // ISO 8601 — 最終初期化時刻（SessionStart/再初期化時に更新）
  last_run_started_at: string; // ISO 8601 — 最終 run 開始時刻（UserPromptSubmit / send-keys 成功時に更新）
  first_prompt_sent: boolean; // Copilot: 初回プロンプト送信済みフラグ
  prompt_ready: boolean; // 送信UI/APIの共通判定フラグ（Copilotはstatusとは独立して制御）
  approvalSupported: boolean; // ブラウザからの承認操作が対応しているか（Codex は false）
  external_session_id: string; // Codex thread-id 等、CLI固有のセッション識別子
  error_at: string; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  activities: Activity[];
  questions: Question[];
  // ターミナルイベント要約（TerminalEventStore から分離管理）
  run_id: number;                          // run 世代カウンタ（初期値1、SessionStart 再初期化時にインクリメント）
  terminal_event_count: number;            // 当該セッションのイベント総数
  terminal_event_latest_seq: number;       // 当該セッションの最新 seq 番号
  last_capture_detected_at: number | null; // epoch ms（capture 検知時刻、null で初期化）
}

export interface Activity {
  timestamp: string;       // ISO 8601
  type: "prompt" | "tool_use" | "message" | "milestone" | "progress";
  summary: string;         // 表示用テキスト
}

export interface Milestone {
  milestone: string;
  details: string;
  timestamp: string; // ISO 8601
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionOption {
  label: string;
  description: string;
}

// MCP ask_user 経由の質問管理
export interface PendingQuestion {
  id: string;                        // UUID
  session_id: string;
  questions: QuestionInput[];        // 質問一覧（AskUserQuestion と同じ構造）
  status: "pending" | "answered" | "timeout";
  answers?: Record<string, string>;  // question index ("0", "1", ...) → answer
  created_at: string;                // ISO 8601
  answered_at?: string;              // ISO 8601
}

export interface QuestionInput {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

// Hook から受信するイベント
export type EventType =
  | "SessionStart"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd"
  | "UserPromptSubmit";

export type NotificationType =
  | "idle_prompt"
  | "permission_prompt"
  | "auth_success"
  | "elicitation_dialog"
  | "error"
  | "group_auto_assign_failed";

export interface HookEvent {
  event_type: EventType;
  session_id: string;
  cwd: string;
  model: string;
  title: string;
  notification_type: NotificationType | "";
  message: string;
  tool_name: string;
  file_path: string; // PostToolUse 時のファイルパス
  prompt: string; // UserPromptSubmit 時のプロンプト
  questions: Question[];
  last_message: string;
  tmux_pane: string; // SessionStart時にnotify.shから送信
  reason: string;
  transcript_path: string; // Claude Code のトランスクリプト JSONL パス
  progress_text: string; // サーバー側でトランスクリプトから抽出した作業工程テキスト（notify.sh からは送信されない）
  cli_tool: CliToolType | ""; // セッション起動元のCLIツール種別（省略時は"claude"をデフォルト補完）
  timestamp: string; // ISO 8601
}

// グループ
export interface Group {
  id: string;
  name: string;
  session_ids: string[];
  created_at: string; // ISO 8601
}

// 決定リクエスト
export type DecisionType = "permission";

export interface Decision {
  id: string; // correlation_id
  session_id: string;
  decision_type: DecisionType;
  tool_name: string;
  tool_input: Record<string, unknown>;
  status: "pending" | "resolved" | "timeout";
  result?: "allow" | "deny";
  created_at: string; // ISO 8601
  resolved_at?: string; // ISO 8601
}

export interface DecisionRequest {
  correlation_id: string;
  session_id: string;
  decision_type: DecisionType;
  tool_name: string;
  tool_input: Record<string, unknown>;
  timestamp: string;
}

export interface DecisionResponse {
  decision: "allow" | "deny";
}

// CLI 別アクション文字列（capture 検知起点の疑似端末操作で使用）
export interface ActionStrings {
  yes: string;          // 承認文字列
  yes_always: string;   // 全承認文字列（"yes and don't ask again" 相当）
  no: string;           // 拒否文字列
}

// CLIツール設定
export interface CliToolConfig {
  id: string;           // "claude", "copilot", "codex"
  label: string;        // "Claude Code"
  command: string;      // "claude"
  windowIndex: number;  // tmuxウィンドウ番号（claudeは1）
  actionStrings: ActionStrings; // CLI 別アクション文字列
}

// Codex 起動モード
export type CodexLaunchMode = "new" | "resume" | "fork";

// セッション起動リクエスト
export interface LaunchRequest {
  tool_id: string;      // CliToolConfig.id
  cwd?: string;         // 作業ディレクトリ（省略時は環境変数のデフォルト値）
  group_id?: string;    // 起動後に自動割り当てするグループID
  // Codex 専用オプション
  codex_mode?: CodexLaunchMode; // 起動モード（省略時は "new"）
  codex_target?: string;        // resume/fork 対象セッションID
  codex_all?: boolean;          // --all フラグ（cwdスコープ不一致時に全セッション対象）
}

// セッション起動結果
export interface LaunchResult {
  ok: boolean;
  tmux_pane: string;    // 作成されたペイン識別子（例: "%5"）
  warning?: string;     // 起動時の警告メッセージ（hooks.json配置失敗等）
}

// tmux ペインID検証用正規表現（例: "%5"）
export const TMUX_PANE_ID_RE = /^%\d+$/;

// プロンプトテンプレート
export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

// WebSocket メッセージ
export type WSMessage =
  | { type: "session_update"; payload: Session }
  | { type: "decision_pending"; payload: Decision }
  | { type: "decision_resolved"; payload: Decision }
  | { type: "notification"; payload: { session_id: string; message: string; notification_type: NotificationType | "" } }
  | { type: "group_update"; payload: Group }
  | { type: "group_delete"; payload: { id: string } }
  | { type: "prompt_template_update"; payload: PromptTemplate }
  | { type: "prompt_template_delete"; payload: { id: string } }
  | { type: "prompt_history_update"; payload: { scope: "group" | "session"; id: string; history: string[] } }
  | { type: "question_pending"; payload: PendingQuestion }
  | { type: "question_answered"; payload: PendingQuestion }
  | { type: "terminal_event_batch"; payload: { session_id: string; events: TerminalEvent[]; dropped_count: number; from_seq: number; to_seq: number } };
