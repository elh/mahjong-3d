import { useEffect, useMemo, useRef, useState } from "react";
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

export function useSimulationController() {
  const initialSeed = useMemo(() => seedFromUrlOrRandom(), []);
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [pendingSeed, setPendingSeed] = useState(initialSeed);
  const [game, setGame] = useState<SimulateRoundResult | undefined>();
  const [isGenerating, setIsGenerating] = useState(true);
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [eventIndex, setEventIndex] = useState(0);
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const holdDelayRef = useRef<number | undefined>(undefined);
  const holdIntervalRef = useRef<number | undefined>(undefined);
  const suppressStepClickRef = useRef(false);
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
      clearEventHold();
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

      setIsGenerating(false);
      if (event.data.status === "error") {
        setGenerationError(event.data.message);
        return;
      }

      setGenerationError(undefined);
      setGame(event.data.result);
      setEventIndex(firstTurnEventIndex(event.data.result.events));
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

  function queueSimulation(
    seed: string,
    options: { replaceUrl?: boolean } = {},
  ) {
    const nextSeed = seed.trim() || randomSeed();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    syncSeedQueryParam(nextSeed, options.replaceUrl ? "replace" : "push");
    setSeedInput(nextSeed);
    setPendingSeed(nextSeed);
    setIsGenerating(true);
    setGenerationError(undefined);
    setEventIndex(0);
    const worker = createSimulationWorker();
    worker.postMessage({
      requestId,
      seed: nextSeed,
    } satisfies SimulationRequest);
  }

  function newSeed() {
    queueSimulation(randomSeed());
  }

  function restart() {
    setEventIndex(0);
  }

  function startTypedSeed() {
    const seed = seedInput.trim() || randomSeed();
    queueSimulation(seed);
  }

  function stepEvent(direction: -1 | 1) {
    setEventIndex((index) =>
      Math.min(Math.max(0, index + direction), Math.max(events.length - 1, 0)),
    );
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
    setEventIndex,
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
    case "claimMade":
      return new Set(event.tiles.map((tile) => tile.id));
    case "kongDeclared":
      return new Set(event.tiles.map((tile) => tile.id));
    case "roundStarted":
    case "drawDeclared":
    case "rulesError":
      return new Set();
  }
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

function firstTurnEventIndex(events: readonly GameEvent[]): number {
  const index = events.findIndex((event) => event.phase === "turn");
  return index === -1 ? 0 : index;
}
