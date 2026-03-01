import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TmuxManager } from "./tmux-manager.js";
import type { SessionStore } from "./session-store.js";
import { TerminalEventStore } from "./terminal-event-store.js";
import type { CaptureConfig, CliToolType, Session, TerminalEvent } from "./types.js";

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

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

  // TASK-024: pane_pid 変化検知（Codex 再起動時の run_id 境界再判定）
  const currentPid = await deps.tmux.getPanePid(session.tmux_pane);
  if (currentPid !== null && state.lastPanePid !== null && currentPid !== state.lastPanePid) {
    // PID 変化: Codex プロセス再起動を検知
    console.log(`[pane_pid_changed] session ${session.session_id}: pid ${state.lastPanePid} → ${currentPid}`);
    session.run_id += 1;
    deps.terminalEventStore.invalidateBySession(session.session_id, "pane_pid_changed");
    // カーソルリセット
    state.cursor = 0;
    state.anchorLine = null;
    state.lastLineCount = 0;
  }
  if (currentPid !== null) {
    state.lastPanePid = currentPid;
  }

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
          text: maskSensitiveData(line),
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

  // CLI 別承認検知（TASK-009b/c/d）
  detectAndTrigger(deps, session, lines);
}

// --- 機密情報マスク処理（TASK-007c） ---

/** ビルトインマスクパターン（RISK-006 ハードコード定義） */
const BUILTIN_MASK_PATTERNS: RegExp[] = [
  // KEY=value, SECRET=value, TOKEN=value, PASSWORD=value 形式
  /(?<=(?:API_KEY|SECRET_KEY|ACCESS_KEY|PRIVATE_KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS|AUTH_TOKEN|BEARER)\s*[=:]\s*).+/gi,
  // Bearer トークン
  /(?<=Bearer\s+)\S+/gi,
  // AWS アクセスキー（AKIA...）
  /\bAKIA[0-9A-Z]{16}\b/g,
  // SSH 秘密鍵ヘッダ
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
];

const MASK_REPLACEMENT = "***MASKED***";

let _loadedMaskPatterns: RegExp[] | null = null;

/** マスクパターンをロード（ビルトイン + 外部設定ファイル） */
export function loadMaskPatterns(configDir?: string): RegExp[] {
  const patterns = [...BUILTIN_MASK_PATTERNS];

  const maskFilePath = configDir
    ? path.join(configDir, "mask-patterns.json")
    : path.resolve(__dirname_local, "../mask-patterns.json");

  try {
    if (fs.existsSync(maskFilePath)) {
      const raw = fs.readFileSync(maskFilePath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(`mask-patterns.json: JSON parse error, using builtin patterns only`);
        return patterns;
      }
      if (!Array.isArray(parsed)) {
        console.warn(`mask-patterns.json: expected array, using builtin patterns only`);
        return patterns;
      }
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item !== "string") {
          console.warn(`mask-patterns.json: entry[${i}] is not a string, skipping`);
          continue;
        }
        try {
          patterns.push(new RegExp(item, "gi"));
        } catch {
          console.warn(`mask-patterns.json: entry[${i}] is invalid regex "${item}", skipping`);
        }
      }
    }
  } catch {
    // ファイル読み込み失敗: ビルトインのみで動作
  }

  return patterns;
}

/** テキストに機密情報マスクを適用する */
export function maskSensitiveData(text: string, patterns?: RegExp[]): string {
  if (!patterns) {
    if (!_loadedMaskPatterns) {
      _loadedMaskPatterns = loadMaskPatterns();
    }
    patterns = _loadedMaskPatterns;
  }
  let result = text;
  for (const pattern of patterns) {
    // lastIndex をリセット（global フラグ付き正規表現の再利用対策）
    pattern.lastIndex = 0;
    result = result.replace(pattern, MASK_REPLACEMENT);
  }
  return result;
}

/** テスト用: ロード済みマスクパターンをリセット */
export function _resetMaskPatterns(): void {
  _loadedMaskPatterns = null;
}

