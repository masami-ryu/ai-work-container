import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import { TMUX_PANE_ID_RE, type CliToolConfig, type LaunchResult, type CodexLaunchMode } from "./types.js";

export interface PaneInfo {
  paneId: string;
  command: string;
  currentPath: string;
}

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

const execFileAsync = promisify(execFile);
const fsReadFile = promisify(fs.readFile);
const fsWriteFile = promisify(fs.writeFile);
const fsMkdir = promisify(fs.mkdir);
const fsCopyFile = promisify(fs.copyFile);

const MAX_PANES_PER_WINDOW = 8;

// デフォルトCLIツール定義
const DEFAULT_TOOLS: CliToolConfig[] = [
  { id: "claude", label: "Claude Code", command: "claude", windowIndex: 1 },
  { id: "copilot", label: "Copilot CLI", command: "copilot", windowIndex: 2 },
  { id: "codex", label: "Codex CLI", command: "codex", windowIndex: 3 },
];

// シェルコマンド文字列用のクォート（シングルクォート方式）
function shellQuote(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`;
}

// hooks テンプレートの __HOOKS_DIR__ プレースホルダーを絶対パスに展開
// テンプレート内でパスはシングルクォートされている前提
function resolveHooksTemplate(templateJson: string, hooksDir: string): string {
  return templateJson.replace(/__HOOKS_DIR__/g, hooksDir.replace(/'/g, "'\\''"));
}

export class TmuxManager {
  private sessionName: string | null = null;
  private selfPaneId: string | null = null;
  private tools: Map<string, CliToolConfig>;
  private toolAvailability: Map<string, { available: boolean; unavailable_reason?: string }> = new Map();
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

      // $TMUX_PANE は既に%N形式（例: %0, %5）なのでそのまま使用
      const tmuxPane = process.env.TMUX_PANE;
      if (tmuxPane && TMUX_PANE_ID_RE.test(tmuxPane)) {
        this.selfPaneId = tmuxPane;
      }

      // ツールの存在チェック
      await this.checkToolAvailability();

      console.log(`TmuxManager initialized: session=${this.sessionName}, selfPane=${this.selfPaneId ?? "(unknown)"}`);
      return true;
    } catch (e) {
      console.warn("TmuxManager initialization failed:", (e as Error).message);
      return false;
    }
  }

  // 各CLIツールのコマンド存在を確認
  private async checkToolAvailability(): Promise<void> {
    for (const tool of this.tools.values()) {
      try {
        await execFileAsync("which", [tool.command]);
        this.toolAvailability.set(tool.id, { available: true });
      } catch {
        this.toolAvailability.set(tool.id, {
          available: false,
          unavailable_reason: `${tool.command} command not found`,
        });
        console.warn(`Tool '${tool.id}' not available: ${tool.command} command not found`);
      }
    }
  }

  // ツール個別の利用可否を返す
  isToolAvailable(toolId: string): { available: boolean; unavailable_reason?: string } {
    return this.toolAvailability.get(toolId) || { available: false, unavailable_reason: "Unknown tool" };
  }

  // tmuxペイン操作（kill/list/exists）が可能か（sessionNameのみ必要）
  canManagePanes(): boolean {
    return this.sessionName !== null;
  }

  // セッション起動が可能か（sessionName + defaultCwd が必要）
  isAvailable(): boolean {
    return this.sessionName !== null && this.defaultCwd !== null;
  }

  // 利用可能なCLIツール一覧（availability情報付き）
  getTools(): CliToolConfig[] {
    return Array.from(this.tools.values());
  }

  // ツール一覧（availability情報付き）
  getToolsWithAvailability(): Array<{ id: string; label: string; available: boolean; unavailable_reason?: string }> {
    const tmuxAvailable = this.isAvailable();
    return Array.from(this.tools.values()).map(t => {
      if (!tmuxAvailable) {
        return { id: t.id, label: t.label, available: false, unavailable_reason: "tmux or CLAUDE_MONITOR_WORK_DIR not available" };
      }
      const avail = this.toolAvailability.get(t.id);
      return {
        id: t.id,
        label: t.label,
        available: avail?.available ?? false,
        unavailable_reason: avail?.unavailable_reason,
      };
    });
  }

  // tmuxペインをkillする（自ペイン保護付き）
  async killPane(paneId: string): Promise<void> {
    if (!this.canManagePanes()) {
      throw new Error("TmuxManager is not available");
    }
    if (!TMUX_PANE_ID_RE.test(paneId)) {
      throw new Error("Invalid pane ID format");
    }

    // 自ペイン保護: サーバー自身のペインをkillしない
    if (this.selfPaneId === null) {
      const err = new Error("Cannot kill pane: server self pane ID is unknown");
      (err as Error & { code: string }).code = "ERR_SELFPANE_UNKNOWN";
      throw err;
    }
    if (paneId === this.selfPaneId) {
      const err = new Error("Refusing to kill server's own pane");
      (err as Error & { code: string }).code = "ERR_REFUSE_SERVER_PANE";
      throw err;
    }

    await execFileAsync("tmux", ["kill-pane", "-t", paneId]);
  }

  // 全アクティブペインIDを取得（全tmuxセッション対象）
  // エラー時は null を返す（呼び出し側でスキップ判断）
  async listActivePanes(): Promise<Set<string> | null> {
    if (!this.canManagePanes()) {
      return null;
    }
    try {
      const format = "#{pane_id}";
      const { stdout } = await execFileAsync("tmux", [
        "list-panes", "-a", "-F", format,
      ]);
      return new Set(stdout.trim().split("\n").filter(Boolean));
    } catch (e) {
      console.warn("listActivePanes failed:", (e as Error).message);
      return null;
    }
  }

  // 全アクティブペインの詳細情報を取得（paneId, command, currentPath）
  // エラー時は null を返す（呼び出し側でスキップ判断）
  async listActivePanesDetailed(): Promise<PaneInfo[] | null> {
    if (!this.canManagePanes()) {
      return null;
    }
    try {
      const format = "#{pane_id}\t#{pane_current_command}\t#{pane_current_path}";
      const { stdout } = await execFileAsync("tmux", [
        "list-panes", "-a", "-F", format,
      ]);
      return stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [paneId, command, currentPath] = line.split("\t");
        return { paneId, command: command || "", currentPath: currentPath || "" };
      });
    } catch (e) {
      console.warn("listActivePanesDetailed failed:", (e as Error).message);
      return null;
    }
  }

  // 指定ペインが存在するか確認
  // pane未検出時は false、tmux実行エラー時は例外を送出
  async paneExists(paneId: string): Promise<boolean> {
    if (!TMUX_PANE_ID_RE.test(paneId)) {
      return false;
    }
    try {
      await execFileAsync("tmux", ["display-message", "-t", paneId, "-p", ""]);
      return true;
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      const msg = stderr || (e as Error).message || "";
      if (/can.t find|no such|not found/i.test(msg)) {
        return false;
      }
      throw e;
    }
  }

  // 指定ペインが copy-mode 等の入力不可状態か確認
  // true = copy-mode 中、false = 通常状態
  // pane未検出時は false、tmux実行エラー時は例外を送出（paneExists パターン準拠）
  async checkPaneMode(paneId: string): Promise<boolean> {
    if (!TMUX_PANE_ID_RE.test(paneId)) {
      return false;
    }
    try {
      const { stdout } = await execFileAsync("tmux", [
        "display-message", "-t", paneId, "-p", "#{pane_in_mode}",
      ]);
      return stdout.trim() === "1";
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      const msg = stderr || (e as Error).message || "";
      if (/can.t find|no such|not found/i.test(msg)) {
        return false;
      }
      throw e;
    }
  }

  // copy-mode を解除し、再判定で通常状態に復帰したか確認
  // true = 復帰成功（再判定で pane_in_mode=0）、false = 復帰失敗
  // pane未検出時は false、tmux実行エラー時は例外を送出（paneExists パターン準拠）
  async cancelCopyMode(paneId: string): Promise<boolean> {
    if (!TMUX_PANE_ID_RE.test(paneId)) {
      return false;
    }
    try {
      await execFileAsync("tmux", ["send-keys", "-t", paneId, "-X", "cancel"]);
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      const msg = stderr || (e as Error).message || "";
      if (/can.t find|no such|not found/i.test(msg)) {
        return false;
      }
      // レースで既に通常モードへ戻っている場合は再判定へ進める
      if (/not in (?:a )?mode/i.test(msg)) {
        return !(await this.checkPaneMode(paneId));
      }
      throw e;
    }
    // 再判定: cancel 後に copy-mode が解除されたか確認
    return !(await this.checkPaneMode(paneId));
  }

  // shutdown時にフラグを立て、以降のlaunchSessionを拒否する
  destroy(): void {
    this.destroyed = true;
  }

  // 指定ツールで新しいセッションをtmuxペインに起動（排他制御付き）
  async launchSession(toolId: string, cwd?: string, codexOptions?: { mode?: CodexLaunchMode; target?: string; all?: boolean }): Promise<LaunchResult> {
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
          resolve(await this._doLaunch(toolId, cwd, codexOptions));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // 内部: 実際の起動処理
  private async _doLaunch(toolId: string, cwd?: string, codexOptions?: { mode?: CodexLaunchMode; target?: string; all?: boolean }): Promise<LaunchResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    // ツール存在チェック
    const availability = this.isToolAvailable(toolId);
    if (!availability.available) {
      throw new Error(availability.unavailable_reason || `Tool ${toolId} is not available`);
    }

    if (!this.isAvailable()) {
      throw new Error("TmuxManager is not available");
    }

    const resolvedCwd = cwd || this.defaultCwd!;

    // ツール固有の前処理
    let warning: string | undefined;
    let command = tool.command;
    if (toolId === "copilot") {
      const result = await this.prepareCopilotLaunch(resolvedCwd);
      warning = result.warning;
      command = result.command;
    } else if (toolId === "codex") {
      const result = this.prepareCodexLaunch(codexOptions);
      warning = result.warning;
      command = result.command;
    }

    // ウィンドウが存在する場合、ペイン数上限チェック
    const exists = await this.windowExists(tool.windowIndex);
    if (exists) {
      const count = await this.getPaneCount(tool.windowIndex);
      if (count >= MAX_PANES_PER_WINDOW) {
        throw new Error(`Pane limit reached: ${count}/${MAX_PANES_PER_WINDOW}`);
      }
    }

    const paneId = await this.createPaneAndRun(tool.windowIndex, command, resolvedCwd, exists);
    return { ok: true, tmux_pane: paneId, warning };
  }

  // Copilot 起動時の前処理: hooks.json 配置 + MCP 設定 + コマンド構築
  private async prepareCopilotLaunch(cwd: string): Promise<{ command: string; warning?: string }> {
    const hooksDir = path.resolve(__dirname_local, "../hooks");
    const warnings: string[] = [];

    // hooks.json 配置
    const hooksWarning = await this.deployCopilotHooks(cwd, hooksDir);
    if (hooksWarning) warnings.push(hooksWarning);

    // MCP 設定ファイルを生成して --additional-mcp-config に渡す
    const mcpConfigPath = await this.createMcpConfigFile(cwd);
    let command = "copilot";
    if (mcpConfigPath) {
      command = `copilot --additional-mcp-config ${shellQuote(`@${mcpConfigPath}`)}`;
    } else {
      warnings.push("MCP設定ファイルの生成に失敗しました");
    }

    return {
      command,
      warning: warnings.length > 0 ? warnings.join("; ") : undefined,
    };
  }

  // Codex 起動コマンド生成（new/resume/fork + notify 注入）
  private prepareCodexLaunch(options?: { mode?: CodexLaunchMode; target?: string; all?: boolean }): { command: string; warning?: string } {
    const mode = options?.mode || "new";
    const target = options?.target;
    const all = options?.all;

    // notify スクリプトのパス
    const hooksDir = path.resolve(__dirname_local, "../hooks");
    const notifyScript = path.join(hooksDir, "codex-notify.sh");

    // notify 設定: TOML 配列をシェル引数で渡す
    // シェルのシングルクォートで全体を保護し、TOML 文字列はダブルクォートで囲む
    const escapedPath = notifyScript.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const notifyConfig = `-c 'notify=["${escapedPath}"]'`;

    // --no-alt-screen: tmux でのキャプチャ対応
    const baseFlags = "--no-alt-screen";

    let command: string;
    switch (mode) {
      case "resume": {
        if (target) {
          command = `codex ${baseFlags} ${notifyConfig} resume ${shellQuote(target)}`;
        } else {
          command = `codex ${baseFlags} ${notifyConfig} resume --last`;
        }
        if (all) {
          command += " --all";
        }
        break;
      }
      case "fork": {
        if (target) {
          command = `codex ${baseFlags} ${notifyConfig} fork ${shellQuote(target)}`;
        } else {
          command = `codex ${baseFlags} ${notifyConfig} fork --last`;
        }
        if (all) {
          command += " --all";
        }
        break;
      }
      default: {
        // new モード: 通常起動
        command = `codex ${baseFlags} ${notifyConfig}`;
        break;
      }
    }

    return { command };
  }

  // Copilot 用 hooks.json を .github/hooks/ に配置
  private async deployCopilotHooks(cwd: string, hooksDir: string): Promise<string | undefined> {
    const targetDir = path.join(cwd, ".github", "hooks");
    const targetFile = path.join(targetDir, "claude-monitor.json");

    try {
      // テンプレートを読み込み、__HOOKS_DIR__ を絶対パスに展開
      const templatePath = path.join(hooksDir, "copilot-hooks.json");
      const templateContent = await fsReadFile(templatePath, "utf-8");
      const resolvedContent = resolveHooksTemplate(templateContent, hooksDir);

      // .github/hooks/ ディレクトリが存在しない場合は作成
      await fsMkdir(targetDir, { recursive: true });

      // 既存ファイルのチェック
      let existingContent: string | null = null;
      try {
        existingContent = await fsReadFile(targetFile, "utf-8");
      } catch {
        // ファイルが存在しない場合は問題なし
      }

      if (existingContent !== null) {
        // 既存ファイルと内容が同じなら何もしない（冪等性）
        if (existingContent === resolvedContent) {
          return undefined;
        }

        // _source チェック: 既存が claude-monitor 由来なら上書き
        try {
          const existing = JSON.parse(existingContent);
          const isCmGenerated = this.isClaudeMonitorGenerated(existing);
          if (isCmGenerated) {
            // claude-monitor が生成したファイルなので上書き
            await fsWriteFile(targetFile, resolvedContent, "utf-8");
            return undefined;
          }
        } catch {
          // JSON パースエラー
        }

        // ユーザー定義ファイルが存在する場合
        if (process.env.CLAUDE_MONITOR_FORCE_HOOKS === "1") {
          // opt-in 上書き: バックアップして新規生成
          const backupFile = targetFile + ".bak";
          await fsCopyFile(targetFile, backupFile);
          await fsWriteFile(targetFile, resolvedContent, "utf-8");
          return `既存 ${targetFile} をバックアップ（${backupFile}）して上書きしました`;
        }

        // デフォルト: スキップ + 手動マージ案内
        return `既存 ${targetFile} を検知しました。claude-monitor のフックを有効にするには手動で hooks を追加するか、CLAUDE_MONITOR_FORCE_HOOKS=1 で再起動してください`;
      }

      // 新規配置
      await fsWriteFile(targetFile, resolvedContent, "utf-8");
      return undefined;
    } catch (e) {
      const msg = (e as Error).message;
      console.warn("Copilot hooks deployment failed:", msg);
      return `hooks.json 配置に失敗しました: ${msg}`;
    }
  }

  // hooks.json が claude-monitor が生成したものか判定
  // 全エントリが _source: "claude-monitor" の場合のみ true（混在ファイルは false）
  private isClaudeMonitorGenerated(json: unknown): boolean {
    if (!json || typeof json !== "object") return false;
    const hooks = (json as Record<string, unknown>).hooks;
    if (!hooks || typeof hooks !== "object") return false;

    let found = false;
    for (const entries of Object.values(hooks as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const source = (entry as Record<string, unknown>)._source;
        if (source !== "claude-monitor") return false; // 混在は自動管理扱いしない
        found = true;
      }
    }
    return found;
  }

  // MCP 設定ファイルを生成
  private async createMcpConfigFile(cwd: string): Promise<string | null> {
    try {
      const configDir = path.join(cwd, ".vscode");
      await fsMkdir(configDir, { recursive: true });
      const configPath = path.join(configDir, "claude-monitor-mcp.json");
      const config = {
        mcpServers: {
          "claude-monitor": {
            type: "http",
            url: "http://localhost:3456/mcp",
          },
        },
      };
      await fsWriteFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      return configPath;
    } catch (e) {
      console.warn("MCP config file creation failed:", (e as Error).message);
      return null;
    }
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
    const format = "#{pane_id}";
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
