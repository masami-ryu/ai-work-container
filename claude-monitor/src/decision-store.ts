import type { Decision, DecisionRequest } from "./types.js";

const DECISION_TIMEOUT_MS = 300 * 1000; // 300秒
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30秒ごとにクリーンアップ

interface PendingWaiter {
  resolve: (value: { resolved: boolean; decision?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DecisionStore {
  private decisions = new Map<string, Decision>();
  private waiters = new Map<string, PendingWaiter>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private onDecisionPending: (decision: Decision) => void;
  private onDecisionResolved: (decision: Decision) => void;
  private onDecisionTimeout: (decision: Decision) => void;

  constructor(handlers: {
    onDecisionPending: (decision: Decision) => void;
    onDecisionResolved: (decision: Decision) => void;
    onDecisionTimeout: (decision: Decision) => void;
  }) {
    this.onDecisionPending = handlers.onDecisionPending;
    this.onDecisionResolved = handlers.onDecisionResolved;
    this.onDecisionTimeout = handlers.onDecisionTimeout;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  register(req: DecisionRequest): Decision {
    const decision: Decision = {
      id: req.correlation_id,
      session_id: req.session_id,
      decision_type: req.decision_type,
      tool_name: req.tool_name,
      tool_input: req.tool_input,
      status: "pending",
      created_at: req.timestamp || new Date().toISOString(),
    };
    this.decisions.set(decision.id, decision);
    this.onDecisionPending(decision);
    return decision;
  }

  respond(id: string, result: "allow" | "deny"): Decision | undefined {
    const decision = this.decisions.get(id);
    if (!decision || decision.status !== "pending") return undefined;

    decision.status = "resolved";
    decision.result = result;
    decision.resolved_at = new Date().toISOString();

    // long-poll waiter に通知
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve({ resolved: true, decision: result });
      this.waiters.delete(id);
    }

    this.onDecisionResolved(decision);
    return decision;
  }

  waitForDecision(id: string, timeoutMs: number = 280000): Promise<{ resolved: boolean; decision?: string }> {
    const decision = this.decisions.get(id);

    // 既に解決済みの場合は即座に返す
    if (decision && decision.status === "resolved") {
      return Promise.resolve({ resolved: true, decision: decision.result });
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        const d = this.decisions.get(id);
        if (d && d.status === "pending") {
          d.status = "timeout";
          this.onDecisionTimeout(d);
        }
        resolve({ resolved: false });
      }, timeoutMs);

      this.waiters.set(id, { resolve, timer });
    });
  }

  getPending(): Decision[] {
    return Array.from(this.decisions.values()).filter((d) => d.status === "pending");
  }

  cancelBySession(sessionId: string): Decision[] {
    const cancelled: Decision[] = [];
    for (const [id, decision] of this.decisions) {
      if (decision.session_id === sessionId && decision.status === "pending") {
        decision.status = "timeout";
        decision.resolved_at = new Date().toISOString();
        // waiter を解放
        const waiter = this.waiters.get(id);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve({ resolved: false });
          this.waiters.delete(id);
        }
        cancelled.push(decision);
      }
    }
    return cancelled;
  }

  denyBySession(sessionId: string): Decision[] {
    const denied: Decision[] = [];
    for (const [id, decision] of this.decisions) {
      if (decision.session_id === sessionId && decision.status === "pending") {
        decision.status = "resolved";
        decision.result = "deny";
        decision.resolved_at = new Date().toISOString();
        const waiter = this.waiters.get(id);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve({ resolved: true, decision: "deny" });
          this.waiters.delete(id);
        }
        this.onDecisionResolved(decision);
        denied.push(decision);
      }
    }
    return denied;
  }

  get(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
    }
    this.waiters.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, decision] of this.decisions) {
      if (decision.status !== "pending") {
        const createdAt = new Date(decision.created_at).getTime();
        if (now - createdAt > DECISION_TIMEOUT_MS) {
          this.decisions.delete(id);
        }
      }
    }
  }
}
