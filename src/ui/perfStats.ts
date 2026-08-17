export type FrameStatsSnapshot = {
  frames: number;
  elapsedMs: number;
  currentFps: number;
  averageFrameMs: number;
  p95FrameMs: number;
  longFrameCount: number;
  worstFrameMs: number;
};

export type FrameStatsTracker = {
  record(timestampMs: number): void;
  reset(timestampMs?: number): FrameStatsSnapshot;
  snapshot(nowMs?: number): FrameStatsSnapshot;
};

const defaultRollingFrameCount = 60;
const defaultLongFrameMs = 50;

export function createFrameStatsTracker({
  rollingFrameCount = defaultRollingFrameCount,
  longFrameMs = defaultLongFrameMs,
}: {
  rollingFrameCount?: number;
  longFrameMs?: number;
} = {}): FrameStatsTracker {
  let startedAt: number | undefined;
  let lastTimestamp: number | undefined;
  let totalFrameMs = 0;
  let frameCount = 0;
  let longFrameCount = 0;
  let worstFrameMs = 0;
  const rollingDurations: number[] = [];

  function reset(timestampMs?: number): FrameStatsSnapshot {
    startedAt = timestampMs;
    lastTimestamp = timestampMs;
    totalFrameMs = 0;
    longFrameCount = 0;
    worstFrameMs = 0;
    frameCount = 0;
    rollingDurations.length = 0;
    return snapshot(timestampMs);
  }

  function record(timestampMs: number): void {
    if (startedAt === undefined) {
      startedAt = timestampMs;
      lastTimestamp = timestampMs;
      return;
    }

    const frameMs =
      lastTimestamp === undefined ? 0 : timestampMs - lastTimestamp;
    lastTimestamp = timestampMs;
    if (frameMs > 0) {
      frameCount += 1;
      rollingDurations.push(frameMs);
      if (rollingDurations.length > rollingFrameCount) {
        rollingDurations.shift();
      }
      totalFrameMs += frameMs;
      worstFrameMs = Math.max(worstFrameMs, frameMs);
      if (frameMs >= longFrameMs) {
        longFrameCount += 1;
      }
    }
  }

  function snapshot(
    nowMs = lastTimestamp ?? startedAt ?? 0,
  ): FrameStatsSnapshot {
    const rollingTotal = rollingDurations.reduce(
      (total, frameMs) => total + frameMs,
      0,
    );
    return {
      frames: frameCount,
      elapsedMs: startedAt === undefined ? 0 : Math.max(0, nowMs - startedAt),
      currentFps:
        rollingTotal > 0 ? (rollingDurations.length * 1000) / rollingTotal : 0,
      averageFrameMs: frameCount > 0 ? totalFrameMs / frameCount : 0,
      p95FrameMs: percentile(rollingDurations, 0.95),
      longFrameCount,
      worstFrameMs,
    };
  }

  return {
    record,
    reset,
    snapshot,
  };
}

function percentile(values: readonly number[], rank: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * rank) - 1),
  );
  return sorted[index];
}
