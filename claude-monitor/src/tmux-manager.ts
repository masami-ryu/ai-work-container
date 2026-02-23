import { execFile } from "child_process";
import { promisify } from "util";
import type { CliToolConfig, LaunchResult } from "./types.js";

const execFileAsync = promisify(execFile);

const MAX_PANES_PER_WINDOW = 8;

// デフォルトCLIツール定義
const DEFAULT_TOOLS: CliToolConfig[] = [
  { id: "claude", label: "Claude Code", command: "claude", windowIndex: 1 },
];

export class TmuxManager {
  private sessionName: string | null = null;
  private tools: Map<string, CliToolConfig>;
  private defaultCwd: string | null;
  private launchQueue: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor() {
    this.tools = new Map(DEFAULT_TOOLS.map(t => [t.id, t]));
    this.defaultCwd = process.env.CLAUDE_MONITOR_WORK_DIR || null;
    if (!this.defaultCwd) {
      console.warn("CLAUDE_MONITOR_WORK_DIR not set. Session launch feature disabled.");
    }
  }

  // サーバー起動時にtmux環境を検出
  // CON-001: tmux外でもサーバー起動を妨げない
  async initialize(): Promise<boolean> {
    try {
      if (!process.env.TMUX) {
        console.warn("Not running inside tmux. Session launch feature disabled.");
        return false;
      }
      const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "#{session_name}"]);
      this.sessionName = stdout.trim();
      if (!this.sessionName) {
        console.warn("Failed to detect tmux session name.");
        return false;
      }
      console.log(`TmuxManager initialized: session=${this.sessionName}`);
      return true;
    } catch (e) {
      console.warn("TmuxManager initialization failed:", (e as Error).message);
      return false;
    }
  }

  // tmuxが利用可能かどうか
  isAvailable(): boolean {
    return this.sessionName !== null && this.defaultCwd !== null;
  }

  // 利用可能なCLIツール一覧
  getTools(): CliToolConfig[] {
    return Array.from(this.tools.values());
  }

  // shutdown時にフラグを立て、以降のlaunchSessionを拒否する
  destroy(): void {
    this.destroyed = true;
  }

  // 指定ツールで新しいセッションをtmuxペインに起動（排他制御付き）
  async launchSession(toolId: string, cwd?: string): Promise<LaunchResult> {
    if (this.destroyed) {
      throw new Error("TmuxManager is destroyed");
    }
    return new Promise((resolve, reject) => {
      this.launchQueue = this.launchQueue.then(async () => {
        if (this.destroyed) {
          reject(new Error("TmuxManager is destroyed"));
          return;
        }
        try {
          resolve(await this._doLaunch(toolId, cwd));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // 内部: 実際の起動処理
  private async _doLaunch(toolId: string, cwd?: string): Promise<LaunchResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }
    if (!this.isAvailable()) {
      throw new Error("TmuxManager is not available");
    }

    const resolvedCwd = cwd || this.defaultCwd!;

    // ウィンドウが存在する場合、ペイン数上限チェック
    const exists = await this.windowExists(tool.windowIndex);
    if (exists) {
      const count = await this.getPaneCount(tool.windowIndex);
      if (count >= MAX_PANES_PER_WINDOW) {
        throw new Error(`Pane limit reached: ${count}/${MAX_PANES_PER_WINDOW}`);
      }
    }

    const paneId = await this.createPaneAndRun(tool.windowIndex, tool.command, resolvedCwd, exists);
    return { ok: true, tmux_pane: paneId };
  }

  // 内部: ウィンドウが存在するか確認
  private async windowExists(windowIndex: number): Promise<boolean> {
    try {
      const target = `${this.sessionName}:${windowIndex}`;
      await execFileAsync("tmux", ["list-panes", "-t", target]);
      return true;
    } catch {
      return false;
    }
  }

  // 内部: 対象ウィンドウのペイン数を取得
  private async getPaneCount(windowIndex: number): Promise<number> {
    const target = `${this.sessionName}:${windowIndex}`;
    const { stdout } = await execFileAsync("tmux", ["list-panes", "-t", target, "-F", "#{pane_index}"]);
    return stdout.trim().split("\n").length;
  }

  // 内部: ペインを作成してコマンド実行し、ペインIDを返す
  private async createPaneAndRun(windowIndex: number, command: string, cwd: string, windowAlreadyExists: boolean): Promise<string> {
    const format = "#{session_name}:#{window_index}.#{pane_index}";
    const target = `${this.sessionName}:${windowIndex}`;

    // -c オプションでcwdを指定し、コマンドは独立した引数として渡す
    // シェル文字列連結を避けることでコマンドインジェクションを防止（CON-003）
    const tmuxCmd = windowAlreadyExists
      ? ["split-window", "-t", target, "-c", cwd, "-P", "-F", format, command]
      : ["new-window", "-t", target, "-c", cwd, "-P", "-F", format, command];

    const { stdout } = await execFileAsync("tmux", tmuxCmd);
    const paneId = stdout.trim();

    // レイアウト整理（失敗してもペイン自体は利用可能）
    try {
      await execFileAsync("tmux", ["select-layout", "-t", target, "even-vertical"]);
    } catch (e) {
      console.warn("select-layout failed (non-critical):", (e as Error).message);
    }

    return paneId;
  }
}
