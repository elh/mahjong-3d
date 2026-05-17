import {
  ChevronLeft,
  ChevronRight,
  Info,
  Orbit,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import type { GameEvent } from "./sim/events";
import { replayEvents } from "./sim/replay";
import { EventLog } from "./ui/EventLog";
import { eventDetail, eventTitle } from "./ui/eventText";
import { InfoModal } from "./ui/InfoModal";
import type { InfoModalLink } from "./ui/InfoModal";
import {
  infiniteRoundFadeMs,
  infiniteRoundFlipTransitionDelayMs,
  infiniteRoundHoldMs,
  infiniteRoundSwapMs,
  nextRoundPromotionDelayMs,
} from "./ui/infinitePlayback";
import { PerfPanel } from "./ui/PerfPanel";
import { playerNames } from "./ui/playerNames";
import {
  initialScreenSaverLifecycle,
  postScreenSaverDiagnostic,
  screenSaverFrameEventName,
  screenSaverFrameTimestampFromEvent,
  screenSaverRuntimeOptions,
  screenSaverSurfaceFromSearch,
  type ScreenSaverFrameEventDetail,
  type ScreenSaverBridge,
  type ScreenSaverLifecycle,
  type ScreenSaverSurfaceConfig,
} from "./ui/screenSaverSurface";
import { TileGroup } from "./ui/TileGroup";
import { useSimulationController } from "./ui/useSimulationController";

declare const __DEBUG_MODE_ENABLED__: boolean;

declare global {
  interface Window {
    mahjongScreenSaver?: ScreenSaverBridge;
    __mahjongScreenSaverNativeState?: Partial<ScreenSaverLifecycle>;
    __mahjongScreenSaverNativeFrameCount?: number;
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
 * - surface=screensaver-r3f-diagnostic: minimal R3F screen saver probe.
 * - preview=1: lower-cost System Settings screen saver preview.
 * - view=debug | debug-table-flip: debug-only routes, enabled by passing DEBUG.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const screenSaverSurface = screenSaverSurfaceFromSearch(
    window.location.search,
  );
  if (screenSaverSurface?.surface === "screensaver-diagnostic") {
    return <ScreenSaverDiagnosticApp screenSaver={screenSaverSurface} />;
  }
  if (screenSaverSurface?.surface === "screensaver-r3f-diagnostic") {
    return <ScreenSaverR3FDiagnosticApp screenSaver={screenSaverSurface} />;
  }
  if (screenSaverSurface) {
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
  const showScreenSaverDebugProbes = false;
  const showPerfPanel = !runtimeOptions.isScreenSaver && perfPanelEnabled();
  const showGenerationPill =
    !runtimeOptions.isScreenSaver && (isGenerating || generationError);

  useEffect(() => {
    if (!runtimeOptions.isScreenSaver) {
      return;
    }
    postScreenSaverDiagnostic(
      [
        "app",
        `active=${runtimeOptions.isPlaybackActive}`,
        `lifecycleActive=${runtimeOptions.isSurfaceActive}`,
        `preview=${runtimeOptions.isPreview}`,
        `generating=${isGenerating}`,
        `error=${generationError ?? "none"}`,
        `events=${events.length}`,
        `eventIndex=${eventIndex}`,
        `renderPaused=${renderPaused}`,
      ].join(" "),
    );
  }, [
    eventIndex,
    events.length,
    generationError,
    isGenerating,
    runtimeOptions.isPreview,
    runtimeOptions.isPlaybackActive,
    runtimeOptions.isScreenSaver,
    runtimeOptions.isSurfaceActive,
    renderPaused,
  ]);

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
        postScreenSaverDiagnostic(
          `app nativeTerminalFlip key=${flipKey} seed=${roundKey}`,
        );
      }
      if (elapsedMs < promotionDelayMs) {
        return;
      }

      didPromote = true;
      if (promoteQueuedRound()) {
        terminalReachedAtRef.current = undefined;
        setTableFlipTransitionKey(undefined);
        postScreenSaverDiagnostic(`app nativePromote seed=${roundKey}`);
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

      postScreenSaverDiagnostic(
        [
          "app nativeAdvance",
          `eventIndex=${eventIndex}`,
          `next=${eventIndex + 1}`,
          `delay=${delay}`,
        ].join(" "),
      );
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
          screenSaverFrameDriver={runtimeOptions.isScreenSaver}
          allowInitialRenderWhilePaused={
            runtimeOptions.allowInitialRenderWhilePaused
          }
          debugProbes={showScreenSaverDebugProbes}
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
      {showScreenSaverDebugProbes ? (
        <>
          <ScreenSaverCanvas2DProbe />
          <ScreenSaverRawWebGlProbe />
          <section className="screensaver-debug-overlay" aria-live="polite">
            <strong>Mahjong 3D probe</strong>
            <span>
              active={String(runtimeOptions.isPlaybackActive)} lifecycle=
              {String(runtimeOptions.isSurfaceActive)} preview=
              {String(runtimeOptions.isPreview)}
            </span>
            <span>
              events={events.length} event={eventIndex} renderPaused=
              {String(renderPaused)}
            </span>
            <span>round={roundKey}</span>
          </section>
        </>
      ) : null}
      {!runtimeOptions.isScreenSaver ? (
        <InfoPopover
          seed={roundKey}
          links={debugRouteLinks(roundKey, ["debug", "debug-table-flip"])}
          showAutoOrbitButton={isCameraUserControlled}
          onAutoOrbitButtonClick={() => setIsCameraUserControlled(false)}
          autoHide={!areOverlayControlsVisible}
        />
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

function ScreenSaverCanvas2DProbe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      postScreenSaverDiagnostic("probe2d unavailable");
      return;
    }

    let frame = 0;
    let animationFrame: number | undefined;
    const draw = () => {
      frame += 1;
      const scale = window.devicePixelRatio || 1;
      const width = 220;
      const height = 130;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = "#101014";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#ff2bd6";
      context.fillRect(12, 12, 64, 64);
      context.fillStyle = "#55f0ff";
      context.fillRect(84, 12, 64, 64);
      context.fillStyle = "#fff06a";
      context.fillRect(156, 12, 52, 64);
      context.fillStyle = "#ffffff";
      context.font = "14px ui-monospace, Menlo, monospace";
      context.fillText(`2d canvas ${frame}`, 12, 104);
      if (frame === 1 || frame % 60 === 0) {
        postScreenSaverDiagnostic(`probe2d frame=${frame}`);
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="screensaver-canvas2d-probe" />;
}

function ScreenSaverRawWebGlProbe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!canvas || !context) {
      postScreenSaverDiagnostic("probeWebGl unavailable");
      return;
    }

    const vertexShader = compileProbeShader(
      context,
      context.VERTEX_SHADER,
      "attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }",
    );
    const fragmentShader = compileProbeShader(
      context,
      context.FRAGMENT_SHADER,
      "precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.15, 0.84, 1.0); }",
    );
    if (!vertexShader || !fragmentShader) {
      postScreenSaverDiagnostic("probeWebGl shader failed");
      return;
    }

    const program = context.createProgram();
    if (!program) {
      postScreenSaverDiagnostic("probeWebGl program failed");
      return;
    }
    context.attachShader(program, vertexShader);
    context.attachShader(program, fragmentShader);
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      postScreenSaverDiagnostic(
        `probeWebGl link failed ${context.getProgramInfoLog(program) ?? ""}`,
      );
      return;
    }

    const buffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-0.86, -0.72, 0.86, -0.72, 0, 0.78]),
      context.STATIC_DRAW,
    );
    const position = context.getAttribLocation(program, "position");
    let frame = 0;
    let animationFrame: number | undefined;
    const draw = () => {
      frame += 1;
      const scale = window.devicePixelRatio || 1;
      const width = 220;
      const height = 130;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.viewport(0, 0, canvas.width, canvas.height);
      context.clearColor(0.05, 0.05, 0.08, 1);
      context.clear(context.COLOR_BUFFER_BIT);
      context["useProgram"](program);
      context.enableVertexAttribArray(position);
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
      context.drawArrays(context.TRIANGLES, 0, 3);
      if (frame === 1 || frame % 60 === 0) {
        const pixels = new Uint8Array(4);
        context.readPixels(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        postScreenSaverDiagnostic(
          `probeWebGl frame=${frame} pixel=${Array.from(pixels).join(",")}`,
        );
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      context.deleteBuffer(buffer);
      context.deleteProgram(program);
      context.deleteShader(vertexShader);
      context.deleteShader(fragmentShader);
    };
  }, []);

  return <canvas ref={canvasRef} className="screensaver-webgl-probe" />;
}

function compileProbeShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | undefined {
  const shader = gl.createShader(type);
  if (!shader) {
    return undefined;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    postScreenSaverDiagnostic(
      `probeWebGl compile failed ${gl.getShaderInfoLog(shader) ?? ""}`,
    );
    gl.deleteShader(shader);
    return undefined;
  }
  return shader;
}

function ScreenSaverR3FDiagnosticApp({
  screenSaver,
}: {
  screenSaver: ScreenSaverSurfaceConfig;
}) {
  const screenSaverLifecycle = useScreenSaverLifecycle(screenSaver);
  const startedAt = useRef(Date.now());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    postScreenSaverDiagnostic(
      [
        "r3fDiagnostic app",
        `active=${screenSaverLifecycle.active}`,
        `preview=${screenSaverLifecycle.preview}`,
        `tick=${tick}`,
      ].join(" "),
    );
  }, [screenSaverLifecycle.active, screenSaverLifecycle.preview, tick]);

  useEffect(() => {
    if (!screenSaverLifecycle.active && screenSaverLifecycle.preview) {
      return;
    }
    const interval = window.setInterval(
      () => setTick((value) => value + 1),
      500,
    );
    return () => window.clearInterval(interval);
  }, [screenSaverLifecycle.active, screenSaverLifecycle.preview]);

  const seconds = Math.floor((Date.now() - startedAt.current) / 1000);

  return (
    <main className="sim-shell screensaver-r3f-diagnostic-shell">
      <R3FDiagnosticCanvas
        className="screensaver-r3f-diagnostic-canvas"
        label="fullscreen"
      />
      <R3FDiagnosticCanvas
        className="screensaver-r3f-diagnostic-mini-canvas"
        label="mini"
      />
      <section className="screensaver-debug-overlay" aria-live="polite">
        <strong>R3F diagnostic</strong>
        <span>
          active={String(screenSaverLifecycle.active)} preview=
          {String(screenSaverLifecycle.preview)} tick={tick} t={seconds}s
        </span>
      </section>
    </main>
  );
}

