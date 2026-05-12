import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimulateRoundResult } from "../sim/engine";
import type { GameEvent } from "../sim/events";
import { replayEvents } from "../sim/replay";
import type {
  SimulationRequest,
  SimulationResponse,
} from "../sim/simulationWorker";

export type EventGroup = {
  id: string;
  phase: "setup" | "turn";
  label: string;
  events: { event: GameEvent; index: number }[];
};

type QueuedRound = {
  seed: string;
  result: SimulateRoundResult;
};

export function useSimulationController({
  initialEvent = "first-turn",
  syncSeedToUrl = true,
}: {
  initialEvent?: "first-setup-draw" | "first-turn";
  syncSeedToUrl?: boolean;
} = {}) {
  const initialSeed = useMemo(() => seedFromUrlOrRandom(), []);
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [pendingSeed, setPendingSeed] = useState(initialSeed);
  const [game, setGame] = useState<SimulateRoundResult | undefined>();
  const [queuedRound, setQueuedRound] = useState<QueuedRound | undefined>();
  const [isPreloadingNextRound, setIsPreloadingNextRound] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [eventIndex, setEventIndex] = useState(0);
  const [isScrubbingEvent, setIsScrubbingEvent] = useState(false);
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const queuedRoundRef = useRef<QueuedRound | undefined>(undefined);
  const isPreloadingNextRoundRef = useRef(false);
  const holdDelayRef = useRef<number | undefined>(undefined);
  const holdIntervalRef = useRef<number | undefined>(undefined);
  const stepFrameRef = useRef<number | undefined>(undefined);
  const pendingStepDeltaRef = useRef(0);
  const scrubFrameRef = useRef<number | undefined>(undefined);
  const scrubIdleTimeoutRef = useRef<number | undefined>(undefined);
  const scrubEventIndexRef = useRef<number | undefined>(undefined);
  const suppressStepClickRef = useRef(false);
  const preloadRequestIdRef = useRef(0);
  const preloadWorkerRef = useRef<Worker | null>(null);
  const preloadRetryTimeoutRef = useRef<number | undefined>(undefined);
  const events = game?.events ?? [];
  const replay = useMemo(
    () => replayEvents(events, eventIndex),
    [events, eventIndex],
  );
  const currentEvent = events[eventIndex];
  const eventGroups = useMemo(() => groupEvents(events), [events]);
  const highlightedTileIds = useMemo(
    () => activeTileIds(currentEvent),
    [currentEvent],
  );
  const atStart = eventIndex === 0;
  const atEnd = eventIndex >= events.length - 1;
  const canStepPrevious = !atStart && events.length > 0;
  const canStepNext = !atEnd && events.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap and popstate wiring should be registered once for the app lifetime.
  useEffect(() => {
    queueSimulation(initialSeed, { replaceUrl: true });

    function syncSeedFromHistory() {
      const seed = seedFromUrlOrRandom();
      queueSimulation(seed, { replaceUrl: true });
    }

    window.addEventListener("popstate", syncSeedFromHistory);

    return () => {
      window.removeEventListener("popstate", syncSeedFromHistory);
      workerRef.current?.terminate();
      workerRef.current = null;
      preloadWorkerRef.current?.terminate();
      preloadWorkerRef.current = null;
      clearPreloadRetry();
      clearEventHold();
      clearPendingStep();
      clearEventScrub({ updateState: false });
    };
  }, []);

  function createSimulationWorker() {
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("../sim/simulationWorker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.onmessage = (event: MessageEvent<SimulationResponse>) => {
      if (event.data.requestId !== requestIdRef.current) {
        return;
      }

      if (event.data.status === "error") {
        setIsGenerating(false);
        setGenerationError(event.data.message);
        return;
      }

      setGenerationError(undefined);
      setGame(event.data.result);
      setEventIndex(initialEventIndex(event.data.result.events, initialEvent));
      setIsGenerating(false);
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    worker.onerror = () => {
      if (workerRef.current === worker) {
        setIsGenerating(false);
        setGenerationError("Simulation worker failed.");
      }
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    workerRef.current = worker;
    return worker;
  }

  function createPreloadWorker() {
    preloadWorkerRef.current?.terminate();
    const worker = new Worker(
      new URL("../sim/simulationWorker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.onmessage = (event: MessageEvent<SimulationResponse>) => {
      if (event.data.requestId !== preloadRequestIdRef.current) {
        return;
      }

      worker.terminate();
      if (preloadWorkerRef.current === worker) {
        preloadWorkerRef.current = null;
      }

      if (event.data.status === "error") {
        retryPreloadNextRound();
        return;
      }

      setQueuedPreloadRound({
        seed: event.data.result.seed,
        result: event.data.result,
      });
      setNextRoundPreloading(false);
    };
    worker.onerror = () => {
      worker.terminate();
      if (preloadWorkerRef.current === worker) {
        preloadWorkerRef.current = null;
      }
      retryPreloadNextRound();
    };
    preloadWorkerRef.current = worker;
    return worker;
  }

  const setQueuedPreloadRound = useCallback(
    (round: QueuedRound | undefined) => {
      queuedRoundRef.current = round;
      setQueuedRound(round);
    },
    [],
  );

  const setNextRoundPreloading = useCallback((isPreloading: boolean) => {
    isPreloadingNextRoundRef.current = isPreloading;
    setIsPreloadingNextRound(isPreloading);
  }, []);

  function startNextRoundPreload() {
    clearPreloadRetry();
    const seed = randomSeed();
    const requestId = preloadRequestIdRef.current + 1;
    preloadRequestIdRef.current = requestId;
    setNextRoundPreloading(true);
    const worker = createPreloadWorker();
    worker.postMessage({
      requestId,
      seed,
    } satisfies SimulationRequest);
  }

  function queueSimulation(
    seed: string,
    options: { replaceUrl?: boolean } = {},
  ) {
    const nextSeed = seed.trim() || randomSeed();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (syncSeedToUrl) {
      syncSeedQueryParam(nextSeed, options.replaceUrl ? "replace" : "push");
    }
    setSeedInput(nextSeed);
    setPendingSeed(nextSeed);
    setQueuedPreloadRound(undefined);
    setNextRoundPreloading(false);
    preloadWorkerRef.current?.terminate();
    preloadWorkerRef.current = null;
    clearPreloadRetry();
    setIsGenerating(true);
    setGenerationError(undefined);
    clearPendingStep();
    clearEventScrub();
    const worker = createSimulationWorker();
    worker.postMessage({
      requestId,
      seed: nextSeed,
    } satisfies SimulationRequest);
  }

  const clearPreloadRetry = useCallback(() => {
    if (preloadRetryTimeoutRef.current !== undefined) {
      window.clearTimeout(preloadRetryTimeoutRef.current);
      preloadRetryTimeoutRef.current = undefined;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: preload state is guarded through refs so retry callbacks never close over stale state.
  const preloadNextRound = useCallback(() => {
    if (queuedRoundRef.current || isPreloadingNextRoundRef.current) {
      return;
    }
    startNextRoundPreload();
  }, []);

  function retryPreloadNextRound() {
    setQueuedPreloadRound(undefined);
    setNextRoundPreloading(false);
    clearPreloadRetry();
    preloadRetryTimeoutRef.current = window.setTimeout(() => {
      preloadRetryTimeoutRef.current = undefined;
      if (!queuedRoundRef.current && !isPreloadingNextRoundRef.current) {
        startNextRoundPreload();
      }
    }, 800);
  }

  function newSeed() {
    queueSimulation(randomSeed());
  }

  function restart() {
    jumpToEventIndex(0);
  }

  function startTypedSeed() {
    const seed = seedInput.trim();
    if (!seed) {
      queueSimulation(randomSeed());
      return;
    }
    if (seed !== pendingSeed) {
      queueSimulation(seed);
    }
  }

  const clearEventScrub = useCallback(
    ({ updateState }: { updateState: boolean } = { updateState: true }) => {
      if (scrubFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrubFrameRef.current);
        scrubFrameRef.current = undefined;
      }
      if (scrubIdleTimeoutRef.current !== undefined) {
        window.clearTimeout(scrubIdleTimeoutRef.current);
        scrubIdleTimeoutRef.current = undefined;
      }
      scrubEventIndexRef.current = undefined;
      if (updateState) {
        setIsScrubbingEvent(false);
      }
    },
    [],
  );

  const clearPendingStep = useCallback(() => {
    if (stepFrameRef.current !== undefined) {
      window.cancelAnimationFrame(stepFrameRef.current);
      stepFrameRef.current = undefined;
    }
    pendingStepDeltaRef.current = 0;
  }, []);

  const promoteQueuedRound = useCallback(() => {
    if (!queuedRound) {
      return false;
    }
    clearPendingStep();
    clearEventScrub();
    clearPreloadRetry();
    setSeedInput(queuedRound.seed);
    setPendingSeed(queuedRound.seed);
    setGame(queuedRound.result);
    setEventIndex(initialEventIndex(queuedRound.result.events, initialEvent));
    setQueuedPreloadRound(undefined);
    setNextRoundPreloading(false);
    return true;
  }, [
    clearEventScrub,
    clearPendingStep,
    clearPreloadRetry,
    initialEvent,
    queuedRound,
    setNextRoundPreloading,
    setQueuedPreloadRound,
  ]);

  const stepEvent = useCallback(
    (direction: -1 | 1) => {
      clearEventScrub();
      pendingStepDeltaRef.current += direction;

      if (stepFrameRef.current !== undefined) {
        return;
      }

      stepFrameRef.current = window.requestAnimationFrame(() => {
        stepFrameRef.current = undefined;
        const delta = Math.sign(pendingStepDeltaRef.current);
        pendingStepDeltaRef.current = 0;
        if (delta === 0) {
          return;
        }
        setEventIndex((index) =>
          Math.min(Math.max(0, index + delta), Math.max(events.length - 1, 0)),
        );
      });
    },
    [events.length, clearEventScrub],
  );

  const jumpToEventIndex = useCallback(
    (index: number) => {
      clearPendingStep();
      clearEventScrub();
      setEventIndex(clampEventIndex(index, events.length));
    },
    [events.length, clearEventScrub, clearPendingStep],
  );

  function scrubToEventIndex(index: number) {
    clearPendingStep();
    scrubEventIndexRef.current = clampEventIndex(index, events.length);
    setIsScrubbingEvent(true);

    if (scrubFrameRef.current === undefined) {
      scrubFrameRef.current = window.requestAnimationFrame(() => {
        scrubFrameRef.current = undefined;
        const nextIndex = scrubEventIndexRef.current;
        scrubEventIndexRef.current = undefined;
        if (nextIndex !== undefined) {
          setEventIndex(nextIndex);
        }
      });
    }

    if (scrubIdleTimeoutRef.current !== undefined) {
      window.clearTimeout(scrubIdleTimeoutRef.current);
    }
    scrubIdleTimeoutRef.current = window.setTimeout(() => {
      scrubIdleTimeoutRef.current = undefined;
      setIsScrubbingEvent(false);
    }, 140);
  }

  function clearEventHold() {
    if (holdDelayRef.current !== undefined) {
      window.clearTimeout(holdDelayRef.current);
      holdDelayRef.current = undefined;
    }
    if (holdIntervalRef.current !== undefined) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = undefined;
    }
  }

  function cancelEventHold() {
    clearEventHold();
    suppressStepClickRef.current = false;
  }

  function startEventHold(direction: -1 | 1, enabled: boolean) {
    if (!enabled) {
      return;
    }
    suppressStepClickRef.current = true;
    clearEventHold();
    stepEvent(direction);
    holdDelayRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => {
        stepEvent(direction);
      }, 65);
    }, 280);
  }

  function clickStepButton(direction: -1 | 1) {
    if (suppressStepClickRef.current) {
      suppressStepClickRef.current = false;
      return;
    }
    stepEvent(direction);
  }

  return {
    seedInput,
    setSeedInput,
    pendingSeed,
    isGenerating,
    generationError,
    eventIndex,
    isScrubbingEvent,
    events,
    replay,
    currentEvent,
    eventGroups,
    highlightedTileIds,
    canStepPrevious,
    canStepNext,
    hasQueuedNextRound: queuedRound !== undefined,
    isPreloadingNextRound,
    newSeed,
    restart,
    startTypedSeed,
    preloadNextRound,
    promoteQueuedRound,
    stepEvent,
    jumpToEventIndex,
    scrubToEventIndex,
    clearEventHold,
    cancelEventHold,
    startEventHold,
    clickStepButton,
  };
}

function activeTileIds(event: GameEvent | undefined): ReadonlySet<string> {
  if (!event) {
    return new Set();
  }
  switch (event.type) {
    case "tileDrawn":
    case "tileDiscarded":
    case "flowerExposed":
    case "winDeclared":
      return new Set([event.tile.id]);
    case "tilesDrawn":
      return new Set(event.tiles.map((tile) => tile.id));
    case "claimMade":
      return new Set(event.tiles.map((tile) => tile.id));
    case "kongDeclared":
      return new Set(event.tiles.map((tile) => tile.id));
    case "addedKongDeclared":
      return new Set(event.tiles.map((tile) => tile.id));
    case "roundStarted":
    case "drawDeclared":
    case "rulesError":
      return new Set();
  }
}

function clampEventIndex(index: number, eventCount: number): number {
  return Math.min(Math.max(0, index), Math.max(eventCount - 1, 0));
}

function seedFromUrlOrRandom(): string {
  const seed = new URLSearchParams(window.location.search).get("seed")?.trim();
  return seed || randomSeed();
}

function randomSeed(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function syncSeedQueryParam(seed: string, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("seed") === seed) {
    return;
  }
  url.searchParams.set("seed", seed);
  window.history[mode === "replace" ? "replaceState" : "pushState"](
    null,
    "",
    url,
  );
}

function groupEvents(events: readonly GameEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  events.forEach((event, index) => {
    const group = groups.get(event.groupId) ?? {
      id: event.groupId,
      phase: event.phase,
      label:
        event.phase === "setup" ? "Initial deal" : `Turn ${event.turn + 1}`,
      events: [],
    };
    group.events.push({ event, index });
    groups.set(event.groupId, group);
  });
  return [...groups.values()];
}

function initialEventIndex(
  events: readonly GameEvent[],
  initialEvent: "first-setup-draw" | "first-turn",
): number {
  if (initialEvent === "first-setup-draw") {
    return firstSetupDrawEventIndex(events);
  }
  return firstTurnEventIndex(events);
}

function firstSetupDrawEventIndex(events: readonly GameEvent[]): number {
  const index = events.findIndex(
    (event) => event.phase === "setup" && event.type === "tilesDrawn",
  );
  return index === -1 ? 0 : index;
}

function firstTurnEventIndex(events: readonly GameEvent[]): number {
  const index = events.findIndex((event) => event.phase === "turn");
  return index === -1 ? 0 : index;
}
