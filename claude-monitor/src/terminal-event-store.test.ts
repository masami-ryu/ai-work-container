import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fc from "fast-check";
import { TerminalEventStore, parseCaptureConfig, DEFAULT_MAX_EVENTS_PER_SESSION, DEFAULT_EVENT_TTL_MINUTES, DEFAULT_MAX_EVENTS_GLOBAL, DEFAULT_MAX_EVENT_CHARS, DEFAULT_TOMBSTONE_TTL_MINUTES, DEFAULT_TRIGGER_MAX_RETRIES } from "./terminal-event-store.js";
import type { CaptureConfig, TerminalEvent } from "./types.js";

function makeConfig(overrides: Partial<CaptureConfig> = {}): CaptureConfig {
  return {
    enableCodex: false,
    enableCopilot: false,
    enableClaude: false,
    maxEventsPerSession: DEFAULT_MAX_EVENTS_PER_SESSION,
    eventTtlMinutes: DEFAULT_EVENT_TTL_MINUTES,
    maxEventsGlobal: DEFAULT_MAX_EVENTS_GLOBAL,
    maxEventChars: DEFAULT_MAX_EVENT_CHARS,
    tombstoneTtlMinutes: DEFAULT_TOMBSTONE_TTL_MINUTES,
    ...overrides,
  };
}

