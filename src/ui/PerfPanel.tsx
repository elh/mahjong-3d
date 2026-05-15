import { useEffect, useMemo, useRef, useState } from "react";
import { createFrameStatsTracker, type FrameStatsSnapshot } from "./perfStats";

const panelUpdateMs = 500;

export function PerfPanel({
  seed,
  eventIndex,
  eventCount,
  viewMode,
}: {
  seed: string;
  eventIndex: number;
  eventCount: number;
  viewMode: string;
}) {
  const tracker = useMemo(() => createFrameStatsTracker(), []);
  const [stats, setStats] = useState<FrameStatsSnapshot>(() =>
    tracker.snapshot(),
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const latestStatsRef = useRef(stats);
  const metadataRef = useRef({
    seed,
    eventIndex,
    eventCount,
    viewMode,
  });

  latestStatsRef.current = stats;
  metadataRef.current = {
    seed,
    eventIndex,
    eventCount,
    viewMode,
  };

  useEffect(() => {
    let frameId: number | undefined;
    let lastPanelUpdateAt = 0;

    function recordFrame(timestamp: number) {
      const nextStats = tracker.record(timestamp);
      if (
        timestamp - lastPanelUpdateAt >= panelUpdateMs ||
        latestStatsRef.current.frames === 0
      ) {
        lastPanelUpdateAt = timestamp;
        latestStatsRef.current = nextStats;
        setStats(nextStats);
      }
      frameId = window.requestAnimationFrame(recordFrame);
    }

    frameId = window.requestAnimationFrame(recordFrame);
    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [tracker]);

  function resetStats() {
    const nextStats = tracker.reset(performance.now());
    latestStatsRef.current = nextStats;
    setStats(nextStats);
    setCopyState("idle");
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryJson());
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function exportSummary() {
    const blob = new Blob([`${summaryJson()}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mahjong-perf-${metadataRef.current.seed}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function summaryJson(): string {
    return JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        ...metadataRef.current,
        stats: latestStatsRef.current,
      },
      null,
      2,
    );
  }

  return (
    <aside className="perf-panel" aria-label="Performance metrics">
      <header>
        <strong>Perf</strong>
        <span>{formatNumber(stats.currentFps, 1)} fps</span>
      </header>
      <dl>
        <div>
          <dt>Frame avg</dt>
          <dd>{formatNumber(stats.averageFrameMs, 1)} ms</dd>
        </div>
        <div>
          <dt>Frame p95</dt>
          <dd>{formatNumber(stats.p95FrameMs, 1)} ms</dd>
        </div>
        <div>
          <dt>Worst</dt>
          <dd>{formatNumber(stats.worstFrameMs, 1)} ms</dd>
        </div>
        <div>
          <dt>Long frames</dt>
          <dd>{stats.longFrameCount}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd>{stats.frames}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{formatNumber(stats.elapsedMs / 1000, 1)} s</dd>
        </div>
        <div>
          <dt>Seed</dt>
          <dd title={seed}>{seed}</dd>
        </div>
        <div>
          <dt>Event</dt>
          <dd>
            {eventCount === 0 ? 0 : eventIndex + 1}/{eventCount}
          </dd>
        </div>
        <div>
          <dt>View</dt>
          <dd>{viewMode}</dd>
        </div>
      </dl>
      <div className="perf-panel-actions">
        <button type="button" onClick={resetStats}>
          Reset
        </button>
        <button type="button" onClick={copySummary}>
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy JSON"}
        </button>
        <button type="button" onClick={exportSummary}>
          Export
        </button>
      </div>
    </aside>
  );
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  }).format(value);
}
