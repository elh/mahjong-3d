import {
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { eventDetail, eventTitle } from "./ui/eventText";
import { InfoModal } from "./ui/InfoModal";
import { playerNames } from "./ui/playerNames";
import { TileGroup } from "./ui/TileGroup";
import { useSimulationController } from "./ui/useSimulationController";

export default function App() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const activeEventRef = useRef<HTMLButtonElement | null>(null);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const infoModalRef = useRef<HTMLElement | null>(null);
  const simulation = useSimulationController();
  const {
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
  } = simulation;

  useEffect(() => {
    if (!currentEvent) {
      return;
    }
    activeEventRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [currentEvent]);

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
            onClick={() => clickStepButton(-1)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                startEventHold(-1, canStepPrevious);
              }
            }}
            onPointerUp={clearEventHold}
            onPointerCancel={cancelEventHold}
            onPointerLeave={cancelEventHold}
            disabled={!canStepPrevious}
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
            disabled={!canStepNext}
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

          <section
            className="event-list"
            aria-label="Event log"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                stepEvent(1);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                stepEvent(-1);
              }
            }}
          >
            {eventGroups.map((group) => {
              const isActiveGroup = group.events.some(
                (entry) => entry.index === eventIndex,
              );
              return (
                <section className="event-group" key={group.id}>
                  <button
                    type="button"
                    ref={
                      isActiveGroup && group.phase === "setup"
                        ? activeEventRef
                        : null
                    }
                    className={
                      isActiveGroup
                        ? "event-group-header active"
                        : "event-group-header"
                    }
                    onClick={() => setEventIndex(group.events[0]?.index ?? 0)}
                  >
                    <strong>{group.label}</strong>
                    {group.phase === "setup" && (
                      <span>{group.events.length} events</span>
                    )}
                  </button>
                  {group.phase === "turn" &&
                    group.events.map(({ event, index }) => (
                      <button
                        type="button"
                        key={`${event.type}-${index}`}
                        ref={index === eventIndex ? activeEventRef : null}
                        className={
                          index === eventIndex
                            ? "event-row active"
                            : "event-row"
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
          </section>
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

      {isInfoOpen && <InfoModal modalRef={infoModalRef} />}
    </main>
  );
}
