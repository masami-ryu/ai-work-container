import type { GroupStore } from "./group-store.js";
import type { WSMessage } from "./types.js";

export interface GroupAssignmentDeps {
  groupStore: GroupStore;
  pendingGroupAssignments: Map<string, { groupId: string; createdAt: number }>;
  broadcast: (msg: WSMessage) => void;
}

/**
 * pendingGroupAssignments からグループ割り当てを実行・消費する。
 * /api/events と Launch API の双方から呼び出される共通ロジック。
 */
export async function assignPendingGroupToSession(
  sessionId: string,
  tmuxPane: string,
  deps: GroupAssignmentDeps,
): Promise<void> {
  const { groupStore, pendingGroupAssignments, broadcast } = deps;
  if (!pendingGroupAssignments.has(tmuxPane)) return;

  const entry = pendingGroupAssignments.get(tmuxPane)!;
  try {
    const result = await groupStore.addSession(entry.groupId, sessionId);
    pendingGroupAssignments.delete(tmuxPane);
    if (!result) {
      console.warn("Auto group assignment skipped: group not found", entry.groupId);
      broadcast({
        type: "notification",
        payload: {
          session_id: sessionId,
          message: "グループ自動割り当てに失敗しました（グループ未存在）",
          notification_type: "group_auto_assign_failed",
        },
      });
    }
  } catch (e) {
    pendingGroupAssignments.delete(tmuxPane);
    console.error("Auto group assignment failed (pending deleted):", e);
    broadcast({
      type: "notification",
      payload: {
        session_id: sessionId,
        message: "グループ自動割り当てに失敗しました（保存エラー）",
        notification_type: "group_auto_assign_failed",
      },
    });
  }
}
