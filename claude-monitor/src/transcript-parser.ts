import fs from "fs";
import os from "os";
import path from "path";

const ALLOWED_TRANSCRIPT_DIR = path.join(os.homedir(), '.claude');

export async function validateTranscriptPath(inputPath: string): Promise<string | null> {
  if (!inputPath.endsWith('.jsonl')) {
    console.warn(`[progress] Invalid transcript extension: ${inputPath}`);
    return null;
  }
  try {
    const resolved = await fs.promises.realpath(inputPath);
    if (!resolved.startsWith(ALLOWED_TRANSCRIPT_DIR + path.sep) && resolved !== ALLOWED_TRANSCRIPT_DIR) {
      console.warn(`[progress] Path outside allowed directory: ${resolved}`);
      return null;
    }
    return resolved;
  } catch {
    console.warn(`[progress] Path resolution failed: ${inputPath}`);
    return null;
  }
}

// maxBytes: 末尾から読み取る最大バイト数。トランスクリプトの1行は通常数KB以下のため、
// 32KBあれば直近の数十行をカバーできる。
export async function readTranscriptTail(filePath: string, maxBytes = 32768): Promise<string> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const stat = await fh.stat();
      const start = Math.max(0, stat.size - maxBytes);
      const buf = Buffer.alloc(stat.size - start);
      await fh.read(buf, 0, buf.length, start);

      let tail = buf.toString('utf8');
      // 途中から読み取った場合、先頭行は不完全な可能性があるため破棄
      if (start > 0) {
        const firstNewline = tail.indexOf('\n');
        if (firstNewline !== -1) {
          tail = tail.substring(firstNewline + 1);
        }
      }
      const lines = tail.split('\n').filter(Boolean);

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            const textBlocks = entry.message.content.filter(
              (c: { type: string }) => c.type === 'text'
            );
            return textBlocks.length > 0
              ? textBlocks
                  .map((c: { text: string }) => c.text)
                  .join('\n')
                  .substring(0, 500)
              : '';
          }
        } catch { continue; }
      }
    } finally {
      await fh.close();
    }
  } catch { /* ファイル読み込み失敗時は空文字 */ }
  return '';
}

export async function extractLatestProgress(transcriptPath: string, maxBytes = 32768): Promise<string> {
  const validPath = await validateTranscriptPath(transcriptPath);
  if (!validPath) return '';
  return readTranscriptTail(validPath, maxBytes);
}
