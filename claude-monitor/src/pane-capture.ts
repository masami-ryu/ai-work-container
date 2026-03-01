import type { TmuxManager } from "./tmux-manager.js";
import type { SessionStore } from "./session-store.js";
import { TerminalEventStore } from "./terminal-event-store.js";
import type { CaptureConfig, CliToolType, Session, TerminalEvent } from "./types.js";

/** capture ポーリングループの依存注入インターフェース */
export interface PaneCaptureDeps {
  tmux: TmuxManager;
  sessionStore: SessionStore;
  terminalEventStore: TerminalEventStore;
  captureConfig: CaptureConfig;
  broadcastTerminalEventBatch: (sessionId: string, events: TerminalEvent[]) => void;
}

/** セッションごとの差分追跡状態 */
interface CaptureState {
  /** 最後に処理した行カーソル（0-indexed、次回はこの行以降を処理） */
  cursor: number;
  /** 先頭アンカー行（再同期検出用） */
  anchorLine: string | null;
  /** 前回取得した総行数 */
  lastLineCount: number;
  /** 前回取得した pane PID */
  lastPanePid: string | null;
}

// セッションIDごとの差分追跡状態
const captureStates = new Map<string, CaptureState>();

/** 差分追跡状態を取得または初期化 */
function getOrCreateState(sessionId: string): CaptureState {
  let state = captureStates.get(sessionId);
  if (!state) {
    state = { cursor: 0, anchorLine: null, lastLineCount: 0, lastPanePid: null };
    captureStates.set(sessionId, state);
  }
  return state;
}

/** セッションの差分追跡状態をリセット */
export function resetCaptureState(sessionId: string): void {
  captureStates.delete(sessionId);
}

/** CLI ごとの capture 有効判定 */
export function isCaptureEnabled(config: CaptureConfig, cliTool: CliToolType): boolean {
  switch (cliTool) {
    case "codex": return config.enableCodex;
    case "copilot": return config.enableCopilot;
    case "claude": return config.enableClaude;
  }
}

/** capture ポーリングの tick ガード（重複実行抑止） */
let captureTickRunning = false;

/**
 * capture ポーリングの1 tick を実行する。
 * pane 消失検知・セッション完了処理は runPaneMonitorTick の責務。
 * 本関数は「収集・差分化・配信」に限定する。
 */
export async function runCaptureTick(deps: PaneCaptureDeps): Promise<void> {
  // 重複実行抑止
  if (captureTickRunning) return;
  captureTickRunning = true;

  try {
    // canManagePanes === false の場合はスキップ（CON-003）
    if (!deps.tmux.canManagePanes()) return;

    const sessions = deps.sessionStore.getAll();

    for (const session of sessions) {
      // completed セッションはスキップ
      if (session.status === "completed") continue;

      // CLI ごとの capture 有効判定
      if (!isCaptureEnabled(deps.captureConfig, session.cli_tool)) continue;

      // tmux pane 未設定のセッションはスキップ
      if (!session.tmux_pane) continue;

      try {
        await captureSessionPane(deps, session);
      } catch (e) {
        console.warn(`captureSessionPane(${session.session_id}) error:`, (e as Error).message);
      }
    }
  } finally {
    captureTickRunning = false;
  }
}

/** 単一セッションの pane をキャプチャし差分を配信する */
async function captureSessionPane(deps: PaneCaptureDeps, session: Session): Promise<void> {
  const lines = await deps.tmux.capturePane(session.tmux_pane);
  if (lines === null) {
    // pane 不在: ポーリング停止（完了処理は runPaneMonitorTick に委ねる）
    return;
  }

  const state = getOrCreateState(session.session_id);

  // 末尾の空行を除去（capture-pane の出力特性）
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const currentLineCount = lines.length;

  // 再同期条件チェック
  let needResync = false;
  let resyncReason = "";

  // 条件1: cursor > 現在行数（scrollback 縮退・clear コマンド等）
  if (state.cursor > currentLineCount) {
    needResync = true;
    resyncReason = "cursor_exceeded";
  }
  // 条件2: 先頭アンカー行の不一致（pane 再生成・内容全置換等）
  else if (state.anchorLine !== null && lines.length > 0 && lines[0] !== state.anchorLine) {
    needResync = true;
    resyncReason = "anchor_mismatch";
  }

  if (needResync) {
    // gap イベントを記録
    deps.terminalEventStore.addEvent({
      sessionId: session.session_id,
      runId: session.run_id,
      text: "",
      type: "gap",
      source: "capture",
      eventState: "consumed", // gap は消費済みとして扱う
      reason: resyncReason,
    });

    // カーソルリセット
    state.cursor = 0;
    state.anchorLine = lines.length > 0 ? lines[0] : null;
  }

  // 差分抽出: cursor 以降の行を新規行として取得
  if (state.cursor < currentLineCount) {
    const newLines = lines.slice(state.cursor);

    // 空行のみの差分は無視
    const hasContent = newLines.some(line => line.trim() !== "");
    if (hasContent) {
      const newEvents: TerminalEvent[] = [];

      for (const line of newLines) {
        const event = deps.terminalEventStore.addEvent({
          sessionId: session.session_id,
          runId: session.run_id,
          text: line,
          type: "output",
          source: "capture",
        });
        newEvents.push(event);
      }

      // Session 要約更新（silent: onChange 非発火）
      deps.sessionStore.updateTerminalEventSummary(
        session.session_id,
        deps.terminalEventStore.getEventCount(session.session_id),
        deps.terminalEventStore.getLatestSeq(session.session_id),
      );

      // WebSocket バッチ配信
      if (newEvents.length > 0) {
        deps.broadcastTerminalEventBatch(session.session_id, newEvents);
      }
    }
  }

  // 状態更新
  state.cursor = currentLineCount;
  state.lastLineCount = currentLineCount;
  if (lines.length > 0 && state.anchorLine === null) {
    state.anchorLine = lines[0];
  }
}

// --- ヘルパー関数（TASK-009a） ---

/** hooks タイムスタンプ文字列を epoch ms に安全に変換する */
export function parseHookTimestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** run 開始基準時刻を安全に取得する */
export function getRunStartMs(session: Pick<Session, "last_run_started_at" | "last_init_at">): number {
  const raw = session.last_run_started_at || session.last_init_at;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

/** CLI 別の hard timeout (ms) を取得する */
export function getHardTimeoutMs(cliType: CliToolType): number {
  switch (cliType) {
    case "copilot": {
      const envMinutes = process.env.COPILOT_HARD_TIMEOUT_MINUTES;
      if (envMinutes) {
        const parsed = parseInt(envMinutes, 10);
        if (!Number.isNaN(parsed) && parsed >= 1) return parsed * 60 * 1000;
      }
      return 10 * 60 * 1000; // デフォルト 10分
    }
    case "codex": {
      const envMinutes = process.env.CODEX_HARD_TIMEOUT_MINUTES;
      if (envMinutes) {
        const parsed = parseInt(envMinutes, 10);
        if (!Number.isNaN(parsed) && parsed >= 1) return parsed * 60 * 1000;
      }
      return 10 * 60 * 1000; // デフォルト 10分
    }
    default:
      return 10 * 60 * 1000;
  }
}

// テスト用: captureTickRunning をリセットする
export function _resetCaptureTickGuard(): void {
  captureTickRunning = false;
}
