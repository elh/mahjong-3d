import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Orbit,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GameEvent } from "./sim/events";
import { replayEvents } from "./sim/replay";
import { macScreenSaverDownloadHref } from "./ui/downloadLinks";
import { EventLog } from "./ui/EventLog";
import { eventDetail, eventTitle } from "./ui/eventText";
import type { InfoModalLink } from "./ui/InfoModal";
import { InfoModal } from "./ui/InfoModal";
import {
  infiniteRoundFadeMs,
  infiniteRoundFlipTransitionDelayMs,
  infiniteRoundHoldMs,
  infiniteRoundSwapMs,
  nextRoundPromotionDelayMs,
} from "./ui/infinitePlayback";
import {
  MacScreenSaverDownloadWarningTooltip,
  macScreenSaverDownloadWarning,
} from "./ui/MacScreenSaverDownloadWarning";
import { PerfPanel } from "./ui/PerfPanel";
import { playerNames } from "./ui/playerNames";
import {
  initialScreenSaverLifecycle,
  postScreenSaverDiagnostic,
  type ScreenSaverBridge,
  type ScreenSaverFrameEventDetail,
  type ScreenSaverLifecycle,
  type ScreenSaverSurfaceConfig,
  screenSaverFrameEventName,
  screenSaverFrameTimestampFromEvent,
  screenSaverRuntimeOptions,
  screenSaverSurfaceFromSearch,
} from "./ui/screenSaverSurface";
import { TileGroup } from "./ui/TileGroup";
import { useSimulationController } from "./ui/useSimulationController";

declare const __DEBUG_MODE_ENABLED__: boolean;

declare global {
  interface Window {
    mahjongScreenSaver?: ScreenSaverBridge;
    __mahjongScreenSaverNativeState?: Partial<ScreenSaverLifecycle>;
  }
}

const eventAdvanceDelayMs = 1200;
const setupEventAdvanceDelayMs = 800;
const turnBoundaryPauseMs = 100;
const overlayControlsInactiveDelayMs = 5000;
const overlayControlsMouseLeaveDelayMs = 3000;
const debugRoutesEnabled = __DEBUG_MODE_ENABLED__;

const ThreeGameView = lazy(() =>
  import("./ui/three/ThreeGameView").then((module) => ({
    default: module.ThreeGameView,
  })),
);

function eventAutoAdvanceDelay(
  currentEvent: GameEvent | undefined,
  nextEvent: GameEvent,
): number {
  const isTurnBoundary =
    currentEvent?.groupId !== nextEvent.groupId && nextEvent.phase === "turn";
  const isSetupDrawPhase =
    currentEvent?.phase === "setup" || nextEvent.phase === "setup";
  const baseDelay = isSetupDrawPhase
    ? setupEventAdvanceDelayMs
    : eventAdvanceDelayMs;
  return baseDelay + (isTurnBoundary ? turnBoundaryPauseMs : 0);
}

function perfPanelEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("perf") === "1";
}

function appHref(search = ""): string {
  const base = import.meta.env.BASE_URL || "/";
  const basePath = base.endsWith("/") ? base : `${base}/`;
  return `${basePath}${search}`;
}

function debugRouteLinks(
  seed: string,
  routes: readonly ("debug" | "debug-table-flip")[],
): InfoModalLink[] {
  if (!debugRoutesEnabled) {
    return [];
  }

  return routes.map((view) => ({
    href: appHref(`?view=${view}&seed=${encodeURIComponent(seed)}`),
    label: view === "debug" ? "Debug view" : "Table flip debug",
  }));
}

function scrollActiveEventIntoView(
  eventLog: HTMLElement | null,
  activeEvent: HTMLElement | null,
): void {
  if (!eventLog || !activeEvent) {
    return;
  }

  const margin = 8;
  const logRect = eventLog.getBoundingClientRect();
  const activeRect = activeEvent.getBoundingClientRect();
  const isVisible =
    activeRect.top >= logRect.top + margin &&
    activeRect.bottom <= logRect.bottom - margin;

  if (isVisible) {
    return;
  }

  eventLog.scrollTop +=
    activeRect.top -
    logRect.top -
    (eventLog.clientHeight - activeEvent.offsetHeight) / 2;
}

