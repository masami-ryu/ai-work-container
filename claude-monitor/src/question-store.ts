import type { PendingQuestion, QuestionInput } from "./types.js";

const CLEANUP_RETENTION_MS = 150 * 1000; // 回答済み・タイムアウト済み質問の保持期間
const CLEANUP_INTERVAL_MS = 30 * 1000;

interface PendingWaiter {
  resolve: (value: { resolved: boolean; answers?: Record<string, string> }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class QuestionStore {
  private questions = new Map<string, PendingQuestion>();
  private waiters = new Map<string, PendingWaiter>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private onQuestionPending: (q: PendingQuestion) => void;
  private onQuestionAnswered: (q: PendingQuestion) => void;
  private onQuestionTimeout: (q: PendingQuestion) => void;

  constructor(handlers: {
    onQuestionPending: (q: PendingQuestion) => void;
    onQuestionAnswered: (q: PendingQuestion) => void;
    onQuestionTimeout: (q: PendingQuestion) => void;
  }) {
    this.onQuestionPending = handlers.onQuestionPending;
    this.onQuestionAnswered = handlers.onQuestionAnswered;
    this.onQuestionTimeout = handlers.onQuestionTimeout;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  register(sessionId: string, questions: QuestionInput[]): PendingQuestion {
    // 同一セッションの既存 pending をキャンセル（1セッション1質問制約）
    this.cancelBySession(sessionId);

    const pq: PendingQuestion = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      questions,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    this.questions.set(pq.id, pq);
    this.onQuestionPending(pq);
    return pq;
  }

  respond(id: string, answers: Record<string, string>): PendingQuestion | undefined {
    const pq = this.questions.get(id);
    if (!pq || pq.status !== "pending") return undefined;

    pq.status = "answered";
    pq.answers = answers;
    pq.answered_at = new Date().toISOString();

    // long-poll waiter に通知
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve({ resolved: true, answers });
      this.waiters.delete(id);
    }

    this.onQuestionAnswered(pq);
    return pq;
  }

  waitForAnswer(id: string, timeoutMs: number = 120000): Promise<{ resolved: boolean; answers?: Record<string, string> }> {
    const pq = this.questions.get(id);

    // 存在しないIDの場合は即座に失敗を返す
    if (!pq) {
      return Promise.resolve({ resolved: false });
    }

    // 既に回答済みなら即座に返す
    if (pq.status === "answered") {
      return Promise.resolve({ resolved: true, answers: pq.answers });
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        const q = this.questions.get(id);
        if (q && q.status === "pending") {
          q.status = "timeout";
          this.onQuestionTimeout(q);
        }
        resolve({ resolved: false });
      }, timeoutMs);

      this.waiters.set(id, { resolve, timer });
    });
  }

  getPending(): PendingQuestion[] {
    return Array.from(this.questions.values()).filter((q) => q.status === "pending");
  }

  cancelBySession(sessionId: string): PendingQuestion[] {
    const cancelled: PendingQuestion[] = [];
    for (const [id, pq] of this.questions) {
      if (pq.session_id === sessionId && pq.status === "pending") {
        pq.status = "timeout";
        // waiter を解放
        const waiter = this.waiters.get(id);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve({ resolved: false });
          this.waiters.delete(id);
        }
        this.onQuestionTimeout(pq);
        cancelled.push(pq);
      }
    }
    return cancelled;
  }

  get(id: string): PendingQuestion | undefined {
    return this.questions.get(id);
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
    for (const [id, pq] of this.questions) {
      if (pq.status !== "pending") {
        const createdAt = new Date(pq.created_at).getTime();
        if (now - createdAt > CLEANUP_RETENTION_MS) {
          this.questions.delete(id);
        }
      }
    }
  }
}
