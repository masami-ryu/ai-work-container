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
  error_info: string;
  error_at: string; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  questions: Question[];
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

// Hook から受信するイベント
export type EventType =
  | "SessionStart"
  | "Notification"
  | "PreToolUse"
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
  questions: Question[];
  last_message: string;
  reason: string;
  timestamp: string; // ISO 8601
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

// WebSocket メッセージ
export type WSMessage =
  | { type: "session_update"; payload: Session }
  | { type: "decision_pending"; payload: Decision }
  | { type: "decision_resolved"; payload: Decision }
  | { type: "notification"; payload: { session_id: string; message: string; notification_type: string } };
