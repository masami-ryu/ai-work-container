import { describe, it, expect, vi, afterEach } from "vitest";
import { QuestionStore } from "./question-store.js";
import type { PendingQuestion } from "./types.js";

function createStore(overrides?: Partial<{
  onQuestionPending: (q: PendingQuestion) => void;
  onQuestionAnswered: (q: PendingQuestion) => void;
  onQuestionTimeout: (q: PendingQuestion) => void;
}>) {
  return new QuestionStore({
    onQuestionPending: overrides?.onQuestionPending ?? vi.fn(),
    onQuestionAnswered: overrides?.onQuestionAnswered ?? vi.fn(),
    onQuestionTimeout: overrides?.onQuestionTimeout ?? vi.fn(),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QuestionStore", () => {
  it("register で PendingQuestion が作成される", () => {
    const store = createStore();
    const pq = store.register("s1", [{ question: "Q?" }]);

    expect(pq.status).toBe("pending");
    expect(pq.session_id).toBe("s1");
    expect(pq.questions).toHaveLength(1);
    expect(pq.questions[0].question).toBe("Q?");
    expect(pq.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pq.created_at).toBeTruthy();

    store.destroy();
  });

  it("respond で回答が記録される", () => {
    const store = createStore();
    const pq = store.register("s1", [{ question: "Q1?" }, { question: "Q2?" }]);

    const updated = store.respond(pq.id, { "0": "A1", "1": "A2" });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("answered");
    expect(updated!.answers).toEqual({ "0": "A1", "1": "A2" });
    expect(updated!.answered_at).toBeTruthy();

    store.destroy();
  });

  it("waitForAnswer が回答で resolve される", async () => {
    const store = createStore();
    const pq = store.register("s1", [{ question: "Q?" }]);

    const waitPromise = store.waitForAnswer(pq.id);
    store.respond(pq.id, { "0": "answer" });

    const result = await waitPromise;
    expect(result.resolved).toBe(true);
    expect(result.answers).toEqual({ "0": "answer" });

    store.destroy();
  });

  it("waitForAnswer がタイムアウトで resolve される", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const store = createStore({ onQuestionTimeout: onTimeout });
    const pq = store.register("s1", [{ question: "Q?" }]);

    const waitPromise = store.waitForAnswer(pq.id, 120000);

    vi.advanceTimersByTime(120000);

    const result = await waitPromise;
    expect(result.resolved).toBe(false);
    expect(result.answers).toBeUndefined();
    expect(store.get(pq.id)!.status).toBe("timeout");
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ id: pq.id, status: "timeout" }));

    store.destroy();
  });

  it("既に回答済みの waitForAnswer は即座に返る", async () => {
    const store = createStore();
    const pq = store.register("s1", [{ question: "Q?" }]);
    store.respond(pq.id, { "0": "answer" });

    const result = await store.waitForAnswer(pq.id);
    expect(result.resolved).toBe(true);
    expect(result.answers).toEqual({ "0": "answer" });

    store.destroy();
  });

  it("cancelBySession で pending がキャンセルされる", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const store = createStore({ onQuestionTimeout: onTimeout });
    const pq = store.register("s1", [{ question: "Q?" }]);

    const waitPromise = store.waitForAnswer(pq.id);
    const cancelled = store.cancelBySession("s1");

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].status).toBe("timeout");
    expect(onTimeout).toHaveBeenCalledTimes(1);

    const result = await waitPromise;
    expect(result.resolved).toBe(false);

    store.destroy();
  });

  it("register 時に同一セッションの既存 pending がキャンセルされる", () => {
    const onTimeout = vi.fn();
    const store = createStore({ onQuestionTimeout: onTimeout });

    const pq1 = store.register("s1", [{ question: "Q1?" }]);
    expect(store.getPending()).toHaveLength(1);

    const pq2 = store.register("s1", [{ question: "Q2?" }]);
    expect(store.getPending()).toHaveLength(1);
    expect(store.getPending()[0].id).toBe(pq2.id);
    expect(store.get(pq1.id)!.status).toBe("timeout");
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ id: pq1.id }));

    store.destroy();
  });

  it("getPending が pending のみ返す", () => {
    const store = createStore();

    const pq1 = store.register("s1", [{ question: "Q1?" }]);
    const pq2 = store.register("s2", [{ question: "Q2?" }]);
    store.respond(pq1.id, { "0": "A1" });

    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(pq2.id);

    store.destroy();
  });

  it("コールバック（onQuestionPending/Answered/Timeout）が呼ばれる", async () => {
    vi.useFakeTimers();
    const onPending = vi.fn();
    const onAnswered = vi.fn();
    const onTimeout = vi.fn();
    const store = createStore({
      onQuestionPending: onPending,
      onQuestionAnswered: onAnswered,
      onQuestionTimeout: onTimeout,
    });

    // register → onQuestionPending
    const pq1 = store.register("s1", [{ question: "Q1?" }]);
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ id: pq1.id }));

    // respond → onQuestionAnswered
    store.respond(pq1.id, { "0": "A1" });
    expect(onAnswered).toHaveBeenCalledWith(expect.objectContaining({ id: pq1.id, status: "answered" }));

    // timeout → onQuestionTimeout
    const pq2 = store.register("s2", [{ question: "Q2?" }]);
    store.waitForAnswer(pq2.id, 120000);
    vi.advanceTimersByTime(120000);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ id: pq2.id, status: "timeout" }));

    store.destroy();
  });

  it("destroy でタイマーがクリーンアップされる", () => {
    const store = createStore();
    store.register("s1", [{ question: "Q?" }]);

    // destroy が例外なく完了する
    expect(() => store.destroy()).not.toThrow();
  });
});
