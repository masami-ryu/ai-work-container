// --- Pending Group Assignments ---
// tmux_pane → { groupId, createdAt } : launch時にgroup_idが指定された場合、SessionStartイベントでグループに自動追加する

export interface PendingAssignment {
  groupId: string;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5分

/**
 * pending group assignments のクリーンアップ。
 * - active pane に存在しないエントリは即時削除（pane 再利用による誤割り当て防止）
 * - TTL超過のエントリはフォールバック削除（hookイベント未到着対策）
 */
export function cleanupPendingAssignments(
  assignments: Map<string, PendingAssignment>,
  activePanes: Set<string>,
  now: number = Date.now(),
): void {
  for (const [pane, entry] of assignments) {
    // 優先条件: active pane に存在しなければ即時削除
    if (!activePanes.has(pane)) {
      assignments.delete(pane);
      continue;
    }
    // 補助条件: TTLで残存エントリを削除
    if (now - entry.createdAt > TTL_MS) {
      assignments.delete(pane);
    }
  }
}
