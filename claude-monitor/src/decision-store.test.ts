import { describe, it, expect, vi } from "vitest";
import { DecisionStore } from "./decision-store.js";
import type { DecisionRequest } from "./types.js";

function makeRequest(overrides?: Partial<DecisionRequest>): DecisionRequest {
  return {
    correlation_id: "d1",
    session_id: "s1",
    decision_type: "permission",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createStore(handlers?: Partial<{
  onDecisionPending: (d: unknown) => void;
  onDecisionResolved: (d: unknown) => void;
  onDecisionTimeout: (d: unknown) => void;
}>) {
  return new DecisionStore({
    onDecisionPending: handlers?.onDecisionPending ?? vi.fn(),
    onDecisionResolved: handlers?.onDecisionResolved ?? vi.fn(),
    onDecisionTimeout: handlers?.onDecisionTimeout ?? vi.fn(),
  });
}

describe("DecisionStore.respond", () => {
  it("pending → resolved(allow) で onDecisionResolved が呼ばれる", () => {
    const onResolved = vi.fn();
    const store = createStore({ onDecisionResolved: onResolved });
    store.register(makeRequest());

    const decision = store.respond("d1", "allow");
    expect(decision).toBeDefined();
    expect(decision!.status).toBe("resolved");
    expect(decision!.result).toBe("allow");
    expect(onResolved).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("pending → resolved(deny) で onDecisionResolved が呼ばれる", () => {
    const onResolved = vi.fn();
    const store = createStore({ onDecisionResolved: onResolved });
    store.register(makeRequest());

    const decision = store.respond("d1", "deny");
    expect(decision).toBeDefined();
    expect(decision!.status).toBe("resolved");
    expect(decision!.result).toBe("deny");
    expect(onResolved).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("存在しない id は undefined を返す", () => {
    const store = createStore();
    const result = store.respond("unknown", "allow");
    expect(result).toBeUndefined();
    store.destroy();
  });

  it("既に resolved の decision は undefined を返す", () => {
    const store = createStore();
    store.register(makeRequest());
    store.respond("d1", "allow");
    const result = store.respond("d1", "deny");
    expect(result).toBeUndefined();
    store.destroy();
  });
});

describe("DecisionStore.denyBySession", () => {
  it("セッションの pending decisions を全て deny 確定し onDecisionResolved が呼ばれる", () => {
    const onResolved = vi.fn();
    const store = createStore({ onDecisionResolved: onResolved });
    store.register(makeRequest({ correlation_id: "d1", session_id: "s1" }));
    store.register(makeRequest({ correlation_id: "d2", session_id: "s1" }));
    store.register(makeRequest({ correlation_id: "d3", session_id: "s2" }));

    const denied = store.denyBySession("s1");
    expect(denied).toHaveLength(2);
    expect(denied[0].status).toBe("resolved");
    expect(denied[0].result).toBe("deny");
    expect(denied[1].status).toBe("resolved");
    expect(denied[1].result).toBe("deny");
    // onDecisionResolved が各 decision に対して呼ばれる
    expect(onResolved).toHaveBeenCalledTimes(2);

    // s2 の decision は影響を受けない
    const s2Decision = store.get("d3");
    expect(s2Decision!.status).toBe("pending");
    store.destroy();
  });

  it("long-poll waiter が resolve される", async () => {
    const store = createStore();
    store.register(makeRequest());

    const waitPromise = store.waitForDecision("d1");
    store.denyBySession("s1");

    const result = await waitPromise;
    expect(result.resolved).toBe(true);
    expect(result.decision).toBe("deny");
    store.destroy();
  });
});

describe("DecisionStore.cancelBySession", () => {
  it("セッションの pending decisions を timeout にする", () => {
    const store = createStore();
    store.register(makeRequest({ correlation_id: "d1" }));

    const cancelled = store.cancelBySession("s1");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].status).toBe("timeout");
    store.destroy();
  });
});
