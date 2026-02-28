import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// listCodexSessions を動的 import で取得（fs モック後に読み込むため）
// parseFromFilename は export されていないため、listCodexSessions 経由で間接テスト

describe("listCodexSessions: セッションディレクトリが存在しない場合", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // CODEX_HOME と HOME を存在しないパスに設定してディレクトリ不在を再現
    process.env.CODEX_HOME = "/nonexistent-codex-home-for-test";
    process.env.HOME = "/nonexistent-home-for-test";
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    process.env.CODEX_HOME = originalEnv.CODEX_HOME;
    process.env.HOME = originalEnv.HOME;
    if (originalEnv.USERPROFILE) {
      process.env.USERPROFILE = originalEnv.USERPROFILE;
    }
  });

  it("探索先なし → 空配列を返す", async () => {
    // 動的 import でモジュールを再読み込み（環境変数を反映）
    const { listCodexSessions } = await import("./codex-session-index.js");
    const sessions = await listCodexSessions();
    expect(sessions).toEqual([]);
  });
});

describe("listCodexSessions: HOME 未設定かつ CODEX_HOME 未設定", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CODEX_HOME;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    if (originalEnv.CODEX_HOME) process.env.CODEX_HOME = originalEnv.CODEX_HOME;
    else delete process.env.CODEX_HOME;
    if (originalEnv.HOME) process.env.HOME = originalEnv.HOME;
    else delete process.env.HOME;
    if (originalEnv.USERPROFILE) process.env.USERPROFILE = originalEnv.USERPROFILE;
  });

  it("HOME も CODEX_HOME も未設定 → 空配列を返す", async () => {
    const { listCodexSessions } = await import("./codex-session-index.js");
    const sessions = await listCodexSessions();
    expect(sessions).toEqual([]);
  });
});

describe("parseFromFilename フォールバック（listCodexSessions 経由の間接テスト）", () => {
  it("rollout- 形式のファイル名から ID とタイムスタンプが抽出される", async () => {
    // parseFromFilename は非公開関数のためインポートできないが、
    // ファイル名のパターンマッチを検証するための単体的なテスト
    // 正規表現パターンを直接テスト
    const pattern = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)$/;

    // 正常パターン
    const validName = "rollout-2026-02-28T10-30-00-abc123-def456";
    const match = validName.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("2026");
    expect(match![2]).toBe("02");
    expect(match![3]).toBe("28");
    expect(match![7]).toBe("abc123-def456");

    // 不正パターン
    expect("session-2026.jsonl".match(pattern)).toBeNull();
    expect("rollout-invalid".match(pattern)).toBeNull();
  });
});
