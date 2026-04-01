import fs from "fs";
import path from "path";
import { promisify } from "util";
import readline from "readline";

const fsReaddir = promisify(fs.readdir);
const fsStat = promisify(fs.stat);

// Codex セッションの最小メタ情報
export interface CodexSessionMeta {
  id: string;       // セッションID（UUID）
  cwd: string;      // 作業ディレクトリ
  timestamp: string; // ISO 8601 作成日時
  file_path: string; // JSONL ファイルパス
}

// 走査上限
const MAX_SESSIONS = 50;
const MAX_AGE_DAYS = 7;

// Codex セッション保存先を解決（CODEX_HOME > HOME/.codex）
function resolveCodexSessionsDir(): string | null {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    const dir = path.join(codexHome, "sessions");
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      return dir;
    } catch {
      // CODEX_HOME 設定されているがアクセス不可
    }
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) return null;

  const dir = path.join(homeDir, ".codex", "sessions");
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    return dir;
  } catch {
    return null;
  }
}

// JSONL ファイルの先頭行から session_meta を抽出
async function parseSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let resolved = false;

    rl.on("line", (line) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();

      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "session_meta" && parsed.payload) {
          const { id, cwd, timestamp } = parsed.payload;
          resolve({
            id: id || "",
            cwd: cwd || "",
            timestamp: timestamp || parsed.timestamp || "",
            file_path: filePath,
          });
          return;
        }
      } catch {
        // JSON パースエラー → ファイル名フォールバック
      }
      resolve(null);
    });

    rl.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    rl.on("error", () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

// ファイル名からフォールバックでメタ情報を抽出
// 例: rollout-2026-02-28T10-30-00-abc123-def456.jsonl
function parseFromFilename(filePath: string): CodexSessionMeta | null {
  const basename = path.basename(filePath, ".jsonl");
  const match = basename.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, uuid] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  return {
    id: uuid,
    cwd: "",
    timestamp,
    file_path: filePath,
  };
}

// ~/.codex/sessions を再帰走査して JSONL ファイルを収集（直近7日、最大50件）
async function collectJsonlFiles(sessionsDir: string): Promise<string[]> {
  const cutoffTime = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const files: Array<{ path: string; mtime: number }> = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsReaddir(dir, { withFileTypes: true }) as fs.Dirent[];
    } catch {
      return; // 読み取り不可ディレクトリはスキップ
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = await fsStat(fullPath);
          if (stat.mtimeMs >= cutoffTime) {
            files.push({ path: fullPath, mtime: stat.mtimeMs });
          }
        } catch {
          // stat 失敗はスキップ
        }
      }
    }
  }

  await walk(sessionsDir);

  // 最新順にソートし、上限を適用
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, MAX_SESSIONS).map(f => f.path);
}

// メインエントリポイント: Codex セッション一覧を取得
// non-fatal: 探索先なし・権限なし・対象0件 → 空配列を返す
// fatal: I/O例外・内部例外 → 例外を上位に伝播
export async function listCodexSessions(): Promise<CodexSessionMeta[]> {
  const sessionsDir = resolveCodexSessionsDir();
  if (!sessionsDir) {
    // non-fatal: 探索先なし
    return [];
  }

  const jsonlFiles = await collectJsonlFiles(sessionsDir);
  if (jsonlFiles.length === 0) {
    return [];
  }

  const results: CodexSessionMeta[] = [];
  for (const filePath of jsonlFiles) {
    let meta = await parseSessionMeta(filePath);
    if (!meta) {
      // JSONL 先頭行パース失敗 → ファイル名フォールバック
      meta = parseFromFilename(filePath);
    }
    if (meta) {
      results.push(meta);
    }
  }

  // 最新順でソート
  results.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return tb - ta;
  });

  return results;
}
