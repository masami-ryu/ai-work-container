import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { validateTranscriptPath, readTranscriptTail, extractLatestProgress } from "./transcript-parser.js";

// テスト用の一時ディレクトリとファイルを管理
let tmpDir: string;

function writeTmpFile(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateTranscriptPath", () => {
  it("不正な拡張子（.txt）で null を返す", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await validateTranscriptPath("/tmp/test.txt");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid transcript extension"));
  });

  it("許可ディレクトリ外のパスで null を返す", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = writeTmpFile("test.jsonl", "{}");
    const result = await validateTranscriptPath(filePath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Path outside allowed directory"));
  });

  it("存在しないファイルパスで null を返す", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await validateTranscriptPath("/nonexistent/path/file.jsonl");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Path resolution failed"));
  });

  it("~/.claude 配下の .jsonl ファイルで有効パスを返す", async () => {
    const claudeDir = path.join(os.homedir(), ".claude");
    // .claude ディレクトリが存在しない場合はスキップ
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const testFile = path.join(claudeDir, `test-validate-${Date.now()}.jsonl`);
    fs.writeFileSync(testFile, "{}\n", "utf8");
    try {
      const result = await validateTranscriptPath(testFile);
      expect(result).toBe(testFile);
    } finally {
      fs.unlinkSync(testFile);
    }
  });
});

describe("readTranscriptTail", () => {
  it("正常な JSONL から最新の assistant テキストを抽出する", async () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "最初のメッセージ" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ファイルを確認します。" }] } }),
    ].join("\n");
    const filePath = writeTmpFile("test.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("ファイルを確認します。");
  });

  it("壊れた JSON 行が混在する JSONL でも正常行からテキストを抽出する", async () => {
    const jsonl = [
      "broken json line {{{",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "正常な行です" }] } }),
      "another broken line",
    ].join("\n");
    const filePath = writeTmpFile("broken.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("正常な行です");
  });

  it("thinking ブロックを含む JSONL で text ブロックのみ抽出する", async () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "内部思考" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "表示用テキスト" }] } }),
    ].join("\n");
    const filePath = writeTmpFile("thinking.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("表示用テキスト");
  });

  it("最新の assistant エントリが thinking のみの場合は空文字を返す（過去ターンに遡らない）", async () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "前のテキスト" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "思考のみ" }] } }),
    ].join("\n");
    const filePath = writeTmpFile("thinking-only.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("");
  });

  it("複数の text ブロックが改行で結合される", async () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "text", text: "1行目" },
        { type: "text", text: "2行目" },
      ] } }),
    ].join("\n");
    const filePath = writeTmpFile("multi-text.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("1行目\n2行目");
  });

  it("500文字を超えるテキストは切り詰められる", async () => {
    const longText = "あ".repeat(600);
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: longText }] } }),
    ].join("\n");
    const filePath = writeTmpFile("long.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result.length).toBe(500);
  });

  it("assistant 以外の type はスキップされる", async () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "最初" }] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "ユーザー入力" }] } }),
    ].join("\n");
    const filePath = writeTmpFile("user-msg.jsonl", jsonl);

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("最初");
  });

  it("空ファイルで空文字を返す", async () => {
    const filePath = writeTmpFile("empty.jsonl", "");

    const result = await readTranscriptTail(filePath);
    expect(result).toBe("");
  });

  it("存在しないファイルパスで空文字を返す", async () => {
    const result = await readTranscriptTail("/nonexistent/path/file.jsonl");
    expect(result).toBe("");
  });
});

describe("extractLatestProgress", () => {
  it("パス検証に失敗する場合は空文字を返す", async () => {
    const result = await extractLatestProgress("/nonexistent/path/file.jsonl");
    expect(result).toBe("");
  });
});