/**
 * Supported query params:
 * - seed: initial round seed.
 * - perf=1: show the performance panel.
 * - surface=screensaver: native macOS screen saver surface.
 * - preview=1: lower-cost System Settings screen saver preview.
 * - diagnostic=dom | canvas2d | webgl-static: screen saver diagnostic renderer.
 * - view=debug | debug-table-flip: debug-only routes, enabled by passing DEBUG.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const screenSaverSurface = screenSaverSurfaceFromSearch(
    window.location.search,
  );
  if (screenSaverSurface) {
    if (screenSaverSurface.diagnosticMode !== "app") {
      return <ScreenSaverDiagnosticApp screenSaver={screenSaverSurface} />;
    }
    return <SimApp screenSaver={screenSaverSurface} />;
  }
  if (debugRoutesEnabled && view === "debug") {
    return <DebugApp />;
  }
  if (debugRoutesEnabled && view === "debug-table-flip") {
    return <TableFlipDebugApp />;
  }
  return <SimApp />;
}

function ScreenSaverDiagnosticApp({
  screenSaver,
}: {
  screenSaver: ScreenSaverSurfaceConfig;
}) {
  const lifecycle = useScreenSaverLifecycle(screenSaver);
  const [frameCount, setFrameCount] = useState(0);
  const [lastTimestampMs, setLastTimestampMs] = useState(0);
  useScreenSaverDiagnosticLogger(screenSaver, lifecycle, frameCount);

  useEffect(() => {
    const handleFrame = (event: Event) => {
      setFrameCount((count) => count + 1);
      setLastTimestampMs(
        screenSaverFrameTimestampFromEvent(event, performance.now()),
      );
    };

    window.addEventListener(screenSaverFrameEventName, handleFrame);
    return () => {
      window.removeEventListener(screenSaverFrameEventName, handleFrame);
    };
  }, []);

  const mode = screenSaver.diagnosticMode;
  return (
    <main
      className="screen-saver-diagnostic-shell"
      data-mode={mode}
      style={{
        minHeight: "100vh",
        overflow: "hidden",
        background: "#131614",
        color: "#f0f6ed",
        position: "relative",
      }}
    >
      <DiagnosticHeartbeat
        mode={mode}
        frameCount={frameCount}
        lastTimestampMs={lastTimestampMs}
      />
      {mode === "dom" ? (
        <DomDiagnostic frameCount={frameCount} />
      ) : mode === "canvas2d" ? (
        <Canvas2DDiagnostic frameCount={frameCount} />
      ) : (
        <WebGLStaticDiagnostic frameCount={frameCount} />
      )}
    </main>
  );
}

function useScreenSaverDiagnosticLogger(
  screenSaver: ScreenSaverSurfaceConfig,
  lifecycle: ScreenSaverLifecycle,
  frameCount: number,
) {
  const lastLogAtRef = useRef(0);
  const frameCountRef = useRef(frameCount);

  useEffect(() => {
    frameCountRef.current = frameCount;
  }, [frameCount]);

  useEffect(() => {
    postScreenSaverDiagnostic(
      `diagnosticMount ${JSON.stringify({
        mode: screenSaver.diagnosticMode,
        preview: screenSaver.preview,
        lifecycle,
        hidden: document.hidden,
        url: window.location.href,
      })}`,
    );
    const handleVisibility = () => {
      postScreenSaverDiagnostic(
        `diagnosticVisibility ${JSON.stringify({
          mode: screenSaver.diagnosticMode,
          hidden: document.hidden,
          visibilityState: document.visibilityState,
        })}`,
      );
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      postScreenSaverDiagnostic(
        `diagnosticUnmount ${JSON.stringify({
          mode: screenSaver.diagnosticMode,
          frameCount: frameCountRef.current,
        })}`,
      );
    };
  }, [screenSaver.diagnosticMode, screenSaver.preview, lifecycle]);

  useEffect(() => {
    const now = performance.now();
    if (frameCount === 0 || now - lastLogAtRef.current < 1000) {
      return;
    }
    lastLogAtRef.current = now;
    postScreenSaverDiagnostic(
      `diagnosticFrameStats ${JSON.stringify({
        mode: screenSaver.diagnosticMode,
        frameCount,
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      })}`,
    );
  }, [frameCount, screenSaver.diagnosticMode]);
}

function DiagnosticHeartbeat({
  mode,
  frameCount,
  lastTimestampMs,
}: {
  mode: string;
  frameCount: number;
  lastTimestampMs: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        left: 20,
        zIndex: 3,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 14,
        lineHeight: 1.4,
        background: "rgba(0, 0, 0, 0.46)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div>mode: {mode}</div>
      <div>frames: {frameCount}</div>
      <div>t: {Math.round(lastTimestampMs)}ms</div>
    </div>
  );
}

function DomDiagnostic({ frameCount }: { frameCount: number }) {
  const x = 12 + (frameCount % 90);
  const y = 32 + ((frameCount * 3) % 40);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(135deg, #182923 0%, #121817 42%, #2b1f30 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `${y}%`,
          width: 180,
          height: 180,
          borderRadius: 8,
          background: "#e8d88f",
          boxShadow: "0 0 60px rgba(232, 216, 143, 0.42)",
          transform: `rotate(${frameCount * 3}deg)`,
        }}
      />
    </div>
  );
}

function Canvas2DDiagnostic({ frameCount }: { frameCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      postScreenSaverDiagnostic("diagnosticCanvas2D missing context");
      return;
    }

    const width = Math.max(1, canvas.clientWidth * window.devicePixelRatio);
    const height = Math.max(1, canvas.clientHeight * window.devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.fillStyle = "#111615";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#194d3e";
    context.fillRect(width * 0.18, height * 0.22, width * 0.64, height * 0.56);
    context.fillStyle = "#f2e5bc";
    const tileWidth = width * 0.055;
    const tileHeight = height * 0.08;
    for (let index = 0; index < 32; index += 1) {
      const column = index % 8;
      const row = Math.floor(index / 8);
      context.fillRect(
        width * 0.28 + column * tileWidth * 1.18,
        height * 0.34 + row * tileHeight * 1.25,
        tileWidth,
        tileHeight,
      );
    }
    context.fillStyle = "#dd7566";
    context.beginPath();
    context.arc(
      width * (0.18 + (frameCount % 80) / 100),
      height * 0.72,
      Math.max(12, width * 0.018),
      0,
      Math.PI * 2,
    );
    context.fill();
  }, [frameCount]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}

function WebGLStaticDiagnostic({ frameCount }: { frameCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl");
    if (!canvas || !gl) {
      postScreenSaverDiagnostic("diagnosticWebGL missing context");
      return;
    }

    const width = Math.max(1, canvas.clientWidth * window.devicePixelRatio);
    const height = Math.max(1, canvas.clientHeight * window.devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    const phase = (frameCount % 120) / 120;
    gl.clearColor(0.07 + phase * 0.08, 0.1, 0.09 + phase * 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pixels = new Uint8Array(4);
    gl.readPixels(
      Math.floor(width / 2),
      Math.floor(height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    if (frameCount % 30 === 0) {
      postScreenSaverDiagnostic(
        `diagnosticWebGLReadback ${JSON.stringify({
          frameCount,
          pixel: Array.from(pixels),
          width,
          height,
        })}`,
      );
    }
  }, [frameCount]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}

function TableFlipDebugApp() {
  const simulation = useSimulationController();
  const {
    pendingSeed,
    isGenerating,
    generationError,
    eventIndex,
    events,
    replay,
    currentEvent,
    jumpToEventIndex,
  } = simulation;
  const previousReplay = useMemo(
    () => (eventIndex > 0 ? replayEvents(events, eventIndex - 1) : undefined),
    [events, eventIndex],
  );
  const nextEvent = events[eventIndex + 1];
  const roundKey =
    events[0]?.type === "roundStarted" ? events[0].seed : pendingSeed;
  const isLoadingRound = isGenerating && !generationError;
  const finalEventIndex = Math.max(events.length - 1, 0);
  const showPerfPanel = perfPanelEnabled();
  const [previewRoundVersion, setPreviewRoundVersion] = useState(0);
  const [isPreviewTransitioning, setIsPreviewTransitioning] = useState(false);
  const previewFadeTimeoutRef = useRef<number | undefined>(undefined);
  const previewSwapTimeoutRef = useRef<number | undefined>(undefined);
  const previewClearTimeoutRef = useRef<number | undefined>(undefined);
  const previewRoundKey =
    previewRoundVersion === 0
      ? roundKey
      : `${roundKey}:preview-${previewRoundVersion}`;
  const clearPreviewTransitionTimeouts = useCallback(() => {
    if (previewFadeTimeoutRef.current !== undefined) {
      window.clearTimeout(previewFadeTimeoutRef.current);
      previewFadeTimeoutRef.current = undefined;
    }
    if (previewSwapTimeoutRef.current !== undefined) {
      window.clearTimeout(previewSwapTimeoutRef.current);
      previewSwapTimeoutRef.current = undefined;
    }
    if (previewClearTimeoutRef.current !== undefined) {
      window.clearTimeout(previewClearTimeoutRef.current);
      previewClearTimeoutRef.current = undefined;
    }
  }, []);
  const previewNextTable = useCallback(
    (delayMs: number) => {
      clearPreviewTransitionTimeouts();
      setIsPreviewTransitioning(false);
      previewFadeTimeoutRef.current = window.setTimeout(() => {
        previewFadeTimeoutRef.current = undefined;
        setIsPreviewTransitioning(true);
        previewSwapTimeoutRef.current = window.setTimeout(() => {
          previewSwapTimeoutRef.current = undefined;
          setPreviewRoundVersion((version) => version + 1);
          previewClearTimeoutRef.current = window.setTimeout(() => {
            previewClearTimeoutRef.current = undefined;
            setIsPreviewTransitioning(false);
          }, infiniteRoundFadeMs);
        }, infiniteRoundSwapMs);
      }, delayMs);
    },
    [clearPreviewTransitionTimeouts],
  );

  useEffect(() => {
    if (
      !isLoadingRound &&
      events.length > 0 &&
      eventIndex !== finalEventIndex
    ) {
      jumpToEventIndex(finalEventIndex);
    }
  }, [
    eventIndex,
    events.length,
    finalEventIndex,
    isLoadingRound,
    jumpToEventIndex,
  ]);

  useEffect(
    () => () => {
      clearPreviewTransitionTimeouts();
    },
    [clearPreviewTransitionTimeouts],
  );

  return (
    <main className="sim-shell">
      {(isGenerating || generationError) && (
        <section
          className={
            generationError ? "generation-pill error" : "generation-pill"
          }
          aria-live="polite"
        >
          {generationError
            ? `Could not generate ${pendingSeed}: ${generationError}`
            : `Generating ${pendingSeed}...`}
        </section>
      )}
      <Suspense
        fallback={
          <section
            className="three-viewer loading"
            aria-label="Loading 3D view"
          >
            Loading 3D view...
          </section>
        }
      >
        <ThreeGameView
          replay={replay}
          previousReplay={previousReplay}
          currentEvent={currentEvent}
          nextEvent={nextEvent}
          eventIndex={eventIndex}
          roundKey={previewRoundKey}
          loading={isLoadingRound}
          simulatorMode
          cameraAutoRotate={false}
          suppressLoadingOverlay={isPreviewTransitioning}
          preserveSceneOnRoundChange={isPreviewTransitioning}
          tableFlipDebug
          onTableFlipPreviewTransition={previewNextTable}
          sceneTransitionOverlayActive={isPreviewTransitioning}
        />
      </Suspense>
      <InfoPopover
        seed={roundKey}
        showSeed={debugRoutesEnabled}
        links={debugRouteLinks(roundKey, ["debug"])}
      />
      {showPerfPanel ? (
        <PerfPanel
          seed={roundKey}
          eventIndex={eventIndex}
          eventCount={events.length}
          viewMode="table-flip"
        />
      ) : null}
    </main>
  );
}

function DebugApp() {
  const [viewMode, setViewMode] = useState<"debug" | "three">("debug");
  const activeEventRef = useRef<HTMLButtonElement | null>(null);
  const eventLogRef = useRef<HTMLElement | null>(null);
  const eventLogScrollFrameRef = useRef<number | undefined>(undefined);
  const simulation = useSimulationController();
  const {
    seedInput,
    setSeedInput,
    pendingSeed,
    isGenerating,
    generationError,
    eventIndex,
    events,
    replay,
    currentEvent,
    eventGroups,
    highlightedTileIds,
    canStepPrevious,
    canStepNext,
    newSeed,
    restart,
    startTypedSeed,
    stepEvent,
    jumpToEventIndex,
    scrubToEventIndex,
    clearEventHold,
    cancelEventHold,
    startEventHold,
    clickStepButton,
  } = simulation;
  const previousReplay = useMemo(
    () => (eventIndex > 0 ? replayEvents(events, eventIndex - 1) : undefined),
    [events, eventIndex],
  );
  const nextEvent = events[eventIndex + 1];
  const roundKey =
    events[0]?.type === "roundStarted" ? events[0].seed : pendingSeed;
  const isLoadingRound = isGenerating && !generationError;
  const showPerfPanel = perfPanelEnabled();

  useEffect(() => {
    if (!currentEvent) {
      return;
    }

    if (eventLogScrollFrameRef.current !== undefined) {
      window.cancelAnimationFrame(eventLogScrollFrameRef.current);
    }
    eventLogScrollFrameRef.current = window.requestAnimationFrame(() => {
      eventLogScrollFrameRef.current = undefined;
      scrollActiveEventIntoView(eventLogRef.current, activeEventRef.current);
    });

    return () => {
      if (eventLogScrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(eventLogScrollFrameRef.current);
        eventLogScrollFrameRef.current = undefined;
      }
    };
  }, [currentEvent]);

  return (
    <main className="app-shell">
      <section className="controls-band" aria-label="Game controls">
        <label className="seed-field">
          <span>Seed</span>
          <input
            value={seedInput}
            onChange={(event) => setSeedInput(event.target.value)}
            onBlur={startTypedSeed}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                startTypedSeed();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <button type="button" className="primary-button" onClick={newSeed}>
          <RefreshCw size={18} aria-hidden="true" />
          <span>New Seed</span>
        </button>
        <fieldset className="view-toggle" aria-label="View mode">
          <button
            type="button"
            className={viewMode === "debug" ? "active" : ""}
            onClick={() => setViewMode("debug")}
          >
            2D
          </button>
          <button
            type="button"
            className={viewMode === "three" ? "active" : ""}
            onClick={() => setViewMode("three")}
          >
            3D
          </button>
        </fieldset>
        <div className="step-controls">
          <button
            type="button"
            onClick={restart}
            disabled={isLoadingRound}
            aria-label="Restart"
            title="Restart"
          >
            <SkipBack size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => clickStepButton(-1)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                startEventHold(-1, canStepPrevious);
              }
            }}
            onPointerUp={clearEventHold}
            onPointerCancel={cancelEventHold}
            onPointerLeave={cancelEventHold}
            disabled={isLoadingRound || !canStepPrevious}
            aria-label="Previous event"
            title="Previous event"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => clickStepButton(1)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                startEventHold(1, canStepNext);
              }
            }}
            onPointerUp={clearEventHold}
            onPointerCancel={cancelEventHold}
            onPointerLeave={cancelEventHold}
            disabled={isLoadingRound || !canStepNext}
            aria-label="Next event"
            title="Next event"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <label className="timeline">
          <span>
            Event {events.length === 0 ? 0 : eventIndex + 1} / {events.length}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(events.length - 1, 0)}
            value={eventIndex}
            disabled={isLoadingRound || events.length === 0}
            onChange={(event) => scrubToEventIndex(Number(event.target.value))}
          />
        </label>
      </section>

      {(isGenerating || generationError) && (
        <section
          className={
            generationError ? "generation-pill error" : "generation-pill"
          }
          aria-live="polite"
        >
          {generationError
            ? `Could not generate ${pendingSeed}: ${generationError}`
            : `Generating ${pendingSeed}...`}
        </section>
      )}

      {isLoadingRound && viewMode === "debug" ? (
        <RoundLoadingView mode={viewMode} />
      ) : viewMode === "three" ? (
        <Suspense
          fallback={
            <section
              className="three-viewer loading"
              aria-label="Loading 3D view"
            >
              Loading 3D view...
            </section>
          }
        >
          <ThreeGameView
            replay={replay}
            previousReplay={previousReplay}
            currentEvent={currentEvent}
            nextEvent={nextEvent}
            eventIndex={eventIndex}
            roundKey={roundKey}
            loading={isLoadingRound}
          />
        </Suspense>
      ) : (
        <>
          <section className="viewer-shell" aria-label="Simulation viewer">
            <section className="wall-panel" aria-label="Wall state">
              <header>
                <h2>Wall</h2>
                <span>
                  {replay.wall.length} live / {replay.deadWall.length} dead
                </span>
              </header>
              <TileGroup
                title="Live"
                tiles={replay.wall}
                highlightedTileIds={highlightedTileIds}
              />
              <TileGroup
                title="Dead"
                tiles={replay.deadWall}
                highlightedTileIds={highlightedTileIds}
                className="dead-wall-group muted-tile-group"
              />
            </section>

            <section className="event-rail" aria-label="Event detail and log">
              <article className="event-panel">
                <header>
                  <h2>Current event</h2>
                </header>
                <div className="event-title">{eventTitle(currentEvent)}</div>
                <p>{eventDetail(currentEvent)}</p>
              </article>

              {replay.rulesErrors.length > 0 && (
                <section className="rules-error" aria-label="Rules errors">
                  <p className="eyebrow">Rules error</p>
                  {replay.rulesErrors.map((error) => (
                    <p
                      key={`${error.player}-${error.turn}-${error.handCount}-${error.expected}-${error.message}`}
                    >
                      {error.message}
                    </p>
                  ))}
                </section>
              )}

              <EventLog
                eventGroups={eventGroups}
                activeEvent={currentEvent}
                eventIndex={eventIndex}
                eventLogRef={eventLogRef}
                activeEventRef={activeEventRef}
                onJump={jumpToEventIndex}
                onStep={stepEvent}
              />
            </section>
          </section>

          <section className="table-grid" aria-label="Player states">
            {replay.players.map((player) => (
              <article className="player-panel" key={player.id}>
                <header>
                  <h2>{playerNames[player.id]}</h2>
                </header>
                <div className="player-tile-rows">
                  <div className="player-tile-row">
                    <TileGroup
                      title="Hand"
                      tiles={player.hand}
                      highlightedTileIds={highlightedTileIds}
                    />
                    <TileGroup
                      title="Winning Tile"
                      tiles={player.winningTile ? [player.winningTile] : []}
                      highlightedTileIds={highlightedTileIds}
                    />
                    <TileGroup
                      title="Melds"
                      tiles={player.melds.flatMap((meld) => meld.tiles)}
                      highlightedTileIds={highlightedTileIds}
                    />
                  </div>
                  <div className="player-tile-row">
                    <TileGroup
                      title="Discards"
                      tiles={player.discards}
                      highlightedTileIds={highlightedTileIds}
                      className="muted-tile-group"
                    />
                    <TileGroup
                      title="Flowers"
                      tiles={player.flowers}
                      highlightedTileIds={highlightedTileIds}
                      className="flowers-group"
                    />
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <InfoPopover
        seed={roundKey}
        showSeed={debugRoutesEnabled}
        links={debugRouteLinks(roundKey, ["debug-table-flip"])}
      />
      {showPerfPanel ? (
        <PerfPanel
          seed={roundKey}
          eventIndex={eventIndex}
          eventCount={events.length}
          viewMode={viewMode === "three" ? "debug-3d" : "debug-2d"}
        />
      ) : null}
    </main>
  );
}

function SimApp({
  screenSaver,
}: {
  screenSaver?: ScreenSaverSurfaceConfig;
} = {}) {
  const screenSaverLifecycle = useScreenSaverLifecycle(screenSaver);
  const isDocumentHidden = useDocumentHidden();
  const runtimeOptions = screenSaverRuntimeOptions({
    config: screenSaver,
    lifecycle: screenSaverLifecycle,
    documentHidden: isDocumentHidden,
  });
  const simulation = useSimulationController({
    syncSeedToUrl: false,
    active: runtimeOptions.isPlaybackActive,
    preloadEnabled: runtimeOptions.preloadEnabled,
    workerEnabled: runtimeOptions.workerEnabled,
    workerFallbackEnabled: runtimeOptions.isScreenSaver,
  });
  const prefersReducedMotion = usePrefersReducedMotion();
  const areOverlayControlsVisible = useScreenPointerActivity(
    overlayControlsInactiveDelayMs,
    overlayControlsMouseLeaveDelayMs,
    !runtimeOptions.isScreenSaver,
  );
  const [isCameraUserControlled, setIsCameraUserControlled] = useState(false);
  const [isRoundTransitioning, setIsRoundTransitioning] = useState(false);
  const [tableFlipTransitionKey, setTableFlipTransitionKey] = useState<
    string | undefined
  >();
  const terminalReachedAtRef = useRef<number | undefined>(undefined);
  const {
    pendingSeed,
    isGenerating,
    generationError,
    eventIndex,
    events,
    replay,
    currentEvent,
    hasQueuedNextRound,
    stepEvent,
    preloadNextRound,
    promoteQueuedRound,
    stepEventImmediate,
  } = simulation;
  const previousReplay = useMemo(
    () => (eventIndex > 0 ? replayEvents(events, eventIndex - 1) : undefined),
    [events, eventIndex],
  );
  const nextEvent = events[eventIndex + 1];
  const roundKey =
    events[0]?.type === "roundStarted" ? events[0].seed : pendingSeed;
  const isLoadingRound = isGenerating && !generationError;
  const isAtRoundEnd = events.length > 0 && eventIndex >= events.length - 1;
  const renderPaused = !runtimeOptions.isPlaybackActive;
  const showPerfPanel = !runtimeOptions.isScreenSaver && perfPanelEnabled();
  const showGenerationPill =
    !runtimeOptions.isScreenSaver && (isGenerating || generationError);

  useEffect(() => {
    if (
      !runtimeOptions.isPlaybackActive ||
      !runtimeOptions.preloadEnabled ||
      isLoadingRound ||
      generationError ||
      !isAtRoundEnd
    ) {
      terminalReachedAtRef.current = undefined;
      setIsRoundTransitioning(false);
      setTableFlipTransitionKey(undefined);
      return;
    }

    terminalReachedAtRef.current ??= Date.now();
    preloadNextRound();
  }, [
    generationError,
    isAtRoundEnd,
    isLoadingRound,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.preloadEnabled,
    preloadNextRound,
  ]);

  useEffect(() => {
    if (
      runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      !runtimeOptions.preloadEnabled ||
      !isAtRoundEnd ||
      !hasQueuedNextRound ||
      terminalReachedAtRef.current === undefined
    ) {
      return;
    }

    const remainingHoldMs = nextRoundPromotionDelayMs({
      isAtRoundEnd,
      hasQueuedNextRound,
      isDocumentHidden: !runtimeOptions.isPlaybackActive,
      terminalReachedAt: terminalReachedAtRef.current,
      now: Date.now(),
    });
    if (remainingHoldMs === undefined) {
      return;
    }
    let flipSettleTimeout: number | undefined;
    let promoteTimeout: number | undefined;
    let clearFadeTimeout: number | undefined;
    const transitionTimeout = window.setTimeout(() => {
      if (!prefersReducedMotion) {
        setTableFlipTransitionKey(`${roundKey}:${eventIndex}`);
      }
      flipSettleTimeout = window.setTimeout(
        () => {
          setIsRoundTransitioning(true);
          promoteTimeout = window.setTimeout(() => {
            if (promoteQueuedRound()) {
              terminalReachedAtRef.current = undefined;
              setTableFlipTransitionKey(undefined);
            }
            clearFadeTimeout = window.setTimeout(() => {
              setIsRoundTransitioning(false);
            }, infiniteRoundFadeMs);
          }, infiniteRoundSwapMs);
        },
        prefersReducedMotion ? 0 : infiniteRoundFlipTransitionDelayMs(),
      );
    }, remainingHoldMs);

    return () => {
      window.clearTimeout(transitionTimeout);
      if (flipSettleTimeout !== undefined) {
        window.clearTimeout(flipSettleTimeout);
      }
      if (promoteTimeout !== undefined) {
        window.clearTimeout(promoteTimeout);
      }
      if (clearFadeTimeout !== undefined) {
        window.clearTimeout(clearFadeTimeout);
      }
    };
  }, [
    eventIndex,
    hasQueuedNextRound,
    isAtRoundEnd,
    runtimeOptions.isScreenSaver,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.preloadEnabled,
    prefersReducedMotion,
    promoteQueuedRound,
    roundKey,
  ]);

  useEffect(() => {
    if (
      !runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      !runtimeOptions.preloadEnabled ||
      !runtimeOptions.nativeFrameDriverEnabled ||
      !isAtRoundEnd ||
      !hasQueuedNextRound ||
      terminalReachedAtRef.current === undefined
    ) {
      return;
    }

    const holdMs = infiniteRoundHoldMs;
    const flipDelayMs =
      prefersReducedMotion || !runtimeOptions.tableFlipTransitionsEnabled
        ? 0
        : infiniteRoundFlipTransitionDelayMs();
    const promotionDelayMs = holdMs + flipDelayMs;
    const flipKey = `${roundKey}:${eventIndex}`;
    let startedAtMs: number | undefined;
    let didStartFlip = false;
    let didPromote = false;

    const handleNativeFrame = (event: Event) => {
      if (didPromote) {
        return;
      }
      const timestampMs = screenSaverFrameTimestampFromEvent(
        event,
        performance.now(),
      );
      startedAtMs ??= timestampMs;
      const elapsedMs = timestampMs - startedAtMs;
      if (
        !didStartFlip &&
        elapsedMs >= holdMs &&
        runtimeOptions.tableFlipTransitionsEnabled &&
        !prefersReducedMotion
      ) {
        didStartFlip = true;
        setTableFlipTransitionKey(flipKey);
      }
      if (elapsedMs < promotionDelayMs) {
        return;
      }

      didPromote = true;
      if (promoteQueuedRound()) {
        terminalReachedAtRef.current = undefined;
        setTableFlipTransitionKey(undefined);
      }
    };

    window.addEventListener(screenSaverFrameEventName, handleNativeFrame);
    return () => {
      window.removeEventListener(screenSaverFrameEventName, handleNativeFrame);
    };
  }, [
    eventIndex,
    hasQueuedNextRound,
    isAtRoundEnd,
    prefersReducedMotion,
    promoteQueuedRound,
    roundKey,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.isScreenSaver,
    runtimeOptions.nativeFrameDriverEnabled,
    runtimeOptions.preloadEnabled,
    runtimeOptions.tableFlipTransitionsEnabled,
  ]);

  useEffect(() => {
    if (
      !runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      !runtimeOptions.preloadEnabled ||
      runtimeOptions.nativeFrameDriverEnabled ||
      !isAtRoundEnd ||
      !hasQueuedNextRound ||
      terminalReachedAtRef.current === undefined
    ) {
      return;
    }

    const holdMs = infiniteRoundHoldMs;
    const flipDelayMs =
      prefersReducedMotion || !runtimeOptions.tableFlipTransitionsEnabled
        ? 0
        : infiniteRoundFlipTransitionDelayMs();
    let flipTimeout: number | undefined;
    let promoteTimeout: number | undefined;

    flipTimeout = window.setTimeout(() => {
      flipTimeout = undefined;
      if (runtimeOptions.tableFlipTransitionsEnabled && !prefersReducedMotion) {
        setTableFlipTransitionKey(`${roundKey}:${eventIndex}`);
      }
      promoteTimeout = window.setTimeout(() => {
        promoteTimeout = undefined;
        if (promoteQueuedRound()) {
          terminalReachedAtRef.current = undefined;
          setTableFlipTransitionKey(undefined);
        }
      }, flipDelayMs);
    }, holdMs);

    return () => {
      if (flipTimeout !== undefined) {
        window.clearTimeout(flipTimeout);
      }
      if (promoteTimeout !== undefined) {
        window.clearTimeout(promoteTimeout);
      }
    };
  }, [
    eventIndex,
    hasQueuedNextRound,
    isAtRoundEnd,
    prefersReducedMotion,
    promoteQueuedRound,
    roundKey,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.isScreenSaver,
    runtimeOptions.nativeFrameDriverEnabled,
    runtimeOptions.preloadEnabled,
    runtimeOptions.tableFlipTransitionsEnabled,
  ]);

  useEffect(() => {
    if (
      runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      prefersReducedMotion ||
      isLoadingRound ||
      generationError ||
      events.length === 0
    ) {
      return;
    }

    const nextEvent = events[eventIndex + 1];
    if (!nextEvent) {
      return;
    }

    const currentEvent = events[eventIndex];
    const delay = eventAutoAdvanceDelay(currentEvent, nextEvent);
    const timeout = window.setTimeout(() => stepEvent(1), delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    eventIndex,
    events,
    generationError,
    runtimeOptions.isScreenSaver,
    runtimeOptions.isPlaybackActive,
    isLoadingRound,
    prefersReducedMotion,
    stepEvent,
  ]);

  useEffect(() => {
    if (
      !runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      !runtimeOptions.nativeFrameDriverEnabled ||
      prefersReducedMotion ||
      isLoadingRound ||
      generationError ||
      events.length === 0
    ) {
      return;
    }

    const nextEvent = events[eventIndex + 1];
    if (!nextEvent) {
      return;
    }

    const currentEvent = events[eventIndex];
    const delay = eventAutoAdvanceDelay(currentEvent, nextEvent);
    let deadlineMs: number | undefined;
    let didAdvance = false;

    const handleNativeFrame = (event: Event) => {
      if (didAdvance) {
        return;
      }
      const timestampMs = screenSaverFrameTimestampFromEvent(
        event,
        performance.now(),
      );
      deadlineMs ??= timestampMs + delay;
      if (timestampMs < deadlineMs) {
        return;
      }

      didAdvance = true;
      stepEventImmediate(1);
    };

    window.addEventListener(screenSaverFrameEventName, handleNativeFrame);
    return () => {
      window.removeEventListener(screenSaverFrameEventName, handleNativeFrame);
    };
  }, [
    eventIndex,
    events,
    generationError,
    runtimeOptions.isScreenSaver,
    runtimeOptions.isPlaybackActive,
    isLoadingRound,
    runtimeOptions.nativeFrameDriverEnabled,
    prefersReducedMotion,
    stepEventImmediate,
  ]);

  useEffect(() => {
    if (
      !runtimeOptions.isScreenSaver ||
      !runtimeOptions.isPlaybackActive ||
      runtimeOptions.nativeFrameDriverEnabled ||
      prefersReducedMotion ||
      isLoadingRound ||
      generationError ||
      events.length === 0
    ) {
      return;
    }

    const nextEvent = events[eventIndex + 1];
    if (!nextEvent) {
      return;
    }

    const currentEvent = events[eventIndex];
    const delay = eventAutoAdvanceDelay(currentEvent, nextEvent);
    const timeout = window.setTimeout(() => stepEventImmediate(1), delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    eventIndex,
    events,
    generationError,
    runtimeOptions.isScreenSaver,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.nativeFrameDriverEnabled,
    isLoadingRound,
    prefersReducedMotion,
    stepEventImmediate,
  ]);

  return (
    <main
      className={
        runtimeOptions.isScreenSaver
          ? "sim-shell screensaver-shell"
          : "sim-shell"
      }
    >
      {showGenerationPill && (
        <section
          className={
            generationError ? "generation-pill error" : "generation-pill"
          }
          aria-live="polite"
        >
          {generationError
            ? `Could not generate ${pendingSeed}: ${generationError}`
            : `Generating ${pendingSeed}...`}
        </section>
      )}
      <Suspense
        fallback={
          <section
            className="three-viewer loading"
            aria-label="Loading 3D view"
          >
            Loading 3D view...
          </section>
        }
      >
        <ThreeGameView
          replay={replay}
          previousReplay={previousReplay}
          currentEvent={currentEvent}
          nextEvent={nextEvent}
          eventIndex={eventIndex}
          roundKey={roundKey}
          loading={isLoadingRound}
          simulatorMode
          cameraAutoRotate={
            runtimeOptions.isSurfaceActive && !prefersReducedMotion
          }
          cameraUserControlled={
            runtimeOptions.isScreenSaver ? false : isCameraUserControlled
          }
          onCameraUserControlChange={
            runtimeOptions.isScreenSaver ? undefined : setIsCameraUserControlled
          }
          renderPaused={renderPaused}
          renderDpr={runtimeOptions.renderDpr}
          pointerControlsEnabled={!runtimeOptions.isScreenSaver}
          audioEnabled={!runtimeOptions.isScreenSaver}
          sceneReadyMode={runtimeOptions.isScreenSaver ? "timer" : "raf"}
          screenSaverFrameDriver={runtimeOptions.nativeFrameDriverEnabled}
          allowInitialRenderWhilePaused={
            runtimeOptions.allowInitialRenderWhilePaused
          }
          suppressLoadingOverlay={isRoundTransitioning}
          preserveSceneOnRoundChange={isRoundTransitioning}
          tableFlipTransitionKey={
            prefersReducedMotion || !runtimeOptions.tableFlipTransitionsEnabled
              ? undefined
              : tableFlipTransitionKey
          }
          sceneTransitionOverlayActive={isRoundTransitioning}
        />
      </Suspense>
      {!runtimeOptions.isScreenSaver ? (
        <>
          <MacDownloadCallout autoHide={!areOverlayControlsVisible} />
          <InfoPopover
            seed={roundKey}
            showSeed={debugRoutesEnabled}
            links={[
              ...debugRouteLinks(roundKey, ["debug", "debug-table-flip"]),
            ]}
            showAutoOrbitButton={isCameraUserControlled}
            onAutoOrbitButtonClick={() => setIsCameraUserControlled(false)}
            autoHide={!areOverlayControlsVisible}
          />
        </>
      ) : null}
      {showPerfPanel ? (
        <PerfPanel
          seed={roundKey}
          eventIndex={eventIndex}
          eventCount={events.length}
          viewMode="sim"
        />
      ) : null}
    </main>
  );
}

function MacDownloadCallout({ autoHide = false }: { autoHide?: boolean }) {
  const [hasOverlayFocus, setHasOverlayFocus] = useState(false);
  const shouldHideOverlay = autoHide && !hasOverlayFocus;

  return (
    <aside
      className={
        shouldHideOverlay
          ? "mac-download-callout is-hidden"
          : "mac-download-callout"
      }
      aria-label="Download macOS screen saver"
      onFocusCapture={() => setHasOverlayFocus(true)}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setHasOverlayFocus(false);
        }
      }}
    >
      <span className="screensaver-download-tooltip-wrap">
        <a
          href={macScreenSaverDownloadHref}
          aria-label={`Download macOS DMG. ${macScreenSaverDownloadWarning}`}
        >
          <Download size={14} aria-hidden="true" />
          Get the macOS screen saver
        </a>
        <MacScreenSaverDownloadWarningTooltip />
      </span>
    </aside>
  );
}

function useScreenPointerActivity(
  inactiveDelayMs: number,
  mouseLeaveDelayMs: number,
  enabled = true,
): boolean {
  const [isActive, setIsActive] = useState(() => {
    if (!enabled) {
      return false;
    }
    return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });

  useEffect(() => {
    if (!enabled) {
      setIsActive(false);
      return;
    }
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    let inactivityTimeout: number | undefined;

    function clearInactivityTimeout() {
      if (inactivityTimeout !== undefined) {
        window.clearTimeout(inactivityTimeout);
        inactivityTimeout = undefined;
      }
    }

    function deactivate(delayMs = 0) {
      clearInactivityTimeout();
      if (hoverQuery.matches) {
        if (delayMs > 0) {
          inactivityTimeout = window.setTimeout(() => {
            inactivityTimeout = undefined;
            setIsActive(false);
          }, delayMs);
        } else {
          setIsActive(false);
        }
      }
    }

    function activate() {
      if (!hoverQuery.matches) {
        setIsActive(true);
        return;
      }

      setIsActive(true);
      clearInactivityTimeout();
      inactivityTimeout = window.setTimeout(() => {
        inactivityTimeout = undefined;
        setIsActive(false);
      }, inactiveDelayMs);
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        activate();
      }
    }

    function handleMouseOut(event: MouseEvent) {
      if (event.relatedTarget === null) {
        deactivate(mouseLeaveDelayMs);
      }
    }

    function handleHoverCapabilityChange() {
      if (hoverQuery.matches) {
        deactivate();
      } else {
        setIsActive(true);
      }
    }

    handleHoverCapabilityChange();
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("mouseout", handleMouseOut);
    hoverQuery.addEventListener("change", handleHoverCapabilityChange);

    return () => {
      clearInactivityTimeout();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mouseout", handleMouseOut);
      hoverQuery.removeEventListener("change", handleHoverCapabilityChange);
    };
  }, [enabled, inactiveDelayMs, mouseLeaveDelayMs]);

  return isActive;
}

function useScreenSaverLifecycle(
  config: ScreenSaverSurfaceConfig | undefined,
): ScreenSaverLifecycle {
  const [lifecycle, setLifecycle] = useState(() =>
    initialScreenSaverLifecycle(config),
  );

  useEffect(() => {
    if (!config) {
      window.mahjongScreenSaver = undefined;
      return;
    }

    const bridge: ScreenSaverBridge = {
      setActive(active) {
        window.__mahjongScreenSaverNativeState = {
          ...window.__mahjongScreenSaverNativeState,
          active,
        };
        setLifecycle((current) => ({ ...current, active }));
      },
      setPreview(preview) {
        window.__mahjongScreenSaverNativeState = {
          ...window.__mahjongScreenSaverNativeState,
          preview,
        };
        setLifecycle((current) => ({ ...current, preview }));
      },
      renderFrame(timestampMs) {
        window.dispatchEvent(
          new CustomEvent<ScreenSaverFrameEventDetail>(
            screenSaverFrameEventName,
            {
              detail: { timestampMs },
            },
          ),
        );
      },
    };
    window.mahjongScreenSaver = bridge;

    return () => {
      if (window.mahjongScreenSaver === bridge) {
        window.mahjongScreenSaver = undefined;
      }
    };
  }, [config]);

  return lifecycle;
}

function useDocumentHidden(): boolean {
  const [isHidden, setIsHidden] = useState(() => document.hidden);

  useEffect(() => {
    function syncVisibility() {
      setIsHidden(document.hidden);
    }

    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  return isHidden;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  return prefersReducedMotion;
}

function InfoPopover({
  seed,
  links,
  showSeed = false,
  showAutoOrbitButton = false,
  onAutoOrbitButtonClick,
  autoHide = false,
}: {
  seed: string;
  links?: readonly InfoModalLink[];
  showSeed?: boolean;
  showAutoOrbitButton?: boolean;
  onAutoOrbitButtonClick?: () => void;
  autoHide?: boolean;
}) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [hasOverlayFocus, setHasOverlayFocus] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const infoModalRef = useRef<HTMLElement | null>(null);
  const shouldHideOverlay = autoHide && !isInfoOpen && !hasOverlayFocus;

  useEffect(() => {
    if (!isInfoOpen) {
      return;
    }

    function dismissInfoOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        infoModalRef.current?.contains(event.target) ||
        infoButtonRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsInfoOpen(false);
    }

    document.addEventListener("pointerdown", dismissInfoOnOutsideClick);
    return () => {
      document.removeEventListener("pointerdown", dismissInfoOnOutsideClick);
    };
  }, [isInfoOpen]);

  return (
    <div
      className={
        shouldHideOverlay
          ? "info-popover-controls is-hidden"
          : "info-popover-controls"
      }
      onFocusCapture={() => setHasOverlayFocus(true)}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setHasOverlayFocus(false);
        }
      }}
    >
      {showAutoOrbitButton && (
        <button
          type="button"
          className="info-button auto-orbit-button"
          aria-label="Resume auto orbit"
          title="Resume auto orbit"
          onClick={onAutoOrbitButtonClick}
        >
          <Orbit size={15} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className="info-button"
        ref={infoButtonRef}
        aria-label="About this simulator"
        title="About this simulator"
        onClick={() => setIsInfoOpen((open) => !open)}
      >
        <Info size={15} aria-hidden="true" />
      </button>

      {isInfoOpen && (
        <InfoModal
          modalRef={infoModalRef}
          seed={seed}
          showSeed={showSeed}
          links={links}
        />
      )}
    </div>
  );
}

function RoundLoadingView({ mode }: { mode: "debug" | "three" }) {
  return (
    <section
      className={mode === "three" ? "three-viewer loading" : "round-loading"}
      aria-label="Loading round"
      aria-live="polite"
    >
      Loading...
    </section>
  );
}