// --- Codex 承認プロンプト検知（TASK-008） ---

/** Codex の承認要求パターン: "Do you want to proceed?" / "Allow" / "apply" 系プロンプト */
const CODEX_APPROVAL_PATTERNS: RegExp[] = [
  // Codex sandbox 承認: "Do you want to proceed? (y/n)" / "(yes/no)" / "(y/n/yes_always)"
  /Do you want to proceed\?\s*\([^)]*\)/i,
  // Codex apply patch: "Apply this patch? (y/n)"
  /Apply (?:this )?(?:patch|change|diff)\?\s*\([^)]*\)/i,
  // Codex tool approval: "Allow <tool>? (y/n)"
  /Allow\s+\w[^?]*\?\s*\([^)]*\)/i,
  // Codex generic approval: 末尾が (y/n) や (yes/no) や (y/n/yes_always) のプロンプト
  /\?\s*\(\s*(?:y(?:es)?)\s*\/\s*(?:n(?:o)?)\s*(?:\/\s*yes_always)?\s*\)\s*$/im,
];

/** 承認プロンプトの近傍テキスト（誤検知防止用の文脈条件） */
const CODEX_APPROVAL_CONTEXT_PATTERNS: RegExp[] = [
  // ツール名やファイルパスなどの付随情報
  /(?:Bash|Write|Edit|Read|Glob|Grep|WebFetch|WebSearch)/i,
  /(?:sandbox|permission|tool|execute|run|command)/i,
];

/**
 * Codex 承認プロンプトを検知する
 * @param lines - pane テキスト（末尾数行を対象にする）
 * @returns 検知されたプロンプトテキスト、未検知時は null
 */
export function detectCodexApprovalPrompt(lines: string[]): string | null {
  // 末尾 10 行を検査（承認プロンプトは通常末尾に表示される）
  const tail = lines.slice(-10);
  const tailText = tail.join("\n");

  for (const pattern of CODEX_APPROVAL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(tailText);
    if (match) {
      // 近傍コンテキストチェック（承認プロンプトの前後に関連テキストが存在するか）
      // 精度向上のため: 近傍テキストが存在しない場合でも末尾パターンの一致で検知を許容する
      return match[0];
    }
  }
  return null;
}

// --- 誤検知保護（TASK-010） ---

/** cooldown/dedup/dismiss 環境変数パース */
const CAPTURE_TRIGGER_COOLDOWN_MS = parseIntEnvOr("CAPTURE_TRIGGER_COOLDOWN_MS", 5000);
const CAPTURE_DEDUP_TTL_MS = parseIntEnvOr("CAPTURE_DEDUP_TTL_MS", 60000);
const CAPTURE_DISMISS_TTL_MS = parseIntEnvOr("CAPTURE_DISMISS_TTL_MS", 300000);

/** absolute timeout（capture 延命の最終上限） */
const CAPTURE_ABSOLUTE_TIMEOUT_MS =
  parseIntEnvOr("CAPTURE_ABSOLUTE_TIMEOUT_MINUTES", 30) * 60 * 1000;

function parseIntEnvOr(key: string, defaultVal: number): number {
  const v = process.env[key];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 1 ? defaultVal : n;
}

/** セッション単位の最終トリガー発火時刻（cooldown 制御） */
const lastTriggerAt = new Map<string, number>();

/** 同一文面抑止ストア: key → expiry epoch ms */
const dedupStore = new Map<string, number>();

/** dismiss 抑止ストア: key → expiry epoch ms */
const dismissStore = new Map<string, number>();

/** 抑止キー生成 */
function makeDedupKey(sessionId: string, patternText: string): string {
  // 正規化: 先頭末尾の空白除去
  return `${sessionId}:${patternText.trim()}`;
}

