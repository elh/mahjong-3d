import {
  ChevronLeft,
  ChevronRight,
  Play,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBaselineBots } from "./bots/baselineBot";
import { simulateRound, type SimulateRoundResult } from "./sim/engine";
import type { GameEvent } from "./sim/events";
import { replayEvents } from "./sim/replay";
import { tileLabel, type TileInstance } from "./sim/tiles";

const playerNames = ["East", "South", "West", "North"] as const;

function runGame(seed: string): SimulateRoundResult {
  return simulateRound({
    seed,
    bots: createBaselineBots(),
  });
}

export default function App() {
  const [seedInput, setSeedInput] = useState("concealed-gang-preview");
  const [game, setGame] = useState(() => runGame("concealed-gang-preview"));
  const [eventIndex, setEventIndex] = useState(0);
  const activeEventRef = useRef<HTMLButtonElement | null>(null);
  const replay = useMemo(
    () => replayEvents(game.events, eventIndex),
    [game.events, eventIndex],
  );
  const currentEvent = game.events[eventIndex];
  const eventGroups = useMemo(() => groupEvents(game.events), [game.events]);
  const highlightedTileIds = useMemo(
    () => activeTileIds(currentEvent),
    [currentEvent],
  );
  const atStart = eventIndex === 0;
  const atEnd = eventIndex === game.events.length - 1;

  useEffect(() => {
    activeEventRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [eventIndex]);

  function runSeed(seed: string) {
    const nextSeed = seed.trim() || `game-${Date.now()}`;
    const nextGame = runGame(nextSeed);
    setSeedInput(nextSeed);
    setGame(nextGame);
    setEventIndex(0);
  }

  function newSeed() {
    runSeed(`game-${Date.now()}`);
  }

  function restart() {
    setEventIndex(0);
  }

  function startTypedSeed() {
    const seed = seedInput.trim() || `game-${Date.now()}`;
    runSeed(seed);
  }

  return (
    <main className="app-shell">
      <section className="status-band">
        <div>
          <p className="eyebrow">Taiwanese 16-tile Mahjong simulator</p>
          <h1>Concealed Gang</h1>
        </div>
        <div className="run-summary">
          <Play size={18} aria-hidden="true" />
          <span>{game.events.length} events</span>
        </div>
      </section>

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
            disabled={atStart}
            aria-label="Previous event"
            title="Previous event"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              setEventIndex((index) => Math.min(game.events.length - 1, index + 1))
            }
            disabled={atEnd}
            aria-label="Next event"
            title="Next event"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <label className="timeline">
          <span>
            Event {eventIndex + 1} / {game.events.length}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(game.events.length - 1, 0)}
            value={eventIndex}
            onChange={(event) => setEventIndex(Number(event.target.value))}
          />
        </label>
      </section>

      <section className="viewer-shell" aria-label="Simulation viewer">
        <article className="event-panel">
          <p className="eyebrow">Current event</p>
          <h2>{formatEventTitle(currentEvent)}</h2>
          <p>{formatEventDetail(currentEvent)}</p>
          <dl>
            <div>
              <dt>Group</dt>
              <dd>{formatGroupLabel(currentEvent)}</dd>
            </div>
            <div>
              <dt>Seed</dt>
              <dd>{game.seed}</dd>
            </div>
            <div>
              <dt>Wall remaining</dt>
              <dd>{replay.wallCount}</dd>
            </div>
            <div>
              <dt>Dead wall</dt>
              <dd>{replay.deadWallCount}</dd>
            </div>
            <div>
              <dt>Winner</dt>
              <dd>
                {replay.winners?.length
                  ? replay.winners.map((winner) => playerNames[winner]).join(", ")
                  : "None"}
              </dd>
            </div>
          </dl>
        </article>

        <div className="event-list" aria-label="Event log">
          {eventGroups.map((group) => (
            <section className="event-group" key={group.id}>
              <button
                type="button"
                className={
                  group.events.some((entry) => entry.index === eventIndex)
                    ? "event-group-header active"
                    : "event-group-header"
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
                    className={index === eventIndex ? "event-row active" : "event-row"}
                    onClick={() => setEventIndex(index)}
                  >
                    <span>{String(index + 1).padStart(3, "0")}</span>
                    <strong>{formatEventTitle(event)}</strong>
                  </button>
                ))}
            </section>
          ))}
        </div>
      </section>

      <section className="table-grid" aria-label="Player states">
        {replay.players.map((player) => (
          <article className="player-panel" key={player.id}>
            <header>
              <h2>{playerNames[player.id]}</h2>
              <span>{player.hand.length} tiles</span>
            </header>
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
          </article>
        ))}
      </section>

      <section className="wall-panel" aria-label="Wall state">
        <header>
          <div>
            <p className="eyebrow">Wall</p>
            <h2>Remaining tiles</h2>
          </div>
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
              {tileLabel(tile)}
            </span>
          ))
        )}
      </div>
    </section>
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
      return new Set();
  }
}

function formatEventTitle(event: GameEvent | undefined): string {
  if (!event) {
    return "No event";
  }
  switch (event.type) {
    case "roundStarted":
      return "Round started";
    case "tileDrawn":
      return `${playerNames[event.player]} drew ${tileLabel(event.tile)}`;
    case "tileDiscarded":
      return `${playerNames[event.player]} discarded ${tileLabel(event.tile)}`;
    case "claimMade":
      return `${playerNames[event.player]} claimed ${event.claim}`;
    case "kongDeclared":
      return `${playerNames[event.player]} declared concealed kong`;
    case "winDeclared":
      return `${playerNames[event.player]} declared win`;
    case "roundEnded":
      return "Round ended";
  }
}

function formatGroupLabel(event: GameEvent | undefined): string {
  if (!event) {
    return "None";
  }
  return event.phase === "setup" ? "Initial deal" : `Turn ${event.turn + 1}`;
}

function formatEventDetail(event: GameEvent | undefined): string {
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
      return `${playerNames[event.player]} took ${tileLabel(event.tile)} from ${playerNames[event.from]} for a ${event.claim}.`;
    case "kongDeclared":
      return `${playerNames[event.player]} exposed four matching concealed tiles and must draw a supplement tile before discarding.`;
    case "winDeclared":
      return event.from === undefined
        ? `${playerNames[event.player]} won by self draw on ${tileLabel(event.tile)}.`
        : `${playerNames[event.player]} won on ${playerNames[event.from]}'s ${tileLabel(event.tile)}.`;
    case "roundEnded":
      return event.winners?.length
        ? `${event.winners.map((winner) => playerNames[winner]).join(", ")} won after ${event.turn} turns.`
        : event.winner === undefined
        ? `Ended by ${event.reason} after ${event.turn} turns.`
        : `${playerNames[event.winner]} won after ${event.turn} turns.`;
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