describe("TerminalEventStore", () => {
  let store: TerminalEventStore;

  beforeEach(() => {
    store = new TerminalEventStore(makeConfig());
  });

  describe("addEvent / getEvents", () => {
    it("イベントを追加し取得できる", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "hello world",
        type: "output",
        source: "capture",
      });

      expect(event.session_id).toBe("s1");
      expect(event.run_id).toBe(1);
      expect(event.text).toBe("hello world");
      expect(event.type).toBe("output");
      expect(event.source).toBe("capture");
      expect(event.sequence).toBe(1);
      expect(event.event_state).toBe("pending");
      expect(event.truncated).toBe(false);

      const events = store.getEvents("s1");
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);
    });

    it("seq 番号が単調増加する", () => {
      store.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "output", source: "capture" });
      store.addEvent({ sessionId: "s1", runId: 1, text: "b", type: "output", source: "capture" });
      store.addEvent({ sessionId: "s1", runId: 1, text: "c", type: "output", source: "capture" });

      const events = store.getEvents("s1");
      expect(events.map(e => e.sequence)).toEqual([1, 2, 3]);
    });

    it("セッション間で seq は独立", () => {
      store.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "output", source: "capture" });
      store.addEvent({ sessionId: "s2", runId: 1, text: "b", type: "output", source: "capture" });

      expect(store.getLatestSeq("s1")).toBe(1);
      expect(store.getLatestSeq("s2")).toBe(1);
    });

    it("cursor で絞り込みできる（exclusive）", () => {
      store.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "output", source: "capture" });
      store.addEvent({ sessionId: "s1", runId: 1, text: "b", type: "output", source: "capture" });
      store.addEvent({ sessionId: "s1", runId: 1, text: "c", type: "output", source: "capture" });

      const events = store.getEvents("s1", 1, 50);
      expect(events.map(e => e.text)).toEqual(["b", "c"]);
    });

    it("limit で件数制限できる", () => {
      for (let i = 0; i < 10; i++) {
        store.addEvent({ sessionId: "s1", runId: 1, text: `line${i}`, type: "output", source: "capture" });
      }

      const events = store.getEvents("s1", 0, 3);
      expect(events).toHaveLength(3);
      expect(events[0].text).toBe("line0");
    });

    it("存在しないセッションは空配列を返す", () => {
      expect(store.getEvents("nonexistent")).toEqual([]);
    });

    it("getLatestSeq は未知セッションで 0 を返す", () => {
      expect(store.getLatestSeq("nonexistent")).toBe(0);
    });

    it("getEventCount はイベント数を返す", () => {
      expect(store.getEventCount("s1")).toBe(0);
      store.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "output", source: "capture" });
      expect(store.getEventCount("s1")).toBe(1);
    });
  });

  describe("テキスト truncate", () => {
    it("maxEventChars 超過時にテキストが切り詰められ truncated=true になる", () => {
      const smallConfig = makeConfig({ maxEventChars: 10 });
      const smallStore = new TerminalEventStore(smallConfig);

      const event = smallStore.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "a".repeat(20),
        type: "output",
        source: "capture",
      });

      expect(event.text).toHaveLength(10);
      expect(event.truncated).toBe(true);
    });

    it("maxEventChars 以下ではテキストがそのまま保持され truncated=false", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "short",
        type: "output",
        source: "capture",
      });

      expect(event.text).toBe("short");
      expect(event.truncated).toBe(false);
    });
  });

  describe("consumeIfPending", () => {
    it("pending イベントを consumed に遷移できる", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      const result = store.consumeIfPending(event.id, "s1", 1);
      expect(result.success).toBe(true);
      expect(store.getEventById(event.id)?.event_state).toBe("consumed");
      expect(store.getEventById(event.id)?.consumed_at).not.toBe("");
    });

    it("consumed イベントの再消費は TRIGGER_EVENT_CONSUMED", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      store.consumeIfPending(event.id, "s1", 1);
      const result = store.consumeIfPending(event.id, "s1", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_EVENT_CONSUMED");
    });

    it("session_id 不一致は TRIGGER_SESSION_MISMATCH", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      const result = store.consumeIfPending(event.id, "s2", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_SESSION_MISMATCH");
    });

    it("run_id 不一致は TRIGGER_RUN_MISMATCH", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      const result = store.consumeIfPending(event.id, "s1", 2);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_RUN_MISMATCH");
    });

    it("存在しないイベントは TRIGGER_EVENT_EXPIRED", () => {
      const result = store.consumeIfPending("nonexistent", "s1", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_EVENT_EXPIRED");
    });

    it("有効期限切れは TRIGGER_EVENT_EXPIRED", () => {
      vi.useFakeTimers();
      try {
        const event = store.addEvent({
          sessionId: "s1",
          runId: 1,
          text: "prompt",
          type: "trigger",
          source: "capture",
          ttlMinutes: 1,
        });

        // 2分進める
        vi.advanceTimersByTime(2 * 60 * 1000);

        const result = store.consumeIfPending(event.id, "s1", 1);
        expect(result.success).toBe(false);
        expect(result.reason).toBe("TRIGGER_EVENT_EXPIRED");
        expect(store.getEventById(event.id)?.event_state).toBe("expired");
      } finally {
        vi.useRealTimers();
      }
    });

    it("failed(before_text) は再試行上限内で再消費可能", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      store.markFailed(event.id, "copy_mode_fail", "before_text");
      expect(store.getEventById(event.id)?.event_state).toBe("failed");

      const result = store.consumeIfPending(event.id, "s1", 1);
      expect(result.success).toBe(true);
      expect(store.getEventById(event.id)?.retry_count).toBe(1);
    });

    it("failed(after_text) は TRIGGER_NOT_RETRIABLE", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      store.markFailed(event.id, "enter_fail", "after_text");

      const result = store.consumeIfPending(event.id, "s1", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_NOT_RETRIABLE");
    });

    it("failed(before_text) の再試行上限超過は TRIGGER_RETRY_EXHAUSTED", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "prompt",
        type: "trigger",
        source: "capture",
      });

      // retry_count を上限まで引き上げ
      store.markFailed(event.id, "fail", "before_text");
      const e = store.getEventById(event.id)!;
      e.retry_count = DEFAULT_TRIGGER_MAX_RETRIES;

      const result = store.consumeIfPending(event.id, "s1", 1);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("TRIGGER_RETRY_EXHAUSTED");
    });
  });

  describe("invalidateBySession", () => {
    it("pending/failed イベントを expired に遷移する", () => {
      const e1 = store.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "trigger", source: "capture" });
      const e2 = store.addEvent({ sessionId: "s1", runId: 1, text: "b", type: "trigger", source: "capture" });
      store.markFailed(e2.id, "fail", "before_text");
      // consumed イベントは対象外
      const e3 = store.addEvent({ sessionId: "s1", runId: 1, text: "c", type: "trigger", source: "capture" });
      store.consumeIfPending(e3.id, "s1", 1);

      const count = store.invalidateBySession("s1", "session_restarted");
      expect(count).toBe(2);

      expect(store.getEventById(e1.id)?.event_state).toBe("expired");
      expect(store.getEventById(e1.id)?.fail_reason).toBe("session_restarted");
      expect(store.getEventById(e2.id)?.event_state).toBe("expired");
      expect(store.getEventById(e3.id)?.event_state).toBe("consumed"); // 変更なし
    });

    it("存在しないセッションでは 0 を返す", () => {
      expect(store.invalidateBySession("nonexistent")).toBe(0);
    });
  });

  describe("セッション単位の保持上限", () => {
    it("上限超過時に eviction 優先順位で削除される", () => {
      const smallStore = new TerminalEventStore(makeConfig({ maxEventsPerSession: 3 }));

      // 3つ追加 → 上限ちょうど
      smallStore.addEvent({ sessionId: "s1", runId: 1, text: "a", type: "output", source: "capture" });
      const b = smallStore.addEvent({ sessionId: "s1", runId: 1, text: "b", type: "output", source: "capture" });
      smallStore.consumeIfPending(b.id, "s1", 1); // consumed に
      smallStore.addEvent({ sessionId: "s1", runId: 1, text: "c", type: "output", source: "capture" });

      expect(smallStore.getEventCount("s1")).toBe(3);

      // 4つ目追加 → consumed の b が削除される
      smallStore.addEvent({ sessionId: "s1", runId: 1, text: "d", type: "output", source: "capture" });
      expect(smallStore.getEventCount("s1")).toBe(3);

      // consumed(b) が削除され、pending の a, c, d が残る
      expect(smallStore.getEventById(b.id)).toBeUndefined();
    });

    it("pending イベントが最後に削除される", () => {
      const smallStore = new TerminalEventStore(makeConfig({ maxEventsPerSession: 2 }));

      const a = smallStore.addEvent({ sessionId: "s1", runId: 1, text: "consumed", type: "trigger", source: "capture" });
      smallStore.consumeIfPending(a.id, "s1", 1);
      const b = smallStore.addEvent({ sessionId: "s1", runId: 1, text: "pending", type: "trigger", source: "capture" });

      // 3つ目追加 → consumed(a) が先に削除
      const c = smallStore.addEvent({ sessionId: "s1", runId: 1, text: "pending2", type: "trigger", source: "capture" });
      expect(smallStore.getEventById(a.id)).toBeUndefined();
      expect(smallStore.getEventById(b.id)).toBeDefined();
      expect(smallStore.getEventById(c.id)).toBeDefined();
    });
  });

  describe("グローバルの保持上限", () => {
    it("全セッション合計が上限超過時に削除される", () => {
      const smallStore = new TerminalEventStore(makeConfig({ maxEventsGlobal: 5, maxEventsPerSession: 10 }));

      for (let i = 0; i < 3; i++) {
        smallStore.addEvent({ sessionId: "s1", runId: 1, text: `s1-${i}`, type: "output", source: "capture" });
      }
      for (let i = 0; i < 3; i++) {
        smallStore.addEvent({ sessionId: "s2", runId: 1, text: `s2-${i}`, type: "output", source: "capture" });
      }

      // 合計 6 → 上限 5 → 1件削除
      const total = smallStore.getEventCount("s1") + smallStore.getEventCount("s2");
      expect(total).toBe(5);
    });
  });

  describe("TTL と tombstone", () => {
    it("runMaintenance で TTL 超過イベントが expired に遷移する", () => {
      vi.useFakeTimers();
      try {
        const config = makeConfig({ eventTtlMinutes: 1 });
        const ttlStore = new TerminalEventStore(config);

        const event = ttlStore.addEvent({
          sessionId: "s1",
          runId: 1,
          text: "old",
          type: "output",
          source: "capture",
        });

        vi.advanceTimersByTime(2 * 60 * 1000); // 2分
        ttlStore.runMaintenance();

        expect(ttlStore.getEventById(event.id)?.event_state).toBe("expired");
      } finally {
        vi.useRealTimers();
      }
    });

    it("tombstone TTL 超過後に物理削除される", () => {
      vi.useFakeTimers();
      try {
        const config = makeConfig({ eventTtlMinutes: 1, tombstoneTtlMinutes: 2 });
        const ttlStore = new TerminalEventStore(config);

        const event = ttlStore.addEvent({
          sessionId: "s1",
          runId: 1,
          text: "old",
          type: "output",
          source: "capture",
        });

        // TTL 超過 → expired
        vi.advanceTimersByTime(2 * 60 * 1000);
        ttlStore.runMaintenance();
        expect(ttlStore.getEventById(event.id)?.event_state).toBe("expired");

        // tombstone TTL 超過 → 物理削除
        vi.advanceTimersByTime(3 * 60 * 1000);
        ttlStore.runMaintenance();
        expect(ttlStore.getEventById(event.id)).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("物理削除済みイベントへの consumeIfPending は TRIGGER_EVENT_EXPIRED", () => {
      vi.useFakeTimers();
      try {
        const config = makeConfig({ eventTtlMinutes: 1, tombstoneTtlMinutes: 1 });
        const ttlStore = new TerminalEventStore(config);

        const event = ttlStore.addEvent({
          sessionId: "s1",
          runId: 1,
          text: "old",
          type: "trigger",
          source: "capture",
        });
        const eventId = event.id;

        // TTL + tombstone 超過
        vi.advanceTimersByTime(3 * 60 * 1000);
        ttlStore.runMaintenance();

        const result = ttlStore.consumeIfPending(eventId, "s1", 1);
        expect(result.success).toBe(false);
        expect(result.reason).toBe("TRIGGER_EVENT_EXPIRED");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("markFailed", () => {
    it("イベントを failed に遷移し詳細を記録する", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "trigger",
        type: "trigger",
        source: "capture",
      });

      store.markFailed(event.id, "copy_mode_error", "before_text");
      const updated = store.getEventById(event.id)!;
      expect(updated.event_state).toBe("failed");
      expect(updated.fail_reason).toBe("copy_mode_error");
      expect(updated.fail_phase).toBe("before_text");
      expect(updated.failed_at).not.toBe("");
    });

    it("存在しないイベントは false を返す", () => {
      expect(store.markFailed("nonexistent", "err", "before_text")).toBe(false);
    });
  });

  describe("gap イベント", () => {
    it("gap イベントを追加できる", () => {
      const event = store.addEvent({
        sessionId: "s1",
        runId: 1,
        text: "",
        type: "gap",
        source: "capture",
        reason: "resync",
      });

      expect(event.type).toBe("gap");
      expect(event.reason).toBe("resync");
    });
  });
});

describe("eviction 決定性プロパティテスト", () => {
  it("同一入力に対して eviction 結果が一意に定まる", () => {
    fc.assert(
      fc.property(
        // ランダムなセッション数（1-3）とイベント数（1-10/session）を生成
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 1, max: 5 }), // maxEventsPerSession
        (numSessions, eventsPerSession, maxPerSession) => {
          const config = makeConfig({
            maxEventsPerSession: maxPerSession,
            maxEventsGlobal: maxPerSession * numSessions,
          });

          // 2つのストアに同一のイベントを追加
          const store1 = new TerminalEventStore(config);
          const store2 = new TerminalEventStore(config);

          const addedIds: string[][] = [[], []];
          for (let s = 0; s < numSessions; s++) {
            const sessionId = `s${s}`;
            for (let e = 0; e < eventsPerSession; e++) {
              const ev1 = store1.addEvent({ sessionId, runId: 1, text: `text-${s}-${e}`, type: "output", source: "capture" });
              const ev2 = store2.addEvent({ sessionId, runId: 1, text: `text-${s}-${e}`, type: "output", source: "capture" });
              addedIds[0].push(ev1.id);
              addedIds[1].push(ev2.id);
            }
          }

          // 各セッションの残存イベント数が一致
          for (let s = 0; s < numSessions; s++) {
            const sessionId = `s${s}`;
            expect(store1.getEventCount(sessionId)).toBe(store2.getEventCount(sessionId));
          }

          // 残存イベントの text 内容が一致
          for (let s = 0; s < numSessions; s++) {
            const sessionId = `s${s}`;
            const events1 = store1.getEvents(sessionId, 0, 1000).map(e => e.text);
            const events2 = store2.getEvents(sessionId, 0, 1000).map(e => e.text);
            expect(events1).toEqual(events2);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("eviction は pending イベントを最後に削除する", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }), // 追加イベント数
        (numEvents) => {
          const maxEvents = Math.max(1, Math.floor(numEvents / 2));
          const config = makeConfig({ maxEventsPerSession: maxEvents, maxEventsGlobal: 1000 });
          const store = new TerminalEventStore(config);

          // 前半を consumed に、後半を pending のまま
          const consumedIds: string[] = [];
          const pendingIds: string[] = [];
          for (let i = 0; i < numEvents; i++) {
            const ev = store.addEvent({ sessionId: "s1", runId: 1, text: `e${i}`, type: "trigger", source: "capture" });
            if (i < Math.floor(numEvents / 2)) {
              store.consumeIfPending(ev.id, "s1", 1);
              consumedIds.push(ev.id);
            } else {
              pendingIds.push(ev.id);
            }
          }

          // pending イベントが残っている限り、consumed よりも多く保存されている
          const remaining = store.getEvents("s1", 0, 1000);
          const remainingPending = remaining.filter(e => e.event_state === "pending");
          const remainingConsumed = remaining.filter(e => e.event_state === "consumed");

          // pending が maxEvents を超過しない限り、consumed より先に削除されない
          if (pendingIds.length <= maxEvents) {
            expect(remainingPending.length).toBe(pendingIds.length);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("parseCaptureConfig", () => {
  it("デフォルト値が設定される（環境変数なし）", () => {
    const config = parseCaptureConfig({});
    expect(config.enableCodex).toBe(false);
    expect(config.enableCopilot).toBe(false);
    expect(config.enableClaude).toBe(false);
    expect(config.maxEventsPerSession).toBe(DEFAULT_MAX_EVENTS_PER_SESSION);
    expect(config.eventTtlMinutes).toBe(DEFAULT_EVENT_TTL_MINUTES);
    expect(config.maxEventsGlobal).toBe(DEFAULT_MAX_EVENTS_GLOBAL);
    expect(config.maxEventChars).toBe(DEFAULT_MAX_EVENT_CHARS);
    expect(config.tombstoneTtlMinutes).toBe(DEFAULT_TOMBSTONE_TTL_MINUTES);
  });

  it("true/TRUE で有効化される", () => {
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "true" }).enableCodex).toBe(true);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "TRUE" }).enableCodex).toBe(true);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "True" }).enableCodex).toBe(true);
  });

  it("false/FALSE で無効化される", () => {
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "false" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "FALSE" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "False" }).enableCodex).toBe(false);
  });

  it("不正値はデフォルト（false）にフォールバック", () => {
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "yes" }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "1" }).enableCodex).toBe(false);
  });

  it("未設定はデフォルト（false）にフォールバック", () => {
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: undefined }).enableCodex).toBe(false);
    expect(parseCaptureConfig({ CAPTURE_ENABLE_CODEX: "" }).enableCodex).toBe(false);
  });

  it("数値環境変数が正しくパースされる", () => {
    const config = parseCaptureConfig({
      CAPTURE_MAX_EVENTS_PER_SESSION: "100",
      CAPTURE_EVENT_TTL_MINUTES: "5",
      CAPTURE_MAX_EVENTS_GLOBAL: "500",
      CAPTURE_MAX_EVENT_CHARS: "2048",
      CAPTURE_TOMBSTONE_TTL_MINUTES: "30",
    });
    expect(config.maxEventsPerSession).toBe(100);
    expect(config.eventTtlMinutes).toBe(5);
    expect(config.maxEventsGlobal).toBe(500);
    expect(config.maxEventChars).toBe(2048);
    expect(config.tombstoneTtlMinutes).toBe(30);
  });

  it("異常値（0, 負値, 非数値）でデフォルト値にフォールバック", () => {
    expect(parseCaptureConfig({ CAPTURE_MAX_EVENTS_PER_SESSION: "0" }).maxEventsPerSession)
      .toBe(DEFAULT_MAX_EVENTS_PER_SESSION);
    expect(parseCaptureConfig({ CAPTURE_MAX_EVENTS_PER_SESSION: "-1" }).maxEventsPerSession)
      .toBe(DEFAULT_MAX_EVENTS_PER_SESSION);
    expect(parseCaptureConfig({ CAPTURE_MAX_EVENTS_PER_SESSION: "abc" }).maxEventsPerSession)
      .toBe(DEFAULT_MAX_EVENTS_PER_SESSION);
    expect(parseCaptureConfig({ CAPTURE_EVENT_TTL_MINUTES: "0" }).eventTtlMinutes)
      .toBe(DEFAULT_EVENT_TTL_MINUTES);
    expect(parseCaptureConfig({ CAPTURE_EVENT_TTL_MINUTES: "-1" }).eventTtlMinutes)
      .toBe(DEFAULT_EVENT_TTL_MINUTES);
    expect(parseCaptureConfig({ CAPTURE_EVENT_TTL_MINUTES: "abc" }).eventTtlMinutes)
      .toBe(DEFAULT_EVENT_TTL_MINUTES);
  });
});
