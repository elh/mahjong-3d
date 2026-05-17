import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimulateRoundResult } from "../sim/engine";
import type { GameEvent } from "../sim/events";
import { replayEvents } from "../sim/replay";
import { simulateRoundForSeed } from "../sim/runSimulation";
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
  syncSeedToUrl = true,
  defaultSeed,
  active = true,
  preloadEnabled = true,
  workerEnabled = true,
  workerFallbackEnabled = false,
}: {
  syncSeedToUrl?: boolean;
  defaultSeed?: string;
  active?: boolean;
  preloadEnabled?: boolean;
  workerEnabled?: boolean;
  workerFallbackEnabled?: boolean;
} = {}) {
  const initialSeed = useMemo(
    () => seedFromUrlOrRandom(defaultSeed),
    [defaultSeed],
  );
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
  const fallbackGenerationTimeoutRef = useRef<number | undefined>(undefined);
  const fallbackPreloadTimeoutRef = useRef<number | undefined>(undefined);
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
      const seed = seedFromUrlOrRandom(defaultSeed);
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
      clearFallbackGeneration();
      clearFallbackPreload();
      clearEventHold();
      clearPendingStep();
      clearEventScrub({ updateState: false });
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pause/resume is coordinated through refs and the current seed.
  useEffect(() => {
    if (!active) {
      workerRef.current?.terminate();
      workerRef.current = null;
      preloadWorkerRef.current?.terminate();
      preloadWorkerRef.current = null;
      clearPreloadRetry();
      clearFallbackGeneration();
      clearFallbackPreload();
      setNextRoundPreloading(false);
      setIsGenerating(false);
      return;
    }

    if (!game && !isGenerating) {
      queueSimulation(pendingSeed, { replaceUrl: true });
    }
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: preload cancellation uses refs and stable cleanup helpers.
  useEffect(() => {
    if (preloadEnabled) {
      return;
    }
    preloadWorkerRef.current?.terminate();
    preloadWorkerRef.current = null;
    clearPreloadRetry();
    clearFallbackPreload();
    setQueuedPreloadRound(undefined);
    setNextRoundPreloading(false);
  }, [preloadEnabled]);

  function createSimulationWorker(seed: string) {
    workerRef.current?.terminate();
    clearFallbackGeneration();
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
      clearFallbackGeneration();

      if (event.data.status === "error") {
        setIsGenerating(false);
        setGenerationError(event.data.message);
        return;
      }

      setGenerationError(undefined);
      setGame(event.data.result);
      setEventIndex(0);
      setIsGenerating(false);
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    worker.onerror = () => {
      clearFallbackGeneration();
      if (workerRef.current === worker) {
        if (workerFallbackEnabled) {
          startFallbackGeneration(requestIdRef.current, seed);
        } else {
          setIsGenerating(false);
          setGenerationError("Simulation worker failed.");
        }
      }
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    workerRef.current = worker;
    if (workerFallbackEnabled) {
      fallbackGenerationTimeoutRef.current = window.setTimeout(() => {
        fallbackGenerationTimeoutRef.current = undefined;
        if (workerRef.current !== worker) {
          return;
        }
        startFallbackGeneration(requestIdRef.current, seed);
      }, 1500);
    }
    return worker;
  }

  function createPreloadWorker(seed: string) {
    preloadWorkerRef.current?.terminate();
    clearFallbackPreload();
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
      clearFallbackPreload();

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
      clearFallbackPreload();
      worker.terminate();
      if (preloadWorkerRef.current === worker) {
        preloadWorkerRef.current = null;
      }
      if (workerFallbackEnabled) {
        startFallbackPreload(preloadRequestIdRef.current, seed);
      } else {
        retryPreloadNextRound();
      }
    };
    preloadWorkerRef.current = worker;
    if (workerFallbackEnabled) {
      fallbackPreloadTimeoutRef.current = window.setTimeout(() => {
        fallbackPreloadTimeoutRef.current = undefined;
        if (preloadWorkerRef.current !== worker) {
          return;
        }
        startFallbackPreload(preloadRequestIdRef.current, seed);
      }, 1500);
    }
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
    if (!active || !preloadEnabled) {
      return;
    }
    clearPreloadRetry();
    const seed = randomSeed();
    const requestId = preloadRequestIdRef.current + 1;
    preloadRequestIdRef.current = requestId;
    setNextRoundPreloading(true);
    if (!workerEnabled) {
      startFallbackPreload(requestId, seed);
      return;
    }

    try {
      const worker = createPreloadWorker(seed);
      worker.postMessage({
        requestId,
        seed,
      } satisfies SimulationRequest);
    } catch {
      if (workerFallbackEnabled) {
        startFallbackPreload(requestId, seed);
      } else {
        retryPreloadNextRound();
      }
    }
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
    if (!active) {
      setIsGenerating(false);
      return;
    }
    if (!workerEnabled) {
      startFallbackGeneration(requestId, nextSeed);
      return;
    }

    try {
      const worker = createSimulationWorker(nextSeed);
      worker.postMessage({
        requestId,
        seed: nextSeed,
      } satisfies SimulationRequest);
    } catch {
      if (workerFallbackEnabled) {
        startFallbackGeneration(requestId, nextSeed);
      } else {
        setIsGenerating(false);
        setGenerationError("Simulation worker failed.");
      }
    }
  }

  const clearPreloadRetry = useCallback(() => {
    if (preloadRetryTimeoutRef.current !== undefined) {
      window.clearTimeout(preloadRetryTimeoutRef.current);
      preloadRetryTimeoutRef.current = undefined;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: preload state is guarded through refs so retry callbacks never close over stale state.
  const preloadNextRound = useCallback(() => {
    if (
      !active ||
      !preloadEnabled ||
      queuedRoundRef.current ||
      isPreloadingNextRoundRef.current
    ) {
      return;
    }
    startNextRoundPreload();
  }, [active, preloadEnabled]);

  function retryPreloadNextRound() {
    if (!active || !preloadEnabled) {
      setQueuedPreloadRound(undefined);
      setNextRoundPreloading(false);
      return;
    }
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
    setEventIndex(0);
    setQueuedPreloadRound(undefined);
    setNextRoundPreloading(false);
    return true;
  }, [
    clearEventScrub,
    clearPendingStep,
    clearPreloadRetry,
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

  function clearFallbackGeneration() {
    if (fallbackGenerationTimeoutRef.current !== undefined) {
      window.clearTimeout(fallbackGenerationTimeoutRef.current);
      fallbackGenerationTimeoutRef.current = undefined;
    }
  }

  function clearFallbackPreload() {
    if (fallbackPreloadTimeoutRef.current !== undefined) {
      window.clearTimeout(fallbackPreloadTimeoutRef.current);
      fallbackPreloadTimeoutRef.current = undefined;
    }
  }

  function startFallbackGeneration(requestId: number, seed: string) {
    clearFallbackGeneration();
    workerRef.current?.terminate();
    workerRef.current = null;
    fallbackGenerationTimeoutRef.current = window.setTimeout(() => {
      fallbackGenerationTimeoutRef.current = undefined;
      if (!active || requestId !== requestIdRef.current) {
        return;
      }
      try {
        const result = simulateRoundForSeed(seed);
        if (requestId !== requestIdRef.current) {
          return;
        }
        setGenerationError(undefined);
        setGame(result);
        setEventIndex(0);
        setIsGenerating(false);
      } catch (error) {
        setIsGenerating(false);
        setGenerationError(
          error instanceof Error ? error.message : "Simulation failed.",
        );
      }
    }, 0);
  }

  function startFallbackPreload(requestId: number, seed = randomSeed()): void {
    if (!active || !preloadEnabled) {
      return;
    }
    clearFallbackPreload();
    preloadWorkerRef.current?.terminate();
    preloadWorkerRef.current = null;
    setNextRoundPreloading(true);
    fallbackPreloadTimeoutRef.current = window.setTimeout(() => {
      fallbackPreloadTimeoutRef.current = undefined;
      if (
        !active ||
        !preloadEnabled ||
        requestId !== preloadRequestIdRef.current
      ) {
        return;
      }
      try {
        const result = simulateRoundForSeed(seed);
        setQueuedPreloadRound({
          seed: result.seed,
          result,
        });
        setNextRoundPreloading(false);
      } catch {
        retryPreloadNextRound();
      }
    }, 0);
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
    case "winDeclared":
      return new Set([event.tile.id]);
    case "flowerExposed":
      return new Set(event.tiles.map((tile) => tile.id));
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

function seedFromUrlOrRandom(defaultSeed?: string): string {
  const seed = new URLSearchParams(window.location.search).get("seed")?.trim();
  return seed || defaultSeed || randomSeed();
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
