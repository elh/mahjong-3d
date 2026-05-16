import {
  ChevronLeft,
  ChevronRight,
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
import { replayEvents } from "./sim/replay";
import { EventLog } from "./ui/EventLog";
import { eventDetail, eventTitle } from "./ui/eventText";
import { InfoModal } from "./ui/InfoModal";
import type { InfoModalLink } from "./ui/InfoModal";
import {
  infiniteRoundFadeMs,
  infiniteRoundFlipTransitionDelayMs,
  infiniteRoundSwapMs,
  nextRoundPromotionDelayMs,
} from "./ui/infinitePlayback";
import { PerfPanel } from "./ui/PerfPanel";
import { playerNames } from "./ui/playerNames";
import { TileGroup } from "./ui/TileGroup";
import { useSimulationController } from "./ui/useSimulationController";

declare const __DEBUG_ROUTES_ENABLED__: boolean;

const eventAdvanceDelayMs = 1200;
const setupEventAdvanceDelayMs = 800;
const turnBoundaryPauseMs = 100;
const overlayControlsInactiveDelayMs = 5000;
const overlayControlsMouseLeaveDelayMs = 3000;
const debugRoutesEnabled = __DEBUG_ROUTES_ENABLED__;

const ThreeGameView = lazy(() =>
  import("./ui/three/ThreeGameView").then((module) => ({
    default: module.ThreeGameView,
  })),
);

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
 * - view=debug | debug-table-flip: debug-only routes, enabled by passing DEBUG.
 */
export default function App() {
  const view = new URLSearchParams(window.location.search).get("view");
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

function SimApp() {
  const simulation = useSimulationController({
    syncSeedToUrl: false,
  });
  const isDocumentHidden = useDocumentHidden();
  const prefersReducedMotion = usePrefersReducedMotion();
  const areOverlayControlsVisible = useScreenPointerActivity(
    overlayControlsInactiveDelayMs,
    overlayControlsMouseLeaveDelayMs,
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
  const showPerfPanel = perfPanelEnabled();

  useEffect(() => {
    if (isLoadingRound || generationError || !isAtRoundEnd) {
      terminalReachedAtRef.current = undefined;
      setIsRoundTransitioning(false);
      setTableFlipTransitionKey(undefined);
      return;
    }

    terminalReachedAtRef.current ??= Date.now();
    preloadNextRound();
  }, [generationError, isAtRoundEnd, isLoadingRound, preloadNextRound]);

  useEffect(() => {
    if (
      isDocumentHidden ||
      !isAtRoundEnd ||
      !hasQueuedNextRound ||
      terminalReachedAtRef.current === undefined
    ) {
      return;
    }

    const remainingHoldMs = nextRoundPromotionDelayMs({
      isAtRoundEnd,
      hasQueuedNextRound,
      isDocumentHidden,
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
    isDocumentHidden,
    prefersReducedMotion,
    promoteQueuedRound,
    roundKey,
  ]);

  useEffect(() => {
    if (
      isDocumentHidden ||
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
    const isTurnBoundary =
      currentEvent?.groupId !== nextEvent.groupId && nextEvent.phase === "turn";
    const isSetupDrawPhase =
      currentEvent?.phase === "setup" || nextEvent.phase === "setup";
    const baseDelay = isSetupDrawPhase
      ? setupEventAdvanceDelayMs
      : eventAdvanceDelayMs;
    const delay = baseDelay + (isTurnBoundary ? turnBoundaryPauseMs : 0);
    const timeout = window.setTimeout(() => stepEvent(1), delay);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    eventIndex,
    events,
    generationError,
    isDocumentHidden,
    isLoadingRound,
    prefersReducedMotion,
    stepEvent,
  ]);

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
          roundKey={roundKey}
          loading={isLoadingRound}
          simulatorMode
          cameraAutoRotate={!prefersReducedMotion}
          cameraUserControlled={isCameraUserControlled}
          onCameraUserControlChange={setIsCameraUserControlled}
          renderPaused={isDocumentHidden}
          suppressLoadingOverlay={isRoundTransitioning}
          preserveSceneOnRoundChange={isRoundTransitioning}
          tableFlipTransitionKey={
            prefersReducedMotion ? undefined : tableFlipTransitionKey
          }
          sceneTransitionOverlayActive={isRoundTransitioning}
        />
      </Suspense>
      <InfoPopover
        seed={roundKey}
        links={debugRouteLinks(roundKey, ["debug", "debug-table-flip"])}
        showAutoOrbitButton={isCameraUserControlled}
        onAutoOrbitButtonClick={() => setIsCameraUserControlled(false)}
        autoHide={!areOverlayControlsVisible}
      />
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

function useScreenPointerActivity(
  inactiveDelayMs: number,
  mouseLeaveDelayMs: number,
): boolean {
  const [isActive, setIsActive] = useState(() => {
    return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });

  useEffect(() => {
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
  }, [inactiveDelayMs, mouseLeaveDelayMs]);

  return isActive;
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