function R3FDiagnosticCanvas({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <Canvas
      className={className}
      dpr={[1, 1]}
      frameloop="never"
      gl={{
        alpha: false,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      }}
      camera={{
        position: [0, 0, 4],
        fov: 42,
        near: 0.1,
        far: 100,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor("#101514", 1);
        const context = gl.getContext();
        const contextKind =
          typeof WebGL2RenderingContext !== "undefined" &&
          context instanceof WebGL2RenderingContext
            ? "webgl2"
            : "webgl1";
        postScreenSaverDiagnostic(
          [
            "r3fDiagnostic renderer",
            `label=${label}`,
            `context=${contextKind}`,
            `size=${gl.domElement.width}x${gl.domElement.height}`,
            `client=${gl.domElement.clientWidth}x${gl.domElement.clientHeight}`,
          ].join(" "),
        );
      }}
    >
      <color attach="background" args={["#101514"]} />
      <R3FDiagnosticCube />
      <R3FDiagnosticForcedRenderLoop label={label} />
    </Canvas>
  );
}

function R3FDiagnosticCube() {
  const meshRef = useRef<THREE.Mesh | null>(null);

  return (
    <group>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshBasicMaterial color="#ff2bd6" toneMapped={false} />
      </mesh>
      <mesh position={[1.25, 0.8, -0.2]} rotation={[0, 0, Math.PI / 4]}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial
          color="#fff06a"
          side={THREE.DoubleSide}
          toneMapped={false}
          wireframe
        />
      </mesh>
      <mesh position={[-1.25, -0.85, 0.1]}>
        <sphereGeometry args={[0.42, 24, 16]} />
        <meshBasicMaterial color="#55f0ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function R3FDiagnosticForcedRenderLoop({ label }: { label: string }) {
  const { camera, gl, scene, size } = useThree();
  const frameRef = useRef(0);
  const lastNativeFrameAtRef = useRef(0);

  useEffect(() => {
    const cube = scene.children
      .flatMap((child) => ("children" in child ? child.children : []))
      .find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
    const startedAt = performance.now();

    const render = (timestampMs: number, source: "native" | "fallback") => {
      frameRef.current += 1;
      const elapsedSeconds = (timestampMs - startedAt) / 1000;
      if (cube) {
        cube.rotation.x = elapsedSeconds * 0.8;
        cube.rotation.y = elapsedSeconds * 1.1;
      }

      gl.render(scene, camera);
      if (frameRef.current === 1 || frameRef.current % 30 === 0) {
        const context = gl.getContext();
        const pixels = new Uint8Array(4);
        context.readPixels(
          Math.floor(gl.domElement.width / 2),
          Math.floor(gl.domElement.height / 2),
          1,
          1,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        postScreenSaverDiagnostic(
          [
            "r3fDiagnostic forcedPixel",
            `label=${label}`,
            `frame=${frameRef.current}`,
            `source=${source}`,
            `size=${Math.round(size.width)}x${Math.round(size.height)}`,
            `canvas=${gl.domElement.width}x${gl.domElement.height}`,
            `pixel=${Array.from(pixels).join(",")}`,
          ].join(" "),
        );
      }
    };

    const handleNativeFrame = (event: Event) => {
      const timestampMs = screenSaverFrameTimestampFromEvent(
        event,
        performance.now(),
      );
      lastNativeFrameAtRef.current = performance.now();
      render(timestampMs, "native");
    };
    const renderFallback = () => {
      if (performance.now() - lastNativeFrameAtRef.current > 500) {
        render(performance.now(), "fallback");
      }
    };

    render(performance.now(), "fallback");
    window.addEventListener(screenSaverFrameEventName, handleNativeFrame);
    const interval = window.setInterval(renderFallback, 1000 / 30);
    return () => {
      window.removeEventListener(screenSaverFrameEventName, handleNativeFrame);
      window.clearInterval(interval);
    };
  }, [camera, gl, label, scene, size.height, size.width]);

  return null;
}

function ScreenSaverDiagnosticApp({
  screenSaver,
}: {
  screenSaver: ScreenSaverSurfaceConfig;
}) {
  const screenSaverLifecycle = useScreenSaverLifecycle(screenSaver);
  const startedAt = useRef(Date.now());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    postScreenSaverDiagnostic(
      [
        "diagnostic",
        `active=${screenSaverLifecycle.active}`,
        `preview=${screenSaverLifecycle.preview}`,
        `tick=${tick}`,
      ].join(" "),
    );
  }, [screenSaverLifecycle.active, screenSaverLifecycle.preview, tick]);

  useEffect(() => {
    if (!screenSaverLifecycle.active) {
      return;
    }
    const interval = window.setInterval(
      () => setTick((value) => value + 1),
      500,
    );
    return () => window.clearInterval(interval);
  }, [screenSaverLifecycle.active]);

  const seconds = Math.floor((Date.now() - startedAt.current) / 1000);

  return (
    <main className="sim-shell screensaver-diagnostic-shell">
      <div className="screensaver-diagnostic-orbit" />
      <div className="screensaver-diagnostic-panel">
        <strong>Mahjong 3D</strong>
        <span>
          active={String(screenSaverLifecycle.active)} preview=
          {String(screenSaverLifecycle.preview)} tick={tick} t={seconds}s
        </span>
      </div>
    </main>
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
  showAutoOrbitButton = false,
  onAutoOrbitButtonClick,
  autoHide = false,
}: {
  seed: string;
  links?: readonly InfoModalLink[];
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
        <InfoModal modalRef={infoModalRef} seed={seed} links={links} />
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
