import { describe, it, expect, vi, beforeEach } from "vitest";
import { assignPendingGroupToSession, type GroupAssignmentDeps } from "./group-assignment.js";
import type { GroupStore } from "./group-store.js";
import type { WSMessage } from "./types.js";

function createMockDeps(overrides?: Partial<GroupAssignmentDeps>): GroupAssignmentDeps {
  return {
    groupStore: {
      addSession: vi.fn().mockResolvedValue({ id: "g1", name: "Test", session_ids: ["s1"], created_at: "" }),
    } as unknown as GroupStore,
    pendingGroupAssignments: new Map(),
    broadcast: vi.fn(),
    ...overrides,
  };
}

describe("assignPendingGroupToSession", () => {
  it("pending が存在しない場合は何もしない", async () => {
    const deps = createMockDeps();
    await assignPendingGroupToSession("s1", "%5", deps);
    expect(deps.groupStore.addSession).not.toHaveBeenCalled();
    expect(deps.broadcast).not.toHaveBeenCalled();
  });

  it("グループ割り当て成功時に pending を消費する", async () => {
    const deps = createMockDeps();
    deps.pendingGroupAssignments.set("%5", { groupId: "g1", createdAt: Date.now() });

    await assignPendingGroupToSession("s1", "%5", deps);

    expect(deps.groupStore.addSession).toHaveBeenCalledWith("g1", "s1");
    expect(deps.pendingGroupAssignments.has("%5")).toBe(false);
    expect(deps.broadcast).not.toHaveBeenCalled();
  });

  it("グループが存在しない場合に group_auto_assign_failed 通知を broadcast する", async () => {
    const deps = createMockDeps({
      groupStore: {
        addSession: vi.fn().mockResolvedValue(undefined),
      } as unknown as GroupStore,
    });
    deps.pendingGroupAssignments.set("%5", { groupId: "nonexistent", createdAt: Date.now() });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await assignPendingGroupToSession("s1", "%5", deps);

    expect(deps.pendingGroupAssignments.has("%5")).toBe(false);
    expect(deps.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notification",
        payload: expect.objectContaining({
          session_id: "s1",
          notification_type: "group_auto_assign_failed",
        }),
      }),
    );
    warnSpy.mockRestore();
  });

  it("保存エラー時に group_auto_assign_failed 通知を broadcast する", async () => {
    const deps = createMockDeps({
      groupStore: {
        addSession: vi.fn().mockRejectedValue(new Error("disk full")),
      } as unknown as GroupStore,
    });
    deps.pendingGroupAssignments.set("%5", { groupId: "g1", createdAt: Date.now() });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await assignPendingGroupToSession("s1", "%5", deps);

    expect(deps.pendingGroupAssignments.has("%5")).toBe(false);
    expect(deps.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notification",
        payload: expect.objectContaining({
          session_id: "s1",
          notification_type: "group_auto_assign_failed",
          message: expect.stringContaining("保存エラー"),
        }),
      }),
    );
    errorSpy.mockRestore();
  });
});
