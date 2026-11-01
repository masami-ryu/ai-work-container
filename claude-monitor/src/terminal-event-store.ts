import { randomUUID } from "node:crypto";
import type { TerminalEvent, TerminalEventState, TerminalEventType, CaptureConfig } from "./types.js";

// デフォルト設定値
export const DEFAULT_MAX_EVENTS_PER_SESSION = 200;
export const DEFAULT_EVENT_TTL_MINUTES = 10;
export const DEFAULT_MAX_EVENTS_GLOBAL = 2000;
export const DEFAULT_MAX_EVENT_CHARS = 4096;
export const DEFAULT_TOMBSTONE_TTL_MINUTES = 20;
export const DEFAULT_TRIGGER_MAX_RETRIES = 3;

// consumeIfPending のエラー理由
export type ConsumeError =
  | "TRIGGER_EVENT_NOT_FOUND"
  | "TRIGGER_EVENT_CONSUMED"
  | "TRIGGER_EVENT_EXPIRED"
  | "TRIGGER_SESSION_MISMATCH"
  | "TRIGGER_RUN_MISMATCH"
  | "TRIGGER_RETRY_EXHAUSTED"
  | "TRIGGER_NOT_RETRIABLE";

export interface ConsumeResult {
  success: boolean;
  reason?: ConsumeError;
}

export interface AddEventParams {
  sessionId: string;
  runId: number;
  text: string;
  type: TerminalEventType;
  source: "capture" | "hooks";
  eventState?: TerminalEventState;
  ttlMinutes?: number;
  reason?: string;
}

/** CaptureConfig を環境変数から生成する */
export function parseCaptureConfig(env: Record<string, string | undefined> = process.env): CaptureConfig {
  return {
    enableCodex: parseBoolEnv(env.CAPTURE_ENABLE_CODEX, false),
    enableCopilot: parseBoolEnv(env.CAPTURE_ENABLE_COPILOT, false),
    enableClaude: parseBoolEnv(env.CAPTURE_ENABLE_CLAUDE, false),
    maxEventsPerSession: parseIntEnvClamped(env.CAPTURE_MAX_EVENTS_PER_SESSION, DEFAULT_MAX_EVENTS_PER_SESSION, 1),
    eventTtlMinutes: parseIntEnvClamped(env.CAPTURE_EVENT_TTL_MINUTES, DEFAULT_EVENT_TTL_MINUTES, 1),
    maxEventsGlobal: parseIntEnvClamped(env.CAPTURE_MAX_EVENTS_GLOBAL, DEFAULT_MAX_EVENTS_GLOBAL, 1),
    maxEventChars: parseIntEnvClamped(env.CAPTURE_MAX_EVENT_CHARS, DEFAULT_MAX_EVENT_CHARS, 1),
    tombstoneTtlMinutes: parseIntEnvClamped(env.CAPTURE_TOMBSTONE_TTL_MINUTES, DEFAULT_TOMBSTONE_TTL_MINUTES, 1),
  };
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return value.toLowerCase() === "true";
}

function parseIntEnvClamped(value: string | undefined, defaultValue: number, min: number): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min) return defaultValue;
  return Math.max(parsed, min);
}

export class TerminalEventStore {
  // セッションID → イベント配列（seq 昇順）
  private events = new Map<string, TerminalEvent[]>();
  // seq カウンタ（セッションごと）
  private seqCounters = new Map<string, number>();
  // 設定
  private config: CaptureConfig;

  constructor(config: CaptureConfig) {
    this.config = config;
  }

  /** イベントを追加し、追加されたイベントを返す */
  addEvent(params: AddEventParams): TerminalEvent {
    const {
      sessionId, runId, text, type, source,
      eventState = "pending",
      ttlMinutes = this.config.eventTtlMinutes,
      reason,
    } = params;

    // seq カウンタ更新
    const prevSeq = this.seqCounters.get(sessionId) ?? 0;
    const seq = prevSeq + 1;
    this.seqCounters.set(sessionId, seq);

    // テキスト truncate
    const truncated = text.length > this.config.maxEventChars;
    const finalText = truncated ? text.substring(0, this.config.maxEventChars) : text;

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    const event: TerminalEvent = {
      id: randomUUID(),
      sequence: seq,
      timestamp: now,
      source,
      session_id: sessionId,
      run_id: runId,
      text: finalText,
      type,
      event_state: eventState,
      expires_at: expiresAt,
      consumed_at: "",
      failed_at: "",
      fail_reason: "",
      fail_phase: "",
      retry_count: 0,
      truncated,
      reason,
    };

    let sessionEvents = this.events.get(sessionId);
    if (!sessionEvents) {
      sessionEvents = [];
      this.events.set(sessionId, sessionEvents);
    }
    sessionEvents.push(event);

    // セッション単位上限
    this.enforceSessionLimit(sessionId);
    // グローバル上限
    this.enforceGlobalLimit();

    return event;
  }

