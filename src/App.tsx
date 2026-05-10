import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { SimulateRoundResult } from "./sim/engine";
import type { GameEvent } from "./sim/events";
import { replayEvents } from "./sim/replay";
import type {
  SimulationRequest,
  SimulationResponse,
} from "./sim/simulationWorker";
import type { TileInstance } from "./sim/tiles";
import { tileAlt, tileImage } from "./ui/tileImages";

const playerNames = ["East", "South", "West", "North"] as const;
const defaultSeed = "concealed-gang-preview";

export default function App() {
  const [seedInput, setSeedInput] = useState(defaultSeed);
  const [pendingSeed, setPendingSeed] = useState(defaultSeed);
  const [game, setGame] = useState<SimulateRoundResult | undefined>();
  const [isGenerating, setIsGenerating] = useState(true);
  const [generationError, setGenerationError] = useState<string | undefined>();
  const [eventIndex, setEventIndex] = useState(0);
  const activeEventRef = useRef<HTMLButtonElement | null>(null);
  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
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

  useEffect(() => {
    queueSimulation(defaultSeed);

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentEvent) {
      return;
    }
    activeEventRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [currentEvent]);

  function createSimulationWorker() {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./sim/simulationWorker.ts", import.meta.url), {
      type: "module",
    });
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
      setEventIndex(0);
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

  function queueSimulation(seed: string) {
    const nextSeed = seed.trim() || `game-${Date.now()}`;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSeedInput(nextSeed);
    setPendingSeed(nextSeed);
    setIsGenerating(true);
    setGenerationError(undefined);
    setEventIndex(0);
    const worker = createSimulationWorker();
    worker?.postMessage({
      requestId,
      seed: nextSeed,
    } satisfies SimulationRequest);
  }

  function newSeed() {
    queueSimulation(`game-${Date.now()}`);
  }

  function restart() {
    setEventIndex(0);
  }

  function startTypedSeed() {
    const seed = seedInput.trim() || `game-${Date.now()}`;
    queueSimulation(seed);
  }

  return (
    <main className="app-shell">
      <section className="controls-band" aria-label="Game controls">
        <label className="seed-field">
          <span>Seed</span>
          <input
            value={seedInput}
            onChange={(event) => setSeedInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                startTypedSeed();
              }
            }}
          />
        </label>
        <button type="button" className="primary-button" onClick={newSeed}>
          <RefreshCw size={18} aria-hidden="true" />
          <span>New Seed</span>
        </button>
        <button type="button" className="secondary-button" onClick={restart}>
          <SkipBack size={18} aria-hidden="true" />
          <span>Restart</span>
        </button>
        <div className="step-controls">
          <button
            type="button"
            onClick={() => setEventIndex((index) => Math.max(0, index - 1))}
            disabled={atStart || events.length === 0}
            aria-label="Previous event"
            title="Previous event"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              setEventIndex((index) => Math.min(events.length - 1, index + 1))
            }
            disabled={atEnd || events.length === 0}
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
            disabled={events.length === 0}
            onChange={(event) => setEventIndex(Number(event.target.value))}
          />
        </label>
      </section>

      {(isGenerating || generationError) && (
        <section
          className={generationError ? "generation-pill error" : "generation-pill"}
          aria-live="polite"
        >
          {generationError
            ? `Could not generate ${pendingSeed}: ${generationError}`
            : `Generating ${pendingSeed}...`}
        </section>
      )}

      <section className="viewer-shell" aria-label="Simulation viewer">
        <section className="wall-panel" aria-label="Wall state">
          <header>
            <h2>Remaining tiles</h2>
            <span>
              {replay.wall.length} live / {replay.deadWall.length} dead
            </span>
          </header>
          <TileGroup
            title="Live wall"
            tiles={replay.wall}
            highlightedTileIds={highlightedTileIds}
          />
          <TileGroup
            title="Dead wall"
            tiles={replay.deadWall}
            highlightedTileIds={highlightedTileIds}
          />
        </section>

        <section className="event-rail" aria-label="Event detail and log">
          <article className="event-panel">
            <p className="eyebrow">Current event</p>
            <h2>{eventTitle(currentEvent)}</h2>
            <p>{eventDetail(currentEvent)}</p>
          </article>

          {replay.rulesErrors.length > 0 && (
            <section className="rules-error" aria-label="Rules errors">
              <p className="eyebrow">Rules error</p>
              {replay.rulesErrors.map((error, index) => (
                <p key={`${error.player}-${error.turn}-${index}`}>{error.message}</p>
              ))}
            </section>
          )}

          <div className="event-list" aria-label="Event log">
            {eventGroups.map((group) => {
              const isActiveGroup = group.events.some(
                (entry) => entry.index === eventIndex,
              );
              return (
                <section className="event-group" key={group.id}>
                  <button
                    type="button"
                    ref={
                      isActiveGroup && group.phase === "setup" ? activeEventRef : null
                    }
                    className={
                      isActiveGroup ? "event-group-header active" : "event-group-header"
                    }
                    onClick={() => setEventIndex(group.events[0]?.index ?? 0)}
                  >
                    <strong>{group.label}</strong>
                    <span>{group.events.length} events</span>
                  </button>
                  {group.phase === "turn" &&
                    group.events.map(({ event, index }) => (
                      <button
                        type="button"
                        key={`${event.type}-${index}`}
                        ref={index === eventIndex ? activeEventRef : null}
                        className={
                          index === eventIndex ? "event-row active" : "event-row"
                        }
                        onClick={() => setEventIndex(index)}
                      >
                        <span>{String(index + 1).padStart(3, "0")}</span>
                        <strong>{eventTitle(event)}</strong>
                      </button>
                    ))}
                </section>
              );
            })}
          </div>
        </section>
      </section>

      <section className="table-grid" aria-label="Player states">
        {replay.players.map((player) => (
          <article className="player-panel" key={player.id}>
            <header>
              <h2>{playerNames[player.id]}</h2>
              <span>{player.hand.length} tiles</span>
            </header>
            <div className="player-tile-rows">
              <div className="player-tile-row">
                <TileGroup
                  title="Hand"
                  tiles={player.hand}
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
                />
                <TileGroup
                  title="Flowers"
                  tiles={player.flowers}
                  highlightedTileIds={highlightedTileIds}
                />
              </div>
            </div>
          </article>
        ))}
      </section>

      <footer className="asset-attribution">
        Tile art adapted from{" "}
        <a href="https://demching.itch.io/mahjong">DemChing/Cangjie6</a>,{" "}
        <a href="/tiles/ATTRIBUTION.md">CC BY-SA 4.0</a>.
      </footer>
    </main>
  );
}

