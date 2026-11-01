import { describe, it, expect } from "vitest";
import { cleanupPendingAssignments, type PendingAssignment } from "./pending-group-assignments.js";

describe("cleanupPendingAssignments", () => {
  it("active pane に存在しないエントリを削除する", () => {
    const assignments = new Map<string, PendingAssignment>([
      ["%1", { groupId: "g1", createdAt: Date.now() }],
      ["%2", { groupId: "g2", createdAt: Date.now() }],
    ]);
    const activePanes = new Set(["%1"]); // %2 は存在しない

    cleanupPendingAssignments(assignments, activePanes);

    expect(assignments.has("%1")).toBe(true);
    expect(assignments.has("%2")).toBe(false);
  });

  it("TTL超過（5分）のエントリを削除する", () => {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000 - 1; // TTL超過

    const assignments = new Map<string, PendingAssignment>([
      ["%1", { groupId: "g1", createdAt: fiveMinAgo }],
      ["%2", { groupId: "g2", createdAt: now }], // 新しい
    ]);
    const activePanes = new Set(["%1", "%2"]);

    cleanupPendingAssignments(assignments, activePanes, now);

    expect(assignments.has("%1")).toBe(false);
    expect(assignments.has("%2")).toBe(true);
  });

  it("TTLちょうど5分のエントリは削除しない", () => {
    const now = Date.now();
    const exactlyFiveMin = now - 5 * 60 * 1000; // ちょうど5分

    const assignments = new Map<string, PendingAssignment>([
      ["%1", { groupId: "g1", createdAt: exactlyFiveMin }],
    ]);
    const activePanes = new Set(["%1"]);

    cleanupPendingAssignments(assignments, activePanes, now);

    expect(assignments.has("%1")).toBe(true);
  });

  it("active pane 不在はTTLより優先して即時削除する", () => {
    const now = Date.now();

    const assignments = new Map<string, PendingAssignment>([
      ["%1", { groupId: "g1", createdAt: now }], // TTL内だが pane 不在
    ]);
    const activePanes = new Set<string>(); // 空

    cleanupPendingAssignments(assignments, activePanes, now);

    expect(assignments.size).toBe(0);
  });

  it("空の Map に対して正常に動作する", () => {
    const assignments = new Map<string, PendingAssignment>();
    const activePanes = new Set(["%1"]);

    cleanupPendingAssignments(assignments, activePanes);

    expect(assignments.size).toBe(0);
  });

  it("複数エントリの混合条件で正しくクリーンアップする", () => {
    const now = Date.now();
    const old = now - 6 * 60 * 1000;

    const assignments = new Map<string, PendingAssignment>([
      ["%1", { groupId: "g1", createdAt: now }],   // active + 新しい → 残る
      ["%2", { groupId: "g2", createdAt: old }],   // active + TTL超過 → 削除
      ["%3", { groupId: "g3", createdAt: now }],   // 不在 → 削除
      ["%4", { groupId: "g4", createdAt: old }],   // 不在 + TTL超過 → 削除
    ]);
    const activePanes = new Set(["%1", "%2"]);

    cleanupPendingAssignments(assignments, activePanes, now);

    expect(assignments.size).toBe(1);
    expect(assignments.has("%1")).toBe(true);
  });
});