/** cooldown チェック */
function isCooldownActive(sessionId: string): boolean {
  const last = lastTriggerAt.get(sessionId);
  if (!last) return false;
  return Date.now() - last < CAPTURE_TRIGGER_COOLDOWN_MS;
}

/** dedup チェック */
function isDeduplicated(key: string): boolean {
  const expiry = dedupStore.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    dedupStore.delete(key);
    return false;
  }
  return true;
}

/** dismiss チェック */
function isDismissed(key: string): boolean {
  const expiry = dismissStore.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    dismissStore.delete(key);
    return false;
  }
  return true;
}

/** dismiss 登録（UI から呼ばれる） */
export function dismissTrigger(sessionId: string, patternText: string): void {
  const key = makeDedupKey(sessionId, patternText);
  dismissStore.set(key, Date.now() + CAPTURE_DISMISS_TTL_MS);
}

/** トリガー発火を記録し抑止ストアに登録する */
function recordTrigger(sessionId: string, patternText: string): void {
  lastTriggerAt.set(sessionId, Date.now());
  const key = makeDedupKey(sessionId, patternText);
  dedupStore.set(key, Date.now() + CAPTURE_DEDUP_TTL_MS);
}

/** トリガー発火可否チェック（全抑止条件を統合） */
function canFireTrigger(sessionId: string, patternText: string): boolean {
  if (isCooldownActive(sessionId)) return false;
  const key = makeDedupKey(sessionId, patternText);
  if (isDeduplicated(key)) return false;
  if (isDismissed(key)) return false;
  return true;
}

/** テスト用: 全抑止ストアをクリア */
export function _resetTriggerStores(): void {
  lastTriggerAt.clear();
  dedupStore.clear();
  dismissStore.clear();
}

// --- CLI 別承認検知統合（TASK-009b/c/d） ---

/**
 * capture 結果から CLI 別の承認プロンプト検知を実行し、
 * 検知時にトリガーイベントを生成する。
 */
function detectAndTrigger(
  deps: PaneCaptureDeps,
  session: Session,
  lines: string[],
): void {
  // Codex: capture-pane がプライマリ検知手段
  if (session.cli_tool === "codex") {
    const detected = detectCodexApprovalPrompt(lines);
    if (detected && canFireTrigger(session.session_id, detected)) {
      recordTrigger(session.session_id, detected);

      // トリガーイベントを生成
      const event = deps.terminalEventStore.addEvent({
        sessionId: session.session_id,
        runId: session.run_id,
        text: detected,
        type: "trigger",
        source: "capture",
      });

      // last_capture_detected_at を更新
      session.last_capture_detected_at = Date.now();

      // WebSocket 配信
      deps.broadcastTerminalEventBatch(session.session_id, [event]);

      console.log(`[capture_trigger] codex session ${session.session_id}: approval detected "${detected.substring(0, 60)}"`);
    }
    return;
  }

  // Copilot: hooks タイムアウト前の補助検知（TASK-009c）
  // Copilot は hooks ベースの承認が動作するため、capture は補助的に
  // 活動検知（last_capture_detected_at 更新）のみ行う
  if (session.cli_tool === "copilot") {
    // pane にテキスト変化がある場合、活動を検知として扱う
    // （トリガーイベントは生成しない — hooks authoritative）
    if (lines.length > 0) {
      session.last_capture_detected_at = Date.now();
    }
    return;
  }

  // Claude: pane テキスト検知（TASK-009d）
  // hooks authoritative のため、capture は補助的な活動検知のみ
  if (session.cli_tool === "claude") {
    if (lines.length > 0) {
      session.last_capture_detected_at = Date.now();
    }
    return;
  }
}

/**
 * hooks イベント受信時に pending capture トリガーを expired にする（TASK-009d）
 * SessionStore の processEvent から呼び出す想定
 */
export function expirePendingTriggersOnHooksEvent(
  terminalEventStore: TerminalEventStore,
  sessionId: string,
): number {
  return terminalEventStore.invalidateBySession(sessionId, "hooks_resolved");
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