function TileGroup({
  title,
  tiles,
  highlightedTileIds,
}: {
  title: string;
  tiles: readonly TileInstance[];
  highlightedTileIds: ReadonlySet<string>;
}) {
  return (
    <section className="tile-group">
      <h3>{title}</h3>
      <div className="tiles">
        {tiles.length === 0 ? (
          <span className="empty">None</span>
        ) : (
          tiles.map((tile) => (
            <span
              className={highlightedTileIds.has(tile.id) ? "tile highlighted" : "tile"}
              key={tile.id}
              title={tile.id}
            >
              <img src={tileImage(tile)} alt={tileAlt(tile)} loading="lazy" />
            </span>
          ))
        )}
      </div>
    </section>
  );
}

function InlineTile({ tile }: { tile: TileInstance }) {
  return (
    <span className="inline-tile" title={tile.id}>
      <img src={tileImage(tile)} alt={tileAlt(tile)} loading="lazy" />
    </span>
  );
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
    case "claimMade":
      return new Set(event.tiles.map((tile) => tile.id));
    case "kongDeclared":
      return new Set(event.tiles.map((tile) => tile.id));
    case "roundStarted":
    case "roundEnded":
    case "rulesError":
      return new Set();
  }
}

function eventTitle(event: GameEvent | undefined): ReactNode {
  if (!event) {
    return "No event";
  }
  switch (event.type) {
    case "roundStarted":
      return "Round started";
    case "tileDrawn":
      return (
        <>
          {playerNames[event.player]} drew <InlineTile tile={event.tile} />
        </>
      );
    case "tileDiscarded":
      return (
        <>
          {playerNames[event.player]} discarded <InlineTile tile={event.tile} />
        </>
      );
    case "claimMade":
      return (
        <>
          {playerNames[event.player]} claimed {event.claim}{" "}
          <InlineTile tile={event.tile} />
        </>
      );
    case "kongDeclared":
      return (
        <>
          {playerNames[event.player]} declared concealed kong{" "}
          {event.tiles.map((tile) => (
            <InlineTile key={tile.id} tile={tile} />
          ))}
        </>
      );
    case "winDeclared":
      return (
        <>
          {playerNames[event.player]} declared win <InlineTile tile={event.tile} />
        </>
      );
    case "roundEnded":
      return "Round ended";
    case "rulesError":
      return `Rules error for ${playerNames[event.player]}`;
  }
}

function eventDetail(event: GameEvent | undefined): ReactNode {
  if (!event) {
    return "Start a game to create an event log.";
  }
  switch (event.type) {
    case "roundStarted":
      return `${playerNames[event.dealer]} is dealer. Each player has ${event.handCounts.join(", ")} concealed tiles.`;
    case "tileDrawn":
      return `${event.replacement ? "Supplement draw" : "Turn draw"} from ${event.source === "deadWall" ? "dead wall" : "live wall"} with ${event.wallCount} live tiles left.`;
    case "tileDiscarded":
      return `${playerNames[event.player]} now has ${event.handCount} concealed tiles.`;
    case "claimMade":
      return (
        <>
          {playerNames[event.player]} took <InlineTile tile={event.tile} /> from{" "}
          {playerNames[event.from]} for a {event.claim}.
        </>
      );
    case "kongDeclared":
      return `${playerNames[event.player]} exposed four matching concealed tiles and must draw a supplement tile before discarding.`;
    case "winDeclared":
      return event.from === undefined
        ? (
          <>
            {playerNames[event.player]} won by self draw on{" "}
            <InlineTile tile={event.tile} />.
          </>
        )
        : (
          <>
            {playerNames[event.player]} won on {playerNames[event.from]}'s{" "}
            <InlineTile tile={event.tile} />.
          </>
        );
    case "roundEnded":
      return event.winners?.length
        ? `${event.winners.map((winner) => playerNames[winner]).join(", ")} won after ${event.turn} turns.`
        : event.winner === undefined
        ? `Ended by ${event.reason} after ${event.turn} turns.`
        : `${playerNames[event.winner]} won after ${event.turn} turns.`;
    case "rulesError":
      return event.message;
  }
}

type EventGroup = {
  id: string;
  phase: "setup" | "turn";
  label: string;
  events: { event: GameEvent; index: number }[];
};

function groupEvents(events: readonly GameEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  events.forEach((event, index) => {
    const group = groups.get(event.groupId) ?? {
      id: event.groupId,
      phase: event.phase,
      label: event.phase === "setup" ? "Initial deal" : `Turn ${event.turn + 1}`,
      events: [],
    };
    group.events.push({ event, index });
    groups.set(event.groupId, group);
  });
  return [...groups.values()];
}