  /** セッションIDで絞り込みイベントを取得（seq 昇順、cursor より大きい seq のみ） */
  getEvents(sessionId: string, cursor: number = 0, limit: number = 50): TerminalEvent[] {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents) return [];
    const filtered = sessionEvents.filter(e => e.sequence > cursor);
    return filtered.slice(0, limit);
  }

  /** セッションの最新 seq 番号を取得 */
  getLatestSeq(sessionId: string): number {
    return this.seqCounters.get(sessionId) ?? 0;
  }

  /** セッションのイベント総数を取得 */
  getEventCount(sessionId: string): number {
    return this.events.get(sessionId)?.length ?? 0;
  }

  /** ID でイベントを取得 */
  getEventById(eventId: string): TerminalEvent | undefined {
    for (const events of this.events.values()) {
      const found = events.find(e => e.id === eventId);
      if (found) return found;
    }
    return undefined;
  }

  /** CAS 型原子的消費: pending/retriable-failed → consumed */
  consumeIfPending(eventId: string, sessionId: string, runId: number): ConsumeResult {
    const event = this.getEventById(eventId);
    if (!event) {
      return { success: false, reason: "TRIGGER_EVENT_EXPIRED" };
    }
    if (event.session_id !== sessionId) {
      return { success: false, reason: "TRIGGER_SESSION_MISMATCH" };
    }
    if (event.run_id !== runId) {
      return { success: false, reason: "TRIGGER_RUN_MISMATCH" };
    }
    // 有効期限チェック
    if (new Date(event.expires_at).getTime() <= Date.now()) {
      event.event_state = "expired";
      return { success: false, reason: "TRIGGER_EVENT_EXPIRED" };
    }
    // 状態チェック
    if (event.event_state === "consumed") {
      return { success: false, reason: "TRIGGER_EVENT_CONSUMED" };
    }
    if (event.event_state === "expired") {
      return { success: false, reason: "TRIGGER_EVENT_EXPIRED" };
    }
    if (event.event_state === "failed") {
      if (event.fail_phase === "after_text") {
        return { success: false, reason: "TRIGGER_NOT_RETRIABLE" };
      }
      if (event.retry_count >= DEFAULT_TRIGGER_MAX_RETRIES) {
        return { success: false, reason: "TRIGGER_RETRY_EXHAUSTED" };
      }
      // retriable failed → consumed
      event.event_state = "consumed";
      event.consumed_at = new Date().toISOString();
      event.retry_count += 1;
      return { success: true };
    }
    if (event.event_state !== "pending") {
      return { success: false, reason: "TRIGGER_EVENT_EXPIRED" };
    }
    // pending → consumed
    event.event_state = "consumed";
    event.consumed_at = new Date().toISOString();
    return { success: true };
  }

  /** セッションの全 pending/failed イベントを expired に遷移 */
  invalidateBySession(sessionId: string, failReason: string = "session_restarted"): number {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents) return 0;
    let count = 0;
    for (const event of sessionEvents) {
      if (event.event_state === "pending" || event.event_state === "failed") {
        event.event_state = "expired";
        event.fail_reason = failReason;
        count++;
      }
    }
    return count;
  }

  /** イベントを failed に遷移 */
  markFailed(eventId: string, failReason: string, failPhase: "before_text" | "after_text"): boolean {
    const event = this.getEventById(eventId);
    if (!event) return false;
    event.event_state = "failed";
    event.failed_at = new Date().toISOString();
    event.fail_reason = failReason;
    event.fail_phase = failPhase;
    return true;
  }

  /** TTL 超過イベントの expired 遷移と tombstone 物理削除 */
  runMaintenance(): void {
    const now = Date.now();
    const tombstoneTtlMs = this.config.tombstoneTtlMinutes * 60 * 1000;

    for (const [sessionId, sessionEvents] of this.events) {
      // TTL 超過を expired に遷移
      for (const event of sessionEvents) {
        if (event.event_state !== "expired" && event.event_state !== "consumed") {
          if (new Date(event.expires_at).getTime() <= now) {
            event.event_state = "expired";
            event.fail_reason = event.fail_reason || "ttl_expired";
          }
        }
      }
      // tombstone 物理削除（expired 状態で tombstone TTL 超過）
      const remaining = sessionEvents.filter(e => {
        if (e.event_state === "expired") {
          const expiredAt = new Date(e.expires_at).getTime();
          return (now - expiredAt) < tombstoneTtlMs;
        }
        return true;
      });
      if (remaining.length === 0) {
        this.events.delete(sessionId);
      } else {
        this.events.set(sessionId, remaining);
      }
    }
  }

  /** セッションのイベントを全削除（テスト用） */
  clearSession(sessionId: string): void {
    this.events.delete(sessionId);
    this.seqCounters.delete(sessionId);
  }

  /** 全データクリア（テスト用） */
  clear(): void {
    this.events.clear();
    this.seqCounters.clear();
  }

  // --- Private ---

  /** eviction 優先順位でソート: consumed→expired→failed→pending, 同一状態ではセッション最終更新→イベント最終更新 の古い順 */
  private getEvictionPriority(event: TerminalEvent): number {
    switch (event.event_state) {
      case "consumed": return 0;
      case "expired": return 1;
      case "failed": return 2;
      case "pending": return 3;
    }
  }

  private getEventLastUpdated(event: TerminalEvent): number {
    // consumed_at, failed_at, timestamp の最大値
    const timestamps = [
      new Date(event.timestamp).getTime(),
    ];
    if (event.consumed_at) timestamps.push(new Date(event.consumed_at).getTime());
    if (event.failed_at) timestamps.push(new Date(event.failed_at).getTime());
    return Math.max(...timestamps);
  }

  private getSessionLastUpdated(sessionId: string): number {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents || sessionEvents.length === 0) return 0;
    return Math.max(...sessionEvents.map(e => this.getEventLastUpdated(e)));
  }

  /** セッション単位の保持上限を強制 */
  private enforceSessionLimit(sessionId: string): void {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents || sessionEvents.length <= this.config.maxEventsPerSession) return;

    // 削除対象を eviction 優先順位でソート
    const sorted = [...sessionEvents].sort((a, b) => {
      const pa = this.getEvictionPriority(a);
      const pb = this.getEvictionPriority(b);
      if (pa !== pb) return pa - pb;
      return this.getEventLastUpdated(a) - this.getEventLastUpdated(b);
    });

    const excess = sessionEvents.length - this.config.maxEventsPerSession;
    const toRemove = new Set(sorted.slice(0, excess).map(e => e.id));
    const remaining = sessionEvents.filter(e => !toRemove.has(e.id));
    this.events.set(sessionId, remaining);
  }

  /** グローバルの保持上限を強制 */
  private enforceGlobalLimit(): void {
    let totalCount = 0;
    for (const events of this.events.values()) {
      totalCount += events.length;
    }
    if (totalCount <= this.config.maxEventsGlobal) return;

    // 全イベントを eviction 優先順位でソート
    const allEvents: Array<{ event: TerminalEvent; sessionLastUpdated: number }> = [];
    for (const [sessionId, events] of this.events) {
      const sessionLastUpdated = this.getSessionLastUpdated(sessionId);
      for (const event of events) {
        allEvents.push({ event, sessionLastUpdated });
      }
    }

    allEvents.sort((a, b) => {
      const pa = this.getEvictionPriority(a.event);
      const pb = this.getEvictionPriority(b.event);
      if (pa !== pb) return pa - pb;
      if (a.sessionLastUpdated !== b.sessionLastUpdated) return a.sessionLastUpdated - b.sessionLastUpdated;
      return this.getEventLastUpdated(a.event) - this.getEventLastUpdated(b.event);
    });

    const excess = totalCount - this.config.maxEventsGlobal;
    const toRemove = new Set(allEvents.slice(0, excess).map(e => e.event.id));

    for (const [sessionId, events] of this.events) {
      const remaining = events.filter(e => !toRemove.has(e.id));
      if (remaining.length === 0) {
        this.events.delete(sessionId);
      } else {
        this.events.set(sessionId, remaining);
      }
    }
  }
}
