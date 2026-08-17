import { describe, expect, test } from "bun:test";
import { createFrameStatsTracker } from "./perfStats";

describe("frame stats tracker", () => {
  test("records average, p95, long frames, and worst frame", () => {
    const tracker = createFrameStatsTracker({
      rollingFrameCount: 3,
      longFrameMs: 50,
    });

    tracker.record(0);
    tracker.record(16);
    tracker.record(32);
    tracker.record(82);
    tracker.record(102);

    expect(tracker.snapshot(102)).toEqual({
      frames: 4,
      elapsedMs: 102,
      currentFps: 1000 / ((16 + 50 + 20) / 3),
      averageFrameMs: 25.5,
      p95FrameMs: 50,
      longFrameCount: 1,
      worstFrameMs: 50,
    });
  });

  test("resets accumulated session state", () => {
    const tracker = createFrameStatsTracker();
    tracker.record(0);
    tracker.record(80);

    expect(tracker.snapshot(80).longFrameCount).toBe(1);

    expect(tracker.reset(100)).toEqual({
      frames: 0,
      elapsedMs: 0,
      currentFps: 0,
      averageFrameMs: 0,
      p95FrameMs: 0,
      longFrameCount: 0,
      worstFrameMs: 0,
    });
  });

  test("uses a bounded rolling window for current frame health", () => {
    const tracker = createFrameStatsTracker({ rollingFrameCount: 3 });
    tracker.record(0);
    tracker.record(100);
    tracker.record(110);
    tracker.record(120);
    tracker.record(130);

    expect(tracker.snapshot(130)).toMatchObject({
      frames: 4,
      averageFrameMs: 32.5,
      p95FrameMs: 10,
      worstFrameMs: 100,
    });
  });
});
