// セッション状態
export type SessionStatus =
  | "running"
  | "waiting_permission"
  | "waiting_answer"
  | "idle"
  | "error"
  | "completed";

// セッション
export interface Session {
  session_id: string;
  cwd: string;
  model: string;
  status: SessionStatus;
  status_text: string; // MCP update_status で更新される作業内容
  milestones: Milestone[];
  last_message: string;
  last_activity: string; // 直近のツール操作情報（PostToolUse: tool_name + file_path）
  current_progress: string; // 直近の作業工程テキスト（トランスクリプト解析で付与）
  artifacts: string[]; // Write/Edit で検出された成果物ファイルパス
  title: string; // ユーザーの初回指示内容
  error_info: string;
  tmux_pane: string; // tmux pane識別子（例: "%5"）
  error_at: string; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  activities: Activity[];
  questions: Question[];
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
  | "elicitation_dialog";

export interface HookEvent {
  event_type: EventType;
  session_id: string;
  cwd: string;
  model: string;
  title: string;
  notification_type: string;
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

// CLIツール設定（将来のcopilot/codex対応用）
export interface CliToolConfig {
  id: string;           // "claude", "copilot", "codex"
  label: string;        // "Claude Code"
  command: string;      // "claude"
  windowIndex: number;  // tmuxウィンドウ番号（claudeは1）
}

// セッション起動リクエスト
export interface LaunchRequest {
  tool_id: string;      // CliToolConfig.id
  cwd?: string;         // 作業ディレクトリ（省略時は環境変数のデフォルト値）
  group_id?: string;    // 起動後に自動割り当てするグループID
}

// セッション起動結果
export interface LaunchResult {
  ok: boolean;
  tmux_pane: string;    // 作成されたペイン識別子（例: "%5"）
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
  | { type: "notification"; payload: { session_id: string; message: string; notification_type: string } }
  | { type: "group_update"; payload: Group }
  | { type: "group_delete"; payload: { id: string } }
  | { type: "prompt_template_update"; payload: PromptTemplate }
  | { type: "prompt_template_delete"; payload: { id: string } }
  | { type: "prompt_history_update"; payload: { scope: "group" | "session"; id: string; history: string[] } }
  | { type: "question_pending"; payload: PendingQuestion }
  | { type: "question_answered"; payload: PendingQuestion };
